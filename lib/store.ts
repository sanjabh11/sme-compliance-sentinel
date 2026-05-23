import { sentinelConfig, makeId, nowIso } from "@/lib/config";
import {
  buildAuditIntegritySummary,
  buildChainedAuditEvent,
  rebuildAuditIntegrityChain,
  sortAuditEventsForChain
} from "@/lib/audit-integrity";
import { makeGmailPiiEvent, makeLowRiskThumbnailEvent, makePublicSecretDriveEvent } from "@/lib/mock-events";
import { scanResourceEvent } from "@/lib/scanner";
import { buildStrategySnapshot } from "@/lib/strategy";
import { buildReadinessCommandCenter } from "@/lib/readiness";
import { bootstrapLiveWorkspaceSyncState, buildInitialWorkspaceSyncState, reconcileWorkspaceSyncState } from "@/lib/workspace-sync";
import { buildTrustPacket, defaultTrustPacketSections } from "@/lib/trust-center";
import { buildQuestionnaireExport, buildQuestionnaireResponsePack, normalizeQuestionText } from "@/lib/questionnaire";
import { buildDefaultPlaybooks, validatePlaybookDraft } from "@/lib/playbooks";
import { buildRiskScoreSnapshot } from "@/lib/risk-score";
import { getApproverForRole, getEscalationTargetForRole } from "@/lib/approval-ops";
import { normalizeEvidenceVaultArtifactInput, type EvidenceVaultArtifactInput } from "@/lib/evidence-vault";
import {
  buildEvidenceVaultArtifactInputsFromImport,
  buildEvidenceVaultImport
} from "@/lib/evidence-vault-import";
import { normalizePilotProspectInput, type PilotProspectInput } from "@/lib/prospect-pipeline";
import type {
  AgentRun,
  ApprovalControl,
  ApproverRole,
  AuditEvent,
  DashboardSnapshot,
  EvidenceCounters,
  EvidenceVaultImportRequest,
  EvidenceVaultArtifact,
  EvidenceVaultImportResult,
  Finding,
  FindingStatus,
  RecommendationAction,
  RemediationActionRecord,
  RemediationPlaybook,
  ResourceEvent,
  RiskScoreSnapshot,
  RiskScoreSnapshotReason,
  Severity,
  Tenant,
  WorkspaceConnection,
  PilotCustomerRecord,
  PilotProspectRecord,
  QuestionnaireAnswerLibraryItem,
  QuestionnaireInputSource,
  QuestionnaireResponsePack,
  QuestionnaireResponseAnswer,
  TrustAccessRequest,
  TrustDocument,
  TrustPacket,
  TrustPacketAccessResult,
  TrustPacketSection,
  WorkspaceOAuthLaunchSession,
  WorkspaceOAuthStateValidationResult,
  WorkspaceReconciliationResult,
  WorkspaceSyncState
} from "@/lib/types";

interface SentinelState {
  tenant: Tenant;
  connections: WorkspaceConnection[];
  syncState: WorkspaceSyncState;
  events: ResourceEvent[];
  findings: Finding[];
  agentRuns: AgentRun[];
  remediations: RemediationActionRecord[];
  auditEvents: AuditEvent[];
  pilotRecords: PilotCustomerRecord[];
  pilotProspects: PilotProspectRecord[];
  evidenceVaultArtifacts: EvidenceVaultArtifact[];
  trustDocuments: TrustDocument[];
  trustAccessRequests: TrustAccessRequest[];
  trustPackets: TrustPacket[];
  questionnairePacks: QuestionnaireResponsePack[];
  answerLibrary: QuestionnaireAnswerLibraryItem[];
  playbooks: RemediationPlaybook[];
  oauthLaunchSessions: WorkspaceOAuthLaunchSession[];
  scoreHistory: RiskScoreSnapshot[];
  processedEventIds: Set<string>;
  processedWebhookNotificationIds: Set<string>;
  aggregateCounters: EvidenceCounters;
}

const workspaceOauthLaunchTtlMs = 15 * 60 * 1000;

const globalState = globalThis as typeof globalThis & { __sentinelState?: SentinelState };

function createInitialState(): SentinelState {
  const pilotRecords = makeInitialPilotRecords();
  const pilotProspects = makeInitialPilotProspects();
  const tenant: Tenant = {
    id: sentinelConfig.tenantId,
    name: "MainStreet Security Labs",
    category: "Small Business Services",
    positioning: "AI DLP + SOC2 readiness evidence pack for seed-stage teams using Google Workspace.",
    settings: {
      safeAutoActions: [],
      requireHumanApproval: true,
      geminiModel: sentinelConfig.geminiModel,
      mockMode: sentinelConfig.mockMode
    },
    evidence: summarizePilotEvidence(pilotRecords)
  };

  const state: SentinelState = {
    tenant,
    connections: [
      {
        id: "conn_google_workspace_mock",
        tenantId: tenant.id,
        provider: "google-workspace",
        mode: "mock",
        connectedAt: nowIso(),
        scopes: [
          "https://www.googleapis.com/auth/drive.metadata.readonly",
          "https://www.googleapis.com/auth/gmail.metadata"
        ]
      }
    ],
    syncState: buildInitialWorkspaceSyncState(tenant.id),
    events: [],
    findings: [],
    agentRuns: [],
    remediations: [],
    auditEvents: [],
    pilotRecords,
    pilotProspects,
    evidenceVaultArtifacts: [],
    trustDocuments: makeInitialTrustDocuments(tenant.id),
    trustAccessRequests: [],
    trustPackets: [],
    questionnairePacks: [],
    answerLibrary: [],
    playbooks: buildDefaultPlaybooks(tenant.id),
    oauthLaunchSessions: [],
    scoreHistory: [],
    processedEventIds: new Set(),
    processedWebhookNotificationIds: new Set(),
    aggregateCounters: { filesInspected: 0, bytesExtracted: 0, bytesScannedByDlp: 0, bytesRoutedToGemini: 0 }
  };

  appendAuditEvent(
    state,
    "system",
    "evidence_exported",
    "Demo state initialized. Production deployments must use consented customer data and avoid certification claims.",
    undefined,
    undefined,
    { id: "audit_bootstrap" }
  );
  state.scoreHistory.unshift(buildRiskScoreSnapshot(state, { id: "score_baseline", capturedAt: nowIso(), reason: "baseline" }));
  return state;
}

export function getState() {
  if (!globalState.__sentinelState) {
    globalState.__sentinelState = createInitialState();
  }

  ensureStateShape(globalState.__sentinelState);
  return globalState.__sentinelState;
}

export function resetState() {
  globalState.__sentinelState = createInitialState();
  return getDashboardSnapshot();
}

export function recordPilotEvidence(input: {
  customerAlias?: string;
  segment?: string;
  armsLength?: boolean;
  relatedParty?: boolean;
  monthlyRevenueUsd?: number;
  activeUsers?: number;
  proofStatus?: PilotCustomerRecord["proofStatus"];
  consentStatus?: PilotCustomerRecord["consentStatus"];
  invoiceReference?: string;
  testimonialQuote?: string;
  notes?: string;
}) {
  const state = getState();
  const segment = cleanText(input.segment ?? "");
  const customerAlias = cleanText(input.customerAlias ?? "Private pilot customer");
  const monthlyRevenueUsd = Math.max(0, Math.round(Number(input.monthlyRevenueUsd ?? 0)));
  const activeUsers = Math.max(0, Math.round(Number(input.activeUsers ?? 0)));

  if (!segment) {
    throw new Error("Pilot segment is required.");
  }

  if (!Number.isFinite(monthlyRevenueUsd) || !Number.isFinite(activeUsers)) {
    throw new Error("Pilot revenue and active users must be valid numbers.");
  }

  const pilot: PilotCustomerRecord = {
    id: makeId("pilot"),
    customerAlias,
    segment,
    armsLength: input.armsLength ?? true,
    relatedParty: input.relatedParty ?? false,
    monthlyRevenueUsd,
    activeUsers,
    proofStatus: input.proofStatus ?? "invoice-needed",
    consentStatus: input.consentStatus ?? "pending",
    startedAt: nowIso(),
    invoiceReference: cleanOptionalText(input.invoiceReference),
    testimonialQuote: cleanOptionalText(input.testimonialQuote),
    notes: cleanOptionalText(input.notes)
  };

  state.pilotRecords.unshift(pilot);
  state.tenant.evidence = summarizePilotEvidence(state.pilotRecords);

  writeAudit(
    "admin",
    "pilot_evidence_recorded",
    `Pilot evidence recorded for ${pilot.segment}: $${pilot.monthlyRevenueUsd}/mo, ${pilot.activeUsers} active user(s).`,
    pilot.id,
    {
      armsLength: pilot.armsLength,
      relatedParty: pilot.relatedParty,
      proofStatus: pilot.proofStatus
    }
  );
  appendRiskScoreSnapshot(state, "pilot_evidence_recorded", pilot.id, true);

  return getDashboardSnapshot();
}

export function recordPilotProspect(input: PilotProspectInput) {
  const state = getState();
  const normalized = normalizePilotProspectInput(input);
  const existingIndex = input.id ? state.pilotProspects.findIndex((prospect) => prospect.id === input.id) : -1;

  if (existingIndex >= 0) {
    const existing = state.pilotProspects[existingIndex];
    state.pilotProspects[existingIndex] = {
      ...normalized,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: nowIso()
    };
  } else {
    state.pilotProspects.unshift(normalized);
  }

  const prospect =
    existingIndex >= 0
      ? state.pilotProspects[existingIndex]
      : state.pilotProspects.find((candidate) => candidate.id === normalized.id) ?? normalized;

  writeAudit(
    "admin",
    "pilot_prospect_recorded",
    `Pilot prospect recorded: ${prospect.prospectAlias} at ${prospect.stage}.`,
    prospect.id,
    {
      stage: prospect.stage,
      fitScore: prospect.fitScore,
      estimatedMrrUsd: prospect.estimatedMrrUsd,
      source: prospect.source
    }
  );
  appendRiskScoreSnapshot(state, "pilot_prospect_recorded", prospect.id, true);

  return { prospect, snapshot: getDashboardSnapshot() };
}

