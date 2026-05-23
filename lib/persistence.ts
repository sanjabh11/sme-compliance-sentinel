import { createHash } from "node:crypto";
import { sentinelConfig } from "@/lib/config";
import type {
  AgentRun,
  AuditEvent,
  PersistenceReadiness,
  PersistenceVerificationResult,
  PilotCustomerRecord,
  WorkspaceConnection,
  WorkspaceOAuthLaunchSession,
  WorkspaceOAuthStateValidationResult,
  WorkspaceSyncState
} from "@/lib/types";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type FirestoreCollection =
  | "auditEvents"
  | "pilotRecords"
  | "findings"
  | "agentRuns"
  | "remediations"
  | "oauthLaunchSessions"
  | "connections"
  | "workspaceSyncState"
  | "webhookNotifications";
type FirestoreCommitPrecondition = { exists?: boolean; updateTime?: string };

type GoogleJsonRequest =
  | ReturnType<typeof buildFirestoreCommitRequest>
  | ReturnType<typeof buildFirestoreGetDocumentRequest>
  | ReturnType<typeof buildWorkspaceConnectionPersistencePlan>
  | ReturnType<typeof buildWorkspaceSyncStatePersistencePlan>
  | ReturnType<typeof buildWorkspaceWebhookNotificationPersistencePlan>
  | ReturnType<typeof buildBigQueryAuditTableSchemaPlan>
  | ReturnType<typeof buildBigQueryAuditInsertRequest>
  | ReturnType<typeof buildBigQueryAgentRunTableSchemaPlan>
  | ReturnType<typeof buildBigQueryAgentRunInsertRequest>
  | ReturnType<typeof buildSecretManagerAccessVersionRequest>
  | ReturnType<typeof buildSecretManagerAddVersionRequest>;

