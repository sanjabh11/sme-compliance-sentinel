import type { ResourceEvent } from "@/lib/types";
import { createDemoEvent } from "@/lib/store";
import { sentinelConfig } from "@/lib/config";

const tokenInfoEndpoint = "https://oauth2.googleapis.com/tokeninfo";

export class WebhookRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string
  ) {
    super(message);
  }
}

export type WorkspaceWebhookResult =
  | {
      kind: "demo-event";
      event: ResourceEvent;
    }
  | {
      kind: "notification";
      source: "drive" | "gmail";
      receivedAt: string;
      subscription?: string;
      messageId?: string;
      messageNumber?: string;
      channelId?: string;
      resourceId?: string;
      resourceState?: string;
      payloadSummary: string;
    };

export async function parsePubSubOrDemoRequest(
  request: Request,
  fallbackKind: "public-secret" | "gmail-pii",
  options: { source?: "drive" | "gmail"; fetchImpl?: typeof fetch } = {}
): Promise<WorkspaceWebhookResult> {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const source = options.source ?? (fallbackKind === "gmail-pii" ? "gmail" : "drive");

  if (typeof body.demo === "string") {
    if (!sentinelConfig.mockMode) {
      throw new WebhookRequestError(403, "Demo webhook payloads are disabled when SENTINEL_MOCK_MODE=false.", "demo-disabled");
    }

    return {
      kind: "demo-event",
      event: createDemoEvent(normalizeDemoKind(body.demo, fallbackKind))
    };
  }

  await validateWorkspaceWebhookRequest(request, body, source, options.fetchImpl ?? fetch);
  return parseNotificationHint(request, body, source);
}

function parseNotificationHint(request: Request, body: Record<string, unknown>, source: "drive" | "gmail"): WorkspaceWebhookResult {
  if (source === "drive" && hasDriveChannelHeaders(request.headers)) {
    return {
      kind: "notification",
      source,
      receivedAt: new Date().toISOString(),
      channelId: request.headers.get("x-goog-channel-id") ?? undefined,
      messageNumber: request.headers.get("x-goog-message-number") ?? undefined,
      resourceId: request.headers.get("x-goog-resource-id") ?? undefined,
      resourceState: request.headers.get("x-goog-resource-state") ?? undefined,
      payloadSummary: "Authenticated Drive channel notification accepted as a reconciliation hint; payload was not trusted as a finding event."
    };
  }

  if (body.message && typeof body.message === "object") {
    const message = body.message as { data?: string; messageId?: string };
    return {
      kind: "notification",
      source,
      receivedAt: new Date().toISOString(),
      subscription: typeof body.subscription === "string" ? body.subscription : undefined,
      messageId: message.messageId,
      payloadSummary: summarizePubSubData(message.data)
    };
  }

  return {
    kind: "notification",
    source,
    receivedAt: new Date().toISOString(),
    payloadSummary: "Authenticated Workspace webhook notification accepted as a reconciliation hint with no trusted message payload."
  };
}

async function validateWorkspaceWebhookRequest(
  request: Request,
  body: Record<string, unknown>,
  source: "drive" | "gmail",
  fetchImpl: typeof fetch
) {
  if (sentinelConfig.workspaceWebhookAuthMode === "demo") {
    throw new WebhookRequestError(401, "Non-demo Workspace webhook requests require authenticated production mode.", "auth-required");
  }

  if (source === "drive" && hasDriveChannelHeaders(request.headers)) {
    validateDriveChannelToken(request.headers);
    return;
  }

  await validateAuthenticatedPubSubPush(request, body, source, fetchImpl);
}

function hasDriveChannelHeaders(headers: Headers) {
  return Boolean(headers.get("x-goog-channel-id") || headers.get("x-goog-resource-id") || headers.get("x-goog-resource-state"));
}