export function registerEvidenceVaultArtifact(input: EvidenceVaultArtifactInput) {
  const state = getState();
  const artifact = normalizeEvidenceVaultArtifactInput(input, state.tenant.id);
  const existingIndex = state.evidenceVaultArtifacts.findIndex((candidate) => candidate.id === artifact.id);

  if (existingIndex >= 0) {
    const existing = state.evidenceVaultArtifacts[existingIndex];
    state.evidenceVaultArtifacts[existingIndex] = {
      ...existing,
      ...artifact,
      createdAt: existing.createdAt,
      updatedAt: nowIso()
    };
  } else {
    state.evidenceVaultArtifacts.unshift(artifact);
  }

  writeAudit(
    "admin",
    "evidence_vault_artifact_registered",
    `Evidence Vault artifact registered: ${artifact.label}`,
    artifact.id,
    {
      kind: artifact.kind,
      status: artifact.status,
      ownerRole: artifact.ownerRole,
      redacted: artifact.redacted
    }
  );
  appendRiskScoreSnapshot(state, "evidence_vault_artifact_registered", artifact.id, true);

  return { artifact: state.evidenceVaultArtifacts.find((candidate) => candidate.id === artifact.id) ?? artifact, snapshot: getDashboardSnapshot() };
}

export function importEvidenceVaultArtifacts(input: EvidenceVaultImportRequest): {
  importResult: EvidenceVaultImportResult;
  artifacts: EvidenceVaultArtifact[];
  snapshot: DashboardSnapshot;
} {
  const state = getState();
  const importResult = buildEvidenceVaultImport(input);

  if (importResult.artifactCount === 0) {
    throw new Error(importResult.blockers[0] ?? "No supported evidence artifact could be inferred from this JSON payload.");
  }

  const artifacts = buildEvidenceVaultArtifactInputsFromImport(importResult).map((artifactInput) =>
    upsertEvidenceVaultArtifact(state, normalizeEvidenceVaultArtifactInput(artifactInput, state.tenant.id))
  );

  writeAudit(
    "admin",
    "evidence_vault_artifact_registered",
    `Evidence Vault proof import registered ${artifacts.length} artifact(s) from ${importResult.source}.`,
    artifacts[0]?.id ?? "evidence_import",
    {
      source: importResult.source,
      artifactCount: artifacts.length,
      checksumSha256: importResult.checksumSha256,
      redacted: importResult.redacted
    }
  );
  appendRiskScoreSnapshot(state, "evidence_vault_artifact_registered", artifacts[0]?.id ?? "evidence_import", true);

  return { importResult, artifacts, snapshot: getDashboardSnapshot() };
}

export function findVerifiedPilotConsentArtifact() {
  const state = getState();
  const artifact = state.evidenceVaultArtifacts.find(
    (candidate) => candidate.kind === "pilot-consent" && candidate.status === "verified" && candidate.redacted
  );

  return artifact ? { ...artifact } : undefined;
}

function upsertEvidenceVaultArtifact(state: SentinelState, artifact: EvidenceVaultArtifact) {
  const existingIndex = state.evidenceVaultArtifacts.findIndex((candidate) => candidate.id === artifact.id);

  if (existingIndex >= 0) {
    const existing = state.evidenceVaultArtifacts[existingIndex];
    state.evidenceVaultArtifacts[existingIndex] = {
      ...existing,
      ...artifact,
      createdAt: existing.createdAt,
      updatedAt: nowIso()
    };
  } else {
    state.evidenceVaultArtifacts.unshift(artifact);
  }

  return state.evidenceVaultArtifacts.find((candidate) => candidate.id === artifact.id) ?? artifact;
}

export function recordWorkspaceOAuthLaunchSession(input: {
  state: string;
  requestedScopes: string[];
  consentArtifactId?: string;
  targetProspectId?: string;
  now?: string;
  ttlMs?: number;
}) {
  const state = getState();
  const oauthState = cleanText(input.state);
  const consentArtifact = input.consentArtifactId
    ? state.evidenceVaultArtifacts.find(
        (candidate) =>
          candidate.id === input.consentArtifactId &&
          candidate.kind === "pilot-consent" &&
          candidate.status === "verified" &&
          candidate.redacted
      )
    : findVerifiedPilotConsentArtifact();

  if (!oauthState) {
    throw new Error("OAuth state is required before redirecting to Google.");
  }

  if (!input.requestedScopes.length) {
    throw new Error("At least one requested OAuth scope is required.");
  }

  if (!consentArtifact) {
    throw new Error("A redacted verified pilot-consent artifact is required before issuing an OAuth launch state.");
  }

  const createdAt = input.now ?? nowIso();
  const expiresAt = new Date(Date.parse(createdAt) + Math.max(60_000, input.ttlMs ?? workspaceOauthLaunchTtlMs)).toISOString();
  const session: WorkspaceOAuthLaunchSession = {
    id: makeId("oauth_launch"),
    tenantId: state.tenant.id,
    state: oauthState,
    consentArtifactId: consentArtifact.id,
    targetProspectId: cleanOptionalText(input.targetProspectId),
    requestedScopes: input.requestedScopes,
    status: "issued",
    createdAt,
    expiresAt
  };

  state.oauthLaunchSessions = state.oauthLaunchSessions.filter((candidate) => candidate.state !== oauthState);
  state.oauthLaunchSessions.unshift(session);
  state.oauthLaunchSessions = state.oauthLaunchSessions.slice(0, 100);

  writeAudit(
    "system",
    "workspace_oauth_launch_issued",
    "Workspace OAuth launch state issued after signed-consent gate.",
    session.id,
    {
      requestedScopes: session.requestedScopes.length,
      consentArtifactId: consentArtifact.id,
      expiresAt: session.expiresAt
    }
  );

  return { ...session };
}

export function consumeWorkspaceOAuthLaunchSession(input: {
  state?: string | null;
  now?: string;
}): WorkspaceOAuthStateValidationResult {
  const state = getState();
  const oauthState = cleanText(input.state ?? "");
  const checkedAt = input.now ?? nowIso();

  if (!oauthState) {
    return rejectWorkspaceOAuthState("missing_state", "OAuth callback did not include a state value.", undefined, Boolean(oauthState));
  }

  const session = state.oauthLaunchSessions.find((candidate) => candidate.state === oauthState);

  if (!session) {
    return rejectWorkspaceOAuthState(
      "unknown_state",
      "OAuth callback state was not issued by this app, was issued in another runtime, or has already been purged.",
      undefined,
      true
    );
  }

  if (session.status === "used") {
    return rejectWorkspaceOAuthState("used_state", "OAuth callback state has already been consumed.", session, true);
  }

  if (session.status === "expired" || Date.parse(session.expiresAt) <= Date.parse(checkedAt)) {
    session.status = "expired";
    return rejectWorkspaceOAuthState("expired_state", "OAuth callback state has expired; restart the consent-gated OAuth launch.", session, true);
  }

  const consentArtifact = state.evidenceVaultArtifacts.find(
    (candidate) =>
      candidate.id === session.consentArtifactId &&
      candidate.kind === "pilot-consent" &&
      candidate.status === "verified" &&
      candidate.redacted
  );

  if (!consentArtifact) {
    return rejectWorkspaceOAuthState(
      "missing_consent_artifact",
      "The pilot-consent artifact tied to this OAuth launch is no longer verified and redacted.",
      session,
      true
    );
  }

  session.status = "used";
  session.usedAt = checkedAt;
  writeAudit(
    "system",
    "workspace_oauth_state_validated",
    "Workspace OAuth callback state validated before token exchange.",
    session.id,
    {
      consentArtifactId: session.consentArtifactId,
      requestedScopes: session.requestedScopes.length
    }
  );

  return {
    status: "passed",
    reason: "validated",
    detail: "OAuth state matched a one-time launch session and signed pilot consent remains verified.",
    session: { ...session, requestedScopes: [...session.requestedScopes] }
  };
}

