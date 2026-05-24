export type StorageMode = "memory" | "gcp-rest";
export type XPrizeEntrantType = "unconfirmed" | "individual" | "team" | "organization";

export const sentinelConfig = {
  tenantId: process.env.SENTINEL_TENANT_ID ?? "tenant_mainstreet_security",
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "SME Workspace Sentinel",
  mockMode: process.env.SENTINEL_MOCK_MODE !== "false",
  storageMode: parseStorageMode(process.env.SENTINEL_STORAGE_MODE),
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
  geminiModelAllowlist: parseCsv(process.env.SENTINEL_GEMINI_MODEL_ALLOWLIST ?? "gemini-3.5-flash,gemini-2.5-flash,gemini-2.5-pro"),
  geminiMonthlyBudgetUsd: parsePositiveNumber(process.env.SENTINEL_GEMINI_MONTHLY_BUDGET_USD, 50),
  geminiMaxContentBytesPerEvent: Math.round(
    parsePositiveNumber(process.env.SENTINEL_GEMINI_MAX_CONTENT_BYTES_PER_EVENT, 2800)
  ),
  geminiInputPer1kUsd: Number(process.env.GEMINI_INPUT_PER_1K_USD ?? "0.000075"),
  geminiOutputPer1kUsd: Number(process.env.GEMINI_OUTPUT_PER_1K_USD ?? "0.0003"),
  sensitiveDataProtectionEnabled: process.env.SENSITIVE_DATA_PROTECTION_ENABLED === "true",
  googleCloudProject: process.env.GOOGLE_CLOUD_PROJECT ?? "",
  googleCloudProjectNumber: process.env.GOOGLE_CLOUD_PROJECT_NUMBER ?? "",
  cloudRunServiceName: process.env.SENTINEL_CLOUD_RUN_SERVICE_NAME ?? "sme-workspace-sentinel",
  cloudRunRegion: process.env.SENTINEL_CLOUD_RUN_REGION ?? "us-central1",
  releaseId: process.env.SENTINEL_RELEASE_ID ?? "",
  sourceCommit: process.env.SENTINEL_SOURCE_COMMIT ?? "",
  sourceCommitAt: process.env.SENTINEL_SOURCE_COMMIT_AT ?? "",
  sourceBranch: process.env.SENTINEL_SOURCE_BRANCH ?? "",
  privateEvidenceBucket: process.env.SENTINEL_PRIVATE_EVIDENCE_BUCKET ?? "",
  googleCloudBillingAccountId: process.env.GOOGLE_CLOUD_BILLING_ACCOUNT_ID ?? "",
  googleCloudBudgetId: process.env.SENTINEL_GCP_BUDGET_ID ?? "",
  budgetPubSubTopic: process.env.SENTINEL_BUDGET_PUBSUB_TOPIC ?? "",
  cloudRunVpcConnector: process.env.SENTINEL_CLOUD_RUN_VPC_CONNECTOR ?? "",
  cloudRunVpcEgress: process.env.SENTINEL_CLOUD_RUN_VPC_EGRESS ?? "",
  geminiApiKeyId: process.env.SENTINEL_GEMINI_API_KEY_ID ?? "",
  geminiApiAllowedServerIps: parseCsv(process.env.SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS ?? ""),
  geminiDailyRequestQuota: Math.round(parsePositiveNumber(process.env.SENTINEL_GEMINI_DAILY_REQUEST_QUOTA, 1000)),
  geminiDailyTokenQuota: Math.round(parsePositiveNumber(process.env.SENTINEL_GEMINI_DAILY_TOKEN_QUOTA, 1000000)),
  geminiQuotaEvidenceConfirmed: process.env.SENTINEL_GEMINI_QUOTA_EVIDENCE_CONFIRMED === "true",
  cloudCostControlsMode: parseCloudCostControlsMode(process.env.SENTINEL_CLOUD_COST_CONTROLS_MODE),
  oauthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
  oauthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
  oauthClientSecretConfigured: Boolean(process.env.GOOGLE_OAUTH_CLIENT_SECRET),
  oauthRedirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "",
  firestoreDatabase: process.env.FIRESTORE_DATABASE ?? "(default)",
  bigQueryDataset: process.env.BIGQUERY_DATASET ?? "sentinel_evidence",
  bigQueryAuditTable: process.env.BIGQUERY_AUDIT_TABLE ?? "audit_events",
  bigQueryAgentRunsTable: process.env.BIGQUERY_AGENT_RUNS_TABLE ?? "agent_runs",
  workspaceSecretPrefix: process.env.WORKSPACE_SECRET_PREFIX ?? "sentinel-workspace-oauth",
  workspaceDriveWebhookUrl: process.env.WORKSPACE_DRIVE_WEBHOOK_URL ?? "",
  gmailPubSubTopic: process.env.WORKSPACE_GMAIL_TOPIC ?? "",
  gmailPubSubSubscription: process.env.WORKSPACE_GMAIL_SUBSCRIPTION ?? "",
  workspaceWebhookAuthMode: parseWorkspaceWebhookAuthMode(process.env.SENTINEL_WORKSPACE_WEBHOOK_AUTH_MODE, process.env.SENTINEL_MOCK_MODE !== "false"),
  workspacePubSubPushAudience: process.env.WORKSPACE_PUBSUB_PUSH_AUDIENCE ?? "",
  workspacePubSubServiceAccountEmail: process.env.WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL ?? "",
  workspaceDriveChannelTokenConfigured: Boolean(process.env.WORKSPACE_DRIVE_CHANNEL_TOKEN),
  workspaceDriveChannelToken: process.env.WORKSPACE_DRIVE_CHANNEL_TOKEN ?? "",
  evidenceMode: process.env.SENTINEL_EVIDENCE_MODE === "production" ? "production" : "mock",
  adminActionTokenConfigured: Boolean(process.env.SENTINEL_ADMIN_ACTION_TOKEN),
  adminActionToken: process.env.SENTINEL_ADMIN_ACTION_TOKEN ?? "",
  evidenceSigningSecretConfigured: Boolean(process.env.SENTINEL_EVIDENCE_SIGNING_SECRET),
  evidenceSigningSecret: process.env.SENTINEL_EVIDENCE_SIGNING_SECRET ?? "",
  productUrl: process.env.NEXT_PUBLIC_PRODUCT_URL ?? "",
  repositoryUrl: process.env.XPRIZE_REPOSITORY_URL ?? "",
  xprizeRepositoryAccessConfigured: process.env.XPRIZE_REPOSITORY_ACCESS_CONFIGURED === "true",
  xprizeSourceCodeCompleteConfirmed: process.env.XPRIZE_SOURCE_CODE_COMPLETE_CONFIRMED === "true",
  xprizeSubmissionCloseAt: process.env.XPRIZE_SUBMISSION_CLOSE_AT ?? "",
  xprizeCategory: process.env.XPRIZE_CATEGORY ?? "Small Business Services",
  xprizeGoogleCloudProductEvidenceConfigured:
    process.env.XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED === "true",
  xprizeGeminiApiCallEvidenceConfigured: process.env.XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED === "true",
  xprizeBusinessModelEvidenceConfigured: process.env.XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED === "true",
  xprizeCategoryImpactEvidenceConfigured: process.env.XPRIZE_CATEGORY_IMPACT_EVIDENCE_CONFIGURED === "true",
  xprizeAiNativeOperationsEvidenceConfigured:
    process.env.XPRIZE_AI_NATIVE_OPERATIONS_EVIDENCE_CONFIGURED === "true",
  demoVideoUrl: process.env.XPRIZE_DEMO_VIDEO_URL ?? "",
  demoVideoUnderThreeMinutesConfirmed: process.env.XPRIZE_DEMO_VIDEO_UNDER_3_MIN_CONFIRMED === "true",
  demoVideoPubliclyAccessibleConfirmed: process.env.XPRIZE_DEMO_VIDEO_PUBLICLY_ACCESSIBLE_CONFIRMED === "true",
  demoVideoAssetClearanceConfirmed: process.env.XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED === "true",
  demoVideoCustomerDataRedactedConfirmed: process.env.XPRIZE_DEMO_VIDEO_CUSTOMER_DATA_REDACTED_CONFIRMED === "true",
  demoVideoEnglishOrSubtitledConfirmed: process.env.XPRIZE_DEMO_VIDEO_ENGLISH_OR_SUBTITLED_CONFIRMED === "true",
  xprizeWorkingProjectAccessConfigured: process.env.XPRIZE_WORKING_PROJECT_ACCESS_CONFIGURED === "true",
  xprizeTestingInstructionsConfigured: process.env.XPRIZE_TESTING_INSTRUCTIONS_CONFIGURED === "true",
  judgeAccessConfigured: process.env.XPRIZE_JUDGE_ACCESS_CONFIGURED === "true",
  xprizeJudgingPeriodEndAt: process.env.XPRIZE_JUDGING_PERIOD_END_AT ?? "",
  thirdPartyReviewApproved: process.env.XPRIZE_THIRD_PARTY_REVIEW_APPROVED === "true",
  xprizeIpOwnershipReviewApproved: process.env.XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED === "true",
  xprizeEvidenceResponseReady: process.env.XPRIZE_EVIDENCE_RESPONSE_READY === "true",
  xprizeEvidenceResponseSlaBusinessDays: parsePositiveInteger(
    process.env.XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS,
    0
  ),
  xprizeEvidenceResponsePrivateContactConfigured:
    process.env.XPRIZE_EVIDENCE_RESPONSE_PRIVATE_CONTACT_CONFIGURED === "true",
  projectCreatedAfterStartConfirmed: process.env.XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED === "true",
  xprizeEntrantType: parseXPrizeEntrantType(process.env.XPRIZE_ENTRANT_TYPE),
  xprizeCorporateIdConfigured: process.env.XPRIZE_CORPORATE_ID_CONFIGURED === "true",
  xprizeGeneralEligibilityConfirmed: process.env.XPRIZE_GENERAL_ELIGIBILITY_CONFIRMED === "true",
  xprizeRepresentativeAuthorized: process.env.XPRIZE_REPRESENTATIVE_AUTHORIZED === "true",
  xprizeOrganizationUnder25Confirmed: process.env.XPRIZE_ORGANIZATION_UNDER_25_CONFIRMED === "true",
  xprizeNoPromotionEntityConflictConfirmed: process.env.XPRIZE_NO_PROMOTION_ENTITY_CONFLICT_CONFIRMED === "true",
  xprizeTotalRevenueEvidenceConfigured: process.env.XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED === "true",
  xprizeRevenueByMonthEvidenceConfigured: process.env.XPRIZE_REVENUE_BY_MONTH_EVIDENCE_CONFIGURED === "true",
  xprizeTotalCostsEvidenceConfigured: process.env.XPRIZE_TOTAL_COSTS_EVIDENCE_CONFIGURED === "true",
  xprizeCacSpendEvidenceConfigured: process.env.XPRIZE_CAC_SPEND_EVIDENCE_CONFIGURED === "true",
  xprizeRealUserEvidenceConfigured: process.env.XPRIZE_REAL_USER_EVIDENCE_CONFIGURED === "true",
  xprizeTestimonialConsentConfirmed: process.env.XPRIZE_TESTIMONIAL_CONSENT_CONFIRMED === "true",
  xprizeRelatedPartyRevenueReviewed: process.env.XPRIZE_RELATED_PARTY_REVENUE_REVIEWED === "true",
  xprizeProductRunningEvidenceConfigured: process.env.XPRIZE_PRODUCT_RUNNING_EVIDENCE_CONFIGURED === "true",
  xprizeAgentExecutionLogsConfigured: process.env.XPRIZE_AGENT_EXECUTION_LOGS_CONFIGURED === "true",
  xprizeFreeJudgeAccessThroughJudgingConfirmed:
    process.env.XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED === "true",
  judgeTestingInstructions:
    process.env.XPRIZE_TESTING_INSTRUCTIONS ??
    "Provide the hosted URL and private test access in Devpost testing instructions; do not commit credentials."
};

