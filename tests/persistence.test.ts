import { afterEach, describe, expect, it, vi } from "vitest";
import { buildChainedAuditEvent } from "@/lib/audit-integrity";
import {
  buildBigQueryAgentRunInsertRequest,
  buildBigQueryAgentRunTableSchemaPlan,
  buildBigQueryAuditInsertRequest,
  buildBigQueryAuditTableSchemaPlan,
  buildFirestoreCommitRequest,
  buildFirestoreGetDocumentRequest,
  buildPersistenceReadiness,
  buildSecretManagerAccessVersionRequest,
  buildSecretManagerAddVersionRequest,
  buildWorkspaceConnectionPersistencePlan,
  buildWorkspaceWebhookNotificationPersistencePlan,
  buildWorkspaceOAuthSessionPersistencePlan,
  buildWorkspaceSyncStatePersistencePlan,
  buildWorkspaceTokenSecretName,
  fetchCloudRunAccessToken,
  verifyPersistenceWriteThrough
} from "@/lib/persistence";
import type { AgentRun, AuditEvent } from "@/lib/types";

function buildVerificationAgentRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run_123",
    tenantId: "tenant_mainstreet_security",
    findingId: "finding_123",
    eventId: "evt_123",
    purpose: "semantic_risk_audit",
    model: "gemini-3.5-flash",
    provider: "mock-gemini",
    fallbackReason: "api-call-failed",
    errorClass: "TypeError",
    inputTokensEstimated: 120,
    outputTokensEstimated: 80,
    estimatedCostUsd: 0.000033,
    promptSummary: "Semantic risk audit for redacted Workspace file.",
    outputSummary: "Stage remediation for admin approval.",
    startedAt: "2026-05-23T00:00:00.000Z",
    completedAt: "2026-05-23T00:00:01.000Z",
    ...overrides
  };
}