export function recordWorkspaceOAuthInstall(input: { scopes: string[]; state?: string | null; connectedAt?: string }) {
  const state = getState();
  const connectedAt = input.connectedAt ?? nowIso();
  const scopes = Array.from(new Set(input.scopes.filter(Boolean))).sort();
  const connection: WorkspaceConnection = {
    id: "conn_google_workspace_oauth",
    tenantId: state.tenant.id,
    provider: "google-workspace",
    mode: "oauth",
    scopes,
    connectedAt
  };

  state.connections = [
    connection,
    ...state.connections.filter(
      (candidate) => !(candidate.provider === "google-workspace" && candidate.mode === "mock") && candidate.id !== connection.id
    )
  ];
  state.syncState = {
    tenantId: state.tenant.id,
    mode: "oauth",
    reconciliationCadenceHours: state.syncState?.reconciliationCadenceHours ?? 6,
    deadLetterCount: state.syncState?.deadLetterCount ?? 0,
    drive: {
      status: "not_configured",
      blocker: "Drive startPageToken and changes.watch channel are not initialized after OAuth install."
    },
    gmail: {
      status: "not_configured",
      topicName:
        sentinelConfig.gmailPubSubTopic ||
        (sentinelConfig.googleCloudProject ? `projects/${sentinelConfig.googleCloudProject}/topics/workspace-gmail-updates` : undefined),
      blocker: "Gmail users.watch historyId is not initialized after OAuth install."
    }
  };

  const artifact = normalizeEvidenceVaultArtifactInput(
    {
      id: "vault_workspace_oauth_log",
      kind: "workspace-oauth-log",
      label: "Workspace OAuth install and sync cursor proof",
      status: "uploaded",
      ownerRole: "engineering",
      sourceDescription: "OAuth callback stored the refresh-token payload in Secret Manager and recorded redacted connection metadata.",
      redacted: true,
      privateHandling: "Keep OAuth tokens, tenant emails, domains, and raw file names private; expose only install timestamp, scopes, and cursor status.",
      requiredFor: "AI-Native Operations",
      nextAction: "Initialize Drive startPageToken, Drive changes watch, Gmail watch historyId, and run reconciliation before claiming live sync."
    },
    state.tenant.id,
    connectedAt
  );
  const artifactIndex = state.evidenceVaultArtifacts.findIndex((candidate) => candidate.id === artifact.id);
  if (artifactIndex >= 0) {
    state.evidenceVaultArtifacts[artifactIndex] = {
      ...state.evidenceVaultArtifacts[artifactIndex],
      ...artifact,
      createdAt: state.evidenceVaultArtifacts[artifactIndex].createdAt,
      updatedAt: connectedAt
    };
  } else {
    state.evidenceVaultArtifacts.unshift(artifact);
  }

  writeAudit(
    "system",
    "workspace_oauth_installed",
    "Workspace OAuth install recorded; sync cursors still require Drive/Gmail initialization.",
    connection.id,
    {
      requestedScopes: scopes.length,
      statePresent: Boolean(input.state)
    }
  );
  appendRiskScoreSnapshot(state, "workspace_oauth_installed", connection.id, true);

  return { connection, syncState: state.syncState, artifact, snapshot: getDashboardSnapshot() };
}

export function recordWorkspaceWebhookNotification(input: {
  source: "drive" | "gmail";
  receivedAt?: string;
  subscription?: string;
  messageId?: string;
  messageNumber?: string;
  channelId?: string;
  resourceId?: string;
  resourceState?: string;
  payloadSummary?: string;
}) {
  const state = getState();
  const receivedAt = input.receivedAt ?? nowIso();
  const dedupeKey = buildWorkspaceWebhookNotificationDedupeKey(input);

  if (dedupeKey && state.processedWebhookNotificationIds.has(dedupeKey)) {
    return {
      accepted: true,
      duplicate: true,
      source: input.source,
      reconciliationRequired: true,
      syncState: state.syncState,
      snapshot: getDashboardSnapshot()
    };
  }

  if (dedupeKey) {
    state.processedWebhookNotificationIds.add(dedupeKey);
  }

  if (input.source === "drive") {
    state.syncState.drive.lastNotificationAt = receivedAt;
    state.syncState.drive.channelId = input.channelId ?? state.syncState.drive.channelId;
    state.syncState.drive.channelResourceId = input.resourceId ?? state.syncState.drive.channelResourceId;
    state.syncState.drive.blocker =
      state.syncState.drive.pageToken || state.syncState.drive.startPageToken
        ? state.syncState.drive.blocker
        : "Drive push notification received, but no Drive cursor is initialized for reconciliation.";
  } else {
    state.syncState.gmail.lastNotificationAt = receivedAt;
    state.syncState.gmail.blocker = state.syncState.gmail.historyId
      ? state.syncState.gmail.blocker
      : "Gmail Pub/Sub notification received, but no Gmail historyId is initialized for reconciliation.";
  }

  writeAudit(
    "system",
    "workspace_webhook_notification_received",
    `${input.source.toUpperCase()} webhook notification accepted as a reconciliation hint; no finding was created from push payload.`,
    input.messageId ?? input.resourceId ?? `${input.source}_webhook`,
    {
      source: input.source,
      subscription: input.subscription ?? null,
      channelId: input.channelId ?? null,
      messageNumber: input.messageNumber ?? null,
      resourceState: input.resourceState ?? null,
      payloadSummary: input.payloadSummary ?? null,
      dedupeKey: dedupeKey ?? null
    }
  );

  return {
    accepted: true,
    duplicate: false,
    source: input.source,
    reconciliationRequired: true,
    syncState: state.syncState,
    snapshot: getDashboardSnapshot()
  };
}

export function buildWorkspaceWebhookNotificationDedupeKey(input: {
  source: "drive" | "gmail";
  subscription?: string;
  messageId?: string;
  messageNumber?: string;
  channelId?: string;
  resourceId?: string;
}) {
  if (input.messageId) {
    return `${input.source}:pubsub:${input.subscription ?? "unknown-subscription"}:${input.messageId}`;
  }

  if (input.source === "drive" && input.channelId && input.resourceId && input.messageNumber) {
    return `drive:channel:${input.channelId}:${input.resourceId}:${input.messageNumber}`;
  }

  return undefined;
}

