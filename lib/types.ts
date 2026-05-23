export type EventSource = "drive" | "gmail" | "manual-upload";

export type ResourceSensitivity = "public" | "internal" | "confidential" | "restricted";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type FindingStatus =
  | "recommended"
  | "approved"
  | "remediated"
  | "dismissed"
  | "false_positive"
  | "rescanning";

export type RecommendationAction =
  | "disable_public_sharing"
  | "notify_owner"
  | "request_owner_review"
  | "label_restricted"
  | "no_action";

export type ApproverRole = "security" | "founder" | "legal" | "engineering";

export type ApprovalSlaStatus = "pending" | "due_soon" | "overdue" | "approved" | "not_required";

export type DetectorTier = "tier0_metadata" | "tier1_deterministic" | "tier1_sdp" | "tier2_gemini";

export interface Tenant {
  id: string;
  name: string;
  category: "Small Business Services";
  positioning: string;
  settings: {
    safeAutoActions: RecommendationAction[];
    requireHumanApproval: boolean;
    geminiModel: string;
    mockMode: boolean;
  };
  evidence: BusinessEvidence;
}

export interface BusinessEvidence {
  mrrUsd: number;
  pilotCount: number;
  revenueByMonth: Record<"May" | "June" | "July" | "August", number>;
  totalCostsUsd: number;
  customerAcquisitionSpendUsd: number;
  activeUsers: number;
  testimonials: Testimonial[];
}

export interface Testimonial {
  id: string;
  customerName: string;
  quote: string;
  consentToShare: boolean;
}

export type PilotProofStatus = "mock" | "invoice-needed" | "testimonial-consented" | "financial-doc-ready";

export type PilotConsentStatus = "consented" | "pending" | "private";

export interface WorkspaceConnection {
  id: string;
  tenantId: string;
  provider: "google-workspace";
  mode: "mock" | "oauth" | "domain-wide-delegation";
  scopes: string[];
  connectedAt: string;
}

export type WorkspaceSyncProviderStatus =
  | "mock"
  | "not_configured"
  | "healthy"
  | "renewal_due"
  | "expired"
  | "blocked";

export interface WorkspaceSyncState {
  tenantId: string;
  mode: WorkspaceConnection["mode"];
  reconciliationCadenceHours: number;
  deadLetterCount: number;
  lastReconciliationAt?: string;
  drive: {
    status: WorkspaceSyncProviderStatus;
    startPageToken?: string;
    pageToken?: string;
    channelId?: string;
    channelResourceId?: string;
    channelExpirationAt?: string;
    renewalDueAt?: string;
    lastNotificationAt?: string;
    lastReconciledAt?: string;
    blocker?: string;
  };
  gmail: {
    status: WorkspaceSyncProviderStatus;
    historyId?: string;
    topicName?: string;
    watchExpirationAt?: string;
    renewalDueAt?: string;
    lastNotificationAt?: string;
    lastReconciledAt?: string;
    blocker?: string;
  };
}

export interface WorkspaceApiRequestPlan {
  method: "GET" | "POST";
  url: string;
  body?: Record<string, unknown>;
  requiredScope: string;
  purpose: string;
}

export interface ResourceEvent {
  id: string;
  tenantId: string;
  source: EventSource;
  resourceId: string;
  resourceName: string;
  mimeType: string;
  actorEmail: string;
  ownerEmail: string;
  eventType: string;
  occurredAt: string;
  metadataOnly: boolean;
  sharing: {
    public: boolean;
    externalDomains: string[];
    anyoneWithLink: boolean;
  };
  content?: string;
  sizeBytes: number;
  contentHash?: string;
  previousContentHash?: string;
  labels: string[];
}

export interface DetectorFinding {
  tier: DetectorTier;
  type: string;
  quote: string;
  likelihood: "very_unlikely" | "unlikely" | "possible" | "likely" | "very_likely";
  offset?: number;
}

export interface ScanDecision {
  skipped: boolean;
  skipReason?: string;
  tiersRun: DetectorTier[];
  shouldRunGemini: boolean;
  geminiGuardrail?: AiInvocationGuardrailResult;
  deterministicFindings: DetectorFinding[];
  counters: EvidenceCounters;
}

export interface AiInvocationGuardrailResult {
  status: "allowed" | "blocked";
  model: string;
  monthlyBudgetUsd: number;
  currentSpendUsd: number;
  projectedCostUsd: number;
  projectedSpendUsd: number;
  maxContentBytesPerEvent: number;
  bytesSelectedForGemini: number;
  reasons: string[];
}

export interface EvidenceCounters {
  filesInspected: number;
  bytesExtracted: number;
  bytesScannedByDlp: number;
  bytesRoutedToGemini: number;
}

export interface GeminiRiskClassification {
  severity: Severity;
  confidence: number;
  rationale: string;
  soc2ReadinessMapping: string[];
  suggestedAction: RecommendationAction;
  blastRadius: string;
  summary: string;
  model: string;
  provider: "gemini-api" | "mock-gemini" | "deterministic";
  fallbackReason?: string;
  errorClass?: string;
  inputTokensEstimated: number;
  outputTokensEstimated: number;
  estimatedCostUsd: number;
}