function parseStorageMode(value?: string): StorageMode {
  return value === "gcp-rest" ? "gcp-rest" : "memory";
}

function parseXPrizeEntrantType(value?: string): XPrizeEntrantType {
  if (value === "individual" || value === "team" || value === "organization") {
    return value;
  }

  return "unconfirmed";
}

function parseCloudCostControlsMode(value?: string): "plan" | "production" {
  return value === "production" ? "production" : "plan";
}

function parseWorkspaceWebhookAuthMode(value: string | undefined, mockMode: boolean): "demo" | "oidc" {
  if (value === "demo" || value === "oidc") {
    return value;
  }

  return mockMode ? "demo" : "oidc";
}

function parseCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function nowIso() {
  return new Date().toISOString();
}

export function makeId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function hasDemoVideoClearance() {
  return (
    Boolean(sentinelConfig.demoVideoUrl) &&
    sentinelConfig.demoVideoUnderThreeMinutesConfirmed &&
    sentinelConfig.demoVideoPubliclyAccessibleConfirmed &&
    sentinelConfig.demoVideoAssetClearanceConfirmed &&
    sentinelConfig.demoVideoCustomerDataRedactedConfirmed &&
    sentinelConfig.demoVideoEnglishOrSubtitledConfirmed
  );
}

export function demoVideoClearanceSummary() {
  if (!sentinelConfig.demoVideoUrl) {
    return "XPRIZE_DEMO_VIDEO_URL is not configured.";
  }

  return `${sentinelConfig.demoVideoUrl}; under 3 minutes ${sentinelConfig.demoVideoUnderThreeMinutesConfirmed ? "confirmed" : "missing"}; public access ${sentinelConfig.demoVideoPubliclyAccessibleConfirmed ? "confirmed" : "missing"}; asset clearance ${sentinelConfig.demoVideoAssetClearanceConfirmed ? "confirmed" : "missing"}; customer-data redaction ${sentinelConfig.demoVideoCustomerDataRedactedConfirmed ? "confirmed" : "missing"}; English or English subtitles ${sentinelConfig.demoVideoEnglishOrSubtitledConfirmed ? "confirmed" : "missing"}.`;
}

export function hasJudgeProductAccess() {
  return (
    Boolean(sentinelConfig.productUrl) &&
    sentinelConfig.xprizeWorkingProjectAccessConfigured &&
    sentinelConfig.xprizeTestingInstructionsConfigured &&
    sentinelConfig.judgeAccessConfigured &&
    sentinelConfig.xprizeFreeJudgeAccessThroughJudgingConfirmed
  );
}

export function judgeProductAccessSummary() {
  return `Product URL ${sentinelConfig.productUrl ? "configured" : "missing"}; working project access ${sentinelConfig.xprizeWorkingProjectAccessConfigured ? "confirmed" : "missing"}; testing instructions ${sentinelConfig.xprizeTestingInstructionsConfigured ? "configured" : "missing"}; judge access ${sentinelConfig.judgeAccessConfigured ? "configured" : "missing"}; free judging-period access ${sentinelConfig.xprizeFreeJudgeAccessThroughJudgingConfirmed ? "confirmed" : "missing"}; judging-period end ${sentinelConfig.xprizeJudgingPeriodEndAt || "missing"}.`;
}