export function createTrustPacket(input: {
  prospectAlias?: string;
  prospectDomain?: string;
  expiresInDays?: number;
  sections?: TrustPacketSection[];
  accessRequestId?: string;
}) {
  const state = getState();
  const createdAt = nowIso();
  const requestedDays = Number(input.expiresInDays ?? 7);
  const expiresInDays = Number.isFinite(requestedDays) ? Math.max(-30, Math.min(30, Math.round(requestedDays))) : 7;
  const expiresAt = new Date(Date.parse(createdAt) + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  const sections = input.sections?.length ? input.sections : defaultTrustPacketSections;
  const accessRequest = input.accessRequestId
    ? findTrustAccessRequest(input.accessRequestId)
    : findLatestApprovedTrustAccessRequest(state, input.prospectDomain);
  const packet = buildTrustPacket(getDashboardSnapshot(), {
    id: makeId("trust_packet"),
    token: makeId("trust"),
    prospectAlias: cleanText(input.prospectAlias ?? "Redacted prospect"),
    prospectDomain: cleanOptionalText(input.prospectDomain),
    createdAt,
    expiresAt,
    sections,
    accessRequest
  });

  state.trustPackets.unshift(packet);
  writeAudit(
    "admin",
    "trust_packet_created",
    `Trust Packet created for ${packet.prospectAlias}; expires ${packet.expiresAt}.`,
    packet.id,
    {
      expiresAt: packet.expiresAt,
      sectionCount: packet.sections.length,
      approvedDocuments: packet.approvedDocuments.length,
      redacted: true
    }
  );
  appendRiskScoreSnapshot(state, "trust_packet_created", packet.id, true);

  return { packet, snapshot: getDashboardSnapshot() };
}

export function createTrustAccessRequest(input: {
  prospectAlias?: string;
  prospectDomain?: string;
  requesterEmail?: string;
  requestedDocumentIds?: string[];
  ndaAccepted?: boolean;
}) {
  const state = getState();
  const createdAt = nowIso();
  const requestedDocumentIds = (input.requestedDocumentIds?.length
    ? input.requestedDocumentIds
    : state.trustDocuments.filter((document) => document.visibility === "requestable").map((document) => document.id)
  ).filter((id, index, ids) => ids.indexOf(id) === index);
  const requestedDocuments = requestedDocumentIds.map((id) => findTrustDocument(id));
  const requiresNda = requestedDocuments.some((document) => document.requiresNda);

  if (!requestedDocumentIds.length) {
    throw new Error("At least one trust document must be requested.");
  }

  if (requestedDocuments.some((document) => document.visibility === "private")) {
    throw new Error("Private trust documents cannot be requested for external packets.");
  }

  const request: TrustAccessRequest = {
    id: makeId("trust_access"),
    tenantId: state.tenant.id,
    prospectAlias: cleanText(input.prospectAlias ?? "Redacted prospect"),
    prospectDomain: cleanOptionalText(input.prospectDomain),
    requesterEmail: cleanText(input.requesterEmail ?? "requester@prospect.example").toLowerCase(),
    requestedDocumentIds,
    approvedDocumentIds: [],
    ndaAccepted: input.ndaAccepted ?? !requiresNda,
    status: "pending",
    approverRole: requiresNda ? "legal" : "security",
    createdAt
  };

  state.trustAccessRequests.unshift(request);
  writeAudit(
    "admin",
    "trust_access_requested",
    `Trust document access requested by ${request.prospectAlias}: ${requestedDocumentIds.length} document(s).`,
    request.id,
    {
      requestedDocuments: requestedDocumentIds.length,
      ndaAccepted: request.ndaAccepted,
      approverRole: request.approverRole
    }
  );

  return { request, snapshot: getDashboardSnapshot() };
}

export function approveTrustAccessRequest(requestId: string, decisionReason = "Approved for active prospect security review.") {
  const request = findTrustAccessRequest(requestId);
  const requestedDocuments = request.requestedDocumentIds.map((id) => findTrustDocument(id));
  const requiresNda = requestedDocuments.some((document) => document.requiresNda);

  if (requiresNda && !request.ndaAccepted) {
    throw new Error("NDA acceptance is required before approving these trust documents.");
  }

  const decidedAt = nowIso();
  request.status = "approved";
  request.approvedDocumentIds = requestedDocuments
    .filter((document) => document.visibility !== "private" && document.status === "available")
    .map((document) => document.id);
  request.decidedAt = decidedAt;
  request.expiresAt = addDays(decidedAt, 365);
  request.decisionReason = cleanText(decisionReason);

  writeAudit("admin", "trust_access_approved", `Trust document access approved for ${request.prospectAlias}.`, request.id, {
    approvedDocuments: request.approvedDocumentIds.length,
    expiresAt: request.expiresAt,
    ndaAccepted: request.ndaAccepted
  });

  return getDashboardSnapshot();
}

export function denyTrustAccessRequest(requestId: string, decisionReason = "Denied by trust owner.") {
  const request = findTrustAccessRequest(requestId);
  const decidedAt = nowIso();
  request.status = "denied";
  request.approvedDocumentIds = [];
  request.decidedAt = decidedAt;
  request.decisionReason = cleanText(decisionReason);

  writeAudit("admin", "trust_access_denied", `Trust document access denied for ${request.prospectAlias}.`, request.id, {
    requestedDocuments: request.requestedDocumentIds.length
  });

  return getDashboardSnapshot();
}

export function accessTrustPacket(token: string): TrustPacketAccessResult {
  const state = getState();
  const packet = state.trustPackets.find((candidate) => candidate.token === token);

  if (!packet) {
    return { status: "not_found", reason: "Trust Packet was not found." };
  }

  if (packet.status === "revoked" || Date.parse(packet.expiresAt) <= Date.now()) {
    packet.status = "expired";
    return { status: "expired", packet, reason: "Trust Packet has expired or is no longer active." };
  }

  packet.accessCount += 1;
  packet.lastAccessedAt = nowIso();
  writeAudit("system", "trust_packet_accessed", `Trust Packet accessed by ${packet.prospectAlias}.`, packet.id, {
    accessCount: packet.accessCount
  });

  return { status: "available", packet };
}

export function createQuestionnaireResponsePack(input: {
  customerAlias?: string;
  customerSegment?: string;
  questionnaireText?: string;
  source?: QuestionnaireInputSource;
  originalFileName?: string;
}) {
  const state = getState();
  const createdAt = nowIso();
  const pack = buildQuestionnaireResponsePack({
    snapshot: getDashboardSnapshot(),
    id: makeId("questionnaire"),
    customerAlias: cleanText(input.customerAlias ?? "Private prospect questionnaire"),
    customerSegment: cleanText(input.customerSegment ?? "Unsegmented security review"),
    questionnaireText: input.questionnaireText ?? "",
    source: input.source ?? "uploaded-text",
    originalFileName: input.originalFileName ? cleanText(input.originalFileName) : undefined,
    createdAt,
    answerLibrary: state.answerLibrary
  });

  state.questionnairePacks.unshift(pack);
  recordAnswerLibraryUsage(state, pack.answers, createdAt);
  writeAudit(
    "admin",
    "questionnaire_pack_created",
    `Questionnaire response pack created for ${pack.customerAlias}: ${pack.questionsCount} question(s).`,
    pack.id,
    {
      questionsCount: pack.questionsCount,
      needsReviewCount: pack.needsReviewCount,
      libraryHitCount: pack.libraryHitCount,
      source: pack.source,
      customerSegment: pack.customerSegment
    }
  );
  appendRiskScoreSnapshot(state, "questionnaire_pack_created", pack.id, true);

  return { pack, snapshot: getDashboardSnapshot() };
}

export function approveQuestionnaireAnswer(packId: string, answerId: string) {
  const pack = findQuestionnairePack(packId);
  const answer = pack.answers.find((candidate) => candidate.id === answerId);

  if (!answer) {
    throw new Error(`Questionnaire answer not found: ${answerId}`);
  }

  answer.status = "approved";
  const libraryItem = upsertAnswerLibraryItem(answer, pack, nowIso());
  pack.approvedCount = pack.answers.filter((candidate) => candidate.status === "approved").length;
  pack.needsReviewCount = pack.answers.filter((candidate) => candidate.status === "needs_review").length;
  pack.status = pack.approvedCount === pack.questionsCount ? "approved" : "ready_for_review";
  pack.updatedAt = nowIso();
  writeAudit("admin", "questionnaire_answer_approved", `Questionnaire answer approved for ${pack.customerAlias}.`, pack.id, {
    answerId,
    approvedCount: pack.approvedCount,
    libraryItemId: libraryItem?.id ?? "not-added"
  });

  return { pack, snapshot: getDashboardSnapshot() };
}

export function verifyAnswerLibraryItem(itemId: string) {
  const state = getState();
  const item = state.answerLibrary.find((candidate) => candidate.id === itemId);

  if (!item) {
    throw new Error(`Answer library item not found: ${itemId}`);
  }

  const verifiedAt = nowIso();
  item.status = "active";
  item.verifiedAt = verifiedAt;
  item.nextReviewAt = addDays(verifiedAt, 90);
  item.updatedAt = verifiedAt;

  writeAudit("admin", "questionnaire_answer_library_verified", `Answer library item verified: ${item.canonicalQuestion}`, item.id, {
    ownerRole: item.ownerRole,
    nextReviewAt: item.nextReviewAt
  });

  return getDashboardSnapshot();
}

export function bulkVerifyAnswerLibraryItems(input: { segment?: string; ownerRole?: QuestionnaireResponseAnswer["ownerRole"]; maxItems?: number } = {}) {
  const state = getState();
  const verifiedAt = nowIso();
  const maxItems = Math.max(1, Math.min(input.maxItems ?? 25, 100));
  const segment = input.segment?.trim().toLowerCase();
  const items = state.answerLibrary
    .filter((item) => item.status !== "retired")
    .filter((item) => !segment || item.segmentTags.some((tag) => tag.toLowerCase() === segment))
    .filter((item) => !input.ownerRole || item.ownerRole === input.ownerRole)
    .slice(0, maxItems);

  for (const item of items) {
    item.status = "active";
    item.verifiedAt = verifiedAt;
    item.nextReviewAt = addDays(verifiedAt, 90);
    item.updatedAt = verifiedAt;
  }

  writeAudit("admin", "questionnaire_answer_library_bulk_verified", `${items.length} Answer Library item(s) bulk verified.`, undefined, {
    verifiedCount: items.length,
    segment: input.segment ?? "all",
    ownerRole: input.ownerRole ?? "all"
  });

  return { verifiedCount: items.length, items, snapshot: getDashboardSnapshot() };
}

export function exportQuestionnaireResponsePack(packId: string) {
  const pack = findQuestionnairePack(packId);
  const exportText = buildQuestionnaireExport(pack);

  pack.exportText = exportText;
  pack.status = "exported";
  pack.updatedAt = nowIso();
  writeAudit("admin", "questionnaire_pack_exported", `Questionnaire response pack exported for ${pack.customerAlias}.`, pack.id, {
    approvedCount: pack.approvedCount,
    questionsCount: pack.questionsCount
  });

  return { pack, exportText, snapshot: getDashboardSnapshot() };
}

export function upsertRemediationPlaybook(input: {
  id?: string;
  name?: string;
  trigger?: string;
  stagedActions?: RecommendationAction[];
  autoAllowed?: boolean;
  approvalSlaHours?: number;
  ownerRole?: ApproverRole;
  escalationTarget?: string;
  status?: RemediationPlaybook["status"];
}) {
  const state = getState();
  const now = nowIso();
  const draft = validatePlaybookDraft(input, state.tenant);
  const existing = input.id ? state.playbooks.find((candidate) => candidate.id === input.id) : undefined;

  if (input.id && !existing) {
    throw new Error(`Playbook not found: ${input.id}`);
  }

  if (existing) {
    Object.assign(existing, {
      ...draft,
      updatedAt: now
    });

    writeAudit("admin", "playbook_updated", `Remediation playbook updated: ${existing.name}`, existing.id, {
      autoAllowed: existing.autoAllowed,
      ownerRole: existing.ownerRole,
      stagedActions: existing.stagedActions.join(",")
    });
    appendRiskScoreSnapshot(state, "playbook_updated", existing.id, true);

    return { playbook: existing, snapshot: getDashboardSnapshot() };
  }

  const playbook: RemediationPlaybook = {
    id: makeId("playbook"),
    tenantId: state.tenant.id,
    ...draft,
    createdAt: now,
    updatedAt: now
  };

  state.playbooks.unshift(playbook);
  writeAudit("admin", "playbook_created", `Remediation playbook created: ${playbook.name}`, playbook.id, {
    autoAllowed: playbook.autoAllowed,
    ownerRole: playbook.ownerRole,
    stagedActions: playbook.stagedActions.join(",")
  });
  appendRiskScoreSnapshot(state, "playbook_created", playbook.id, true);

  return { playbook, snapshot: getDashboardSnapshot() };
}

export function captureRiskScoreSnapshot(reason: RiskScoreSnapshotReason = "manual_snapshot", targetId?: string) {
  const state = getState();
  const snapshot = appendRiskScoreSnapshot(state, reason, targetId, true);

  return { scoreSnapshot: snapshot, snapshot: getDashboardSnapshot() };
}

export function getDashboardSnapshot(): DashboardSnapshot {
  const state = getState();
  refreshApprovalStatuses(state);

  return {
    tenant: state.tenant,
    connections: state.connections,
    syncState: state.syncState,
    events: state.events.map(redactEventForClient),
    findings: state.findings.map(redactFindingForClient),
    agentRuns: [...state.agentRuns],
    remediations: [...state.remediations],
    auditEvents: sortAuditEventsForChain(state.auditEvents),
    pilotRecords: [...state.pilotRecords],
    pilotProspects: [...state.pilotProspects],
    evidenceVaultArtifacts: [...state.evidenceVaultArtifacts],
    trustDocuments: [...state.trustDocuments],
    trustAccessRequests: [...state.trustAccessRequests],
    trustPackets: [...state.trustPackets],
    questionnairePacks: [...state.questionnairePacks],
    answerLibrary: [...state.answerLibrary],
    playbooks: [...state.playbooks],
    scoreHistory: [...state.scoreHistory],
    aggregateCounters: { ...state.aggregateCounters },
    strategy: buildStrategySnapshot(state),
    readiness: buildReadinessCommandCenter({
      tenant: state.tenant,
      connections: state.connections,
      findings: state.findings,
      agentRuns: state.agentRuns,
      auditEvents: state.auditEvents,
      remediations: state.remediations,
      pilotRecords: state.pilotRecords,
      pilotProspects: state.pilotProspects,
      evidenceVaultArtifacts: state.evidenceVaultArtifacts,
      trustDocuments: state.trustDocuments,
      trustAccessRequests: state.trustAccessRequests,
      trustPackets: state.trustPackets,
      questionnairePacks: state.questionnairePacks,
      answerLibrary: state.answerLibrary,
      playbooks: state.playbooks,
      scoreHistory: state.scoreHistory,
      aggregateCounters: state.aggregateCounters,
      syncState: state.syncState
    })
  };
}

export function runWorkspaceSyncReconciliation(): {
  result: WorkspaceReconciliationResult;
  snapshot: DashboardSnapshot;
} {
  const state = getState();
  const result = reconcileWorkspaceSyncState({
    syncState: state.syncState,
    connections: state.connections
  });

  writeAudit(
    "system",
    "sync_reconciliation_completed",
    `Workspace sync reconciliation ${result.status}: ${result.processedChanges} change(s) processed.`,
    "workspace_sync",
    {
      status: result.status,
      attemptedLiveApi: result.attemptedLiveApi,
      processedChanges: result.processedChanges
    }
  );
  appendRiskScoreSnapshot(state, "sync_reconciliation_completed", "workspace_sync", true);

  return { result, snapshot: getDashboardSnapshot() };
}

export async function runWorkspaceSyncBootstrap(): Promise<{
  result: WorkspaceReconciliationResult;
  snapshot: DashboardSnapshot;
}> {
  const state = getState();
  const result = await bootstrapLiveWorkspaceSyncState({
    syncState: state.syncState,
    connections: state.connections
  });

  writeAudit(
    "system",
    "sync_reconciliation_completed",
    `Workspace live sync bootstrap ${result.status}: Drive/Gmail cursor initialization ${result.attemptedLiveApi ? "attempted" : "blocked before API calls"}.`,
    "workspace_sync_bootstrap",
    {
      status: result.status,
      attemptedLiveApi: result.attemptedLiveApi,
      processedChanges: result.processedChanges
    }
  );
  appendRiskScoreSnapshot(state, "sync_reconciliation_completed", "workspace_sync_bootstrap", true);

  return { result, snapshot: getDashboardSnapshot() };
}

export async function ingestResourceEvent(event: ResourceEvent) {
  const state = getState();

  if (state.processedEventIds.has(event.id)) {
    writeAudit("system", "resource_event_skipped", `Duplicate event ignored: ${event.id}`, event.id, {
      reason: "dedupe"
    });
    return { event, duplicate: true, snapshot: getDashboardSnapshot() };
  }

  state.processedEventIds.add(event.id);
  state.events.unshift(event);
  writeAudit("system", "resource_event_ingested", `${event.source.toUpperCase()} event received: ${event.resourceName}`, event.id);

  const { decision, classification, findingDraft } = await scanResourceEvent(event, {
    currentGeminiSpendUsd: currentGeminiSpendUsd(state.agentRuns)
  });
  addCounters(decision.counters);

  if (decision.skipped) {
    writeAudit("system", "resource_event_skipped", `Tier 0 skipped ${event.resourceName}: ${decision.skipReason}`, event.id, {
      reason: decision.skipReason ?? "not specified",
      geminiCalled: false
    });
    appendRiskScoreSnapshot(state, "resource_event_skipped", event.id, true);
    return { event, decision, snapshot: getDashboardSnapshot() };
  }

  let finding: Finding | undefined;

  if (findingDraft && classification) {
    const now = nowIso();
    finding = {
      ...findingDraft,
      id: makeId("finding"),
      status: "recommended",
      approval: buildApprovalControl(
        findingDraft.severity,
        event.source,
        findingDraft.recommendation.action,
        now,
        findingDraft.recommendation.humanApprovalRequired
      ),
      createdAt: now,
      updatedAt: now
    };
    state.findings.unshift(finding);

    const agentRun: AgentRun = {
      id: makeId("agent"),
      tenantId: event.tenantId,
      findingId: finding.id,
      eventId: event.id,
      purpose: "semantic_risk_audit",
      model: classification.model,
      provider: classification.provider,
      fallbackReason: classification.fallbackReason,
      errorClass: classification.errorClass,
      inputTokensEstimated: classification.inputTokensEstimated,
      outputTokensEstimated: classification.outputTokensEstimated,
      estimatedCostUsd: classification.estimatedCostUsd,
      promptSummary: `Risk audit for ${event.resourceName}`,
      outputSummary: classification.summary,
      startedAt: now,
      completedAt: nowIso()
    };
    state.agentRuns.unshift(agentRun);

    const auditLabel =
      classification.provider === "deterministic" ? "Deterministic risk audit completed" : "Gemini semantic audit completed";
    writeAudit("agent", "agent_run_completed", `${auditLabel} for ${event.resourceName}`, agentRun.id, {
      provider: classification.provider,
      estimatedCostUsd: classification.estimatedCostUsd,
      fallbackReason: classification.fallbackReason ?? null,
      errorClass: classification.errorClass ?? null
    });
    writeAudit("agent", "finding_created", `Staged recommendation created: ${finding.title}`, finding.id, {
      severity: finding.severity,
      humanApprovalRequired: finding.recommendation.humanApprovalRequired,
      approverRole: finding.approval.requiredRole,
      dueAt: finding.approval.dueAt
    });
    appendRiskScoreSnapshot(state, "finding_created", finding.id, true);
  }

  return { event, decision, finding, snapshot: getDashboardSnapshot() };
}

export async function rescanFinding(findingId: string) {
  const state = getState();
  const finding = findFinding(findingId);
  const event = state.events.find((candidate) => candidate.id === finding.eventId);

  if (!event) {
    throw new Error("Original event not found for re-scan.");
  }

  finding.status = "rescanning";
  finding.updatedAt = nowIso();
  writeAudit("admin", "finding_rescan_requested", `Admin requested a re-scan for ${finding.resourceName}`, finding.id);

  const { classification } = await scanResourceEvent(
    { ...event, id: makeId("evt_rescan"), previousContentHash: undefined },
    { currentGeminiSpendUsd: currentGeminiSpendUsd(state.agentRuns) }
  );

  if (classification) {
    finding.severity = classification.severity;
    finding.rationale = classification.rationale;
    finding.soc2ReadinessMapping = classification.soc2ReadinessMapping;
    finding.recommendation = {
      action: classification.suggestedAction,
      confidence: classification.confidence,
      blastRadius: classification.blastRadius,
      humanApprovalRequired: classification.suggestedAction !== "no_action"
    };
    finding.approval = buildApprovalControl(
      classification.severity,
      finding.source,
      classification.suggestedAction,
      nowIso(),
      classification.suggestedAction !== "no_action"
    );
    finding.status = "recommended";
    finding.updatedAt = nowIso();

    state.agentRuns.unshift({
      id: makeId("agent"),
      tenantId: finding.tenantId,
      findingId: finding.id,
      eventId: event.id,
      purpose: "rescan",
      model: classification.model,
      provider: classification.provider,
      fallbackReason: classification.fallbackReason,
      errorClass: classification.errorClass,
      inputTokensEstimated: classification.inputTokensEstimated,
      outputTokensEstimated: classification.outputTokensEstimated,
      estimatedCostUsd: classification.estimatedCostUsd,
      promptSummary: `Re-scan for ${finding.resourceName}`,
      outputSummary: classification.summary,
      startedAt: nowIso(),
      completedAt: nowIso()
    });
  }

  appendRiskScoreSnapshot(state, "finding_rescan_requested", finding.id, true);
  return getDashboardSnapshot();
}

export function approveFinding(findingId: string) {
  const finding = updateFindingStatus(findingId, "approved");
  const approvedAt = nowIso();
  finding.approval.status = "approved";
  finding.approval.approvedAt = approvedAt;
  finding.approval.approvedByRole = finding.approval.requiredRole;
  writeAudit("admin", "finding_approved", `Admin approved staged action: ${finding.recommendation.action}`, finding.id, {
    action: finding.recommendation.action,
    approverRole: finding.approval.requiredRole,
    approvedAt
  });
  appendRiskScoreSnapshot(getState(), "finding_approved", finding.id, true);
  return getDashboardSnapshot();
}

export function dismissFinding(findingId: string) {
  const finding = updateFindingStatus(findingId, "dismissed");
  finding.approval.status = "not_required";
  writeAudit("admin", "finding_dismissed", `Admin dismissed recommendation for ${finding.resourceName}`, finding.id);
  appendRiskScoreSnapshot(getState(), "finding_dismissed", finding.id, true);
  return getDashboardSnapshot();
}

export function markFindingFalsePositive(findingId: string) {
  const finding = updateFindingStatus(findingId, "false_positive");
  finding.approval.status = "not_required";
  writeAudit("admin", "finding_false_positive", `Admin marked finding as false positive: ${finding.resourceName}`, finding.id);
  appendRiskScoreSnapshot(getState(), "finding_false_positive", finding.id, true);
  return getDashboardSnapshot();
}

export function remediateFinding(findingId: string, requestedAction?: RecommendationAction) {
  const state = getState();
  const finding = findFinding(findingId);
  const action = requestedAction ?? finding.recommendation.action;
  const safeAutoAllowed = state.tenant.settings.safeAutoActions.includes(action);

  if (finding.status !== "approved" && !safeAutoAllowed) {
    throw new Error("Human approval is required before remediation.");
  }

  if (action === "no_action") {
    throw new Error("No remediation action was recommended.");
  }

  const remediation: RemediationActionRecord = {
    id: makeId("remediation"),
    tenantId: finding.tenantId,
    findingId: finding.id,
    action,
    mode: finding.status === "approved" ? "human_approved" : "safe_auto",
    outcome: "simulated",
    message: simulateRemediationMessage(action, finding.resourceName),
    createdAt: nowIso()
  };

  state.remediations.unshift(remediation);
  finding.status = "remediated";
  finding.updatedAt = nowIso();
  finding.approval.status = "approved";

  writeAudit("system", "remediation_completed", remediation.message, remediation.id, {
    findingId: finding.id,
    action
  });
  appendRiskScoreSnapshot(state, "remediation_completed", remediation.id, true);

  return getDashboardSnapshot();
}

export function writeAudit(
  actor: AuditEvent["actor"],
  type: AuditEvent["type"],
  message: string,
  targetId?: string,
  metadata?: AuditEvent["metadata"]
) {
  const state = getState();
  appendAuditEvent(state, actor, type, message, targetId, metadata);
}

function appendAuditEvent(
  state: SentinelState,
  actor: AuditEvent["actor"],
  type: AuditEvent["type"],
  message: string,
  targetId?: string,
  metadata?: AuditEvent["metadata"],
  options: { id?: string; createdAt?: string } = {}
) {
  const previousHead = state.auditEvents[0];
  const event = buildChainedAuditEvent(
    {
      id: options.id ?? makeId("audit"),
      tenantId: state.tenant.id,
      actor,
      type,
      targetId,
      message,
      createdAt: options.createdAt ?? nowIso(),
      metadata
    },
    previousHead
  );

  state.auditEvents.unshift(event);
}

function appendRiskScoreSnapshot(
  state: SentinelState,
  reason: RiskScoreSnapshotReason,
  targetId?: string,
  audit = false
) {
  const scoreSnapshot = buildRiskScoreSnapshot(state, {
    id: makeId("score"),
    capturedAt: nowIso(),
    reason,
    targetId
  });

  state.scoreHistory.unshift(scoreSnapshot);
  state.scoreHistory = state.scoreHistory.slice(0, 50);

  if (audit) {
    appendAuditEvent(state, "system", "risk_score_snapshot_created", `Risk score snapshot captured: ${reason}.`, scoreSnapshot.id, {
      reason,
      workspaceRiskScore: scoreSnapshot.workspaceRiskScore,
      dealImpactScore: scoreSnapshot.dealImpactScore,
      evidenceMaturity: scoreSnapshot.evidenceMaturity
    });
  }

  return scoreSnapshot;
}

export function createDemoEvent(kind: "public-secret" | "low-risk" | "gmail-pii") {
  if (kind === "low-risk") {
    return makeLowRiskThumbnailEvent();
  }

  if (kind === "gmail-pii") {
    return makeGmailPiiEvent();
  }

  return makePublicSecretDriveEvent();
}

function updateFindingStatus(findingId: string, status: FindingStatus) {
  const finding = findFinding(findingId);
  finding.status = status;
  finding.updatedAt = nowIso();
  return finding;
}

function findFinding(findingId: string) {
  const finding = getState().findings.find((candidate) => candidate.id === findingId);
  if (!finding) {
    throw new Error(`Finding not found: ${findingId}`);
  }

  return finding;
}

function ensureStateShape(state: SentinelState) {
  if (!Array.isArray(state.auditEvents)) {
    state.auditEvents = [];
  }

  backfillLegacyAuditIntegrity(state);

  if (!state.syncState) {
    state.syncState = buildInitialWorkspaceSyncState(state.tenant.id);
    appendAuditEvent(state, "system", "sync_reconciliation_completed", "Workspace sync state initialized after schema migration.", undefined, {
      migration: true
    });
  }

  if (!Array.isArray(state.pilotRecords)) {
    state.pilotRecords = makeInitialPilotRecords();
    state.tenant.evidence = summarizePilotEvidence(state.pilotRecords);
    appendAuditEvent(state, "system", "pilot_evidence_recorded", "Pilot evidence store initialized after schema migration.", undefined, {
      migration: true
    });
  }

  if (!Array.isArray(state.pilotProspects)) {
    state.pilotProspects = makeInitialPilotProspects();
    appendAuditEvent(state, "system", "pilot_prospect_recorded", "Pilot prospect pipeline initialized after schema migration.", undefined, {
      migration: true
    });
  }

  if (!Array.isArray(state.trustDocuments)) {
    state.trustDocuments = makeInitialTrustDocuments(state.tenant.id);
  }

  if (!Array.isArray(state.evidenceVaultArtifacts)) {
    state.evidenceVaultArtifacts = [];
  }

  if (!Array.isArray(state.trustAccessRequests)) {
    state.trustAccessRequests = [];
  }

  if (!Array.isArray(state.trustPackets)) {
    state.trustPackets = [];
  }

  if (!Array.isArray(state.questionnairePacks)) {
    state.questionnairePacks = [];
  }

  if (!Array.isArray(state.answerLibrary)) {
    state.answerLibrary = [];
  }

  if (!Array.isArray(state.playbooks)) {
    state.playbooks = buildDefaultPlaybooks(state.tenant.id);
  }

  if (!Array.isArray(state.oauthLaunchSessions)) {
    state.oauthLaunchSessions = [];
  }

  if (!Array.isArray(state.scoreHistory)) {
    state.scoreHistory = [
      buildRiskScoreSnapshot(state, {
        id: "score_migration_baseline",
        capturedAt: nowIso(),
        reason: "baseline"
      })
    ];
  }

  state.playbooks = state.playbooks.map((playbook) => ({
    ...playbook,
    tenantId: playbook.tenantId ?? state.tenant.id,
    ownerRole: playbook.ownerRole ?? "security",
    escalationTarget: playbook.escalationTarget ?? "founder@mainstreet-security.example",
    status: playbook.status ?? "active",
    createdAt: playbook.createdAt ?? nowIso(),
    updatedAt: playbook.updatedAt ?? nowIso()
  }));

  state.questionnairePacks.forEach((pack) => {
    pack.customerSegment = pack.customerSegment ?? "Unsegmented security review";
    pack.importSummary = pack.importSummary ?? {
      source: pack.source,
      rowsDetected: pack.questionsCount,
      columnsDetected: 1,
      questionsDetected: pack.questionsCount,
      notes: ["Imported before questionnaire intake metadata existed."]
    };
  });

  state.answerLibrary.forEach((item) => {
    item.segmentTags = item.segmentTags ?? [];
  });

  if (!(state.processedEventIds instanceof Set)) {
    state.processedEventIds = new Set(state.events.map((event) => event.id));
  }

  if (!(state.processedWebhookNotificationIds instanceof Set)) {
    state.processedWebhookNotificationIds = new Set();
  }

  state.findings.forEach((finding) => {
    if (!finding.approval) {
      finding.approval = buildApprovalControl(
        finding.severity,
        finding.source,
        finding.recommendation.action,
        finding.createdAt,
        finding.recommendation.humanApprovalRequired
      );
    }
  });

  refreshApprovalStatuses(state);
  refreshAnswerLibraryReviewStatuses(state);
}

function backfillLegacyAuditIntegrity(state: SentinelState) {
  const summary = buildAuditIntegritySummary(state.auditEvents);
  if (summary.missingSeals === 0) {
    return;
  }

  const backfilledAt = nowIso();
  state.auditEvents = rebuildAuditIntegrityChain(state.auditEvents, backfilledAt);
  appendAuditEvent(
    state,
    "system",
    "audit_integrity_backfilled",
    `Audit hash-chain metadata backfilled for ${summary.missingSeals} legacy event(s).`,
    undefined,
    {
      legacyEvents: summary.missingSeals,
      backfilledAt
    }
  );
}

function buildApprovalControl(
  severity: Severity,
  source: ResourceEvent["source"],
  action: RecommendationAction,
  createdAt: string,
  required: boolean
): ApprovalControl {
  const noApprovalNeeded = !required || action === "no_action";
  const requiredRole = noApprovalNeeded ? "security" : selectApproverRole(severity, source, action);
  const slaHours = noApprovalNeeded ? 0 : slaHoursForSeverity(severity);
  const dueAt = noApprovalNeeded ? createdAt : addHours(createdAt, slaHours);

  return {
    requiredRole,
    assignedTo: getApproverForRole(requiredRole).email,
    slaHours,
    dueAt,
    status: noApprovalNeeded ? "not_required" : "pending",
    escalationTarget: noApprovalNeeded ? "none" : getEscalationTargetForRole(requiredRole)
  };
}

function selectApproverRole(severity: Severity, source: ResourceEvent["source"], action: RecommendationAction): ApproverRole {
  if (action === "disable_public_sharing" || severity === "critical" || severity === "high") {
    return "security";
  }

  if (action === "request_owner_review") {
    return "founder";
  }

  if (source === "gmail") {
    return "legal";
  }

  if (action === "label_restricted") {
    return "engineering";
  }

  return "security";
}

function slaHoursForSeverity(severity: Severity) {
  switch (severity) {
    case "critical":
      return 4;
    case "high":
      return 8;
    case "medium":
      return 24;
    case "low":
      return 72;
    case "info":
      return 168;
    default:
      return 24;
  }
}

function refreshApprovalStatuses(state: SentinelState) {
  const nowMs = Date.now();

  state.findings.forEach((finding) => {
    if (finding.status === "approved" || finding.status === "remediated") {
      finding.approval.status = "approved";
      return;
    }

    if (finding.status === "dismissed" || finding.status === "false_positive" || !finding.recommendation.humanApprovalRequired) {
      finding.approval.status = "not_required";
      return;
    }

    if (finding.approval.status === "approved" || finding.approval.status === "not_required") {
      return;
    }

    const dueAtMs = Date.parse(finding.approval.dueAt);
    const createdAtMs = Date.parse(finding.createdAt);
    const totalSlaMs = Math.max(1, dueAtMs - createdAtMs);
    const remainingMs = dueAtMs - nowMs;
    const dueSoonThresholdMs = Math.min(60 * 60 * 1000, totalSlaMs * 0.25);

    if (remainingMs <= 0) {
      finding.approval.status = "overdue";
    } else if (remainingMs <= dueSoonThresholdMs) {
      finding.approval.status = "due_soon";
    } else {
      finding.approval.status = "pending";
    }
  });
}

function addHours(isoTimestamp: string, hours: number) {
  return new Date(Date.parse(isoTimestamp) + hours * 60 * 60 * 1000).toISOString();
}

function upsertAnswerLibraryItem(
  answer: QuestionnaireResponseAnswer,
  pack: QuestionnaireResponsePack,
  approvedAt: string
): QuestionnaireAnswerLibraryItem | undefined {
  if (answer.category === "unknown" || answer.status !== "approved") {
    return undefined;
  }

  const state = getState();
  const normalizedQuestion = normalizeQuestionText(answer.question);
  const existing = state.answerLibrary.find((item) => item.normalizedQuestion === normalizedQuestion);
  const nextReviewAt = addDays(approvedAt, 90);
  const segmentTags = Array.from(new Set([...(existing?.segmentTags ?? []), pack.customerSegment].filter(Boolean))).sort();

  if (existing) {
    existing.canonicalQuestion = answer.question;
    existing.approvedAnswer = answer.draftAnswer;
    existing.citations = answer.citations;
    existing.ownerRole = answer.ownerRole;
    existing.sourcePackId = pack.id;
    existing.sourceAnswerId = answer.id;
    existing.confidence = answer.confidence;
    existing.status = "active";
    existing.updatedAt = approvedAt;
    existing.verifiedAt = approvedAt;
    existing.nextReviewAt = nextReviewAt;
    existing.segmentTags = segmentTags;

    writeAudit("admin", "questionnaire_answer_library_updated", `Answer Library updated: ${answer.question}`, existing.id, {
      mode: "updated",
      ownerRole: existing.ownerRole,
      nextReviewAt
    });

    return existing;
  }

  const item: QuestionnaireAnswerLibraryItem = {
    id: makeId("answer_library"),
    normalizedQuestion,
    canonicalQuestion: answer.question,
    category: answer.category,
    approvedAnswer: answer.draftAnswer,
    citations: answer.citations,
    ownerRole: answer.ownerRole,
    sourcePackId: pack.id,
    sourceAnswerId: answer.id,
    confidence: answer.confidence,
    status: "active",
    usageCount: 0,
    createdAt: approvedAt,
    updatedAt: approvedAt,
    verifiedAt: approvedAt,
    nextReviewAt,
    segmentTags
  };

  state.answerLibrary.unshift(item);
  writeAudit("admin", "questionnaire_answer_library_updated", `Answer Library item created: ${answer.question}`, item.id, {
    mode: "created",
    ownerRole: item.ownerRole,
    nextReviewAt
  });

  return item;
}

function recordAnswerLibraryUsage(state: SentinelState, answers: QuestionnaireResponseAnswer[], usedAt: string) {
  answers.forEach((answer) => {
    if (!answer.libraryItemId) {
      return;
    }

    const item = state.answerLibrary.find((candidate) => candidate.id === answer.libraryItemId);
    if (!item) {
      return;
    }

    item.usageCount += 1;
    item.lastUsedAt = usedAt;
    item.updatedAt = usedAt;
  });
}

function refreshAnswerLibraryReviewStatuses(state: SentinelState) {
  const nowMs = Date.now();

  state.answerLibrary.forEach((item) => {
    if (item.status === "retired") {
      return;
    }

    item.status = Date.parse(item.nextReviewAt) <= nowMs ? "review_due" : "active";
  });
}

function addDays(isoTimestamp: string, days: number) {
  return new Date(Date.parse(isoTimestamp) + days * 24 * 60 * 60 * 1000).toISOString();
}

function rejectWorkspaceOAuthState(
  reason: WorkspaceOAuthStateValidationResult["reason"],
  detail: string,
  session: WorkspaceOAuthLaunchSession | undefined,
  oauthStatePresent: boolean
): WorkspaceOAuthStateValidationResult {
  writeAudit("system", "workspace_oauth_state_rejected", detail, session?.id, {
    reason,
    oauthStatePresent
  });

  return {
    status: "blocked",
    reason,
    detail,
    session: session ? { ...session, requestedScopes: [...session.requestedScopes] } : undefined
  };
}

function findQuestionnairePack(packId: string) {
  const pack = getState().questionnairePacks.find((candidate) => candidate.id === packId);
  if (!pack) {
    throw new Error(`Questionnaire pack not found: ${packId}`);
  }

  return pack;
}

function findTrustDocument(documentId: string) {
  const document = getState().trustDocuments.find((candidate) => candidate.id === documentId);
  if (!document) {
    throw new Error(`Trust document not found: ${documentId}`);
  }

  return document;
}

function findTrustAccessRequest(requestId: string) {
  const request = getState().trustAccessRequests.find((candidate) => candidate.id === requestId);
  if (!request) {
    throw new Error(`Trust access request not found: ${requestId}`);
  }

  refreshTrustAccessRequestStatus(request);
  return request;
}

function findLatestApprovedTrustAccessRequest(state: SentinelState, prospectDomain?: string) {
  const normalizedDomain = cleanOptionalText(prospectDomain)?.toLowerCase();
  const candidates = state.trustAccessRequests
    .map((request) => {
      refreshTrustAccessRequestStatus(request);
      return request;
    })
    .filter((request) => request.status === "approved")
    .filter((request) => !normalizedDomain || request.prospectDomain?.toLowerCase() === normalizedDomain)
    .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt));

  return candidates[0];
}

