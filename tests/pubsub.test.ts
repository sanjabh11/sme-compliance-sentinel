import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResourceEvent } from "@/lib/types";

const webhookTestTimeoutMs = 30000;

function sampleEvent(source: ResourceEvent["source"] = "gmail"): ResourceEvent {
  return {
    id: `evt_${source}_auth`,
    tenantId: "tenant_mainstreet_security",
    source,
    resourceId: "resource_123",
    resourceName: "Security review packet",
    mimeType: "application/vnd.google-apps.document",
    actorEmail: "founder@example.com",
    ownerEmail: "founder@example.com",
    eventType: "updated",
    occurredAt: "2026-05-23T00:00:00.000Z",
    metadataOnly: false,
    sharing: {
      public: false,
      externalDomains: [],
      anyoneWithLink: false
    },
    content: "Sample event content",
    sizeBytes: 128,
    labels: []
  };
}

function pubSubBody(event: ResourceEvent, subscription = "projects/project-123/subscriptions/workspace-gmail-push") {
  return {
    subscription,
    message: {
      messageId: "message_123",
      publishTime: "2026-05-23T00:00:00.000Z",
      data: Buffer.from(JSON.stringify(event), "utf8").toString("base64")
    }
  };
}

async function signedGoogleOidcToken(claims: {
  aud: string;
  email: string;
  email_verified?: boolean | string;
}) {
  const kid = `test-key-${Math.random().toString(36).slice(2)}`;
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );
  const publicJwk = (await crypto.subtle.exportKey("jwk", keyPair.publicKey)) as JsonWebKey & {
    kid?: string;
    alg?: string;
    use?: string;
  };
  publicJwk.kid = kid;
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";

  const nowSeconds = Math.floor(Date.now() / 1000);
  const signingInput = [
    encodeJwtPart({ alg: "RS256", kid, typ: "JWT" }),
    encodeJwtPart({
      iss: "https://accounts.google.com",
      iat: nowSeconds - 60,
      exp: nowSeconds + 3600,
      email_verified: true,
      ...claims
    })
  ].join(".");
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(signingInput));

  return {
    token: `${signingInput}.${base64Url(signature)}`,
    jwks: { keys: [publicJwk] }
  };
}