export function buildPersistenceReadiness(): PersistenceReadiness {
  const missingEnv = [
    ["GOOGLE_CLOUD_PROJECT", sentinelConfig.googleCloudProject],
    ["FIRESTORE_DATABASE", sentinelConfig.firestoreDatabase],
    ["BIGQUERY_DATASET", sentinelConfig.bigQueryDataset],
    ["BIGQUERY_AUDIT_TABLE", sentinelConfig.bigQueryAuditTable],
    ["BIGQUERY_AGENT_RUNS_TABLE", sentinelConfig.bigQueryAgentRunsTable],
    ["WORKSPACE_SECRET_PREFIX", sentinelConfig.workspaceSecretPrefix]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
  const configured = sentinelConfig.storageMode === "gcp-rest" && missingEnv.length === 0;
  const tenantRoot = `tenants/${sentinelConfig.tenantId}`;

  return {
    mode: sentinelConfig.storageMode,
    configured,
    missingEnv,
    projectId: sentinelConfig.googleCloudProject || "not-configured",
    firestoreDatabase: sentinelConfig.firestoreDatabase,
    bigQueryDataset: sentinelConfig.bigQueryDataset,
    bigQueryAuditTable: sentinelConfig.bigQueryAuditTable,
    bigQueryAgentRunsTable: sentinelConfig.bigQueryAgentRunsTable,
    secretPrefix: sentinelConfig.workspaceSecretPrefix,
    tenantIsolation: {
      partitionKey: "tenantId",
      firestoreRoot: tenantRoot,
      bigQueryTenantColumn: "tenant_id",
      exportBoundary: "All judge/admin exports filter by tenantId and redact customer-identifying fields by default."
    },
    requiredIamRoles: [
      "roles/datastore.user",
      "roles/bigquery.dataEditor",
      "roles/bigquery.jobUser",
      "roles/secretmanager.secretAccessor",
      "roles/secretmanager.secretVersionAdder"
    ],
    writePlan: [
      {
        artifact: "Tenant settings, findings, approvals, remediations, pilot records",
        target: "firestore",
        purpose: "Durable tenant-scoped application state and replayable customer evidence."
      },
      {
        artifact: "One-time Workspace OAuth launch states",
        target: "firestore",
        purpose: "Survive Cloud Run restarts and multi-instance callback routing without relying on process memory."
      },
      {
        artifact: "Workspace webhook notification replay registry",
        target: "firestore",
        purpose: "Deduplicate Pub/Sub and Drive push redeliveries across Cloud Run instances before updating evidence."
      },
      {
        artifact: "Audit events and agent-run evidence rows",
        target: "bigquery",
        purpose: "Append-only analytics trail with audit-chain sequence/hash fields for judge evidence, cost analysis, and operational proof."
      },
      {
        artifact: "Google Workspace OAuth refresh tokens",
        target: "secret-manager",
        purpose: "Keep tenant credentials out of Firestore, BigQuery, logs, and judge exports."
      }
    ],
    productionWarnings: [
      "Memory mode is acceptable only for local demos and tests.",
      "Production mode must run on Google Cloud with a service account that has the listed least-privilege IAM roles.",
      "Do not store OAuth refresh tokens, raw document content, or unredacted customer findings in BigQuery."
    ]
  };
}

export function buildFirestoreCommitRequest(
  collection: FirestoreCollection,
  id: string,
  data: Record<string, JsonValue>,
  options: { currentDocument?: FirestoreCommitPrecondition } = {}
) {
  assertTenantSafeId(sentinelConfig.tenantId, "tenantId");
  assertTenantSafeId(id, "document id");

  const documentName = buildFirestoreDocumentName(collection, id);
  const commitRoot = buildFirestoreCommitRoot();

  return {
    url: `https://firestore.googleapis.com/v1/${commitRoot}`,
    method: "POST" as const,
    body: {
      writes: [
        {
          update: {
            name: documentName,
            fields: toFirestoreFields(data)
          },
          ...(options.currentDocument ? { currentDocument: options.currentDocument } : {})
        }
      ]
    }
  };
}

export function buildFirestoreGetDocumentRequest(collection: FirestoreCollection, id: string) {
  assertTenantSafeId(sentinelConfig.tenantId, "tenantId");
  assertTenantSafeId(id, "document id");

  return {
    url: `https://firestore.googleapis.com/v1/${buildFirestoreDocumentName(collection, id)}`,
    method: "GET" as const
  };
}

export function buildBigQueryAuditInsertRequest(auditEvents: AuditEvent[]) {
  const tablePath = [
    "projects",
    sentinelConfig.googleCloudProject || "PROJECT_ID",
    "datasets",
    sentinelConfig.bigQueryDataset,
    "tables",
    sentinelConfig.bigQueryAuditTable
  ].join("/");

  return {
    url: `https://bigquery.googleapis.com/bigquery/v2/${tablePath}/insertAll`,
    method: "POST" as const,
    body: {
      kind: "bigquery#tableDataInsertAllRequest",
      rows: auditEvents.map((event) => ({
        insertId: event.id,
        json: {
          event_id: event.id,
          tenant_id: event.tenantId,
          actor: event.actor,
          type: event.type,
          target_id: event.targetId ?? null,
          message: event.message,
          created_at: event.createdAt,
          sequence: event.sequence ?? null,
          previous_hash: event.previousHash ?? null,
          event_hash: event.eventHash ?? null,
          audit_chain_version: event.eventHash ? "sha256-v1" : null,
          integrity_backfilled_at:
            typeof event.metadata?.integrityBackfilledAt === "string" ? event.metadata.integrityBackfilledAt : null,
          metadata_json: event.metadata ? JSON.stringify(event.metadata) : null
        }
      }))
    }
  };
}

export function buildBigQueryAgentRunInsertRequest(agentRuns: AgentRun[]) {
  const tablePath = [
    "projects",
    sentinelConfig.googleCloudProject || "PROJECT_ID",
    "datasets",
    sentinelConfig.bigQueryDataset,
    "tables",
    sentinelConfig.bigQueryAgentRunsTable
  ].join("/");

  return {
    url: `https://bigquery.googleapis.com/bigquery/v2/${tablePath}/insertAll`,
    method: "POST" as const,
    body: {
      kind: "bigquery#tableDataInsertAllRequest",
      rows: agentRuns.map((run) => ({
        insertId: run.id,
        json: {
          run_id: run.id,
          tenant_id: run.tenantId,
          finding_id: run.findingId ?? null,
          event_id: run.eventId ?? null,
          purpose: run.purpose,
          model: run.model,
          provider: run.provider,
          fallback_reason: run.fallbackReason ?? null,
          error_class: run.errorClass ?? null,
          input_tokens_estimated: run.inputTokensEstimated,
          output_tokens_estimated: run.outputTokensEstimated,
          estimated_cost_usd: run.estimatedCostUsd,
          prompt_summary: redactAgentRunSummary(run.promptSummary),
          output_summary: redactAgentRunSummary(run.outputSummary),
          started_at: run.startedAt,
          completed_at: run.completedAt,
          created_at: run.completedAt
        }
      }))
    }
  };
}

export function buildBigQueryAuditTableSchemaPlan() {
  const projectId = sentinelConfig.googleCloudProject || "PROJECT_ID";
  const datasetId = sentinelConfig.bigQueryDataset;
  const tableId = sentinelConfig.bigQueryAuditTable;

  return {
    url: `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/${datasetId}/tables`,
    method: "POST" as const,
    body: {
      tableReference: {
        projectId,
        datasetId,
        tableId
      },
      description:
        "Append-only SME Workspace Sentinel audit evidence with tenant partitioning and SHA-256 audit-chain verification fields.",
      schema: {
        fields: [
          tableField("event_id", "STRING", "REQUIRED", "Stable audit event id used as BigQuery insertId."),
          tableField("tenant_id", "STRING", "REQUIRED", "Tenant partition key for all judge/admin exports."),
          tableField("actor", "STRING", "REQUIRED", "Actor class: system, admin, or agent."),
          tableField("type", "STRING", "REQUIRED", "Audit event type."),
          tableField("target_id", "STRING", "NULLABLE", "Optional resource, finding, packet, or evidence target id."),
          tableField("message", "STRING", "REQUIRED", "Redaction-safe event message."),
          tableField("created_at", "TIMESTAMP", "REQUIRED", "Event creation timestamp."),
          tableField("sequence", "INTEGER", "NULLABLE", "Newest-first audit-chain sequence number."),
          tableField("previous_hash", "STRING", "NULLABLE", "SHA-256 hash of the previous audit-chain event."),
          tableField("event_hash", "STRING", "NULLABLE", "SHA-256 hash for this canonical audit event."),
          tableField("audit_chain_version", "STRING", "NULLABLE", "Audit-chain algorithm/version, for example sha256-v1."),
          tableField("integrity_backfilled_at", "TIMESTAMP", "NULLABLE", "Set only when legacy local events were sealed after rollout."),
          tableField("metadata_json", "STRING", "NULLABLE", "JSON metadata with secrets and raw customer content excluded.")
        ]
      },
      timePartitioning: {
        type: "DAY",
        field: "created_at",
        requirePartitionFilter: false
      },
      clustering: {
        fields: ["tenant_id", "type", "audit_chain_version"]
      }
    }
  };
}

export function buildBigQueryAgentRunTableSchemaPlan() {
  const projectId = sentinelConfig.googleCloudProject || "PROJECT_ID";
  const datasetId = sentinelConfig.bigQueryDataset;
  const tableId = sentinelConfig.bigQueryAgentRunsTable;

  return {
    url: `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/${datasetId}/tables`,
    method: "POST" as const,
    body: {
      tableReference: {
        projectId,
        datasetId,
        tableId
      },
      description:
        "Append-only Gemini and deterministic agent-run evidence for SME Workspace Sentinel, excluding raw prompts, document content, and secrets.",
      schema: {
        fields: [
          tableField("run_id", "STRING", "REQUIRED", "Stable agent run id used as BigQuery insertId."),
          tableField("tenant_id", "STRING", "REQUIRED", "Tenant partition key for all judge/admin exports."),
          tableField("finding_id", "STRING", "NULLABLE", "Finding created or reviewed by this run."),
          tableField("event_id", "STRING", "NULLABLE", "Workspace event that caused this run."),
          tableField("purpose", "STRING", "REQUIRED", "Agent purpose: semantic_risk_audit, evidence_summary, or rescan."),
          tableField("model", "STRING", "REQUIRED", "Configured model name used or attempted."),
          tableField("provider", "STRING", "REQUIRED", "gemini-api, mock-gemini, or deterministic."),
          tableField("fallback_reason", "STRING", "NULLABLE", "Reason live Gemini was not used, when applicable."),
          tableField("error_class", "STRING", "NULLABLE", "Redacted error class for model/API failures."),
          tableField("input_tokens_estimated", "INTEGER", "NULLABLE", "Estimated input tokens for cost and quota evidence."),
          tableField("output_tokens_estimated", "INTEGER", "NULLABLE", "Estimated output tokens for cost and quota evidence."),
          tableField("estimated_cost_usd", "FLOAT", "NULLABLE", "Estimated model cost in USD for this run."),
          tableField("prompt_summary", "STRING", "NULLABLE", "Redacted summary only; never raw prompt or customer content."),
          tableField("output_summary", "STRING", "NULLABLE", "Redacted summary only; never raw model output or finding details."),
          tableField("started_at", "TIMESTAMP", "REQUIRED", "Run start timestamp."),
          tableField("completed_at", "TIMESTAMP", "REQUIRED", "Run completion timestamp."),
          tableField("created_at", "TIMESTAMP", "REQUIRED", "Insert event timestamp, equal to completed_at for v1.")
        ]
      },
      timePartitioning: {
        type: "DAY",
        field: "completed_at",
        requirePartitionFilter: false
      },
      clustering: {
        fields: ["tenant_id", "provider", "model"]
      }
    }
  };
}

function tableField(name: string, type: string, mode: "REQUIRED" | "NULLABLE", description: string) {
  return { name, type, mode, description };
}

function redactAgentRunSummary(value: string) {
  const redacted = value
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[redacted-aws-key]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted-ssn]")
    .replace(/\b(?:\d[ -]*?){13,16}\b/g, "[redacted-card]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b(api[_-]?key|secret|token|password)\s*[:=]\s*[^,\s;]+/gi, "$1=[redacted]");

  return redacted.length > 900 ? `${redacted.slice(0, 897)}...` : redacted;
}

export function buildWorkspaceTokenSecretName(tenantId = sentinelConfig.tenantId) {
  return `${buildWorkspaceTokenSecretParent(tenantId)}/versions/latest`;
}

export function buildWorkspaceTokenSecretParent(tenantId = sentinelConfig.tenantId) {
  assertTenantSafeId(tenantId, "tenantId");

  return [
    "projects",
    sentinelConfig.googleCloudProject || "PROJECT_ID",
    "secrets",
    `${sentinelConfig.workspaceSecretPrefix}-${tenantId}`
  ].join("/");
}

export function buildSecretManagerAddVersionRequest(tenantId: string, payload: Record<string, JsonValue>) {
  const parent = buildWorkspaceTokenSecretParent(tenantId);

  return {
    url: `https://secretmanager.googleapis.com/v1/${parent}:addVersion`,
    method: "POST" as const,
    body: {
      payload: {
        data: Buffer.from(JSON.stringify(payload), "utf8").toString("base64")
      }
    }
  };
}

export function buildSecretManagerAccessVersionRequest(tenantId = sentinelConfig.tenantId) {
  return {
    url: `https://secretmanager.googleapis.com/v1/${buildWorkspaceTokenSecretName(tenantId)}:access`,
    method: "GET" as const
  };
}

export function buildPilotRecordPersistencePlan(pilot: PilotCustomerRecord) {
  return buildFirestoreCommitRequest("pilotRecords", pilot.id, {
    id: pilot.id,
    tenantId: sentinelConfig.tenantId,
    customerAlias: pilot.customerAlias,
    segment: pilot.segment,
    armsLength: pilot.armsLength,
    relatedParty: pilot.relatedParty,
    monthlyRevenueUsd: pilot.monthlyRevenueUsd,
    activeUsers: pilot.activeUsers,
    proofStatus: pilot.proofStatus,
    consentStatus: pilot.consentStatus,
    startedAt: pilot.startedAt,
    invoiceReference: pilot.invoiceReference ?? null,
    testimonialQuote: pilot.testimonialQuote ?? null,
    notes: pilot.notes ?? null
  });
}

export function buildWorkspaceOAuthSessionPersistencePlan(session: WorkspaceOAuthLaunchSession) {
  return buildFirestoreCommitRequest("oauthLaunchSessions", session.state, serializeWorkspaceOAuthSession(session));
}

export function buildWorkspaceOAuthSessionConsumePlan(session: WorkspaceOAuthLaunchSession, usedAt: string, updateTime?: string) {
  return buildFirestoreCommitRequest(
    "oauthLaunchSessions",
    session.state,
    serializeWorkspaceOAuthSession({
      ...session,
      status: "used",
      usedAt
    }),
    updateTime ? { currentDocument: { updateTime } } : {}
  );
}

export function buildWorkspaceConnectionPersistencePlan(connection: WorkspaceConnection) {
  return buildFirestoreCommitRequest("connections", connection.id, {
    id: connection.id,
    tenantId: connection.tenantId,
    provider: connection.provider,
    mode: connection.mode,
    scopes: connection.scopes,
    connectedAt: connection.connectedAt
  });
}

export function buildWorkspaceSyncStatePersistencePlan(syncState: WorkspaceSyncState) {
  return buildFirestoreCommitRequest("workspaceSyncState", "current", {
    tenantId: syncState.tenantId,
    mode: syncState.mode,
    reconciliationCadenceHours: syncState.reconciliationCadenceHours,
    deadLetterCount: syncState.deadLetterCount,
    lastReconciliationAt: syncState.lastReconciliationAt ?? null,
    drive: {
      status: syncState.drive.status,
      startPageToken: syncState.drive.startPageToken ?? null,
      pageToken: syncState.drive.pageToken ?? null,
      channelId: syncState.drive.channelId ?? null,
      channelResourceId: syncState.drive.channelResourceId ?? null,
      channelExpirationAt: syncState.drive.channelExpirationAt ?? null,
      renewalDueAt: syncState.drive.renewalDueAt ?? null,
      lastNotificationAt: syncState.drive.lastNotificationAt ?? null,
      lastReconciledAt: syncState.drive.lastReconciledAt ?? null,
      blocker: syncState.drive.blocker ?? null
    },
    gmail: {
      status: syncState.gmail.status,
      historyId: syncState.gmail.historyId ?? null,
      topicName: syncState.gmail.topicName ?? null,
      watchExpirationAt: syncState.gmail.watchExpirationAt ?? null,
      renewalDueAt: syncState.gmail.renewalDueAt ?? null,
      lastNotificationAt: syncState.gmail.lastNotificationAt ?? null,
      lastReconciledAt: syncState.gmail.lastReconciledAt ?? null,
      blocker: syncState.gmail.blocker ?? null
    }
  });
}

export function buildWorkspaceWebhookNotificationPersistencePlan(input: {
  dedupeKey: string;
  source: "drive" | "gmail";
  receivedAt: string;
  subscription?: string;
  messageId?: string;
  messageNumber?: string;
  channelId?: string;
  resourceId?: string;
  resourceState?: string;
}) {
  const id = buildWorkspaceWebhookNotificationDocumentId(input.dedupeKey);

  return buildFirestoreCommitRequest(
    "webhookNotifications",
    id,
    {
      id,
      tenantId: sentinelConfig.tenantId,
      dedupeKey: input.dedupeKey,
      source: input.source,
      receivedAt: input.receivedAt,
      subscription: input.subscription ?? null,
      messageId: input.messageId ?? null,
      messageNumber: input.messageNumber ?? null,
      channelId: input.channelId ?? null,
      resourceId: input.resourceId ?? null,
      resourceState: input.resourceState ?? null
    },
    { currentDocument: { exists: false } }
  );
}

export function buildWorkspaceWebhookNotificationDocumentId(dedupeKey: string) {
  return `webhook_${createHash("sha256").update(dedupeKey).digest("hex").slice(0, 40)}`;
}

export async function reservePersistedWorkspaceWebhookNotification(
  input: Parameters<typeof buildWorkspaceWebhookNotificationPersistencePlan>[0],
  fetchImpl: typeof fetch = fetch
) {
  const readiness = buildPersistenceReadiness();

  if (!readiness.configured) {
    throw new Error(
      `Webhook replay persistence requires SENTINEL_STORAGE_MODE=gcp-rest and Google Cloud configuration. Missing env: ${readiness.missingEnv.join(", ") || "none"}.`
    );
  }

  const request = buildWorkspaceWebhookNotificationPersistencePlan(input);
  const accessToken = await fetchCloudRunAccessToken(fetchImpl);

  try {
    const result = await executeGoogleJsonRequest(request, accessToken, fetchImpl);
    return {
      duplicate: false,
      documentName: buildFirestoreDocumentName("webhookNotifications", buildWorkspaceWebhookNotificationDocumentId(input.dedupeKey)),
      httpStatus: result.httpStatus
    };
  } catch (error) {
    if (error instanceof GoogleCloudRequestError && (error.httpStatus === 409 || error.httpStatus === 412)) {
      return {
        duplicate: true,
        documentName: buildFirestoreDocumentName("webhookNotifications", buildWorkspaceWebhookNotificationDocumentId(input.dedupeKey)),
        httpStatus: error.httpStatus
      };
    }

    throw error;
  }
}

export async function verifyPersistenceWriteThrough(
  input: {
    auditEvents: AuditEvent[];
    agentRuns: AgentRun[];
    pilotRecords: PilotCustomerRecord[];
  },
  fetchImpl: typeof fetch = fetch
): Promise<PersistenceVerificationResult> {
  const readiness = buildPersistenceReadiness();
  const checks: PersistenceVerificationResult["checks"] = [];

  if (!readiness.configured) {
    const missing = readiness.missingEnv.length ? ` Missing env: ${readiness.missingEnv.join(", ")}.` : "";
    return {
      generatedAt: new Date().toISOString(),
      mode: readiness.mode,
      status: "blocked",
      attemptedWrites: false,
      checks: [
        {
          target: "configuration",
          status: "blocked",
          detail: `Persistence write-through requires SENTINEL_STORAGE_MODE=gcp-rest and Google Cloud configuration.${missing}`
        }
      ]
    };
  }

  try {
    const accessToken = await fetchCloudRunAccessToken(fetchImpl);
    checks.push({
      target: "access-token",
      status: "passed",
      detail: "Resolved Google Cloud access token from env or Cloud Run metadata server."
    });

    const pilot = input.pilotRecords[0];
    if (pilot) {
      const request = buildPilotRecordPersistencePlan(pilot);
      const result = await executeGoogleJsonRequest(request, accessToken, fetchImpl);
      checks.push({
        target: "firestore",
        status: "passed",
        detail: "Pilot evidence document committed to tenant-scoped Firestore path.",
        url: request.url,
        httpStatus: result.httpStatus
      });
    } else {
      checks.push({
        target: "firestore",
        status: "blocked",
        detail: "No pilot record exists to verify Firestore write-through."
      });
    }

    const oauthIssuedAt = new Date().toISOString();
    const oauthRequest = buildWorkspaceOAuthSessionPersistencePlan({
      id: `oauth_launch_verify_${Date.now()}`,
      tenantId: sentinelConfig.tenantId,
      state: `oauth_state_verify_${Date.now()}`,
      consentArtifactId: "verification_only_redacted_pilot_consent",
      requestedScopes: ["https://www.googleapis.com/auth/drive.metadata.readonly", "https://www.googleapis.com/auth/gmail.metadata"],
      status: "issued",
      createdAt: oauthIssuedAt,
      expiresAt: new Date(Date.parse(oauthIssuedAt) + 15 * 60 * 1000).toISOString()
    });
    const oauthResult = await executeGoogleJsonRequest(oauthRequest, accessToken, fetchImpl);
    checks.push({
      target: "oauth-state-firestore",
      status: "passed",
      detail: "One-time OAuth launch state committed to tenant-scoped Firestore path.",
      url: oauthRequest.url,
      httpStatus: oauthResult.httpStatus
    });

    if (input.auditEvents.length) {
      const request = buildBigQueryAuditInsertRequest(input.auditEvents.slice(0, 5));
      const result = await executeGoogleJsonRequest(request, accessToken, fetchImpl);
      const insertErrors = getInsertErrorCount(result.body);
      checks.push({
        target: "bigquery",
        status: insertErrors > 0 ? "failed" : "passed",
        detail:
          insertErrors > 0
            ? `BigQuery insertAll returned ${insertErrors} row error(s).`
            : "Audit events streamed to append-only BigQuery table.",
        url: request.url,
        httpStatus: result.httpStatus
      });
    } else {
      checks.push({
        target: "bigquery",
        status: "blocked",
        detail: "No audit events exist to verify BigQuery write-through."
      });
    }

    if (input.agentRuns.length) {
      const request = buildBigQueryAgentRunInsertRequest(input.agentRuns.slice(0, 5));
      const result = await executeGoogleJsonRequest(request, accessToken, fetchImpl);
      const insertErrors = getInsertErrorCount(result.body);
      const providers = Array.from(new Set(input.agentRuns.map((run) => run.provider))).join(", ");
      checks.push({
        target: "agent-runs-bigquery",
        status: insertErrors > 0 ? "failed" : "passed",
        detail:
          insertErrors > 0
            ? `BigQuery agent-run insertAll returned ${insertErrors} row error(s).`
            : `Agent-run evidence rows streamed to BigQuery with provider metadata (${providers}). Live XPRIZE proof still requires provider=gemini-api.`,
        url: request.url,
        httpStatus: result.httpStatus
      });
    } else {
      checks.push({
        target: "agent-runs-bigquery",
        status: "blocked",
        detail: "No agent runs exist to verify durable Gemini/agent evidence rows."
      });
    }

    const secretRequest = buildSecretManagerAccessVersionRequest();
    try {
      const result = await executeGoogleJsonRequest(secretRequest, accessToken, fetchImpl);
      checks.push({
        target: "secret-manager",
        status: "passed",
        detail: "Workspace OAuth token secret latest version is accessible; token payload was not logged or returned.",
        url: secretRequest.url,
        httpStatus: result.httpStatus
      });
    } catch (error) {
      if (error instanceof GoogleCloudRequestError && error.httpStatus === 404) {
        checks.push({
          target: "secret-manager",
          status: "blocked",
          detail:
            "Workspace OAuth token secret has no accessible latest version yet. Complete a consent-gated OAuth callback to verify Secret Manager token storage.",
          url: secretRequest.url,
          httpStatus: error.httpStatus
        });
      } else if (error instanceof GoogleCloudRequestError) {
        checks.push({
          target: "secret-manager",
          status: "failed",
          detail: `Secret Manager token access verification failed with HTTP ${error.httpStatus}.`,
          url: secretRequest.url,
          httpStatus: error.httpStatus
        });
      } else {
        checks.push({
          target: "secret-manager",
          status: "failed",
          detail: error instanceof Error ? error.message : "Secret Manager token access verification failed.",
          url: secretRequest.url
        });
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      mode: readiness.mode,
      status: summarizePersistenceStatus(checks),
      attemptedWrites: true,
      checks
    };
  } catch (error) {
    checks.push({
      target: "configuration",
      status: "failed",
      detail: error instanceof Error ? error.message : "Persistence write-through failed."
    });

    return {
      generatedAt: new Date().toISOString(),
      mode: readiness.mode,
      status: "failed",
      attemptedWrites: true,
      checks
    };
  }
}

export async function storeWorkspaceOAuthTokenPayload(
  tenantId: string,
  tokenPayload: Record<string, JsonValue>,
  fetchImpl: typeof fetch = fetch
) {
  const readiness = buildPersistenceReadiness();

  if (!readiness.configured) {
    throw new Error(
      `Secret Manager token storage requires SENTINEL_STORAGE_MODE=gcp-rest and Google Cloud configuration. Missing env: ${readiness.missingEnv.join(", ") || "none"}.`
    );
  }

  const accessToken = await fetchCloudRunAccessToken(fetchImpl);
  const request = buildSecretManagerAddVersionRequest(tenantId, tokenPayload);
  const result = await executeGoogleJsonRequest(request, accessToken, fetchImpl);

  return {
    secretName: buildWorkspaceTokenSecretName(tenantId),
    httpStatus: result.httpStatus
  };
}

export async function accessWorkspaceOAuthTokenPayload(tenantId = sentinelConfig.tenantId, fetchImpl: typeof fetch = fetch) {
  const readiness = buildPersistenceReadiness();

  if (!readiness.configured) {
    throw new Error(
      `Workspace OAuth token access requires SENTINEL_STORAGE_MODE=gcp-rest and Google Cloud configuration. Missing env: ${readiness.missingEnv.join(", ") || "none"}.`
    );
  }

  const accessToken = await fetchCloudRunAccessToken(fetchImpl);
  const request = buildSecretManagerAccessVersionRequest(tenantId);
  const result = await executeGoogleJsonRequest(request, accessToken, fetchImpl);
  const payload = parseSecretManagerPayload(result.body);

  if (!payload.refreshToken) {
    throw new Error("Workspace OAuth token secret does not contain a refresh token payload.");
  }

  return {
    secretName: buildWorkspaceTokenSecretName(tenantId),
    httpStatus: result.httpStatus,
    refreshToken: payload.refreshToken,
    scope: payload.scope,
    tokenType: payload.tokenType,
    expiresInSeconds: payload.expiresInSeconds
  };
}

export async function persistWorkspaceOAuthLaunchSession(
  session: WorkspaceOAuthLaunchSession,
  fetchImpl: typeof fetch = fetch
) {
  const readiness = buildPersistenceReadiness();

  if (!readiness.configured) {
    throw new Error(
      `OAuth state persistence requires SENTINEL_STORAGE_MODE=gcp-rest and Google Cloud configuration. Missing env: ${readiness.missingEnv.join(", ") || "none"}.`
    );
  }

  const accessToken = await fetchCloudRunAccessToken(fetchImpl);
  const request = buildWorkspaceOAuthSessionPersistencePlan(session);
  const result = await executeGoogleJsonRequest(request, accessToken, fetchImpl);

  return {
    documentName: buildFirestoreDocumentName("oauthLaunchSessions", session.state),
    httpStatus: result.httpStatus
  };
}

export async function persistWorkspaceOAuthInstallMetadata(
  input: { connection: WorkspaceConnection; syncState: WorkspaceSyncState },
  fetchImpl: typeof fetch = fetch
) {
  const readiness = buildPersistenceReadiness();

  if (!readiness.configured) {
    throw new Error(
      `Workspace install metadata persistence requires SENTINEL_STORAGE_MODE=gcp-rest and Google Cloud configuration. Missing env: ${readiness.missingEnv.join(", ") || "none"}.`
    );
  }

  const accessToken = await fetchCloudRunAccessToken(fetchImpl);
  const connectionRequest = buildWorkspaceConnectionPersistencePlan(input.connection);
  const syncRequest = buildWorkspaceSyncStatePersistencePlan(input.syncState);
  const connectionResult = await executeGoogleJsonRequest(connectionRequest, accessToken, fetchImpl);
  const syncResult = await executeGoogleJsonRequest(syncRequest, accessToken, fetchImpl);

  return {
    connection: {
      url: connectionRequest.url,
      httpStatus: connectionResult.httpStatus
    },
    syncState: {
      url: syncRequest.url,
      httpStatus: syncResult.httpStatus
    }
  };
}

export async function consumePersistedWorkspaceOAuthLaunchSession(
  input: { state?: string | null; now?: string },
  fetchImpl: typeof fetch = fetch
): Promise<WorkspaceOAuthStateValidationResult> {
  const oauthState = cleanState(input.state ?? "");

  if (!oauthState) {
    return {
      status: "blocked",
      reason: "missing_state",
      detail: "OAuth callback did not include a state value."
    };
  }

  if (!isTenantSafeId(oauthState)) {
    return {
      status: "blocked",
      reason: "unknown_state",
      detail: "OAuth callback state contains unsupported characters and was rejected before Firestore lookup."
    };
  }

  const readiness = buildPersistenceReadiness();
  if (!readiness.configured) {
    return {
      status: "blocked",
      reason: "persistence_error",
      detail: "Durable OAuth state validation requires SENTINEL_STORAGE_MODE=gcp-rest and Google Cloud configuration."
    };
  }

  try {
    const accessToken = await fetchCloudRunAccessToken(fetchImpl);
    const getRequest = buildFirestoreGetDocumentRequest("oauthLaunchSessions", oauthState);
    const getResult = await executeGoogleJsonRequest(getRequest, accessToken, fetchImpl);
    const loaded = parseWorkspaceOAuthSessionDocument(getResult.body);

    if (!loaded?.session) {
      return {
        status: "blocked",
        reason: "unknown_state",
        detail: "OAuth callback state was not found in tenant-scoped Firestore state storage."
      };
    }

    const { session, updateTime } = loaded;
    const checkedAt = input.now ?? new Date().toISOString();

    if (session.status === "used") {
      return {
        status: "blocked",
        reason: "used_state",
        detail: "OAuth callback state has already been consumed.",
        session
      };
    }

    if (session.status === "expired" || Date.parse(session.expiresAt) <= Date.parse(checkedAt)) {
      return {
        status: "blocked",
        reason: "expired_state",
        detail: "OAuth callback state has expired; restart the consent-gated OAuth launch.",
        session: { ...session, status: "expired" }
      };
    }

    if (!session.consentArtifactId) {
      return {
        status: "blocked",
        reason: "missing_consent_artifact",
        detail: "Persisted OAuth state is missing its signed pilot-consent artifact binding.",
        session
      };
    }

    const consumeRequest = buildWorkspaceOAuthSessionConsumePlan(session, checkedAt, updateTime);
    await executeGoogleJsonRequest(consumeRequest, accessToken, fetchImpl);

    return {
      status: "passed",
      reason: "validated",
      detail: "OAuth state matched a one-time Firestore launch session and retained its signed pilot-consent binding.",
      session: { ...session, status: "used", usedAt: checkedAt }
    };
  } catch (error) {
    if (error instanceof GoogleCloudRequestError && error.httpStatus === 404) {
      return {
        status: "blocked",
        reason: "unknown_state",
        detail: "OAuth callback state was not found in tenant-scoped Firestore state storage."
      };
    }

    if (error instanceof GoogleCloudRequestError && (error.httpStatus === 409 || error.httpStatus === 412)) {
      return {
        status: "blocked",
        reason: "used_state",
        detail: "OAuth callback state was already consumed or changed by another Cloud Run instance."
      };
    }

    return {
      status: "blocked",
      reason: "persistence_error",
      detail: error instanceof Error ? error.message : "Durable OAuth state validation failed."
    };
  }
}

export async function fetchCloudRunAccessToken(fetchImpl: typeof fetch = fetch) {
  const envToken = process.env.GOOGLE_CLOUD_ACCESS_TOKEN;
  if (envToken) {
    return envToken;
  }

  const response = await fetchImpl("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
    headers: { "Metadata-Flavor": "Google" }
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch Google Cloud access token from metadata server: ${response.status}`);
  }

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error("Metadata server response did not include an access token.");
  }

  return payload.access_token;
}

async function executeGoogleJsonRequest(request: GoogleJsonRequest, accessToken: string, fetchImpl: typeof fetch) {
  const init: RequestInit = {
    method: request.method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    }
  };

  if ("body" in request) {
    init.body = JSON.stringify(request.body);
  }

  const response = await fetchImpl(request.url, {
    ...init
  });
  const text = await response.text();
  const body = parseJsonResponse(text);

  if (!response.ok) {
    throw new GoogleCloudRequestError(response.status, `Google Cloud request failed: ${response.status} ${response.statusText} at ${request.url}`, body);
  }

  return { httpStatus: response.status, body };
}

class GoogleCloudRequestError extends Error {
  constructor(
    readonly httpStatus: number,
    message: string,
    readonly body: unknown
  ) {
    super(message);
  }
}

function buildFirestoreDocumentName(collection: FirestoreCollection, id: string) {
  return [
    "projects",
    sentinelConfig.googleCloudProject || "PROJECT_ID",
    "databases",
    sentinelConfig.firestoreDatabase,
    "documents",
    "tenants",
    sentinelConfig.tenantId,
    collection,
    id
  ].join("/");
}

function buildFirestoreCommitRoot() {
  return [
    "projects",
    sentinelConfig.googleCloudProject || "PROJECT_ID",
    "databases",
    sentinelConfig.firestoreDatabase,
    "documents:commit"
  ].join("/");
}

function parseSecretManagerPayload(body: unknown) {
  const payload = body as { payload?: { data?: string } };
  const encoded = payload.payload?.data;

  if (!encoded) {
    throw new Error("Secret Manager access response did not include payload data.");
  }

  const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
    refreshToken?: string;
    scope?: string;
    tokenType?: string;
    expiresInSeconds?: number | null;
  };

  return parsed;
}

function serializeWorkspaceOAuthSession(session: WorkspaceOAuthLaunchSession): Record<string, JsonValue> {
  return {
    id: session.id,
    tenantId: session.tenantId,
    state: session.state,
    consentArtifactId: session.consentArtifactId,
    targetProspectId: session.targetProspectId ?? null,
    requestedScopes: session.requestedScopes,
    status: session.status,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    usedAt: session.usedAt ?? null
  };
}

function parseWorkspaceOAuthSessionDocument(body: unknown): { session?: WorkspaceOAuthLaunchSession; updateTime?: string } {
  if (!body || typeof body !== "object") {
    return {};
  }

  const document = body as { fields?: Record<string, FirestoreValue>; updateTime?: string };
  const fields = fromFirestoreFields(document.fields ?? {});
  const status = fields.status === "used" || fields.status === "expired" ? fields.status : "issued";
  const requestedScopes = Array.isArray(fields.requestedScopes)
    ? fields.requestedScopes.filter((scope): scope is string => typeof scope === "string")
    : [];

  if (
    typeof fields.id !== "string" ||
    typeof fields.tenantId !== "string" ||
    typeof fields.state !== "string" ||
    typeof fields.consentArtifactId !== "string" ||
    typeof fields.createdAt !== "string" ||
    typeof fields.expiresAt !== "string"
  ) {
    return { updateTime: document.updateTime };
  }

  return {
    updateTime: document.updateTime,
    session: {
      id: fields.id,
      tenantId: fields.tenantId,
      state: fields.state,
      consentArtifactId: fields.consentArtifactId,
      targetProspectId: typeof fields.targetProspectId === "string" ? fields.targetProspectId : undefined,
      requestedScopes,
      status,
      createdAt: fields.createdAt,
      expiresAt: fields.expiresAt,
      usedAt: typeof fields.usedAt === "string" ? fields.usedAt : undefined
    }
  };
}

type FirestoreValue = {
  nullValue?: null;
  stringValue?: string;
  booleanValue?: boolean;
  integerValue?: string | number;
  doubleValue?: number;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};

function fromFirestoreFields(fields: Record<string, FirestoreValue>): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromFirestoreValue(value)]));
}

function fromFirestoreValue(value: FirestoreValue): JsonValue {
  if ("nullValue" in value) {
    return null;
  }

  if (typeof value.stringValue === "string") {
    return value.stringValue;
  }

  if (typeof value.booleanValue === "boolean") {
    return value.booleanValue;
  }

  if (typeof value.integerValue !== "undefined") {
    return Number(value.integerValue);
  }

  if (typeof value.doubleValue === "number") {
    return value.doubleValue;
  }

  if (value.arrayValue) {
    return (value.arrayValue.values ?? []).map(fromFirestoreValue);
  }

  if (value.mapValue) {
    return fromFirestoreFields(value.mapValue.fields ?? {});
  }

  return null;
}

function parseJsonResponse(text: string): unknown {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getInsertErrorCount(body: unknown) {
  if (!body || typeof body !== "object" || !("insertErrors" in body)) {
    return 0;
  }

  const errors = (body as { insertErrors?: unknown }).insertErrors;
  return Array.isArray(errors) ? errors.length : 0;
}

function summarizePersistenceStatus(checks: PersistenceVerificationResult["checks"]): PersistenceVerificationResult["status"] {
  if (checks.some((check) => check.status === "failed")) {
    return "failed";
  }

  if (checks.some((check) => check.status === "blocked")) {
    return "blocked";
  }

  return "passed";
}

function toFirestoreFields(data: Record<string, JsonValue>) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toFirestoreValue(value)]));
}

function toFirestoreValue(value: JsonValue): Record<string, unknown> {
  if (value === null) {
    return { nullValue: null };
  }

  if (typeof value === "string") {
    return { stringValue: value };
  }

  if (typeof value === "boolean") {
    return { booleanValue: value };
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }

  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }

  return { mapValue: { fields: toFirestoreFields(value) } };
}

function assertTenantSafeId(value: string, label: string) {
  if (!isTenantSafeId(value)) {
    throw new Error(`Unsafe ${label}: only letters, numbers, underscores, and hyphens are allowed.`);
  }
}

function isTenantSafeId(value: string) {
  return /^[a-zA-Z0-9_-]+$/u.test(value);
}

function cleanState(value: string) {
  return value.trim().slice(0, 240);
}