function refreshTrustAccessRequestStatus(request: TrustAccessRequest) {
  if (request.status === "approved" && request.expiresAt && Date.parse(request.expiresAt) <= Date.now()) {
    request.status = "expired";
  }
}

function makeInitialTrustDocuments(tenantId: string): TrustDocument[] {
  return [
    {
      id: "trust_doc_security_overview",
      tenantId,
      title: "Security overview",
      category: "overview",
      visibility: "public",
      requiresNda: false,
      summary: "High-level overview of Sentinel's Google Workspace risk detection, human approval, and evidence workflow.",
      redactedSummary: "High-level overview of Sentinel's Workspace risk detection and approval workflow.",
      ownerRole: "security",
      status: "available",
      lastReviewedAt: "2026-05-20T00:00:00.000Z",
      nextReviewAt: "2026-08-18T00:00:00.000Z"
    },
    {
      id: "trust_doc_soc2_readiness_packet",
      tenantId,
      title: "SOC2 readiness evidence packet",
      category: "report",
      visibility: "requestable",
      requiresNda: true,
      summary: "Redacted readiness packet with control mapping, remediation approvals, and AI-operation evidence.",
      redactedSummary: "Redacted readiness packet with control mapping and AI-operation evidence.",
      ownerRole: "legal",
      status: "available",
      lastReviewedAt: "2026-05-20T00:00:00.000Z",
      nextReviewAt: "2026-08-18T00:00:00.000Z"
    },
    {
      id: "trust_doc_ai_data_minimization",
      tenantId,
      title: "AI data minimization policy",
      category: "policy",
      visibility: "requestable",
      requiresNda: true,
      summary: "Explains deterministic screening, Gemini byte caps, model allowlists, and redaction boundaries.",
      redactedSummary: "Explains deterministic screening, Gemini byte caps, model allowlists, and redaction boundaries.",
      ownerRole: "security",
      status: "available",
      lastReviewedAt: "2026-05-20T00:00:00.000Z",
      nextReviewAt: "2026-08-18T00:00:00.000Z"
    },
    {
      id: "trust_doc_raw_customer_findings",
      tenantId,
      title: "Raw customer finding logs",
      category: "evidence",
      visibility: "private",
      requiresNda: true,
      summary: "Internal-only customer security finding details. Never shared in prospect packets.",
      redactedSummary: "Internal-only finding details. Not shareable externally.",
      ownerRole: "founder",
      status: "available",
      lastReviewedAt: "2026-05-20T00:00:00.000Z",
      nextReviewAt: "2026-06-19T00:00:00.000Z"
    }
  ];
}