function encodeJwtPart(payload: unknown) {
  return base64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

function base64Url(input: ArrayBuffer | Uint8Array) {
  return Buffer.from(input instanceof ArrayBuffer ? new Uint8Array(input) : input)
    .toString("base64")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

describe("Workspace webhook authentication", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("allows explicit demo payloads only in local mock mode", async () => {
    const { parsePubSubOrDemoRequest } = await import("@/lib/pubsub");
    const parsed = await parsePubSubOrDemoRequest(
      new Request("https://sentinel.example.com/api/webhooks/pubsub/drive", {
        method: "POST",
        body: JSON.stringify({ demo: "low-risk" })
      }),
      "public-secret",
      { source: "drive" }
    );

    expect(parsed.kind).toBe("demo-event");
    expect(parsed.kind === "demo-event" ? parsed.event.source : undefined).toBe("drive");
    expect(parsed.kind === "demo-event" ? parsed.event.resourceName : undefined).toContain("thumbnail");
  }, webhookTestTimeoutMs);

  it("blocks unauthenticated production Pub/Sub pushes before parsing events", async () => {
    vi.stubEnv("SENTINEL_MOCK_MODE", "false");
    vi.stubEnv("WORKSPACE_PUBSUB_PUSH_AUDIENCE", "https://sentinel.example.com/api/webhooks/pubsub/gmail");
    vi.stubEnv("WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL", "pubsub-push@example.iam.gserviceaccount.com");
    vi.stubEnv("WORKSPACE_GMAIL_SUBSCRIPTION", "projects/project-123/subscriptions/workspace-gmail-push");
    vi.resetModules();
    const { parsePubSubOrDemoRequest } = await import("@/lib/pubsub");

    await expect(
      parsePubSubOrDemoRequest(
        new Request("https://sentinel.example.com/api/webhooks/pubsub/gmail", {
          method: "POST",
          body: JSON.stringify(pubSubBody(sampleEvent("gmail")))
        }),
        "gmail-pii",
        { source: "gmail", fetchImpl: vi.fn() as unknown as typeof fetch }
      )
    ).rejects.toMatchObject({ status: 401, code: "pubsub-token-missing" });
  }, webhookTestTimeoutMs);

  it("accepts authenticated Gmail Pub/Sub pushes only when OIDC claims and subscription match", async () => {
    vi.stubEnv("SENTINEL_MOCK_MODE", "false");
    vi.stubEnv("WORKSPACE_PUBSUB_PUSH_AUDIENCE", "https://sentinel.example.com/api/webhooks/pubsub/gmail");
    vi.stubEnv("WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL", "pubsub-push@example.iam.gserviceaccount.com");
    vi.stubEnv("WORKSPACE_GMAIL_SUBSCRIPTION", "projects/project-123/subscriptions/workspace-gmail-push");
    vi.resetModules();
    const { token, jwks } = await signedGoogleOidcToken({
      aud: "https://sentinel.example.com/api/webhooks/pubsub/gmail",
      email: "pubsub-push@example.iam.gserviceaccount.com",
      email_verified: true
    });
    const fetchImpl = vi.fn(async () => Response.json(jwks, { headers: { "cache-control": "public, max-age=300" } }));
    const { parsePubSubOrDemoRequest } = await import("@/lib/pubsub");
    const parsed = await parsePubSubOrDemoRequest(
      new Request("https://sentinel.example.com/api/webhooks/pubsub/gmail", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(pubSubBody(sampleEvent("gmail")))
      }),
      "gmail-pii",
      { source: "gmail", fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    expect(parsed.kind).toBe("notification");
    expect(parsed.kind === "notification" ? parsed.source : undefined).toBe("gmail");
    expect(parsed.kind === "notification" ? parsed.messageId : undefined).toBe("message_123");
    expect(parsed.kind === "notification" ? parsed.payloadSummary : undefined).toContain("id");
    expect(fetchImpl).toHaveBeenCalledWith("https://www.googleapis.com/oauth2/v3/certs");
  }, webhookTestTimeoutMs);

  it("rejects authenticated Pub/Sub pushes with the wrong audience", async () => {
    vi.stubEnv("SENTINEL_MOCK_MODE", "false");
    vi.stubEnv("WORKSPACE_PUBSUB_PUSH_AUDIENCE", "https://sentinel.example.com/api/webhooks/pubsub/gmail");
    vi.stubEnv("WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL", "pubsub-push@example.iam.gserviceaccount.com");
    vi.resetModules();
    const { token, jwks } = await signedGoogleOidcToken({
      aud: "https://attacker.example.com/webhook",
      email: "pubsub-push@example.iam.gserviceaccount.com",
      email_verified: true
    });
    const fetchImpl = vi.fn(async () => Response.json(jwks));
    const { parsePubSubOrDemoRequest } = await import("@/lib/pubsub");

    await expect(
      parsePubSubOrDemoRequest(
        new Request("https://sentinel.example.com/api/webhooks/pubsub/gmail", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify(pubSubBody(sampleEvent("gmail")))
        }),
        "gmail-pii",
        { source: "gmail", fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).rejects.toMatchObject({ status: 403, code: "pubsub-audience-invalid" });
  }, webhookTestTimeoutMs);

  it("rejects Pub/Sub pushes when the OIDC JWT signature is invalid", async () => {
    vi.stubEnv("SENTINEL_MOCK_MODE", "false");
    vi.stubEnv("WORKSPACE_PUBSUB_PUSH_AUDIENCE", "https://sentinel.example.com/api/webhooks/pubsub/gmail");
    vi.stubEnv("WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL", "pubsub-push@example.iam.gserviceaccount.com");
    vi.resetModules();
    const { token, jwks } = await signedGoogleOidcToken({
      aud: "https://sentinel.example.com/api/webhooks/pubsub/gmail",
      email: "pubsub-push@example.iam.gserviceaccount.com",
      email_verified: true
    });
    const tamperedToken = token.replace(/\.[^.]+$/u, ".invalid-signature");
    const fetchImpl = vi.fn(async () => Response.json(jwks));
    const { parsePubSubOrDemoRequest } = await import("@/lib/pubsub");

    await expect(
      parsePubSubOrDemoRequest(
        new Request("https://sentinel.example.com/api/webhooks/pubsub/gmail", {
          method: "POST",
          headers: { authorization: `Bearer ${tamperedToken}` },
          body: JSON.stringify(pubSubBody(sampleEvent("gmail")))
        }),
        "gmail-pii",
        { source: "gmail", fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).rejects.toMatchObject({ status: 401, code: "pubsub-token-invalid" });
  }, webhookTestTimeoutMs);

  it("rejects malformed OIDC JWTs before claims are trusted", async () => {
    vi.stubEnv("SENTINEL_MOCK_MODE", "false");
    vi.stubEnv("WORKSPACE_PUBSUB_PUSH_AUDIENCE", "https://sentinel.example.com/api/webhooks/pubsub/gmail");
    vi.stubEnv("WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL", "pubsub-push@example.iam.gserviceaccount.com");
    vi.resetModules();
    const fetchImpl = vi.fn(async () => Response.json({ keys: [] }));
    const { parsePubSubOrDemoRequest } = await import("@/lib/pubsub");

    await expect(
      parsePubSubOrDemoRequest(
        new Request("https://sentinel.example.com/api/webhooks/pubsub/gmail", {
          method: "POST",
          headers: { authorization: "Bearer header.payload.signature.extra" },
          body: JSON.stringify(pubSubBody(sampleEvent("gmail")))
        }),
        "gmail-pii",
        { source: "gmail", fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).rejects.toMatchObject({ status: 401, code: "pubsub-token-invalid" });
    expect(fetchImpl).not.toHaveBeenCalled();
  }, webhookTestTimeoutMs);

  it("accepts Drive channel notifications only when the channel token matches", async () => {
    vi.stubEnv("SENTINEL_MOCK_MODE", "false");
    vi.stubEnv("WORKSPACE_DRIVE_CHANNEL_TOKEN", "drive_channel_secret");
    vi.resetModules();
    const fetchImpl = vi.fn();
    const { parsePubSubOrDemoRequest } = await import("@/lib/pubsub");
    const parsed = await parsePubSubOrDemoRequest(
      new Request("https://sentinel.example.com/api/webhooks/pubsub/drive", {
        method: "POST",
        headers: {
          "x-goog-channel-id": "channel_123",
          "x-goog-message-number": "7",
          "x-goog-channel-token": "drive_channel_secret",
          "x-goog-resource-state": "change"
        },
        body: JSON.stringify(sampleEvent("drive"))
      }),
      "public-secret",
      { source: "drive", fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    expect(parsed.kind).toBe("notification");
    expect(parsed.kind === "notification" ? parsed.channelId : undefined).toBe("channel_123");
    expect(parsed.kind === "notification" ? parsed.messageNumber : undefined).toBe("7");
    expect(parsed.kind === "notification" ? parsed.resourceState : undefined).toBe("change");
    expect(fetchImpl).not.toHaveBeenCalled();
  }, webhookTestTimeoutMs);

  it("records authenticated production pushes as sync hints without creating findings", async () => {
    vi.resetModules();
    const { getDashboardSnapshot, recordWorkspaceWebhookNotification, resetState } = await import("@/lib/store");
    resetState();
    const before = getDashboardSnapshot();

    const result = recordWorkspaceWebhookNotification({
      source: "gmail",
      receivedAt: "2026-05-23T00:00:00.000Z",
      subscription: "projects/project-123/subscriptions/workspace-gmail-push",
      messageId: "message_123",
      payloadSummary: "historyId present"
    });
    const after = getDashboardSnapshot();

    expect(result.reconciliationRequired).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(after.syncState.gmail.lastNotificationAt).toBe("2026-05-23T00:00:00.000Z");
    expect(after.findings.length).toBe(before.findings.length);
    expect(after.agentRuns.length).toBe(before.agentRuns.length);
    expect(after.auditEvents[0].type).toBe("workspace_webhook_notification_received");
  }, webhookTestTimeoutMs);

  it("deduplicates repeated Pub/Sub message notifications before writing audit evidence", async () => {
    vi.resetModules();
    const { getDashboardSnapshot, recordWorkspaceWebhookNotification, resetState } = await import("@/lib/store");
    resetState();

    const first = recordWorkspaceWebhookNotification({
      source: "gmail",
      receivedAt: "2026-05-23T00:00:00.000Z",
      subscription: "projects/project-123/subscriptions/workspace-gmail-push",
      messageId: "message_123",
      payloadSummary: "historyId present"
    });
    const afterFirst = getDashboardSnapshot();
    const auditCountAfterFirst = afterFirst.auditEvents.length;
    const second = recordWorkspaceWebhookNotification({
      source: "gmail",
      receivedAt: "2026-05-23T00:05:00.000Z",
      subscription: "projects/project-123/subscriptions/workspace-gmail-push",
      messageId: "message_123",
      payloadSummary: "historyId present"
    });
    const afterSecond = getDashboardSnapshot();
    const auditCountAfterSecond = afterSecond.auditEvents.length;
    const gmailLastNotificationAfterSecond = afterSecond.syncState.gmail.lastNotificationAt;
    const third = recordWorkspaceWebhookNotification({
      source: "gmail",
      receivedAt: "2026-05-23T00:10:00.000Z",
      subscription: "projects/project-123/subscriptions/workspace-gmail-push",
      messageId: "message_456",
      payloadSummary: "historyId present"
    });
    const afterThird = getDashboardSnapshot();

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(third.duplicate).toBe(false);
    expect(auditCountAfterSecond).toBe(auditCountAfterFirst);
    expect(gmailLastNotificationAfterSecond).toBe("2026-05-23T00:00:00.000Z");
    expect(afterThird.auditEvents.length).toBe(auditCountAfterFirst + 1);
    expect(afterThird.syncState.gmail.lastNotificationAt).toBe("2026-05-23T00:10:00.000Z");
  }, webhookTestTimeoutMs);

  it("deduplicates Drive push channel notifications by channel resource and message number", async () => {
    vi.resetModules();
    const { getDashboardSnapshot, recordWorkspaceWebhookNotification, resetState } = await import("@/lib/store");
    resetState();

    const first = recordWorkspaceWebhookNotification({
      source: "drive",
      receivedAt: "2026-05-23T00:00:00.000Z",
      channelId: "channel_123",
      resourceId: "resource_123",
      messageNumber: "7",
      resourceState: "change"
    });
    const afterFirst = getDashboardSnapshot();
    const auditCountAfterFirst = afterFirst.auditEvents.length;
    const second = recordWorkspaceWebhookNotification({
      source: "drive",
      receivedAt: "2026-05-23T00:05:00.000Z",
      channelId: "channel_123",
      resourceId: "resource_123",
      messageNumber: "7",
      resourceState: "change"
    });
    const afterSecond = getDashboardSnapshot();
    const auditCountAfterSecond = afterSecond.auditEvents.length;
    const driveLastNotificationAfterSecond = afterSecond.syncState.drive.lastNotificationAt;
    const third = recordWorkspaceWebhookNotification({
      source: "drive",
      receivedAt: "2026-05-23T00:10:00.000Z",
      channelId: "channel_123",
      resourceId: "resource_123",
      messageNumber: "8",
      resourceState: "change"
    });
    const afterThird = getDashboardSnapshot();

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(third.duplicate).toBe(false);
    expect(auditCountAfterSecond).toBe(auditCountAfterFirst);
    expect(driveLastNotificationAfterSecond).toBe("2026-05-23T00:00:00.000Z");
    expect(afterThird.auditEvents.length).toBe(auditCountAfterFirst + 1);
    expect(afterThird.syncState.drive.lastNotificationAt).toBe("2026-05-23T00:10:00.000Z");
  }, webhookTestTimeoutMs);

  it("uses Firestore create-only replay protection for production Pub/Sub pushes in gcp-rest mode", async () => {
    vi.stubEnv("SENTINEL_STORAGE_MODE", "gcp-rest");
    vi.stubEnv("SENTINEL_MOCK_MODE", "false");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "project_123");
    vi.stubEnv("GOOGLE_CLOUD_ACCESS_TOKEN", "access_token_123");
    vi.stubEnv("WORKSPACE_PUBSUB_PUSH_AUDIENCE", "https://sentinel.example.com/api/webhooks/pubsub/gmail");
    vi.stubEnv("WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL", "pubsub-push@example.iam.gserviceaccount.com");
    vi.stubEnv("WORKSPACE_GMAIL_SUBSCRIPTION", "projects/project-123/subscriptions/workspace-gmail-push");
    vi.resetModules();

    const { token, jwks } = await signedGoogleOidcToken({
      aud: "https://sentinel.example.com/api/webhooks/pubsub/gmail",
      email: "pubsub-push@example.iam.gserviceaccount.com",
      email_verified: true
    });
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://www.googleapis.com/oauth2/v3/certs") {
        return Response.json(jwks);
      }

      if (url.includes("/documents:commit") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body.writes[0].currentDocument.exists).toBe(false);
        expect(body.writes[0].update.name).toContain("/webhookNotifications/webhook_");
        return new Response(JSON.stringify({ error: { status: "ALREADY_EXISTS" } }), { status: 409 });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchImpl);

    const { resetState, getDashboardSnapshot } = await import("@/lib/store");
    const { POST } = await import("@/app/api/webhooks/pubsub/gmail/route");
    resetState();

    const response = await POST(
      new Request("https://sentinel.example.com/api/webhooks/pubsub/gmail", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(pubSubBody(sampleEvent("gmail")))
      })
    );
    const payload = await response.json();
    const snapshot = getDashboardSnapshot();

    expect(response.status).toBe(202);
    expect(payload.duplicate).toBe(true);
    expect(payload.durableReplayGuard).toBe(true);
    expect(snapshot.auditEvents[0].id).toBe("audit_bootstrap");
  }, webhookTestTimeoutMs);
});