export interface Finding {
  id: string;
  tenantId: string;
  eventId: string;
  resourceId: string;
  resourceName: string;
  source: EventSource;
  severity: Severity;
  status: FindingStatus;
  title: string;
  rationale: string;
  soc2ReadinessMapping: string[];
  recommendation: {
    action: RecommendationAction;
    confidence: number;
    blastRadius: string;
    humanApprovalRequired: boolean;
  };
  approval: ApprovalControl;
  detectorFindings: DetectorFinding[];
  counters: EvidenceCounters;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalControl {
  requiredRole: ApproverRole;
  assignedTo: string;
  slaHours: number;
  dueAt: string;
  status: ApprovalSlaStatus;
  escalationTarget: string;
  approvedAt?: string;
  approvedByRole?: ApproverRole;
}

export type ApprovalDeliveryChannel = "in_app" | "email" | "google_chat" | "webhook";

export type ApprovalNotificationStatus = "queued" | "blocked" | "acknowledged";

export interface ApproverIdentity {
  id: string;
  role: ApproverRole;
  displayName: string;
  email: string;
  backupEmail: string;
  deliveryChannels: ApprovalDeliveryChannel[];
  status: "active" | "inactive";
  productionIdentityVerified: boolean;
}

export interface ApprovalRbacDecision {
  findingId: string;
  resourceName: string;
  requiredRole: ApproverRole;
  assignedTo: string;
  authorized: boolean;
  reason: string;
}

export interface ApprovalNotification {
  id: string;
  findingId: string;
  resourceName: string;
  recipientRole: ApproverRole;
  recipientEmail: string;
  channel: ApprovalDeliveryChannel;
  status: ApprovalNotificationStatus;
  priority: Severity;
  queuedAt: string;
  dueAt: string;
  escalationTarget: string;
  message: string;
  productionDeliveryRequired: boolean;
}

export interface AgentRun {
  id: string;
  tenantId: string;
  findingId?: string;
  eventId?: string;
  purpose: "semantic_risk_audit" | "evidence_summary" | "rescan";
  model: string;
  provider: "gemini-api" | "mock-gemini" | "deterministic";
  fallbackReason?: string;
  errorClass?: string;
  inputTokensEstimated: number;
  outputTokensEstimated: number;
  estimatedCostUsd: number;
  promptSummary: string;
  outputSummary: string;
  startedAt: string;
  completedAt: string;
}

export interface RemediationActionRecord {
  id: string;
  tenantId: string;
  findingId: string;
  action: RecommendationAction;
  mode: "human_approved" | "safe_auto";
  outcome: "simulated" | "completed" | "failed";
  message: string;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  tenantId: string;
  actor: "system" | "admin" | "agent";
  type:
    | "resource_event_ingested"
    | "resource_event_skipped"
    | "finding_created"
    | "agent_run_completed"
    | "finding_approved"
    | "finding_dismissed"
    | "finding_false_positive"
    | "finding_rescan_requested"
    | "pilot_evidence_recorded"
    | "questionnaire_pack_created"
    | "questionnaire_answer_approved"
    | "questionnaire_answer_library_updated"
    | "questionnaire_answer_library_verified"
    | "questionnaire_answer_library_bulk_verified"
    | "questionnaire_pack_exported"
    | "playbook_created"
    | "playbook_updated"
    | "risk_score_snapshot_created"
    | "framework_pack_exported"
    | "evidence_vault_artifact_registered"
    | "pilot_prospect_recorded"
    | "trust_access_requested"
    | "trust_access_approved"
    | "trust_access_denied"
    | "trust_packet_created"
    | "trust_packet_accessed"
    | "sync_reconciliation_completed"
    | "workspace_webhook_notification_received"
    | "workspace_oauth_installed"
    | "workspace_oauth_launch_issued"
    | "workspace_oauth_state_validated"
    | "workspace_oauth_state_rejected"
    | "audit_integrity_backfilled"
    | "remediation_completed"
    | "evidence_exported";
  targetId?: string;
  message: string;
  createdAt: string;
  metadata?: Record<string, string | number | boolean | null>;
  sequence?: number;
  previousHash?: string | null;
  eventHash?: string;
}

export interface AuditIntegritySummary {
  valid: boolean;
  totalEvents: number;
  sealedEvents: number;
  legacySealedEvents: number;
  missingSeals: number;
  invalidHashes: number;
  brokenLinks: number;
  headHash?: string;
  firstInvalidEventId?: string;
  notes: string[];
}

export interface DashboardSnapshot {
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
  scoreHistory: RiskScoreSnapshot[];
  aggregateCounters: EvidenceCounters;
  strategy: StrategySnapshot;
  readiness: ReadinessCommandCenter;
}

export interface EvidenceExport {
  generatedAt: string;
  redacted: boolean;
  consentSummary: EvidenceConsentSummary;
  tenant: Pick<Tenant, "id" | "name" | "category" | "positioning">;
  businessEvidence: BusinessEvidence;
  financialEvidence: FinancialEvidenceLedger;
  evidenceVault: EvidenceVault;
  aggregateCounters: EvidenceCounters;
  findingsBySeverity: Record<Severity, number>;
  findingsByStatus: Record<FindingStatus, number>;
  remediationsApproved: number;
  publicExposuresClosed: number;
  falsePositiveRate: number;
  pilotRecords: PilotCustomerRecord[];
  agentRuns: AgentRun[];
  auditEvents: AuditEvent[];
  auditIntegrity: AuditIntegritySummary;
  testimonials: Testimonial[];
  strategy: StrategySnapshot;
  answerLibrarySummary: AnswerLibrarySummary;
  trustAccessSummary: TrustAccessSummary;
}

export interface EvidenceConsentSummary {
  armsLengthPilots: number;
  relatedPartyPilots: number;
  privatePilots: number;
  consentedTestimonials: number;
  pendingConsent: number;
  financialDocsReady: number;
}

export type EvidencePacketFormat = "json" | "markdown" | "csv";

export interface EvidencePacket {
  generatedAt: string;
  format: EvidencePacketFormat;
  redacted: boolean;
  filename: string;
  contentType: string;
  body: string;
  export: EvidenceExport;
}

export type EvidenceSealStatus = "unsigned-local" | "signed";

export interface EvidenceIntegritySeal {
  status: EvidenceSealStatus;
  algorithm: "sha256" | "hmac-sha256";
  canonicalDigest: string;
  signature?: string;
  signedAt: string;
  signer: string;
  verificationInstructions: string[];
  productionGaps: string[];
}

export interface SignedEvidencePacket {
  generatedAt: string;
  redacted: boolean;
  filename: string;
  contentType: string;
  body: string;
  sourcePacket: EvidencePacket;
  seal: EvidenceIntegritySeal;
}

export interface TrustCenterProfile {
  generatedAt: string;
  publicName: string;
  headline: string;
  readinessPostureScore: number;
  approvedClaims: string[];
  restrictedClaims: string[];
  evidenceLinks: Array<{
    label: string;
    kind: "metric" | "audit-log" | "testimonial" | "document";
    value: string;
  }>;
  accessRequestWorkflow: string[];
  disclaimer: string;
}

export type TrustPacketSection =
  | "trust-profile"
  | "risk-metrics"
  | "approved-documents"
  | "ai-operations"
  | "consented-testimonials"
  | "questionnaire-preview";

export type TrustDocumentVisibility = "public" | "requestable" | "private";

export type TrustAccessRequestStatus = "pending" | "approved" | "denied" | "expired";

export interface TrustDocument {
  id: string;
  tenantId: string;
  title: string;
  category: "overview" | "policy" | "report" | "questionnaire" | "evidence";
  visibility: TrustDocumentVisibility;
  requiresNda: boolean;
  summary: string;
  redactedSummary: string;
  ownerRole: "security" | "legal" | "founder";
  status: "available" | "retired";
  lastReviewedAt: string;
  nextReviewAt: string;
}

export interface TrustAccessRequest {
  id: string;
  tenantId: string;
  prospectAlias: string;
  prospectDomain?: string;
  requesterEmail: string;
  requestedDocumentIds: string[];
  approvedDocumentIds: string[];
  ndaAccepted: boolean;
  status: TrustAccessRequestStatus;
  approverRole: "security" | "legal" | "founder";
  createdAt: string;
  decidedAt?: string;
  expiresAt?: string;
  decisionReason?: string;
}

export interface TrustPacketDocument {
  id: string;
  title: string;
  category: TrustDocument["category"];
  visibility: TrustDocumentVisibility;
  requiresNda: boolean;
  summary: string;
  lastReviewedAt: string;
}

export interface TrustPacket {
  id: string;
  token: string;
  tenantId: string;
  prospectAlias: string;
  prospectDomain?: string;
  status: "active" | "expired" | "revoked";
  redacted: true;
  sections: TrustPacketSection[];
  accessRequestId?: string;
  accessUrl: string;
  accessCount: number;
  createdAt: string;
  expiresAt: string;
  lastAccessedAt?: string;
  profile: TrustCenterProfile;
  summaryMetrics: {
    risksDetected: number;
    publicExposuresClosed: number;
    filesInspected: number;
    bytesRoutedToGemini: number;
    agentRuns: number;
    consentedTestimonials: number;
    approvedDocuments: number;
  };
  approvedDocuments: TrustPacketDocument[];
  aiOperations: Array<{
    purpose: AgentRun["purpose"];
    model: string;
    provider: AgentRun["provider"];
    estimatedCostUsd: number;
    completedAt: string;
  }>;
  testimonials: Testimonial[];
  questionnairePreview: QuestionnaireDraft["questions"];
  disclaimer: string;
}

export interface TrustPacketAccessResult {
  status: "available" | "expired" | "not_found";
  packet?: TrustPacket;
  reason?: string;
}

export type TrustEngagementStage = "new" | "engaged" | "hot" | "stale";

export interface TrustProspectEngagement {
  prospectAlias: string;
  prospectDomain?: string;
  packetsCreated: number;
  accessCount: number;
  approvedDocumentCount: number;
  latestPacketAt?: string;
  lastAccessedAt?: string;
  stage: TrustEngagementStage;
  nextAction: string;
}

export interface TrustCenterAnalytics {
  generatedAt: string;
  packetsCreated: number;
  activePackets: number;
  expiredPackets: number;
  totalPacketAccesses: number;
  accessedPackets: number;
  pendingAccessRequests: number;
  approvedAccessRequests: number;
  deniedAccessRequests: number;
  averageAccessesPerPacket: number;
  topProspects: TrustProspectEngagement[];
  followUpQueue: TrustProspectEngagement[];
  productionGaps: string[];
  disclaimer: string;
}

export interface QuestionnaireDraft {
  generatedAt: string;
  source: "approved-evidence";
  questions: Array<{
    id: string;
    question: string;
    draftAnswer: string;
    citations: string[];
    approvalRequired: boolean;
  }>;
  disclaimer: string;
}

export type QuestionnaireAnswerStatus = "draft" | "approved" | "needs_review";

export type QuestionnaireAnswerSource = "approved-library" | "library-context" | "generated-evidence" | "sme-review";

export type AnswerLibraryStatus = "active" | "review_due" | "retired";

export type QuestionnaireInputSource = "uploaded-text" | "csv" | "tsv" | "spreadsheet-text" | "pdf-text";

export interface QuestionnaireImportSummary {
  source: QuestionnaireInputSource;
  originalFileName?: string;
  rowsDetected: number;
  columnsDetected: number;
  questionsDetected: number;
  notes: string[];
}

export interface QuestionnaireResponseAnswer {
  id: string;
  question: string;
  category:
    | "workspace-monitoring"
    | "ai-data-minimization"
    | "remediation-controls"
    | "audit-trail"
    | "compliance-claims"
    | "access-controls"
    | "business-evidence"
    | "unknown";
  draftAnswer: string;
  citations: string[];
  confidence: number;
  status: QuestionnaireAnswerStatus;
  ownerRole: "security" | "legal" | "founder" | "sales" | "engineering";
  approvalRequired: true;
  answerSource: QuestionnaireAnswerSource;
  libraryItemId?: string;
  reviewDueAt?: string;
}

export interface QuestionnaireResponsePack {
  id: string;
  customerAlias: string;
  customerSegment: string;
  source: QuestionnaireInputSource;
  importSummary: QuestionnaireImportSummary;
  status: "draft" | "ready_for_review" | "approved" | "exported";
  createdAt: string;
  updatedAt: string;
  questionsCount: number;
  approvedCount: number;
  needsReviewCount: number;
  libraryHitCount: number;
  answers: QuestionnaireResponseAnswer[];
  exportText?: string;
  disclaimer: string;
}

export interface QuestionnaireAnswerLibraryItem {
  id: string;
  normalizedQuestion: string;
  canonicalQuestion: string;
  category: QuestionnaireResponseAnswer["category"];
  approvedAnswer: string;
  citations: string[];
  ownerRole: QuestionnaireResponseAnswer["ownerRole"];
  sourcePackId: string;
  sourceAnswerId: string;
  confidence: number;
  status: AnswerLibraryStatus;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  verifiedAt: string;
  nextReviewAt: string;
  lastUsedAt?: string;
  segmentTags: string[];
}

export interface ReadinessCommandCenter {
  generatedAt: string;
  usp: string;
  pilotLaunchPlan: PilotLaunchPlan;
  riskScore: RiskScore;
  riskTrend: RiskScoreTrend;
  xprizeGate: XPrizeSubmissionGate;
  submissionCompliance: SubmissionComplianceCenter;
  devpostSubmissionPack: DevpostSubmissionPack;
  demoVideoCompliance: DemoVideoCompliancePack;
  projectProvenance: ProjectProvenanceReport;
  productionLaunch: ProductionLaunchCommandCenter;
  productionProvisioning: ProductionProvisioningPack;
  productionGeminiProof: ProductionGeminiProofResult;
  marketPositioning: MarketPositioningCommandCenter;
  oauthReadiness: OAuthReadiness;
  persistenceReadiness: PersistenceReadiness;
  syncReliability: SyncReliability;
  claimGuard: ClaimGuardResult;
  approvalQueue: ApprovalQueueSummary;
  approvalOps: ApprovalOpsSummary;
  answerLibrary: AnswerLibrarySummary;
  trustAccess: TrustAccessSummary;
  trustAnalytics: TrustCenterAnalytics;
  pilotCrm: PilotCustomerRecord[];
  pilotProspectPipeline: PilotProspectPipeline;
  pilotConversionKit: PilotConversionKit;
  pilotConsentPacket: PilotConsentPacket;
  financialEvidence: FinancialEvidenceLedger;
  evidenceVault: EvidenceVault;
  evidenceIntakeQueue: EvidenceIntakeQueue;
  aiCostGuardrail: AiCostGuardrail;
  cloudCostControls: CloudCostControlCenter;
  complianceCopyGuardrail: ComplianceCopyGuardrail;
  frameworkCoverage: FrameworkCoverage[];
  playbooks: RemediationPlaybook[];
  roiCalculator: FounderRoiEstimate;
  judgeNarrative: JudgeNarrative;
}

export interface ApprovalQueueSummary {
  pending: number;
  dueSoon: number;
  overdue: number;
  approved: number;
  earliestDueAt?: string;
  escalationTargets: string[];
}

export interface ApprovalOpsSummary {
  directory: ApproverIdentity[];
  rbacDecisions: ApprovalRbacDecision[];
  notifications: ApprovalNotification[];
  openApprovals: number;
  assignedApprovals: number;
  roleMismatches: number;
  queuedNotifications: number;
  blockedNotifications: number;
  acknowledgedNotifications: number;
  productionGaps: string[];
  routingPolicy: string[];
}

export interface AnswerLibrarySummary {
  totalApproved: number;
  reviewDue: number;
  dueSoon: number;
  totalUsage: number;
  libraryHitRate: number;
  nextReviewAt?: string;
  segmentHistory: AnswerLibrarySegmentSummary[];
}

export interface AnswerLibrarySegmentSummary {
  segment: string;
  packCount: number;
  approvedAnswers: number;
  libraryHits: number;
  lastPackAt?: string;
}

export interface TrustAccessSummary {
  publicDocuments: number;
  requestableDocuments: number;
  privateDocuments: number;
  pendingRequests: number;
  approvedRequests: number;
  deniedRequests: number;
  ndaRequiredDocuments: number;
  expiringApprovals: number;
}

export interface RiskScore {
  workspaceRiskScore: number;
  dealImpactScore: number;
  openCriticalFindings: number;
  evidenceMaturity: number;
  scoringNotes: string[];
}

export type RiskScoreSnapshotReason =
  | "baseline"
  | "resource_event_ingested"
  | "resource_event_skipped"
  | "finding_created"
  | "finding_approved"
  | "finding_dismissed"
  | "finding_false_positive"
  | "finding_rescan_requested"
  | "remediation_completed"
  | "pilot_evidence_recorded"
  | "pilot_prospect_recorded"
  | "evidence_vault_artifact_registered"
  | "questionnaire_pack_created"
  | "trust_packet_created"
  | "sync_reconciliation_completed"
  | "workspace_oauth_installed"
  | "playbook_created"
  | "playbook_updated"
  | "manual_snapshot";

export interface RiskScoreSnapshot {
  id: string;
  tenantId: string;
  capturedAt: string;
  reason: RiskScoreSnapshotReason;
  targetId?: string;
  workspaceRiskScore: number;
  dealImpactScore: number;
  evidenceMaturity: number;
  openCriticalFindings: number;
  activeFindings: number;
  remediationsCount: number;
  agentRunsCount: number;
  mrrUsd: number;
  activeUsers: number;
  publicExposuresClosed: number;
  falsePositiveRate: number;
}

export interface RiskScoreTrend {
  history: RiskScoreSnapshot[];
  latest?: RiskScoreSnapshot;
  previous?: RiskScoreSnapshot;
  deltas: {
    workspaceRiskScore: number;
    dealImpactScore: number;
    evidenceMaturity: number;
    mrrUsd: number;
  };
  direction: "improving" | "mixed" | "regressing" | "insufficient_data";
  narrative: string;
  nextMilestones: string[];
  productionWarning: string;
}

export interface DealImpactMilestone {
  label: string;
  value: string;
  status: "proven-local" | "needs-production" | "missing";
}

export interface DealImpactReport {
  generatedAt: string;
  redacted: boolean;
  targetAlias: string;
  targetSegment: string;
  headline: string;
  summaryMetrics: {
    workspaceRiskScore: number;
    dealImpactScore: number;
    evidenceMaturity: number;
    workspaceRiskDelta: number;
    dealImpactDelta: number;
    evidenceMaturityDelta: number;
    mrrUsd: number;
    estimatedMonthlyValueUsd: number;
    paybackMultiple: number;
    trustPacketAccesses: number;
    questionnairePacks: number;
    remediationsApproved: number;
    publicExposuresClosed: number;
  };
  milestones: DealImpactMilestone[];
  buyerProofPoints: string[];
  recommendedNextActions: string[];
  productionGaps: string[];
  exportText: string;
  disclaimer: string;
}

export type XPrizeGateStatus = "passed" | "warning" | "blocked";

export interface XPrizeGateCheck {
  id: string;
  label: string;
  criterion: "Business Viability" | "AI-Native Operations" | "Category Impact" | "Submission Logistics" | "Safety";
  status: XPrizeGateStatus;
  evidence: string;
  fix: string;
}

export interface XPrizeSubmissionGate {
  generatedAt: string;
  overallStatus: XPrizeGateStatus;
  factualWinConfidence: number;
  category: Tenant["category"];
  checks: XPrizeGateCheck[];
  criterionScores: Record<XPrizeGateCheck["criterion"], number>;
  blockingSummary: string[];
  nextBestActions: string[];
  ruleBasis: string[];
}

export type SubmissionEvidenceKind =
  | "product-url"
  | "repository"
  | "demo-video"
  | "devpost-pack"
  | "testing-instructions"
  | "financial-record"
  | "user-proof"
  | "customer-testimonial"
  | "gemini-log"
  | "gcp-log"
  | "workspace-sync"
  | "redacted-export"
  | "claim-guard"
  | "license-manifest"
  | "trust-packet"
  | "questionnaire-pack"
  | "screenshot";

export type SubmissionEvidenceStatus = "missing" | "mock-only" | "ready" | "private-on-request" | "verified";

export type EvidenceVaultArtifactStatus = "missing" | "requested" | "uploaded" | "verified" | "needs-redaction" | "mock-only";

export type EvidenceVaultArtifactKind =
  | "pilot-consent"
  | "pilot-invoice"
  | "payment-export"
  | "active-user-log"
  | "cost-receipt"
  | "cac-receipt"
  | "testimonial-consent"
  | "cloud-billing-proof"
  | "gemini-usage-log"
  | "workspace-oauth-log"
  | "product-url-proof"
  | "demo-video-proof"
  | "repository-proof"
  | "trust-policy"
  | "customer-reference";

export interface EvidenceVaultArtifact {
  id: string;
  tenantId: string;
  kind: EvidenceVaultArtifactKind;
  label: string;
  ownerRole: "founder" | "sales" | "finance" | "legal" | "security" | "engineering";
  status: EvidenceVaultArtifactStatus;
  customerAlias?: string;
  linkedPilotId?: string;
  linkedFinancialItemId?: string;
  amountUsd?: number;
  sourceDescription: string;
  checksumSha256?: string;
  redacted: boolean;
  privateHandling: string;
  requiredFor: XPrizeGateCheck["criterion"] | "Prospect Trust";
  nextAction: string;
  blocker?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface EvidenceVault {
  generatedAt: string;
  evidenceMode: "mock" | "production";
  summary: Record<EvidenceVaultArtifactStatus, number>;
  requiredArtifacts: EvidenceVaultArtifact[];
  blockers: string[];
  nextActions: string[];
  disclaimer: string;
}

export type EvidenceIntakePriority = "p0" | "p1" | "p2";

export type EvidenceIntakeStatus = "ready" | "needs-proof" | "needs-redaction" | "blocked";

export interface EvidenceIntakeItem {
  id: string;
  artifactId: string;
  kind: EvidenceVaultArtifactKind;
  label: string;
  priority: EvidenceIntakePriority;
  status: EvidenceIntakeStatus;
  artifactStatus: EvidenceVaultArtifactStatus;
  ownerRole: EvidenceVaultArtifact["ownerRole"];
  requiredFor: EvidenceVaultArtifact["requiredFor"];
  whyNeeded: string;
  acceptedProof: string[];
  redactionChecklist: string[];
  rejectionTriggers: string[];
  registrationPayload: Partial<EvidenceVaultArtifact>;
  nextAction: string;
}

export interface EvidenceIntakeQueue {
  generatedAt: string;
  overallStatus: "ready" | "needs-proof" | "blocked";
  evidenceMode: EvidenceVault["evidenceMode"];
  proofQualityScore: number;
  items: EvidenceIntakeItem[];
  criticalMissing: number;
  redactionBacklog: number;
  nextActions: string[];
  claimBoundaries: string[];
  disclaimer: string;
}

export type PilotLaunchStatus = "ready" | "mock-only" | "external-required" | "blocked";

export type PilotLaunchStage =
  | "offer"
  | "consent"
  | "workspace"
  | "scan"
  | "remediation"
  | "trust-proof"
  | "commercial-proof"
  | "submission";

export interface PilotLaunchChecklistItem {
  id: string;
  stage: PilotLaunchStage;
  label: string;
  status: PilotLaunchStatus;
  ownerRole: "founder" | "sales" | "security" | "engineering" | "finance" | "legal";
  evidence: string;
  fix: string;
  requiredForDayOne: boolean;
}

export interface PilotLaunchTimelineItem {
  window: string;
  action: string;
  proof: string;
  ownerRole: PilotLaunchChecklistItem["ownerRole"];
}

export interface PilotLaunchObjection {
  objection: string;
  response: string;
  proofSurface: string;
}

export interface PilotLaunchPlan {
  generatedAt: string;
  offer: string;
  targetSegment: string;
  launchReadinessScore: number;
  status: PilotLaunchStatus;
  checklist: PilotLaunchChecklistItem[];
  oneDayTimeline: PilotLaunchTimelineItem[];
  buyerObjections: PilotLaunchObjection[];
  blockers: string[];
  nextActions: string[];
  disclaimer: string;
}

export interface SubmissionEvidenceArtifact {
  id: string;
  kind: SubmissionEvidenceKind;
  label: string;
  criterion: XPrizeGateCheck["criterion"];
  status: SubmissionEvidenceStatus;
  source: string;
  evidence: string;
  fix: string;
  redacted: boolean;
  ownerRole: "founder" | "engineering" | "security" | "sales" | "legal";
  requiredFor: string;
  privateHandling: string;
}

export interface SubmissionTestingInstruction {
  label: string;
  value: string;
  status: SubmissionEvidenceStatus;
}

export interface SubmissionDemoTimelineItem {
  timestamp: string;
  scene: string;
  proof: string;
}

export interface SubmissionPrivateEvidenceRequest {
  id: string;
  label: string;
  ownerRole: SubmissionEvidenceArtifact["ownerRole"];
  responseSlaHours: number;
  status: SubmissionEvidenceStatus;
  handling: string;
}

export interface XPrizeSubmissionBinder {
  generatedAt: string;
  category: Tenant["category"];
  overallStatus: XPrizeGateStatus;
  factualWinConfidence: number;
  judgeResponseSlaHours: number;
  testingInstructions: SubmissionTestingInstruction[];
  demoTimeline: SubmissionDemoTimelineItem[];
  artifactManifest: SubmissionEvidenceArtifact[];
  artifactSummary: Record<SubmissionEvidenceStatus, number>;
  privateEvidenceRequestQueue: SubmissionPrivateEvidenceRequest[];
  claimBoundary: string[];
  ruleBasis: string[];
  finalPreSubmitChecks: string[];
}

export type SubmissionComplianceStatus = "passed" | "warning" | "blocked";

export interface SubmissionComplianceCheck {
  id: string;
  label: string;
  ruleArea:
    | "Project Eligibility"
    | "IP Ownership"
    | "Third-Party Use"
    | "Demo Video"
    | "Testing Access"
    | "Evidence Response";
  status: SubmissionComplianceStatus;
  evidence: string;
  fix: string;
  ownerRole: "founder" | "engineering" | "sales" | "legal";
  requiredBeforeSubmit: boolean;
}

export type ThirdPartyManifestStatus = "passed" | "warning" | "blocked";

export interface ThirdPartyPackageReviewItem {
  name: string;
  version: string;
  license: string;
  scope: "runtime" | "development" | "optional";
  direct: boolean;
  source: string;
  reviewStatus: "cleared-for-review" | "needs-review" | "restricted-review";
  notes: string;
}

export interface ThirdPartyIntegrationReviewItem {
  name: string;
  purpose: string;
  provider: string;
  status: "planned" | "configured" | "needs-review";
  authorizationBasis: string;
  dataBoundary: string;
}

export interface ThirdPartyManifestSummary {
  status: ThirdPartyManifestStatus;
  totalPackages: number;
  productionPackages: number;
  directRuntimeDependencies: number;
  directDevDependencies: number;
  unknownLicenseCount: number;
  restrictedLicenseReviewCount: number;
  integrationsNeedingReview: number;
}

export interface ThirdPartyManifest {
  generatedAt: string;
  packageManager: "npm";
  lockfileVersion: number;
  summary: ThirdPartyManifestSummary;
  packages: ThirdPartyPackageReviewItem[];
  integrations: ThirdPartyIntegrationReviewItem[];
  disclosureText: string[];
  blockers: string[];
  nextActions: string[];
  disclaimer: string;
}

export interface SubmissionDemoAssetItem {
  timestamp: string;
  scene: string;
  requiredProof: string;
  assetRisk: string;
  clearanceAction: string;
}

export interface SubmissionComplianceCenter {
  generatedAt: string;
  overallStatus: SubmissionComplianceStatus;
  summary: Record<SubmissionComplianceStatus, number>;
  thirdPartyManifestSummary: ThirdPartyManifestSummary;
  projectProvenance: ProjectProvenanceReport;
  checks: SubmissionComplianceCheck[];
  demoAssetChecklist: SubmissionDemoAssetItem[];
  repositoryDisclosure: string[];
  nextActions: string[];
  disclaimer: string;
}

export type DevpostSubmissionStatus = "ready" | "needs-review" | "blocked";

export interface DevpostCopySection {
  id: string;
  label: string;
  status: DevpostSubmissionStatus;
  copy: string;
  claimBoundary: string;
  missingProof: string[];
}

export interface DemoScriptScene {
  timestamp: string;
  scene: string;
  voiceover: string;
  screenAction: string;
  proofShown: string;
  riskToAvoid: string;
}

export interface SubmissionScreenshotItem {
  id: string;
  label: string;
  routeOrAction: string;
  proof: string;
  redactionRequired: boolean;
  status: DevpostSubmissionStatus;
}

export interface DevpostSubmissionPack {
  generatedAt: string;
  overallStatus: DevpostSubmissionStatus;
  title: string;
  tagline: string;
  category: Tenant["category"];
  publicDescription: DevpostCopySection;
  problem: DevpostCopySection;
  solution: DevpostCopySection;
  googleStack: DevpostCopySection;
  businessModel: DevpostCopySection;
  tractionEvidence: DevpostCopySection;
  demoVideoScript: DemoScriptScene[];
  screenshotChecklist: SubmissionScreenshotItem[];
  testingInstructionsDraft: string[];
  privateEvidenceResponse: SubmissionPrivateEvidenceRequest[];
  claimBoundaries: string[];
  blockers: string[];
  nextActions: string[];
  disclaimer: string;
}

export type DemoVideoComplianceStatus = "cleared" | "ready-to-record" | "blocked";

export interface DemoVideoScenePlan extends DemoScriptScene {
  startSecond: number;
  endSecond: number;
  durationSeconds: number;
  assetRiskLevel: "low" | "medium" | "high";
  ruleCoverage: string[];
  clearanceAction: string;
}

export interface DemoVideoRuleCheck {
  id: string;
  label: string;
  status: "passed" | "warning" | "blocked";
  evidence: string;
  fix: string;
  requiredBeforeSubmit: boolean;
}

export interface DemoVideoCompliancePack {
  generatedAt: string;
  overallStatus: DemoVideoComplianceStatus;
  plannedDurationSeconds: number;
  maximumAllowedSeconds: number;
  bufferSeconds: number;
  videoUrl: string;
  allowedPlatforms: string[];
  scenes: DemoVideoScenePlan[];
  checks: DemoVideoRuleCheck[];
  screenshotChecklist: SubmissionScreenshotItem[];
  blockers: string[];
  nextActions: string[];
  recordingChecklist: string[];
  privateHandling: string[];
  sourceUrls: string[];
  disclaimer: string;
}

export interface ProjectProvenanceGitSignals {
  gitAvailable: boolean;
  commitCount: number;
  headCommit?: string;
  remoteUrl?: string;
  upstreamBranch?: string;
  remoteHeadCommit?: string;
  firstCommitAt?: string;
  headCommitAt?: string;
  trackedFileCount: number;
  untrackedPaths: string[];
  error?: string;
}

export type SourceReleaseStatus = "ready-to-commit" | "published" | "blocked";

export type SourceReleaseFileCategory =
  | "app-source"
  | "library-source"
  | "api-route"
  | "test"
  | "docs"
  | "config"
  | "script"
  | "public-asset"
  | "package-manifest"
  | "unknown";

export interface SourceReleaseFilePlan {
  path: string;
  category: SourceReleaseFileCategory;
  gitStatus: "tracked" | "untracked" | "modified" | "deleted";
  releaseAction: "stage" | "review" | "ignore";
  requiredForSubmission: boolean;
  reason: string;
}

export interface SourceReleaseSecretFinding {
  path: string;
  line: number;
  detector: string;
  severity: "critical" | "high" | "medium";
  evidence: string;
  fix: string;
}

export interface SourceReleaseCheck {
  id: string;
  label: string;
  status: "passed" | "warning" | "blocked";
  evidence: string;
  fix: string;
  requiredBeforeCommit: boolean;
}

export interface SourceReleaseGuard {
  generatedAt: string;
  overallStatus: SourceReleaseStatus;
  trackedFileCount: number;
  untrackedFileCount: number;
  releasableFileCount: number;
  files: SourceReleaseFilePlan[];
  checks: SourceReleaseCheck[];
  secretFindings: SourceReleaseSecretFinding[];
  blockers: string[];
  nextActions: string[];
  recommendedCommands: string[];
  privateHandling: string[];
  disclaimer: string;
}

export interface ProjectProvenanceDisclosureItem {
  id: string;
  label: string;
  disclosure: string;
  publicSafe: boolean;
  needsHumanReview: boolean;
}

export interface ProjectProvenanceCheck {
  id: string;
  label: string;
  status: SubmissionComplianceStatus;
  evidence: string;
  fix: string;
  ownerRole: SubmissionEvidenceArtifact["ownerRole"];
  requiredBeforeSubmit: boolean;
}

export interface ProjectProvenanceReport {
  generatedAt: string;
  overallStatus: SubmissionComplianceStatus;
  hackathonStartAt: string;
  projectCreatedAfterStartConfirmed: boolean;
  repositoryUrl: string;
  repositoryUrlSource: "env" | "git-remote" | "missing";
  git: ProjectProvenanceGitSignals;
  checks: ProjectProvenanceCheck[];
  disclosureItems: ProjectProvenanceDisclosureItem[];
  draftDevpostDisclosure: string[];
  blockers: string[];
  nextActions: string[];
  privateHandling: string[];
  disclaimer: string;
}

export type EligibilityDisclosureStatus = "ready-for-review" | "blocked";

export interface EligibilityDisclosureCheck {
  id: string;
  label: string;
  status: "passed" | "needs-review" | "blocked";
  evidence: string;
  fix: string;
  ownerRole: SubmissionEvidenceArtifact["ownerRole"];
  requiredBeforeAttestation: boolean;
}

export interface EligibilityDisclosureSection {
  id: string;
  title: string;
  summary: string;
  disclosureText: string[];
  publicSafe: boolean;
  privateHandling: string;
  ownerRole: SubmissionEvidenceArtifact["ownerRole"];
}

export interface EligibilityReviewerAttestation {
  id: string;
  label: string;
  envFlag: string;
  currentValue: boolean;
  ownerRole: SubmissionEvidenceArtifact["ownerRole"];
  instruction: string;
}

export interface EligibilityDisclosurePacket {
  generatedAt: string;
  overallStatus: EligibilityDisclosureStatus;
  repositoryUrl: string;
  repositoryUrlSource: ProjectProvenanceReport["repositoryUrlSource"];
  provenanceSummary: {
    hackathonStartAt: string;
    firstCommitAt?: string;
    headCommit?: string;
    remoteHeadCommit?: string;
    commitCount: number;
    trackedFileCount: number;
    untrackedPathCount: number;
  };
  disclosureSections: EligibilityDisclosureSection[];
  checks: EligibilityDisclosureCheck[];
  blockers: string[];
  nextActions: string[];
  reviewerAttestations: EligibilityReviewerAttestation[];
  privateHandling: string[];
  sourceUrls: string[];
  disclaimer: string;
}

export type ProductionLaunchStatus = "ready" | "needs-review" | "external-required" | "blocked";

export interface ProductionLaunchEnvItem {
  name: string;
  requiredFor: string;
  status: "configured" | "missing" | "review-required" | "secret-required";
  secret: boolean;
  currentValue: string;
  nextAction: string;
}

export interface ProductionLaunchWorkstream {
  id: string;
  label: string;
  criterion: XPrizeGateCheck["criterion"];
  status: ProductionLaunchStatus;
  ownerRole: SubmissionEvidenceArtifact["ownerRole"];
  currentEvidence: string;
  requiredProof: string[];
  nextAction: string;
  verificationEndpoint?: string;
  privateHandling: string;
}

export interface ProductionLaunchCommand {
  id: string;
  label: string;
  command: string;
  ownerRole: SubmissionEvidenceArtifact["ownerRole"];
  purpose: string;
  expectedProof: string;
}

export interface ProductionLaunchProofArtifact {
  id: string;
  label: string;
  status: ProductionLaunchStatus;
  ownerRole: SubmissionEvidenceArtifact["ownerRole"];
  source: string;
  requiredFor: string;
  privateHandling: string;
  nextAction: string;
}

export interface ProductionLaunchCommandCenter {
  generatedAt: string;
  overallStatus: ProductionLaunchStatus;
  readinessScore: number;
  launchMode: "local-mock" | "production-candidate" | "production-ready";
  workstreams: ProductionLaunchWorkstream[];
  envMatrix: ProductionLaunchEnvItem[];
  verificationCommands: ProductionLaunchCommand[];
  proofArtifacts: ProductionLaunchProofArtifact[];
  blockers: string[];
  nextActions: string[];
  claimBoundaries: string[];
  disclaimer: string;
}

export type ProductionProvisioningStatus = "ready-to-run" | "needs-values" | "external-required";

export interface ProductionProvisioningChecklistItem {
  id: string;
  label: string;
  status: "configured" | "missing" | "manual-review";
  ownerRole: SubmissionEvidenceArtifact["ownerRole"];
  requiredFor: string;
  verification: string;
  privateHandling: string;
}

export interface ProductionProvisioningCommand {
  id: string;
  stage: string;
  command: string;
  ownerRole: SubmissionEvidenceArtifact["ownerRole"];
  requiresSecretInput: boolean;
  mutatesCloudResources: boolean;
  expectedProof: string;
}

export interface ProductionProvisioningPack {
  generatedAt: string;
  status: ProductionProvisioningStatus;
  manifestPath: string;
  serviceName: string;
  recommendedRegion: string;
  requiredApis: string[];
  secretNames: string[];
  requiredIamRoles: string[];
  checklist: ProductionProvisioningChecklistItem[];
  commands: ProductionProvisioningCommand[];
  dryRunCommand: string;
  deployCommand: string;
  verificationSequence: ProductionProvisioningCommand[];
  blockers: string[];
  privateHandlingRules: string[];
  sourceUrls: string[];
  disclaimer: string;
}

export type ProductionGeminiProofStatus = "passed" | "blocked" | "mock-only";

export interface ProductionGeminiProofResult {
  generatedAt: string;
  status: ProductionGeminiProofStatus;
  provider?: AgentRun["provider"];
  model: string;
  eventId?: string;
  findingId?: string;
  agentRunId?: string;
  fallbackReason?: string;
  errorClass?: string;
  estimatedCostUsd?: number;
  decisionSummary: string;
  proofSummary: string;
  nextAction: string;
  privateHandling: string[];
}

export type MarketPositioningStatus = "strong" | "needs-proof" | "behind-incumbents";

export interface CompetitorPositioningItem {
  name: string;
  sourceUrl: string;
  publicPositioning: string;
  incumbentStrength: string;
  sentinelCounterPosition: string;
  sentinelCurrentProof: string;
  gapToClose: string;
  wedgeScore: number;
}

export interface MarketDifferentiator {
  label: string;
  status: "implemented" | "partial" | "missing";
  whyItMatters: string;
  proofSurface: string;
  nextProof: string;
}

export interface MarketPositioningCommandCenter {
  generatedAt: string;
  overallStatus: MarketPositioningStatus;
  targetSegment: string;
  usp: string;
  wedgeScore: number;
  competitorComparisons: CompetitorPositioningItem[];
  topDifferentiators: MarketDifferentiator[];
  parityGaps: MarketDifferentiator[];
  pricingHypothesis: string;
  buyerNarrative: string[];
  proofActions: string[];
  marketRisks: string[];
  sources: string[];
  disclaimer: string;
}

export interface OAuthReadiness {
  mode: "pilot-test-users" | "oauth-verification" | "marketplace-ready";
  requiredScopes: Array<{
    scope: string;
    sensitivity: "non-sensitive" | "sensitive" | "restricted";
    reason: string;
    status: "needed" | "defer" | "configured";
  }>;
  verificationChecklist: Array<{
    item: string;
    status: "done" | "next" | "blocked";
  }>;
  goToMarketDecision: string;
}

export interface WorkspaceOAuthPlan {
  configured: boolean;
  launchAllowed: boolean;
  missingEnv: string[];
  launchBlockers: string[];
  authEndpoint: string;
  tokenEndpoint: string;
  redirectUri: string;
  launchMode: "pilot-test-users" | "verification-required";
  requestedScopes: Array<{
    scope: string;
    reason: string;
    sensitivity: "non-sensitive" | "sensitive" | "restricted";
  }>;
  deferredScopes: Array<{
    scope: string;
    reason: string;
    sensitivity: "restricted";
  }>;
  consentGate: {
    required: boolean;
    status: "not-checked" | "passed" | "blocked";
    requiredArtifactKind: "pilot-consent";
    detail: string;
  };
  authorizationUrl?: string;
  verificationWarnings: string[];
}

export interface WorkspaceOAuthLaunchSession {
  id: string;
  tenantId: string;
  state: string;
  consentArtifactId: string;
  targetProspectId?: string;
  requestedScopes: string[];
  status: "issued" | "used" | "expired";
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
}

export interface WorkspaceOAuthStateValidationResult {
  status: "passed" | "blocked";
  reason:
    | "validated"
    | "missing_state"
    | "unknown_state"
    | "used_state"
    | "expired_state"
    | "missing_consent_artifact"
    | "persistence_error";
  detail: string;
  session?: WorkspaceOAuthLaunchSession;
}

export interface WorkspaceOAuthCallbackResult {
  generatedAt: string;
  status: "blocked" | "stored" | "failed";
  state?: string;
  checks: Array<{
    target: "configuration" | "state-validation" | "consent-gate" | "token-exchange" | "secret-manager" | "workspace-install";
    status: "blocked" | "passed" | "failed";
    detail: string;
    httpStatus?: number;
  }>;
}

export interface PersistenceReadiness {
  mode: "memory" | "gcp-rest";
  configured: boolean;
  missingEnv: string[];
  projectId: string;
  firestoreDatabase: string;
  bigQueryDataset: string;
  bigQueryAuditTable: string;
  bigQueryAgentRunsTable: string;
  secretPrefix: string;
  tenantIsolation: {
    partitionKey: string;
    firestoreRoot: string;
    bigQueryTenantColumn: string;
    exportBoundary: string;
  };
  requiredIamRoles: string[];
  writePlan: Array<{
    artifact: string;
    target: "firestore" | "bigquery" | "secret-manager";
    purpose: string;
  }>;
  productionWarnings: string[];
}

export interface PersistenceVerificationResult {
  generatedAt: string;
  mode: PersistenceReadiness["mode"];
  status: "blocked" | "passed" | "failed";
  attemptedWrites: boolean;
  checks: Array<{
    target:
      | "configuration"
      | "access-token"
      | "firestore"
      | "oauth-state-firestore"
      | "bigquery"
      | "agent-runs-bigquery"
      | "secret-manager";
    status: "blocked" | "passed" | "failed";
    detail: string;
    url?: string;
    httpStatus?: number;
  }>;
}

export interface WorkspaceReconciliationResult {
  generatedAt: string;
  status: "blocked" | "simulated" | "passed" | "failed";
  attemptedLiveApi: boolean;
  processedChanges: number;
  cursors: {
    drivePageToken?: string;
    gmailHistoryId?: string;
  };
  checks: Array<{
    target:
      | "configuration"
      | "drive-start-token"
      | "drive-changes"
      | "drive-watch"
      | "gmail-watch"
      | "gmail-history";
    status: "blocked" | "passed" | "simulated" | "failed";
    detail: string;
    url?: string;
    httpStatus?: number;
  }>;
}

export interface SyncReliability {
  driveChannelStatus: WorkspaceSyncProviderStatus;
  gmailWatchStatus: WorkspaceSyncProviderStatus;
  reconciliationCadenceHours: number;
  deadLetterCount: number;
  lastReconciliationAt?: string;
  driveCursor?: string;
  gmailCursor?: string;
  renewalWarnings: string[];
  blockers: string[];
  reliabilityNotes: string[];
}

export interface PilotCustomerRecord {
  id: string;
  customerAlias: string;
  segment: string;
  armsLength: boolean;
  relatedParty: boolean;
  monthlyRevenueUsd: number;
  activeUsers: number;
  proofStatus: PilotProofStatus;
  consentStatus: PilotConsentStatus;
  startedAt: string;
  invoiceReference?: string;
  testimonialQuote?: string;
  notes?: string;
}

export type PilotProspectStage =
  | "targeted"
  | "contacted"
  | "demo-scheduled"
  | "pilot-proposed"
  | "pilot-started"
  | "won"
  | "lost";

export type PilotProspectSource = "founder-network" | "linkedin" | "community" | "referral" | "inbound" | "manual";

export interface PilotProspectRecord {
  id: string;
  prospectAlias: string;
  segment: string;
  source: PilotProspectSource;
  stage: PilotProspectStage;
  fitScore: number;
  estimatedMrrUsd: number;
  ownerRole: "founder" | "sales";
  painSignal: string;
  objection: string;
  nextAction: string;
  evidenceNeeded: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PilotProspectOutreachStep {
  day: number;
  channel: "email" | "linkedin" | "community" | "intro";
  targetSegment: string;
  subject: string;
  body: string;
  proofAttachments: string[];
  followUpAfterDays: number;
  claimBoundary: string;
}

export interface PilotProspectPipelineSummary {
  total: number;
  targeted: number;
  contacted: number;
  demoScheduled: number;
  pilotProposed: number;
  pilotStarted: number;
  won: number;
  lost: number;
  highFit: number;
  activeOpportunities: number;
  proposedPilots: number;
  convertedPilots: number;
  estimatedPipelineMrrUsd: number;
  expectedPipelineMrrUsd: number;
}

export interface PilotProspectPipeline {
  generatedAt: string;
  offer: string;
  targetSegment: string;
  summary: PilotProspectPipelineSummary;
  prospects: PilotProspectRecord[];
  outreachSequence: PilotProspectOutreachStep[];
  conversionRules: string[];
  blockers: string[];
  nextActions: string[];
  disclaimer: string;
}

export type PilotConversionStatus = "ready" | "needs-proof" | "blocked";

export interface PilotConversionAsset {
  id: string;
  label: string;
  channel: "email" | "call-script" | "proposal" | "consent" | "invoice" | "evidence";
  status: PilotConversionStatus;
  copy: string;
  claimBoundary: string;
  nextAction: string;
}

export interface PilotConversionStep {
  id: string;
  label: string;
  status: PilotConversionStatus;
  ownerRole: "founder" | "sales" | "security" | "engineering" | "finance" | "legal";
  requiredEvidence: string[];
  proofSurface: string;
  nextAction: string;
}

export interface PilotConversionKit {
  generatedAt: string;
  status: PilotConversionStatus;
  targetProspect?: PilotProspectRecord;
  conversionScore: number;
  offer: string;
  pricing: string;
  closeNarrative: string[];
  conversionSteps: PilotConversionStep[];
  closeAssets: PilotConversionAsset[];
  evidenceChecklist: Array<{
    id: string;
    label: string;
    status: PilotConversionStatus;
    ownerRole: "founder" | "sales" | "security" | "engineering" | "finance" | "legal";
    source: string;
    nextAction: string;
  }>;
  blockers: string[];
  nextActions: string[];
  claimBoundaries: string[];
  disclaimer: string;
}

export interface PilotConsentPacketScope {
  label: string;
  status: "included" | "excluded" | "deferred";
  reason: string;
}

export interface PilotConsentPacketChecklistItem {
  id: string;
  label: string;
  status: PilotConversionStatus;
  ownerRole: "founder" | "sales" | "security" | "engineering" | "finance" | "legal";
  evidenceArtifactKind?: EvidenceVaultArtifactKind;
  nextAction: string;
}

export interface PilotConsentPacket {
  generatedAt: string;
  status: PilotConversionStatus;
  targetProspect?: PilotProspectRecord;
  authorizationScore: number;
  packetTitle: string;
  pilotOffer: string;
  customerSummary: string;
  allowedWorkspaceSources: PilotConsentPacketScope[];
  excludedData: PilotConsentPacketScope[];
  oauthScopes: Array<{
    scope: string;
    sensitivity: "non-sensitive" | "sensitive" | "restricted";
    status: "requested" | "deferred";
    reason: string;
  }>;
  aiDataRules: string[];
  remediationRules: string[];
  evidenceArtifacts: Array<{
    kind: EvidenceVaultArtifactKind;
    label: string;
    requiredBefore: string;
  }>;
  signatureFields: string[];
  consentChecklist: PilotConsentPacketChecklistItem[];
  blockers: string[];
  nextActions: string[];
  claimBoundaries: string[];
  exportText: string;
  disclaimer: string;
}

export type FinancialEvidenceStatus = "mock-only" | "missing" | "private-on-request" | "verified";

export type FinancialEvidenceKind =
  | "monthly-revenue"
  | "pilot-invoice"
  | "cost-record"
  | "cac-record"
  | "active-user-proof"
  | "testimonial-consent"
  | "related-party-review";

export interface FinancialEvidenceLedgerItem {
  id: string;
  kind: FinancialEvidenceKind;
  label: string;
  month?: "May" | "June" | "July" | "August";
  amountUsd?: number;
  customerAlias?: string;
  status: FinancialEvidenceStatus;
  source: string;
  ownerRole: "founder" | "sales" | "finance" | "legal";
  privateHandling: string;
  evidence: string;
  fix: string;
  relatedPartyRisk: boolean;
  consentRequired: boolean;
}

export interface FinancialEvidenceLedger {
  generatedAt: string;
  evidenceMode: "mock" | "production";
  summary: Record<FinancialEvidenceStatus, number>;
  revenueByMonth: Record<"May" | "June" | "July" | "August", { amountUsd: number; status: FinancialEvidenceStatus }>;
  totalMrrUsd: number;
  totalCostsUsd: number;
  customerAcquisitionSpendUsd: number;
  activeUsers: number;
  items: FinancialEvidenceLedgerItem[];
  blockers: string[];
  nextActions: string[];
  disclaimer: string;
}

export interface AiCostGuardrail {
  monthlyBudgetUsd: number;
  estimatedSpendUsd: number;
  budgetUsedPercent: number;
  modelAllowlist: string[];
  fallbackPolicy: string;
  blockedConditions: string[];
}

export type CloudCostControlStatus = "ready" | "warning" | "blocked";

export type CloudCostControlEvidenceStatus = "missing" | "planned" | "configured" | "verified";

export interface CloudCostControlChecklistItem {
  item: string;
  status: CloudCostControlEvidenceStatus;
  proof: string;
  fix: string;
}

export interface CloudBudgetPlan {
  billingAccountId: string;
  budgetId?: string;
  displayName: string;
  endpoint: string;
  monthlyBudgetUsd: number;
  alertThresholds: Array<{
    percent: number;
    basis: "CURRENT_SPEND" | "FORECASTED_SPEND";
  }>;
  pubSubTopic?: string;
  requestBody: Record<string, unknown>;
}

export interface ApiKeyRestrictionPlan {
  projectNumber: string;
  keyId: string;
  endpoint: string;
  requiredApiTargets: string[];
  allowedServerIps: string[];
  clientRestrictionMode: "server-ip" | "pending-static-egress";
  requestBody: Record<string, unknown>;
  warnings: string[];
}

export interface GeminiQuotaPlan {
  dailyRequestLimit: number;
  dailyTokenLimit: number;
  enforcement: "internal-budget-gate" | "gcp-quota-required";
  runbook: string[];
}

export interface CloudCostControlCenter {
  generatedAt: string;
  status: CloudCostControlStatus;
  mode: "plan" | "production";
  projectId: string;
  estimatedGeminiSpendUsd: number;
  monthlyBudgetUsd: number;
  budgetPlan: CloudBudgetPlan;
  apiKeyRestrictionPlan: ApiKeyRestrictionPlan;
  quotaPlan: GeminiQuotaPlan;
  evidenceChecklist: CloudCostControlChecklistItem[];
  runbook: string[];
  warnings: string[];
}

export interface CloudCostControlVerificationResult {
  generatedAt: string;
  status: "blocked" | "passed" | "failed";
  attemptedLiveApi: boolean;
  checks: Array<{
    target: "configuration" | "access-token" | "budget" | "api-key" | "quota";
    status: "blocked" | "passed" | "failed";
    detail: string;
    url?: string;
    httpStatus?: number;
  }>;
}

export interface ComplianceCopyGuardrail {
  bannedClaims: string[];
  approvedPhrases: string[];
  currentViolations: ClaimGuardViolation[];
}

export interface ClaimGuardViolation {
  location: string;
  phrase: string;
  severity: "critical" | "high" | "medium" | "low";
  context: string;
  fix: string;
}

export interface ClaimGuardResult {
  generatedAt: string;
  status: "passed" | "warning" | "failed";
  scannedArtifacts: number;
  bannedClaims: string[];
  approvedPhrases: string[];
  violations: ClaimGuardViolation[];
  warnings: ClaimGuardViolation[];
  notes: string[];
}

export type FrameworkName = "SOC2" | "ISO 27001" | "GDPR" | "HIPAA" | "PCI";

export type FrameworkEvidenceAudience = "judge" | "prospect" | "auditor";

export interface FrameworkCoverage {
  framework: FrameworkName;
  coverageLevel: "implemented" | "partial" | "planned";
  buyerValue: string;
  evidenceTypes: string[];
}

export type FrameworkControlStatus = "ready" | "partial" | "blocked" | "not_applicable";

export interface FrameworkEvidenceControl {
  id: string;
  framework: FrameworkName;
  title: string;
  status: FrameworkControlStatus;
  ownerRole: ApproverRole | "sales";
  mappedEvidence: string[];
  gaps: string[];
  exportSafe: boolean;
  productionRequired: boolean;
}

export interface FrameworkEvidencePack {
  generatedAt: string;
  framework: FrameworkName;
  audience: FrameworkEvidenceAudience;
  redacted: boolean;
  coverageLevel: FrameworkCoverage["coverageLevel"];
  buyerValue: string;
  audienceSummary: string;
  includedSections: string[];
  hiddenSections: string[];
  summary: {
    ready: number;
    partial: number;
    blocked: number;
    notApplicable: number;
    productionRequired: number;
  };
  controls: FrameworkEvidenceControl[];
  exportText: string;
  disclaimer: string;
}

export interface RemediationPlaybook {
  id: string;
  tenantId: string;
  name: string;
  trigger: string;
  stagedActions: RecommendationAction[];
  autoAllowed: boolean;
  approvalSlaHours: number;
  ownerRole: ApproverRole;
  escalationTarget: string;
  status: "active" | "paused";
  createdAt: string;
  updatedAt: string;
}

export interface FounderRoiEstimate {
  pricePerMonthUsd: number;
  averageSecurityReviewDelayDaysAvoided: number;
  founderHourlyRateUsd: number;
  engineerHourlyRateUsd: number;
  securityReviewHoursSaved: number;
  estimatedMonthlyValueUsd: number;
  paybackMultiple: number;
  calibrationSource: "seeded-demo" | "pilot-adjusted" | "production-verified";
  qualifiedPilotCount: number;
  pilotMrrUsd: number;
  remediationsApproved: number;
  questionnairePacksCompleted: number;
  trustPacketsCreated: number;
  riskReductionPoints: number;
  evidenceFactors: RoiEvidenceFactor[];
  proofGaps: string[];
  disclaimer: string;
}

export interface RoiEvidenceFactor {
  label: string;
  value: string;
  impact: "revenue" | "time_saved" | "risk_reduction" | "trust_proof" | "proof_gap";
}

export interface JudgeNarrative {
  headline: string;
  threeMinuteScript: string[];
  screenshotChecklist: string[];
  proofChecklist: string[];
}

export interface StrategySnapshot {
  confidence: StrategicConfidence;
  topFeatures: StrategyFeature[];
  topGaps: StrategyGap[];
  loopholes: StrategyLoophole[];
  implementationFocus: string[];
  completionSummary: string;
}

export interface StrategicConfidence {
  ruleCompliance: number;
  marketability: number;
  technicalDifferentiation: number;
  businessEvidence: number;
  winConfidence: number;
  confidenceNote: string;
}

export interface StrategyFeature {
  rank: number;
  name: string;
  marketSignal: string;
  winSignal: string;
  currentState: "implemented" | "partial" | "missing";
  marketabilityScore: number;
  winningLeverageScore: number;
  sellabilityScore: number;
  totalScore: number;
  proofStatus: "local-proof" | "production-proof-needed" | "customer-proof-needed" | "external-clearance-needed";
  scoreReason: string;
  nextFix: string;
}

export interface StrategyGap {
  priority: number;
  capability: string;
  currentlyHave: string;
  neededForTopTier: string;
  implementationPlan: string;
}

export interface StrategyLoophole {
  risk: string;
  severity: "critical" | "high" | "medium" | "low";
  whyItMatters: string;
  fix: string;
}