function makeInitialPilotRecords(): PilotCustomerRecord[] {
  return [
    {
      id: "pilot_seed_saas_001",
      customerAlias: "Redacted seed-stage CTO",
      segment: "Seed-stage B2B SaaS preparing enterprise security review",
      armsLength: true,
      relatedParty: false,
      monthlyRevenueUsd: 199,
      activeUsers: 3,
      proofStatus: "testimonial-consented",
      consentStatus: "consented",
      startedAt: "2026-05-01T00:00:00.000Z",
      testimonialQuote:
        "Sentinel found a public vendor packet we would have missed before an enterprise security review."
    },
    {
      id: "pilot_fractional_cto_002",
      customerAlias: "Fractional CTO pilot",
      segment: "Fractional CTO managing multiple Workspace tenants",
      armsLength: true,
      relatedParty: false,
      monthlyRevenueUsd: 199,
      activeUsers: 2,
      proofStatus: "invoice-needed",
      consentStatus: "pending",
      startedAt: "2026-05-04T00:00:00.000Z"
    },
    {
      id: "pilot_founder_ops_003",
      customerAlias: "Founder-led operations team",
      segment: "Founder-led services company responding to security questionnaires",
      armsLength: true,
      relatedParty: false,
      monthlyRevenueUsd: 199,
      activeUsers: 2,
      proofStatus: "financial-doc-ready",
      consentStatus: "private",
      startedAt: "2026-05-07T00:00:00.000Z",
      invoiceReference: "Private Stripe invoice on file"
    },
    {
      id: "pilot_agency_004",
      customerAlias: "Boutique agency owner",
      segment: "Small agency sharing client proposals through Google Drive",
      armsLength: true,
      relatedParty: false,
      monthlyRevenueUsd: 199,
      activeUsers: 3,
      proofStatus: "invoice-needed",
      consentStatus: "pending",
      startedAt: "2026-05-10T00:00:00.000Z"
    },
    {
      id: "pilot_consulting_005",
      customerAlias: "Security consulting studio",
      segment: "Consulting studio packaging trust evidence for prospects",
      armsLength: true,
      relatedParty: false,
      monthlyRevenueUsd: 199,
      activeUsers: 2,
      proofStatus: "testimonial-consented",
      consentStatus: "consented",
      startedAt: "2026-05-13T00:00:00.000Z",
      testimonialQuote: "The redacted evidence packet made our security-review story easier to explain."
    },
    {
      id: "pilot_private_beta_006",
      customerAlias: "Private beta founder",
      segment: "Private beta founder validating Google Workspace risk scans",
      armsLength: true,
      relatedParty: false,
      monthlyRevenueUsd: 199,
      activeUsers: 2,
      proofStatus: "mock",
      consentStatus: "private",
      startedAt: "2026-05-16T00:00:00.000Z"
    }
  ];
}