function validateDriveChannelToken(headers: Headers) {
  if (!sentinelConfig.workspaceDriveChannelTokenConfigured) {
    throw new WebhookRequestError(401, "Drive push channel token is not configured.", "drive-channel-token-missing");
  }

  const receivedToken = headers.get("x-goog-channel-token") ?? "";
  if (!safeEqual(receivedToken, sentinelConfig.workspaceDriveChannelToken)) {
    throw new WebhookRequestError(403, "Drive push channel token did not match the configured value.", "drive-channel-token-invalid");
  }
}

async function validateAuthenticatedPubSubPush(
  request: Request,
  body: Record<string, unknown>,
  source: "drive" | "gmail",
  fetchImpl: typeof fetch
) {
  if (!sentinelConfig.workspacePubSubPushAudience || !sentinelConfig.workspacePubSubServiceAccountEmail) {
    throw new WebhookRequestError(
      401,
      "Authenticated Pub/Sub push requires WORKSPACE_PUBSUB_PUSH_AUDIENCE and WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL.",
      "pubsub-auth-config-missing"
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/iu)?.[1];

  if (!token) {
    throw new WebhookRequestError(401, "Authenticated Pub/Sub push did not include a bearer OIDC token.", "pubsub-token-missing");
  }

  const tokenInfo = await fetchTokenInfo(token, fetchImpl);
  if (tokenInfo.aud !== sentinelConfig.workspacePubSubPushAudience) {
    throw new WebhookRequestError(403, "Authenticated Pub/Sub push token audience did not match this webhook.", "pubsub-audience-invalid");
  }

  if (tokenInfo.email !== sentinelConfig.workspacePubSubServiceAccountEmail) {
    throw new WebhookRequestError(403, "Authenticated Pub/Sub push token email did not match the configured service account.", "pubsub-email-invalid");
  }

  if (typeof tokenInfo.email_verified !== "undefined" && tokenInfo.email_verified !== "true" && tokenInfo.email_verified !== true) {
    throw new WebhookRequestError(403, "Authenticated Pub/Sub push token email is not verified.", "pubsub-email-unverified");
  }

  if (source === "gmail" && sentinelConfig.gmailPubSubSubscription) {
    const subscription = typeof body.subscription === "string" ? body.subscription : "";
    if (subscription !== sentinelConfig.gmailPubSubSubscription) {
      throw new WebhookRequestError(403, "Gmail Pub/Sub push subscription did not match the configured subscription.", "pubsub-subscription-invalid");
    }
  }
}

async function fetchTokenInfo(token: string, fetchImpl: typeof fetch) {
  const url = new URL(tokenInfoEndpoint);
  url.searchParams.set("id_token", token);
  const response = await fetchImpl(url.toString());
  const payload = (await response.json().catch(() => ({}))) as {
    aud?: string;
    email?: string;
    email_verified?: string | boolean;
    error?: string;
    error_description?: string;
  };

  if (!response.ok) {
    throw new WebhookRequestError(
      401,
      `Unable to verify Pub/Sub push token: ${payload.error_description ?? payload.error ?? response.status}.`,
      "pubsub-token-invalid"
    );
  }

  return payload;
}

function normalizeDemoKind(value: string, fallbackKind: "public-secret" | "gmail-pii") {
  if (value === "low-risk" || value === "public-secret" || value === "gmail-pii") {
    return value;
  }

  return fallbackKind;
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function summarizePubSubData(data?: string) {
  if (!data) {
    return "Authenticated Pub/Sub push contained no data payload; reconciliation is still required.";
  }

  try {
    const decoded = JSON.parse(decodeBase64Url(data)) as Record<string, unknown>;
    const keys = Object.keys(decoded).sort().slice(0, 8);
    return `Authenticated Pub/Sub push data keys: ${keys.join(", ") || "none"}. Data is treated as a cursor hint, not a trusted finding event.`;
  } catch {
    return "Authenticated Pub/Sub push data was not JSON; reconciliation is required before scanning.";
  }
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return result === 0;
}
