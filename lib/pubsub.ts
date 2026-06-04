import { sentinelConfig } from "@/lib/config";
import { createDemoEvent } from "@/lib/store";
import type { ResourceEvent } from "@/lib/types";

const googleOidcJwksEndpoint = "https://www.googleapis.com/oauth2/v3/certs";
const googleTokenIssuers = new Set(["https://accounts.google.com", "accounts.google.com"]);

type GoogleOidcJwk = JsonWebKey & {
  kid?: string;
  alg?: string;
  use?: string;
};

type GoogleOidcClaims = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  email?: string;
  email_verified?: string | boolean;
};

let jwksCache: { keys: GoogleOidcJwk[]; expiresAtMs: number } | undefined;

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

  const tokenClaims = await verifyGoogleOidcToken(token, fetchImpl);
  if (!audienceMatches(tokenClaims.aud, sentinelConfig.workspacePubSubPushAudience)) {
    throw new WebhookRequestError(403, "Authenticated Pub/Sub push token audience did not match this webhook.", "pubsub-audience-invalid");
  }

  if (tokenClaims.email !== sentinelConfig.workspacePubSubServiceAccountEmail) {
    throw new WebhookRequestError(403, "Authenticated Pub/Sub push token email did not match the configured service account.", "pubsub-email-invalid");
  }

  if (tokenClaims.email_verified !== "true" && tokenClaims.email_verified !== true) {
    throw new WebhookRequestError(403, "Authenticated Pub/Sub push token email is not verified.", "pubsub-email-unverified");
  }

  if (source === "gmail" && sentinelConfig.gmailPubSubSubscription) {
    const subscription = typeof body.subscription === "string" ? body.subscription : "";
    if (subscription !== sentinelConfig.gmailPubSubSubscription) {
      throw new WebhookRequestError(403, "Gmail Pub/Sub push subscription did not match the configured subscription.", "pubsub-subscription-invalid");
    }
  }
}

async function verifyGoogleOidcToken(token: string, fetchImpl: typeof fetch): Promise<GoogleOidcClaims> {
  const tokenParts = token.split(".");
  if (tokenParts.length !== 3) {
    throw new WebhookRequestError(401, "Authenticated Pub/Sub push token is not a signed OIDC JWT.", "pubsub-token-invalid");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = tokenParts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new WebhookRequestError(401, "Authenticated Pub/Sub push token is not a signed OIDC JWT.", "pubsub-token-invalid");
  }

  const header = parseJwtPart<{ alg?: string; kid?: string }>(encodedHeader, "header");
  if (header.alg !== "RS256" || !header.kid) {
    throw new WebhookRequestError(401, "Authenticated Pub/Sub push token header is not a Google RS256 JWT.", "pubsub-token-invalid");
  }

  const jwk = await findGoogleOidcJwk(header.kid, fetchImpl);
  const publicKey = await importGoogleOidcPublicKey(jwk);
  const signingInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = decodeBase64UrlToBytes(encodedSignature);
  const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature, signingInput);

  if (!verified) {
    throw new WebhookRequestError(401, "Authenticated Pub/Sub push token signature could not be verified.", "pubsub-token-invalid");
  }

  const claims = parseJwtPart<GoogleOidcClaims>(encodedPayload, "payload");
  validateGoogleOidcClaims(claims);
  return claims;
}

function parseJwtPart<T>(encoded: string, label: string): T {
  try {
    return JSON.parse(decodeBase64Url(encoded)) as T;
  } catch {
    throw new WebhookRequestError(401, `Authenticated Pub/Sub push token ${label} is not valid JSON.`, "pubsub-token-invalid");
  }
}

async function findGoogleOidcJwk(kid: string, fetchImpl: typeof fetch) {
  const keys = await fetchGoogleOidcJwks(fetchImpl);
  const jwk = keys.find(
    (candidate) =>
      candidate.kid === kid &&
      candidate.kty === "RSA" &&
      (!candidate.alg || candidate.alg === "RS256") &&
      (!candidate.use || candidate.use === "sig")
  );
  if (!jwk) {
    throw new WebhookRequestError(401, "Authenticated Pub/Sub push token key id is not in Google's OIDC key set.", "pubsub-token-invalid");
  }

  return jwk;
}

async function fetchGoogleOidcJwks(fetchImpl: typeof fetch) {
  const now = Date.now();
  if (fetchImpl === fetch && jwksCache && jwksCache.expiresAtMs > now) {
    return jwksCache.keys;
  }

  const response = await fetchImpl(googleOidcJwksEndpoint);
  const payload = (await response.json().catch(() => ({}))) as { keys?: GoogleOidcJwk[] };
  if (!response.ok || !Array.isArray(payload.keys)) {
    throw new WebhookRequestError(401, `Unable to fetch Google's OIDC key set: ${response.status}.`, "pubsub-token-invalid");
  }

  if (fetchImpl === fetch) {
    jwksCache = {
      keys: payload.keys,
      expiresAtMs: now + parseCacheMaxAgeMs(response.headers.get("cache-control"))
    };
  }

  return payload.keys;
}

async function importGoogleOidcPublicKey(jwk: GoogleOidcJwk) {
  return crypto.subtle.importKey(
    "jwk",
    { ...jwk, ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

function validateGoogleOidcClaims(claims: GoogleOidcClaims) {
  if (!claims.iss || !googleTokenIssuers.has(claims.iss)) {
    throw new WebhookRequestError(401, "Authenticated Pub/Sub push token issuer is not Google.", "pubsub-token-invalid");
  }

  if (!claims.exp || claims.exp * 1000 <= Date.now()) {
    throw new WebhookRequestError(401, "Authenticated Pub/Sub push token is expired.", "pubsub-token-invalid");
  }
}

function audienceMatches(actual: string | string[] | undefined, expected: string) {
  return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
}

function parseCacheMaxAgeMs(cacheControl: string | null) {
  const seconds = Number(cacheControl?.match(/max-age=(\d+)/iu)?.[1] ?? "300");
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 300000;
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

function decodeBase64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
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