function makeInitialPilotProspects(): PilotProspectRecord[] {
  const createdAt = "2026-05-22T00:00:00.000Z";
  return [
    normalizePilotProspectInput(
      {
        id: "prospect_seed_saas_procurement",
        prospectAlias: "Redacted SOC2-bound SaaS founder",
        segment: "Seed-stage B2B SaaS with enterprise procurement request",
        source: "founder-network",
        stage: "demo-scheduled",
        fitScore: 92,
        estimatedMrrUsd: 199,
        ownerRole: "founder",
        painSignal: "Enterprise buyer asked for security questionnaire, trust artifacts, and Drive data-handling proof.",
        objection: "Concerned about exposing customer files to AI.",
        nextAction: "Prepare Trust Packet, one-day scan scope, and data-minimization proof for the demo call.",
        evidenceNeeded: ["Trust Packet", "One-day scan scope", "Questionnaire response pack", "Pilot consent"]
      },
      createdAt
    ),
    normalizePilotProspectInput(
      {
        id: "prospect_agency_owner",
        prospectAlias: "Redacted agency operator",
        segment: "Small agency sharing client proposals in Google Drive",
        source: "community",
        stage: "targeted",
        fitScore: 84,
        estimatedMrrUsd: 199,
        ownerRole: "sales",
        painSignal: "Public proposal links and client folders create review risk.",
        objection: "Needs a simple owner-review workflow, not a broad GRC rollout.",
        nextAction: "Send fixed-scope Drive sharing scan offer.",
        evidenceNeeded: ["Drive sharing report", "HITL remediation screenshot", "Pilot consent"]
      },
      createdAt
    ),
    normalizePilotProspectInput(
      {
        id: "prospect_fractional_cto",
        prospectAlias: "Redacted fractional CTO",
        segment: "Fractional CTO managing several startup Workspace tenants",
        source: "referral",
        stage: "contacted",
        fitScore: 88,
        estimatedMrrUsd: 399,
        ownerRole: "founder",
        painSignal: "Needs repeatable security-review prep across multiple small clients.",
        objection: "Wants proof the tool will not create noisy false positives.",
        nextAction: "Show HITL remediation, false-positive workflow, and per-tenant evidence boundaries.",
        evidenceNeeded: ["Approval workflow screenshot", "False-positive rate summary", "Tenant isolation plan"]
      },
      createdAt
    ),
    normalizePilotProspectInput(
      {
        id: "prospect_bootstrap_saas",
        prospectAlias: "Redacted bootstrap SaaS founder",
        segment: "Bootstrap SaaS preparing for first enterprise customer security review",
        source: "linkedin",
        stage: "pilot-proposed",
        fitScore: 90,
        estimatedMrrUsd: 199,
        ownerRole: "founder",
        painSignal: "Needs Trust Packet and questionnaire answers before procurement call.",
        objection: "Needs a fixed-price, one-day pilot before considering subscription.",
        nextAction: "Collect consent, invoice/payment proof, and Workspace install requirements.",
        evidenceNeeded: ["Invoice/payment proof", "Workspace OAuth install proof", "Active-user proof", "Evidence Vault artifact"]
      },
      createdAt
    )
  ];
}