describe("production persistence contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defines tenant-scoped Firestore, BigQuery, and Secret Manager targets", () => {
    const readiness = buildPersistenceReadiness();
    const firestore = buildFirestoreCommitRequest("pilotRecords", "pilot_123", {
      tenantId: "tenant_mainstreet_security",
      monthlyRevenueUsd: 199,
      relatedParty: false
    });
    const secretName = buildWorkspaceTokenSecretName();

    expect(readiness.mode).toBe("memory");
    expect(readiness.tenantIsolation.partitionKey).toBe("tenantId");
    expect(readiness.bigQueryAgentRunsTable).toBe("agent_runs");
    expect(readiness.writePlan.map((item) => item.target)).toEqual([
      "firestore",
      "firestore",
      "firestore",
      "bigquery",
      "secret-manager"
    ]);
    expect(firestore.url).toContain("/documents:commit");
    expect(JSON.stringify(firestore.body)).toContain("tenants/tenant_mainstreet_security/pilotRecords/pilot_123");
    expect(secretName).toContain("secrets/sentinel-workspace-oauth-tenant_mainstreet_security/versions/latest");
  });

  it("builds append-only BigQuery audit rows with tenant_id and audit-chain fields", () => {
    const firstAuditEvent: AuditEvent = buildChainedAuditEvent({
      id: "audit_001",
      tenantId: "tenant_mainstreet_security",
      actor: "system",
      type: "evidence_exported",
      message: "Bootstrap audit event.",
      createdAt: "2026-05-22T00:00:00.000Z"
    });
    const auditEvent: AuditEvent = buildChainedAuditEvent(
      {
        id: "audit_123",
        tenantId: "tenant_mainstreet_security",
        actor: "admin",
        type: "pilot_evidence_recorded",
        targetId: "pilot_123",
        message: "Pilot evidence recorded for redacted customer segment.",
        createdAt: "2026-05-22T00:00:00.000Z",
        metadata: { redacted: true }
      },
      firstAuditEvent
    );

    const request = buildBigQueryAuditInsertRequest([auditEvent]);

    expect(request.url).toContain("/insertAll");
    expect(request.body.rows[0].insertId).toBe("audit_123");
    expect(request.body.rows[0].json.tenant_id).toBe("tenant_mainstreet_security");
    expect(request.body.rows[0].json.sequence).toBe(2);
    expect(request.body.rows[0].json.previous_hash).toBe(firstAuditEvent.eventHash);
    expect(request.body.rows[0].json.event_hash).toBe(auditEvent.eventHash);
    expect(request.body.rows[0].json.audit_chain_version).toBe("sha256-v1");
    expect(request.body.rows[0].json.metadata_json).toContain("redacted");
  });

  it("builds the BigQuery audit table schema with partitioning and hash-chain columns", () => {
    const request = buildBigQueryAuditTableSchemaPlan();
    const fields = request.body.schema.fields;
    const fieldByName = Object.fromEntries(fields.map((field) => [field.name, field]));

    expect(request.url).toContain("/datasets/sentinel_evidence/tables");
    expect(request.body.tableReference.tableId).toBe("audit_events");
    expect(request.body.timePartitioning.field).toBe("created_at");
    expect(request.body.clustering.fields).toEqual(["tenant_id", "type", "audit_chain_version"]);
    expect(fieldByName.event_id.mode).toBe("REQUIRED");
    expect(fieldByName.tenant_id.mode).toBe("REQUIRED");
    expect(fieldByName.created_at.type).toBe("TIMESTAMP");
    expect(fieldByName.sequence.type).toBe("INTEGER");
    expect(fieldByName.previous_hash.type).toBe("STRING");
    expect(fieldByName.event_hash.type).toBe("STRING");
    expect(fieldByName.audit_chain_version.type).toBe("STRING");
    expect(fieldByName.integrity_backfilled_at.type).toBe("TIMESTAMP");
  });

  it("builds append-only BigQuery agent-run rows with provider, fallback, and redacted summaries", () => {
    const syntheticAwsKey = ["AKIA", "1234567890ABCDEF"].join("");
    const agentRun: AgentRun = {
      id: "run_123",
      tenantId: "tenant_mainstreet_security",
      findingId: "finding_123",
      eventId: "evt_123",
      purpose: "semantic_risk_audit",
      model: "gemini-3.5-flash",
      provider: "mock-gemini",
      fallbackReason: "api-call-failed",
      errorClass: "TypeError",
      inputTokensEstimated: 120,
      outputTokensEstimated: 80,
      estimatedCostUsd: 0.000033,
      promptSummary: `Audit config.js owned by alice@example.com with api_key=abc123 and ${syntheticAwsKey}.`,
      outputSummary: "Detected SSN 123-45-6789 and card 4111 1111 1111 1111 in sampled content.",
      startedAt: "2026-05-23T00:00:00.000Z",
      completedAt: "2026-05-23T00:00:01.000Z"
    };

    const request = buildBigQueryAgentRunInsertRequest([agentRun]);
    const row = request.body.rows[0].json;

    expect(request.url).toContain("/tables/agent_runs/insertAll");
    expect(request.body.rows[0].insertId).toBe("run_123");
    expect(row.tenant_id).toBe("tenant_mainstreet_security");
    expect(row.provider).toBe("mock-gemini");
    expect(row.model).toBe("gemini-3.5-flash");
    expect(row.fallback_reason).toBe("api-call-failed");
    expect(row.error_class).toBe("TypeError");
    expect(row.event_id).toBe("evt_123");
    expect(row.estimated_cost_usd).toBe(0.000033);
    expect(row.prompt_summary).toContain("[redacted-email]");
    expect(row.prompt_summary).toContain("api_key=[redacted]");
    expect(row.prompt_summary).toContain("[redacted-aws-key]");
    expect(row.output_summary).toContain("[redacted-ssn]");
    expect(row.output_summary).toContain("[redacted-card]");
    expect(row.prompt_summary).not.toContain("alice@example.com");
    expect(row.prompt_summary).not.toContain("abc123");
  });

  it("builds the BigQuery agent-run table schema with partitioning and fallback columns", () => {
    const request = buildBigQueryAgentRunTableSchemaPlan();
    const fields = request.body.schema.fields;
    const fieldByName = Object.fromEntries(fields.map((field) => [field.name, field]));

    expect(request.url).toContain("/datasets/sentinel_evidence/tables");
    expect(request.body.tableReference.tableId).toBe("agent_runs");
    expect(request.body.timePartitioning.field).toBe("completed_at");
    expect(request.body.clustering.fields).toEqual(["tenant_id", "provider", "model"]);
    expect(fieldByName.run_id.mode).toBe("REQUIRED");
    expect(fieldByName.tenant_id.mode).toBe("REQUIRED");
    expect(fieldByName.provider.mode).toBe("REQUIRED");
    expect(fieldByName.fallback_reason.type).toBe("STRING");
    expect(fieldByName.error_class.type).toBe("STRING");
    expect(fieldByName.estimated_cost_usd.type).toBe("FLOAT");
    expect(fieldByName.prompt_summary.description).toContain("never raw prompt");
    expect(fieldByName.output_summary.description).toContain("never raw model output");
  });

  it("rejects unsafe tenant-scoped document ids", () => {
    expect(() => buildFirestoreCommitRequest("pilotRecords", "../escape", { tenantId: "tenant_mainstreet_security" })).toThrow(
      "Unsafe document id"
    );
  });

  it("builds Secret Manager addVersion requests without exposing plaintext in the URL", () => {
    const request = buildSecretManagerAddVersionRequest("tenant_mainstreet_security", {
      refreshToken: "refresh_secret",
      scope: "https://www.googleapis.com/auth/gmail.metadata"
    });

    expect(request.url).toContain(":addVersion");
    expect(request.url).not.toContain("refresh_secret");
    expect(Buffer.from(request.body.payload.data, "base64").toString("utf8")).toContain("refresh_secret");
  });

  it("builds Secret Manager access requests without exposing token values", () => {
    const request = buildSecretManagerAccessVersionRequest("tenant_mainstreet_security");

    expect(request.method).toBe("GET");
    expect(request.url).toContain("secretmanager.googleapis.com");
    expect(request.url).toContain("/secrets/sentinel-workspace-oauth-tenant_mainstreet_security/versions/latest:access");
    expect(request.url).not.toContain("refresh");
  });

  it("builds tenant-scoped OAuth launch-state Firestore requests", () => {
    const session = {
      id: "oauth_launch_123",
      tenantId: "tenant_mainstreet_security",
      state: "oauth_state_123",
      consentArtifactId: "consent_123",
      requestedScopes: ["https://www.googleapis.com/auth/drive.metadata.readonly"],
      status: "issued" as const,
      createdAt: "2026-05-23T00:00:00.000Z",
      expiresAt: "2026-05-23T00:15:00.000Z"
    };
    const commit = buildWorkspaceOAuthSessionPersistencePlan(session);
    const get = buildFirestoreGetDocumentRequest("oauthLaunchSessions", session.state);

    expect(JSON.stringify(commit.body)).toContain("tenants/tenant_mainstreet_security/oauthLaunchSessions/oauth_state_123");
    expect(JSON.stringify(commit.body)).toContain("consent_123");
    expect(get.url).toContain("/oauthLaunchSessions/oauth_state_123");
  });

  it("builds Workspace connection and sync-state Firestore persistence plans", () => {
    const connection = buildWorkspaceConnectionPersistencePlan({
      id: "conn_google_workspace_oauth",
      tenantId: "tenant_mainstreet_security",
      provider: "google-workspace",
      mode: "oauth",
      scopes: ["https://www.googleapis.com/auth/gmail.metadata"],
      connectedAt: "2026-05-23T00:00:00.000Z"
    });
    const sync = buildWorkspaceSyncStatePersistencePlan({
      tenantId: "tenant_mainstreet_security",
      mode: "oauth",
      reconciliationCadenceHours: 6,
      deadLetterCount: 0,
      drive: {
        status: "not_configured",
        blocker: "Drive cursor missing."
      },
      gmail: {
        status: "not_configured",
        blocker: "Gmail cursor missing."
      }
    });

    expect(JSON.stringify(connection.body)).toContain("tenants/tenant_mainstreet_security/connections/conn_google_workspace_oauth");
    expect(JSON.stringify(sync.body)).toContain("tenants/tenant_mainstreet_security/workspaceSyncState/current");
    expect(JSON.stringify(sync.body)).toContain("Drive cursor missing.");
  });

  it("builds a tenant-scoped webhook replay registry entry with a hashed document id", () => {
    const request = buildWorkspaceWebhookNotificationPersistencePlan({
      dedupeKey: "gmail:pubsub:projects/project-123/subscriptions/workspace-gmail-push:message_123",
      source: "gmail",
      receivedAt: "2026-05-23T00:00:00.000Z",
      subscription: "projects/project-123/subscriptions/workspace-gmail-push",
      messageId: "message_123"
    });
    const serialized = JSON.stringify(request.body);

    expect(serialized).toContain("tenants/tenant_mainstreet_security/webhookNotifications/webhook_");
    expect(serialized).toContain("gmail:pubsub:projects/project-123/subscriptions/workspace-gmail-push:message_123");
    expect(request.body.writes[0].currentDocument).toEqual({ exists: false });
  });

  it("can fetch a Cloud Run metadata-server token through an injected fetch", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ access_token: "token_123" }));

    await expect(fetchCloudRunAccessToken(fetchImpl as unknown as typeof fetch)).resolves.toBe("token_123");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      expect.objectContaining({ headers: { "Metadata-Flavor": "Google" } })
    );
  });

  it("blocks write-through verification in local memory mode", async () => {
    const fetchImpl = vi.fn();

    const result = await verifyPersistenceWriteThrough(
      { auditEvents: [], agentRuns: [], pilotRecords: [] },
      fetchImpl as unknown as typeof fetch
    );

    expect(result.status).toBe("blocked");
    expect(result.attemptedWrites).toBe(false);
    expect(result.checks[0].detail).toContain("SENTINEL_STORAGE_MODE=gcp-rest");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("passes write-through verification only when Secret Manager token storage is accessible", async () => {
    vi.stubEnv("SENTINEL_STORAGE_MODE", "gcp-rest");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "project_123");
    vi.stubEnv("GOOGLE_CLOUD_ACCESS_TOKEN", "access_token_123");
    vi.resetModules();
    const { verifyPersistenceWriteThrough } = await import("@/lib/persistence");
    const auditEvent = buildChainedAuditEvent({
      id: "audit_123",
      tenantId: "tenant_mainstreet_security",
      actor: "system",
      type: "evidence_exported",
      message: "Persistence verifier audit event.",
      createdAt: "2026-05-23T00:00:00.000Z"
    });
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("firestore.googleapis.com") && init?.method === "POST") {
        return Response.json({ writeResults: [{ updateTime: "2026-05-23T00:01:00.000Z" }] });
      }

      if (url.includes("bigquery.googleapis.com") && init?.method === "POST") {
        return Response.json({});
      }

      if (url.includes("secretmanager.googleapis.com") && init?.method === "GET") {
        return Response.json({ name: "projects/project_123/secrets/sentinel-workspace-oauth-tenant_mainstreet_security/versions/1" });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await verifyPersistenceWriteThrough(
      {
        auditEvents: [auditEvent],
        agentRuns: [buildVerificationAgentRun()],
        pilotRecords: [
          {
            id: "pilot_123",
            customerAlias: "Redacted pilot",
            segment: "Seed-stage SaaS",
            armsLength: true,
            relatedParty: false,
            monthlyRevenueUsd: 199,
            activeUsers: 2,
            proofStatus: "financial-doc-ready",
            consentStatus: "private",
            startedAt: "2026-05-23T00:00:00.000Z"
          }
        ]
      },
      fetchImpl as unknown as typeof fetch
    );

    expect(result.status).toBe("passed");
    expect(result.checks.find((check) => check.target === "agent-runs-bigquery")).toMatchObject({
      status: "passed",
      httpStatus: 200
    });
    expect(result.checks.find((check) => check.target === "secret-manager")).toMatchObject({
      status: "passed",
      httpStatus: 200
    });
    vi.unstubAllEnvs();
  });

  it("blocks write-through verification when no agent-run evidence exists", async () => {
    vi.stubEnv("SENTINEL_STORAGE_MODE", "gcp-rest");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "project_123");
    vi.stubEnv("GOOGLE_CLOUD_ACCESS_TOKEN", "access_token_123");
    vi.resetModules();
    const { verifyPersistenceWriteThrough } = await import("@/lib/persistence");
    const auditEvent = buildChainedAuditEvent({
      id: "audit_123",
      tenantId: "tenant_mainstreet_security",
      actor: "system",
      type: "evidence_exported",
      message: "Persistence verifier audit event.",
      createdAt: "2026-05-23T00:00:00.000Z"
    });
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("firestore.googleapis.com") && init?.method === "POST") {
        return Response.json({ writeResults: [{ updateTime: "2026-05-23T00:01:00.000Z" }] });
      }

      if (url.includes("bigquery.googleapis.com") && init?.method === "POST") {
        return Response.json({});
      }

      if (url.includes("secretmanager.googleapis.com") && init?.method === "GET") {
        return Response.json({ name: "projects/project_123/secrets/sentinel-workspace-oauth-tenant_mainstreet_security/versions/1" });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await verifyPersistenceWriteThrough(
      {
        auditEvents: [auditEvent],
        agentRuns: [],
        pilotRecords: [
          {
            id: "pilot_123",
            customerAlias: "Redacted pilot",
            segment: "Seed-stage SaaS",
            armsLength: true,
            relatedParty: false,
            monthlyRevenueUsd: 199,
            activeUsers: 2,
            proofStatus: "financial-doc-ready",
            consentStatus: "private",
            startedAt: "2026-05-23T00:00:00.000Z"
          }
        ]
      },
      fetchImpl as unknown as typeof fetch
    );

    expect(result.status).toBe("blocked");
    expect(result.checks.find((check) => check.target === "agent-runs-bigquery")).toMatchObject({
      status: "blocked"
    });
    vi.unstubAllEnvs();
  });

  it("blocks write-through verification when the Workspace OAuth token secret is not available yet", async () => {
    vi.stubEnv("SENTINEL_STORAGE_MODE", "gcp-rest");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "project_123");
    vi.stubEnv("GOOGLE_CLOUD_ACCESS_TOKEN", "access_token_123");
    vi.resetModules();
    const { verifyPersistenceWriteThrough } = await import("@/lib/persistence");
    const auditEvent = buildChainedAuditEvent({
      id: "audit_123",
      tenantId: "tenant_mainstreet_security",
      actor: "system",
      type: "evidence_exported",
      message: "Persistence verifier audit event.",
      createdAt: "2026-05-23T00:00:00.000Z"
    });
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("firestore.googleapis.com") && init?.method === "POST") {
        return Response.json({ writeResults: [{ updateTime: "2026-05-23T00:01:00.000Z" }] });
      }

      if (url.includes("bigquery.googleapis.com") && init?.method === "POST") {
        return Response.json({});
      }

      if (url.includes("secretmanager.googleapis.com") && init?.method === "GET") {
        return new Response(JSON.stringify({ error: { status: "NOT_FOUND" } }), { status: 404 });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await verifyPersistenceWriteThrough(
      {
        auditEvents: [auditEvent],
        agentRuns: [buildVerificationAgentRun()],
        pilotRecords: [
          {
            id: "pilot_123",
            customerAlias: "Redacted pilot",
            segment: "Seed-stage SaaS",
            armsLength: true,
            relatedParty: false,
            monthlyRevenueUsd: 199,
            activeUsers: 2,
            proofStatus: "financial-doc-ready",
            consentStatus: "private",
            startedAt: "2026-05-23T00:00:00.000Z"
          }
        ]
      },
      fetchImpl as unknown as typeof fetch
    );

    expect(result.status).toBe("blocked");
    expect(result.checks.find((check) => check.target === "secret-manager")).toMatchObject({
      status: "blocked",
      httpStatus: 404
    });
    vi.unstubAllEnvs();
  });

  it("reserves webhook notification dedupe keys through Firestore create-only writes", async () => {
    vi.stubEnv("SENTINEL_STORAGE_MODE", "gcp-rest");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "project_123");
    vi.stubEnv("GOOGLE_CLOUD_ACCESS_TOKEN", "access_token_123");
    vi.resetModules();
    const { reservePersistedWorkspaceWebhookNotification } = await import("@/lib/persistence");
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/documents:commit");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body.writes[0].currentDocument.exists).toBe(false);
      expect(body.writes[0].update.name).toContain("/webhookNotifications/webhook_");
      return Response.json({ writeResults: [{ updateTime: "2026-05-23T00:00:01.000Z" }] });
    });

    const result = await reservePersistedWorkspaceWebhookNotification(
      {
        dedupeKey: "drive:channel:channel_123:resource_123:7",
        source: "drive",
        receivedAt: "2026-05-23T00:00:00.000Z",
        channelId: "channel_123",
        resourceId: "resource_123",
        messageNumber: "7",
        resourceState: "change"
      },
      fetchImpl as unknown as typeof fetch
    );

    expect(result.duplicate).toBe(false);
    expect(result.documentName).toContain("/webhookNotifications/webhook_");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it("treats Firestore create conflicts as duplicate webhook notifications", async () => {
    vi.stubEnv("SENTINEL_STORAGE_MODE", "gcp-rest");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "project_123");
    vi.stubEnv("GOOGLE_CLOUD_ACCESS_TOKEN", "access_token_123");
    vi.resetModules();
    const { reservePersistedWorkspaceWebhookNotification } = await import("@/lib/persistence");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { status: "ALREADY_EXISTS" } }), { status: 409 }));

    const result = await reservePersistedWorkspaceWebhookNotification(
      {
        dedupeKey: "gmail:pubsub:subscription:message_123",
        source: "gmail",
        receivedAt: "2026-05-23T00:00:00.000Z",
        messageId: "message_123"
      },
      fetchImpl as unknown as typeof fetch
    );

    expect(result.duplicate).toBe(true);
    expect(result.httpStatus).toBe(409);
    vi.unstubAllEnvs();
  });

  it("consumes persisted OAuth launch states with a Firestore update-time precondition", async () => {
    vi.stubEnv("SENTINEL_STORAGE_MODE", "gcp-rest");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "project_123");
    vi.stubEnv("GOOGLE_CLOUD_ACCESS_TOKEN", "access_token_123");
    vi.resetModules();
    const { consumePersistedWorkspaceOAuthLaunchSession } = await import("@/lib/persistence");
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/oauthLaunchSessions/oauth_state_abc") && init?.method === "GET") {
        return Response.json({
          updateTime: "2026-05-23T00:00:01.000Z",
          fields: {
            id: { stringValue: "oauth_launch_abc" },
            tenantId: { stringValue: "tenant_mainstreet_security" },
            state: { stringValue: "oauth_state_abc" },
            consentArtifactId: { stringValue: "consent_artifact_abc" },
            requestedScopes: {
              arrayValue: {
                values: [{ stringValue: "https://www.googleapis.com/auth/gmail.metadata" }]
              }
            },
            status: { stringValue: "issued" },
            createdAt: { stringValue: "2026-05-23T00:00:00.000Z" },
            expiresAt: { stringValue: "2026-05-23T00:15:00.000Z" },
            usedAt: { nullValue: null }
          }
        });
      }

      if (url.endsWith("/documents:commit") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body.writes[0].currentDocument.updateTime).toBe("2026-05-23T00:00:01.000Z");
        expect(body.writes[0].update.fields.status.stringValue).toBe("used");
        return Response.json({ writeResults: [{ updateTime: "2026-05-23T00:01:00.000Z" }] });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await consumePersistedWorkspaceOAuthLaunchSession(
      { state: "oauth_state_abc", now: "2026-05-23T00:01:00.000Z" },
      fetchImpl as unknown as typeof fetch
    );

    expect(result.status).toBe("passed");
    expect(result.reason).toBe("validated");
    expect(result.session?.status).toBe("used");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    vi.unstubAllEnvs();
  });

  it("blocks persisted OAuth state validation before lookup when state is unsafe", async () => {
    vi.stubEnv("SENTINEL_STORAGE_MODE", "gcp-rest");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "project_123");
    vi.stubEnv("GOOGLE_CLOUD_ACCESS_TOKEN", "access_token_123");
    vi.resetModules();
    const { consumePersistedWorkspaceOAuthLaunchSession } = await import("@/lib/persistence");
    const fetchImpl = vi.fn();

    const result = await consumePersistedWorkspaceOAuthLaunchSession(
      { state: "../bad_state", now: "2026-05-23T00:01:00.000Z" },
      fetchImpl as unknown as typeof fetch
    );

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("unknown_state");
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