function summarizePilotEvidence(pilotRecords: PilotCustomerRecord[]): Tenant["evidence"] {
  const qualifiedPilots = pilotRecords.filter((pilot) => pilot.armsLength && !pilot.relatedParty);
  const mrrUsd = qualifiedPilots.reduce((total, pilot) => total + pilot.monthlyRevenueUsd, 0);
  const activeUsers = qualifiedPilots.reduce((total, pilot) => total + pilot.activeUsers, 0);

  return {
    mrrUsd,
    pilotCount: qualifiedPilots.length,
    revenueByMonth: {
      May: revenueForMonth(qualifiedPilots, "2026-05-31T23:59:59.999Z"),
      June: revenueForMonth(qualifiedPilots, "2026-06-30T23:59:59.999Z"),
      July: revenueForMonth(qualifiedPilots, "2026-07-31T23:59:59.999Z"),
      August: revenueForMonth(qualifiedPilots, "2026-08-31T23:59:59.999Z")
    },
    totalCostsUsd: 142,
    customerAcquisitionSpendUsd: 80,
    activeUsers,
    testimonials: pilotRecords
      .filter((pilot) => pilot.testimonialQuote && pilot.consentStatus === "consented")
      .map((pilot) => ({
        id: `${pilot.id}_testimonial`,
        customerName: pilot.customerAlias,
        quote: pilot.testimonialQuote ?? "",
        consentToShare: true
      }))
  };
}

function revenueForMonth(pilotRecords: PilotCustomerRecord[], monthEndIso: string) {
  const monthEnd = Date.parse(monthEndIso);
  return pilotRecords
    .filter((pilot) => Date.parse(pilot.startedAt) <= monthEnd)
    .reduce((total, pilot) => total + pilot.monthlyRevenueUsd, 0);
}

function addCounters(counters: EvidenceCounters) {
  const totals = getState().aggregateCounters;
  totals.filesInspected += counters.filesInspected;
  totals.bytesExtracted += counters.bytesExtracted;
  totals.bytesScannedByDlp += counters.bytesScannedByDlp;
  totals.bytesRoutedToGemini += counters.bytesRoutedToGemini;
}

function currentGeminiSpendUsd(agentRuns: AgentRun[]) {
  return Number(agentRuns.reduce((total, run) => total + run.estimatedCostUsd, 0).toFixed(6));
}

function redactEventForClient(event: ResourceEvent): ResourceEvent {
  return {
    ...event,
    actorEmail: redactEmail(event.actorEmail),
    ownerEmail: redactEmail(event.ownerEmail),
    content: event.content ? "[content redacted in dashboard state]" : undefined
  };
}

function redactFindingForClient(finding: Finding): Finding {
  return {
    ...finding,
    detectorFindings: finding.detectorFindings.map((detectorFinding) => ({
      ...detectorFinding,
      quote: detectorFinding.quote
        .replace(/AWS_SECRET_ACCESS_KEY\s*=\s*.*/gi, "AWS_SECRET_ACCESS_KEY = [redacted-secret]")
        .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted-ssn]")
        .replace(/\b(?:\d[ -]*?){13,16}\b/g, "[redacted-card]")
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    }))
  };
}

function redactEmail(email: string) {
  return email.replace(/^(.).+(@.+)$/u, "$1***$2");
}

function cleanText(text: string) {
  return text.trim().replace(/\s+/gu, " ").slice(0, 240);
}

function cleanOptionalText(text?: string) {
  const cleaned = cleanText(text ?? "");
  return cleaned || undefined;
}

function simulateRemediationMessage(action: RecommendationAction, resourceName: string) {
  switch (action) {
    case "disable_public_sharing":
      return `Simulated Drive permission update: public sharing disabled for ${resourceName}.`;
    case "notify_owner":
      return `Simulated owner notification sent for ${resourceName}.`;
    case "label_restricted":
      return `Simulated restricted label applied to ${resourceName}.`;
    case "request_owner_review":
      return `Simulated owner review request sent for ${resourceName}.`;
    default:
      return `No remediation needed for ${resourceName}.`;
  }
}
