import {
  hasDemoVideoClearance,
  hasJudgeProductAccess,
  judgeProductAccessSummary,
  sentinelConfig
} from "@/lib/config";
import { buildCloudCostControlCenter } from "@/lib/cloud-cost-controls";
import { buildThirdPartyManifest } from "@/lib/license-manifest";
import { buildPersistenceReadiness } from "@/lib/persistence";
import { buildSubmissionComplianceCenter } from "@/lib/submission-compliance";
import { hasLiveWorkspaceSyncEvidence } from "@/lib/workspace-sync";
import { buildXPrizeSubmissionGate } from "@/lib/xprize-gate";
import type {
  DashboardSnapshot,
  ProductionLaunchCommand,
  ProductionLaunchCommandCenter,
  ProductionLaunchEnvItem,
  ProductionLaunchProofArtifact,
  ProductionLaunchStatus,
  ProductionLaunchWorkstream
} from "@/lib/types";

type ProductionLaunchSnapshot = Pick<
  DashboardSnapshot,
  | "tenant"
  | "connections"
  | "syncState"
  | "agentRuns"
  | "auditEvents"
  | "pilotRecords"
  | "pilotProspects"
  | "aggregateCounters"
  | "findings"
  | "remediations"
  | "trustPackets"
  | "questionnairePacks"
  | "evidenceVaultArtifacts"
>;

export function buildProductionLaunchCommandCenter(snapshot: ProductionLaunchSnapshot): ProductionLaunchCommandCenter {
  const workstreams = buildWorkstreams(snapshot);
  const envMatrix = buildEnvMatrix();
  const proofArtifacts = buildProofArtifacts(snapshot);
  const verificationCommands = buildVerificationCommands();
  const blockers = [
    ...workstreams
      .filter((workstream) => workstream.status === "blocked" || workstream.status === "external-required")
      .map((workstream) => `${workstream.label}: ${workstream.nextAction}`),
    ...envMatrix
      .filter((item) => item.status === "missing" || item.status === "secret-required")
      .map((item) => `${item.name}: ${item.nextAction}`)
  ];
  const readyUnits =
    workstreams.filter((workstream) => workstream.status === "ready").length +
    proofArtifacts.filter((artifact) => artifact.status === "ready").length +
    envMatrix.filter((item) => item.status === "configured").length;
  const totalUnits = workstreams.length + proofArtifacts.length + envMatrix.length;
  const readinessScore = totalUnits ? Math.round((readyUnits / totalUnits) * 100) : 0;
  const overallStatus = resolveStatus(workstreams, proofArtifacts, envMatrix);

  return {
    generatedAt: new Date().toISOString(),
    overallStatus,
    readinessScore,
    launchMode: resolveLaunchMode(overallStatus),
    workstreams,
    envMatrix,
    verificationCommands,
    proofArtifacts,
    blockers,
    nextActions: buildNextActions(workstreams, envMatrix, proofArtifacts),
    claimBoundaries: [
      "Production launch proof requires live Google Cloud resources, live Gemini API metadata, live Workspace OAuth/sync logs, and real customer business evidence.",
      "Local mock data, seeded revenue, generated plans, and screenshots are product demonstration proof only.",
      "Judge credentials, invoices, customer contact information, OAuth tokens, and security findings stay private or redacted.",
      "Do not mark SENTINEL_EVIDENCE_MODE=production until the mock pilot rows are replaced by arms-length customer records and private artifacts.",
      "Run Claim Guard after every copy change and before recording the final public demo."
    ],
    disclaimer:
      "This launch command center is an operator checklist and evidence planner. It does not deploy infrastructure, create customer traction, replace legal/IP review, or prove production readiness unless the linked evidence is present."
  };
}

function buildWorkstreams(snapshot: ProductionLaunchSnapshot): ProductionLaunchWorkstream[] {
  const gate = buildXPrizeSubmissionGate(snapshot);
  const compliance = buildSubmissionComplianceCenter(snapshot);
  const persistence = buildPersistenceReadiness();
  const costControls = buildCloudCostControlCenter({ agentRuns: snapshot.agentRuns });
  const manifest = buildThirdPartyManifest();
  const hasGeminiRun = snapshot.agentRuns.some((run) => run.provider === "gemini-api");
  const hasMockGeminiRun = snapshot.agentRuns.some((run) => run.provider === "mock-gemini");
  const hasLiveWorkspaceConnection = snapshot.connections.some((connection) => connection.mode !== "mock");
  const hasLiveSync = hasLiveWorkspaceSyncEvidence(snapshot.syncState);
  const productionEvidence = sentinelConfig.evidenceMode === "production";
  const paidProofReady =
    productionEvidence &&
    snapshot.pilotRecords.some((pilot) => pilot.armsLength && !pilot.relatedParty && pilot.proofStatus === "financial-doc-ready");
  const consentReady =
    productionEvidence && snapshot.pilotRecords.some((pilot) => pilot.consentStatus === "consented" && pilot.testimonialQuote);
  const judgeAccessReady =
    hasJudgeProductAccess() &&
    Boolean(sentinelConfig.repositoryUrl) &&
    hasDemoVideoClearance();

  return [
    {
      id: "gcp-deploy-persistence",
      label: "Cloud Run and durable Google Cloud persistence",
      criterion: "AI-Native Operations",
      status: persistence.configured ? "ready" : "blocked",
      ownerRole: "engineering",
      currentEvidence: persistence.configured
        ? `Configured project ${persistence.projectId}, Firestore database ${persistence.firestoreDatabase}, BigQuery dataset ${persistence.bigQueryDataset}.`
        : `Storage mode ${persistence.mode}; missing ${persistence.missingEnv.join(", ") || "gcp-rest mode"}.`,
      requiredProof: [
        "Cloud Run service URL and revision screenshot/log.",
        "Firestore tenant document write-through result.",
        "BigQuery audit row insert/read result.",
        "BigQuery agent-run row insert/read result with provider/model/fallback/cost metadata.",
        "Secret Manager token secret path with value redacted."
      ],
      nextAction: "Deploy on Cloud Run, set SENTINEL_STORAGE_MODE=gcp-rest, and run /api/production/persistence POST.",
      verificationEndpoint: "/api/production/persistence",
      privateHandling: "Share project ids, service names, IAM roles, and logs with secrets and customer data redacted."
    },
    {
      id: "live-gemini-operation",
      label: "Live Gemini semantic audit",
      criterion: "AI-Native Operations",
      status: hasGeminiRun ? "ready" : hasMockGeminiRun ? "needs-review" : "blocked",
      ownerRole: "engineering",
      currentEvidence: hasGeminiRun
        ? `${snapshot.agentRuns.filter((run) => run.provider === "gemini-api").length} live Gemini API run(s) recorded.`
        : hasMockGeminiRun
          ? "Only mock Gemini run evidence is available."
          : "No semantic agent run is recorded in current state.",
      requiredProof: [
        "Gemini API model id and timestamp.",
        "Token/cost estimate and request outcome.",
        "Durable BigQuery agent-run row with provider=gemini-api for final evidence.",
        "Finding rationale generated from a high-risk scan.",
        "Audit event tying the model run to a staged recommendation."
      ],
      nextAction: "Configure GEMINI_API_KEY, POST /api/production/gemini-smoke from Cloud Run, then preserve redacted agent-run metadata.",
      verificationEndpoint: "/api/production/gemini-smoke",
      privateHandling: "Do not expose prompt secrets, raw document text, API keys, or customer file names in public materials."
    },
    {
      id: "workspace-pilot-sync",
      label: "Workspace OAuth install and sync proof",
      criterion: "AI-Native Operations",
      status: hasLiveWorkspaceConnection && hasLiveSync ? "ready" : "external-required",
      ownerRole: "security",
      currentEvidence: `Connection modes: ${snapshot.connections.map((connection) => connection.mode).join(", ")}; sync mode: ${snapshot.syncState.mode}.`,
      requiredProof: [
        "Pilot consent record and OAuth install timestamp.",
        "Drive startPageToken/pageToken state.",
        "Gmail historyId/watch state.",
        "Reconciliation run showing no hidden cursor gaps."
      ],
      nextAction: "Install OAuth for an allowlisted pilot, store refresh token in Secret Manager, run /api/workspace/sync/bootstrap, then run sync reconciliation.",
      verificationEndpoint: "/api/workspace/sync/reconcile",
      privateHandling: "Keep OAuth tokens, tenant emails, and document names out of public screenshots."
    },
    {
      id: "paid-pilot-evidence",
      label: "Arms-length paid pilot and user evidence",
      criterion: "Business Viability",
      status: paidProofReady && consentReady ? "ready" : "blocked",
      ownerRole: "founder",
      currentEvidence: productionEvidence
        ? `${snapshot.tenant.evidence.activeUsers} active user(s); revenue by month ${JSON.stringify(snapshot.tenant.evidence.revenueByMonth)}.`
        : "Evidence mode is mock, so seeded revenue and users are not submission proof.",
      requiredProof: [
        "Invoice/payment export for every counted customer.",
        "Revenue by month, costs, and customer acquisition spend.",
        "Active-user log or Workspace install proof.",
        "Customer testimonial or feedback only with explicit consent.",
        "Related-party revenue separation."
      ],
      nextAction: "Convert one arms-length prospect to paid pilot and register private invoice, user, cost, CAC, and consent artifacts.",
      verificationEndpoint: "/api/financial-evidence/ledger",
      privateHandling: "Keep raw invoices, customer contacts, payment identifiers, and testimonials in private judge evidence only."
    },
    {
      id: "cloud-cost-controls",
      label: "Cloud Billing budget and Gemini key controls",
      criterion: "Business Viability",
      status: costControls.status === "ready" ? "ready" : "blocked",
      ownerRole: "engineering",
      currentEvidence: `Cost-control mode ${costControls.mode}; budget id ${costControls.budgetPlan.budgetId ?? "missing"}; API key restriction mode ${costControls.apiKeyRestrictionPlan.clientRestrictionMode}.`,
      requiredProof: [
        "Cloud Billing budget id and alert thresholds.",
        "Budget Pub/Sub alert test or screenshot.",
        "Gemini API key restricted to the required API target and server boundary.",
        "Quota/usage control evidence for private judge review."
      ],
      nextAction: "Create the Cloud Billing budget, restrict the Gemini API key, configure quota evidence, and run /api/production/cost-controls POST.",
      verificationEndpoint: "/api/production/cost-controls",
      privateHandling: "Share budget ids, quota screenshots, and API-key resource metadata without exposing secret key values."
    },
    {
      id: "judge-access-media",
      label: "Judge access, repository, and public demo media",
      criterion: "Submission Logistics",
      status: judgeAccessReady ? "ready" : "external-required",
      ownerRole: "sales",
      currentEvidence: `${judgeProductAccessSummary()} Repository ${sentinelConfig.repositoryUrl ? "configured" : "missing"}; demo clearance ${hasDemoVideoClearance() ? "confirmed" : "missing"}.`,
      requiredProof: [
        "Signed-out browser check of hosted product URL.",
        "Repository URL with complete source or required private sharing.",
        "Public video under three minutes.",
        "Private judge login instructions outside the repository.",
        "Free product access remains available through the judging period."
      ],
      nextAction: "Publish product/repository/demo URLs, configure private judge access, and run the Devpost pack before upload.",
      verificationEndpoint: "/api/xprize/devpost-pack",
      privateHandling: "Do not put credentials, customer evidence, or unredacted security findings in the repository or public demo."
    },
    {
      id: "license-ip-review",
      label: "Third-party license, API terms, and IP clearance",
      criterion: "Submission Logistics",
      status:
        sentinelConfig.thirdPartyReviewApproved && manifest.summary.status === "passed"
          ? "ready"
          : manifest.summary.status === "blocked"
            ? "blocked"
            : "needs-review",
      ownerRole: "legal",
      currentEvidence: `${manifest.summary.totalPackages} package(s), ${manifest.summary.restrictedLicenseReviewCount} restricted-review package(s), ${manifest.summary.obligationReviewCount} obligation-review package(s), ${manifest.summary.licenseNeedsReviewCount} license-review package(s), ${manifest.summary.integrationsNeedingReview} integration(s) need review.`,
      requiredProof: [
        "Dependency license manifest reviewed by a human owner.",
        "Google API terms and OAuth consent reviewed for intended use.",
        "Demo screenshots/video cleared for owned or permitted assets.",
        "Pre-existing boilerplate and open-source usage disclosed."
      ],
      nextAction:
        compliance.nextActions.find((action) => action.toLowerCase().includes("package")) ??
        manifest.nextActions[0] ??
        "Review the license manifest and update final Devpost disclosure.",
      verificationEndpoint: "/api/xprize/license-manifest",
      privateHandling: "Publish disclosure text but keep private review notes and customer-specific examples out of public materials."
    },
    {
      id: "final-gate-binder",
      label: "Final submission gate and binder",
      criterion: "Submission Logistics",
      status: gate.overallStatus === "passed" && compliance.overallStatus === "passed" ? "ready" : "needs-review",
      ownerRole: "founder",
      currentEvidence: `Submission gate ${gate.overallStatus}; compliance gate ${compliance.overallStatus}; ${gate.blockingSummary.length} gate blocker(s).`,
      requiredProof: [
        "Claim Guard pass on final copy and script.",
        "Submission Gate pass from production evidence.",
        "Submission Compliance pass after IP/license/video review.",
        "Private binder with artifact owners and two-business-day response plan."
      ],
      nextAction: gate.nextBestActions[0] ?? compliance.nextActions[0] ?? "Run final submission gate and binder from hosted production.",
      verificationEndpoint: "/api/xprize/submission-binder",
      privateHandling: "Binder may list private evidence owners; redact customer-identifying fields before public screenshots."
    }
  ];
}

function buildEnvMatrix(): ProductionLaunchEnvItem[] {
  return [
    envItem("NEXT_PUBLIC_PRODUCT_URL", sentinelConfig.productUrl, "Hosted judge-accessible product URL.", false, "Deploy the app and set the public product URL."),
    envItem("XPRIZE_REPOSITORY_URL", sentinelConfig.repositoryUrl, "Repository access for judging/testing.", false, "Publish or share the repository and set the URL."),
    envItem("XPRIZE_DEMO_VIDEO_URL", sentinelConfig.demoVideoUrl, "Public under-three-minute demo video.", false, "Record and publish the final demo video."),
    envItem(
      "XPRIZE_DEMO_VIDEO_UNDER_3_MIN_CONFIRMED",
      sentinelConfig.demoVideoUnderThreeMinutesConfirmed ? "true" : "",
      "Demo video duration rule.",
      false,
      "Confirm final public demo duration is under three minutes before setting this true."
    ),
    envItem(
      "XPRIZE_DEMO_VIDEO_PUBLICLY_ACCESSIBLE_CONFIRMED",
      sentinelConfig.demoVideoPubliclyAccessibleConfirmed ? "true" : "",
      "Demo video public visibility rule.",
      false,
      "Confirm the demo video is public on an accepted video platform before setting this true."
    ),
    envItem(
      "XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED",
      sentinelConfig.demoVideoAssetClearanceConfirmed ? "true" : "",
      "Demo video third-party asset and music clearance.",
      false,
      "Confirm all video assets, marks, screenshots, and music are owned or permitted before setting this true."
    ),
    envItem(
      "XPRIZE_DEMO_VIDEO_CUSTOMER_DATA_REDACTED_CONFIRMED",
      sentinelConfig.demoVideoCustomerDataRedactedConfirmed ? "true" : "",
      "Demo video customer/security data redaction.",
      false,
      "Confirm the final public video contains no customer-identifying security data before setting this true."
    ),
    envItem(
      "XPRIZE_DEMO_VIDEO_ENGLISH_OR_SUBTITLED_CONFIRMED",
      sentinelConfig.demoVideoEnglishOrSubtitledConfirmed ? "true" : "",
      "Demo video English-language or English-subtitle rule.",
      false,
      "Confirm the final public video is in English or includes English subtitles before setting this true."
    ),
    envItem(
      "XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED",
      sentinelConfig.projectCreatedAfterStartConfirmed ? "true" : "",
      "Project eligibility and pre-existing work disclosure.",
      false,
      "Verify repository history and pre-existing work disclosure before setting this true."
    ),
    envItem(
      "XPRIZE_ENTRANT_TYPE",
      sentinelConfig.xprizeEntrantType === "unconfirmed" ? "" : sentinelConfig.xprizeEntrantType,
      "Entrant eligibility and corporate ID applicability.",
      false,
      "Set to individual, team, or organization after confirming final submission entrant."
    ),
    envItem(
      "XPRIZE_GENERAL_ELIGIBILITY_CONFIRMED",
      sentinelConfig.xprizeGeneralEligibilityConfirmed ? "true" : "",
      "Entrant eligibility, age/authority, jurisdiction, and rule compliance.",
      false,
      "Complete human eligibility review before setting this true."
    ),
    envItem(
      "XPRIZE_REPRESENTATIVE_AUTHORIZED",
      sentinelConfig.xprizeRepresentativeAuthorized ? "true" : "",
      "Required for team or organization submissions.",
      false,
      "Confirm the team or organization representative has authority to submit."
    ),
    envItem(
      "XPRIZE_ORGANIZATION_UNDER_25_CONFIRMED",
      sentinelConfig.xprizeEntrantType === "organization" && sentinelConfig.xprizeOrganizationUnder25Confirmed ? "true" : "",
      "Required only when entering as a small organization.",
      false,
      "If entering as an organization, confirm the employee-count eligibility condition privately."
    ),
    envItem(
      "XPRIZE_CORPORATE_ID_CONFIGURED",
      sentinelConfig.xprizeEntrantType === "organization" && sentinelConfig.xprizeCorporateIdConfigured ? "configured" : "",
      "Required only when entering as an organization.",
      false,
      "If entering as an organization, add corporate ID to the private submission packet and set this true."
    ),
    envItem(
      "XPRIZE_NO_PROMOTION_ENTITY_CONFLICT_CONFIRMED",
      sentinelConfig.xprizeNoPromotionEntityConflictConfirmed ? "true" : "",
      "Eligibility conflict check for promotion entities and immediate family.",
      false,
      "Complete legal/founder conflict review before setting this true."
    ),
    envItem(
      "XPRIZE_JUDGE_ACCESS_CONFIGURED",
      sentinelConfig.judgeAccessConfigured ? "true" : "",
      "Private judge testing access.",
      false,
      "Store judge credentials only in Devpost testing instructions or an approved private channel."
    ),
    envItem(
      "XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED",
      sentinelConfig.xprizeFreeJudgeAccessThroughJudgingConfirmed ? "true" : "",
      "Required hosted product availability through judging/testing.",
      false,
      "Confirm the hosted product remains free and accessible for judges through the judging period."
    ),
    envItem("GOOGLE_CLOUD_PROJECT", sentinelConfig.googleCloudProject, "Cloud Run, Firestore, BigQuery, Secret Manager proof.", false, "Create or select the production Google Cloud project."),
    envItem("FIRESTORE_DATABASE", sentinelConfig.firestoreDatabase, "Durable tenant state.", false, "Confirm the Firestore database id used by Cloud Run."),
    envItem("BIGQUERY_DATASET", sentinelConfig.bigQueryDataset, "Append-only evidence analytics.", false, "Provision the BigQuery dataset before production verification."),
    envItem("BIGQUERY_AUDIT_TABLE", sentinelConfig.bigQueryAuditTable, "Hash-chained audit evidence rows.", false, "Provision the BigQuery audit table before production verification."),
    envItem("BIGQUERY_AGENT_RUNS_TABLE", sentinelConfig.bigQueryAgentRunsTable, "Durable Gemini and agent-run evidence rows.", false, "Provision the BigQuery agent-runs table before production verification."),
    envItem("WORKSPACE_SECRET_PREFIX", sentinelConfig.workspaceSecretPrefix, "Secret Manager Workspace OAuth token namespace.", false, "Confirm the Secret Manager prefix for per-tenant OAuth refresh tokens."),
    envItem(
      "SENTINEL_STORAGE_MODE",
      sentinelConfig.storageMode === "gcp-rest" ? "gcp-rest" : "",
      "Enable production persistence verification.",
      false,
      "Set SENTINEL_STORAGE_MODE=gcp-rest only after Cloud Run service credentials are ready."
    ),
    envItem("GEMINI_API_KEY", process.env.GEMINI_API_KEY ? "configured" : "", "Live Gemini API semantic audit.", true, "Configure the Gemini API key as a secret, not in source control."),
    envItem("GEMINI_MODEL", sentinelConfig.geminiModel, "Stable Gemini model routing.", false, "Verify the model string against current Gemini API docs before final submission."),
    envItem("GOOGLE_OAUTH_CLIENT_ID", sentinelConfig.oauthClientId, "Workspace OAuth pilot install.", false, "Configure an OAuth client for the hosted callback URL."),
    envItem("GOOGLE_OAUTH_CLIENT_SECRET", sentinelConfig.oauthClientSecretConfigured ? "configured" : "", "Workspace OAuth token exchange.", true, "Store the OAuth client secret in the deployment secret store."),
    envItem("GOOGLE_OAUTH_REDIRECT_URI", sentinelConfig.oauthRedirectUri, "Workspace OAuth callback.", false, "Set the hosted callback URL."),
    envItem("WORKSPACE_GMAIL_TOPIC", sentinelConfig.gmailPubSubTopic, "Gmail watch Pub/Sub topic.", false, "Create the Gmail Pub/Sub topic and configure users.watch."),
    envItem("WORKSPACE_GMAIL_SUBSCRIPTION", sentinelConfig.gmailPubSubSubscription, "Authenticated Gmail Pub/Sub push subscription.", false, "Create the push subscription that targets the hosted Gmail webhook."),
    envItem(
      "SENTINEL_WORKSPACE_WEBHOOK_AUTH_MODE",
      sentinelConfig.workspaceWebhookAuthMode === "oidc" ? "oidc" : "",
      "Production webhook authentication mode.",
      false,
      "Set oidc in production so Pub/Sub pushes cannot fall back to demo mode."
    ),
    envItem("WORKSPACE_PUBSUB_PUSH_AUDIENCE", sentinelConfig.workspacePubSubPushAudience, "Expected OIDC audience for Pub/Sub pushes.", false, "Set the hosted Gmail webhook URL as the Pub/Sub push audience."),
    envItem("WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL", sentinelConfig.workspacePubSubServiceAccountEmail, "Expected OIDC service account for Pub/Sub pushes.", false, "Use a dedicated Pub/Sub push service account."),
    envItem("WORKSPACE_DRIVE_CHANNEL_TOKEN", sentinelConfig.workspaceDriveChannelTokenConfigured ? "configured" : "", "Direct Drive channel token validation.", true, "Store the Drive channel token in Secret Manager, not source control."),
    envItem(
      "SENTINEL_EVIDENCE_MODE",
      sentinelConfig.evidenceMode === "production" ? "production" : "",
      "Allow real business evidence to count.",
      false,
      "Set production mode only after mock pilots are replaced by real customer evidence."
    ),
    envItem(
      "SENTINEL_EVIDENCE_SIGNING_SECRET",
      sentinelConfig.evidenceSigningSecretConfigured ? "configured" : "",
      "Signed final evidence packet.",
      true,
      "Configure a production HMAC secret before generating the final packet."
    ),
    envItem(
      "SENTINEL_CLOUD_COST_CONTROLS_MODE",
      sentinelConfig.cloudCostControlsMode === "production" ? "production" : "",
      "Live Cloud Billing and API-key evidence.",
      false,
      "Set production cost-control mode after budget and API key resources exist."
    ),
    envItem("GOOGLE_CLOUD_BILLING_ACCOUNT_ID", sentinelConfig.googleCloudBillingAccountId, "Cloud Billing budget verification.", false, "Attach the production billing account id."),
    envItem("SENTINEL_GCP_BUDGET_ID", sentinelConfig.googleCloudBudgetId, "Cloud Billing budget verification.", false, "Create a Cloud Billing budget and record the budget id."),
    envItem("SENTINEL_BUDGET_PUBSUB_TOPIC", sentinelConfig.budgetPubSubTopic, "Cloud Billing alert Pub/Sub notifications.", false, "Create the budget alert topic and wire it into the cost-control runbook."),
    envItem("GOOGLE_CLOUD_PROJECT_NUMBER", sentinelConfig.googleCloudProjectNumber, "API key restriction verification.", false, "Record the numeric Google Cloud project id."),
    envItem("SENTINEL_GEMINI_API_KEY_ID", sentinelConfig.geminiApiKeyId, "Gemini API key restriction verification.", false, "Record the API key resource id, not the secret key value."),
    envItem(
      "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS",
      sentinelConfig.geminiApiAllowedServerIps.join(","),
      "Gemini API key server boundary.",
      false,
      "Set static egress IPs if enforcing server IP restrictions for the production Gemini key."
    ),
    envItem(
      "SENTINEL_GEMINI_DAILY_REQUEST_QUOTA",
      String(sentinelConfig.geminiDailyRequestQuota),
      "Gemini request-volume guardrail.",
      false,
      "Confirm quota values match the pilot budget before launch."
    ),
    envItem(
      "SENTINEL_GEMINI_DAILY_TOKEN_QUOTA",
      String(sentinelConfig.geminiDailyTokenQuota),
      "Gemini token-volume guardrail.",
      false,
      "Confirm quota values match the pilot budget before launch."
    ),
    envItem(
      "SENSITIVE_DATA_PROTECTION_ENABLED",
      sentinelConfig.sensitiveDataProtectionEnabled ? "true" : "",
      "Google Sensitive Data Protection Tier 1 adapter.",
      false,
      "Enable only after the service account and Google Cloud project are configured for production scans."
    )
  ];
}

function envItem(
  name: string,
  value: string,
  requiredFor: string,
  secret: boolean,
  nextAction: string
): ProductionLaunchEnvItem {
  const configured = Boolean(value);

  return {
    name,
    requiredFor,
    status: configured ? "configured" : secret ? "secret-required" : "missing",
    secret,
    currentValue: configured ? (secret ? "configured" : value) : "missing",
    nextAction
  };
}

function buildVerificationCommands(): ProductionLaunchCommand[] {
  return [
    {
      id: "local-quality-gates",
      label: "Local quality gates",
      command: "npm run lint && npm run typecheck && npm test && npm run build",
      ownerRole: "engineering",
      purpose: "Prove the submitted source builds and test coverage is green before deployment.",
      expectedProof: "Terminal output showing lint, typecheck, tests, and build passing."
    },
    {
      id: "cloudrun-manifest-review",
      label: "Cloud Run manifest review",
      command: "npm test -- tests/cloudrun-manifest.test.ts",
      ownerRole: "engineering",
      purpose: "Prove the checked-in Cloud Run manifest contains the required production env and secret placeholders.",
      expectedProof: "Test output showing required XPRIZE, Gemini, OAuth, Workspace, cost-control, and Secret Manager entries are present."
    },
    {
      id: "hosted-readiness",
      label: "Hosted readiness payload",
      command: "curl -s $NEXT_PUBLIC_PRODUCT_URL/api/readiness",
      ownerRole: "engineering",
      purpose: "Show the deployed app can generate the Readiness Command Center from the hosted URL.",
      expectedProof: "JSON payload with productionLaunch, xprizeGate, and claimGuard sections."
    },
    {
      id: "hosted-production-smoke",
      label: "Hosted production smoke report",
      command: "npm run verify:production -- --url $NEXT_PUBLIC_PRODUCT_URL --strict",
      ownerRole: "engineering",
      purpose: "Generate one JSON readiness report across hosted launch, submission, compliance, Devpost, license, and Claim Guard endpoints.",
      expectedProof: "JSON report with transport status, blocked/review summary, and next actions attached to the private launch packet."
    },
    {
      id: "production-gemini-smoke",
      label: "Production Gemini smoke",
      command: "curl -X POST -s $NEXT_PUBLIC_PRODUCT_URL/api/production/gemini-smoke",
      ownerRole: "engineering",
      purpose: "Prove the hosted app can perform a Gemini API semantic audit on a synthetic non-customer fixture.",
      expectedProof: "JSON payload with provider=gemini-api, model, agentRunId, eventId, token/cost estimate, and no customer data."
    },
    {
      id: "persistence-write-through",
      label: "Persistence write-through",
      command: "curl -X POST -s $NEXT_PUBLIC_PRODUCT_URL/api/production/persistence",
      ownerRole: "engineering",
      purpose: "Verify Firestore, BigQuery audit rows, BigQuery agent-run rows, and Secret Manager write-through in production mode.",
      expectedProof: "Passed checks for configuration, Firestore, BigQuery audit, BigQuery agent-run, and Secret Manager targets."
    },
    {
      id: "cost-controls",
      label: "Cloud cost controls",
      command: "curl -X POST -s $NEXT_PUBLIC_PRODUCT_URL/api/production/cost-controls",
      ownerRole: "engineering",
      purpose: "Verify Cloud Billing budget and Gemini API key restriction resources.",
      expectedProof: "Passed budget and API-key checks, with quota evidence noted for private binder."
    },
    {
      id: "workspace-reconciliation",
      label: "Workspace sync reconciliation",
      command: "curl -X POST -s $NEXT_PUBLIC_PRODUCT_URL/api/workspace/sync/reconcile",
      ownerRole: "security",
      purpose: "Prove Drive/Gmail cursor reconciliation exists after OAuth install.",
      expectedProof: "Reconciliation payload showing live cursor state or explicit blocker if not installed."
    },
    {
      id: "final-claim-guard",
      label: "Final Claim Guard",
      command: "curl -s $NEXT_PUBLIC_PRODUCT_URL/api/compliance/claims",
      ownerRole: "legal",
      purpose: "Check hosted product and submission copy for overclaims before demo recording.",
      expectedProof: "Claim Guard passed with no banned certification, guarantee, legal, audit, or absolute-win claims."
    },
    {
      id: "final-submission-binder",
      label: "Final XPRIZE binder",
      command: "curl -s $NEXT_PUBLIC_PRODUCT_URL/api/xprize/submission-binder",
      ownerRole: "founder",
      purpose: "Generate the private binder from hosted production evidence immediately before Devpost upload.",
      expectedProof: "Binder artifact summary with missing/mock-only items cleared or assigned to private evidence response."
    }
  ];
}

function buildProofArtifacts(snapshot: ProductionLaunchSnapshot): ProductionLaunchProofArtifact[] {
  const hasGeminiRun = snapshot.agentRuns.some((run) => run.provider === "gemini-api");
  const hasLiveWorkspaceConnection = snapshot.connections.some((connection) => connection.mode !== "mock");
  const productionEvidence = sentinelConfig.evidenceMode === "production";
  const manifest = buildThirdPartyManifest();
  const paidProofReady =
    productionEvidence &&
    snapshot.pilotRecords.some((pilot) => pilot.armsLength && !pilot.relatedParty && pilot.proofStatus === "financial-doc-ready");

  return [
    proofArtifact("cloud-run-url", "Cloud Run hosted product URL", hasJudgeProductAccess(), "engineering", "NEXT_PUBLIC_PRODUCT_URL", "Working product access.", "If private, provide credentials only through Devpost testing instructions.", "Deploy, verify from a signed-out browser, and confirm free judge access through judging."),
    proofArtifact("firestore-write", "Firestore tenant write-through", buildPersistenceReadiness().configured, "engineering", "/api/production/persistence", "Durable tenant state.", "Redact project ids if screenshots expose sensitive structure.", "Run the persistence verifier in production mode."),
    proofArtifact("bigquery-audit", "BigQuery audit evidence row", buildPersistenceReadiness().configured, "engineering", "/api/production/persistence", "Production operation proof.", "Share row metadata, not private finding content.", "Run write-through and capture BigQuery row proof."),
    proofArtifact("bigquery-agent-run", "BigQuery agent-run evidence row", buildPersistenceReadiness().configured && snapshot.agentRuns.length > 0, "engineering", "/api/production/persistence", "Durable AI-native operations proof.", "Share provider/model/fallback/cost metadata only; redact prompt, output, and customer content.", "Run a production high-risk scan, then verify the agent-run insert/read path."),
    proofArtifact("secret-manager-token", "Secret Manager OAuth token path", buildPersistenceReadiness().configured && hasLiveWorkspaceConnection, "security", "/api/oauth/google/callback", "Workspace OAuth credential safety.", "Never expose token values; show secret path and IAM only.", "Complete OAuth callback and verify token storage."),
    proofArtifact("live-gemini-log", "Live Gemini API semantic run", hasGeminiRun, "engineering", "/api/production/gemini-smoke", "Required deployed LLM functionality proof.", "Share model/cost metadata only; redact prompt and customer content.", "Run the hosted synthetic Gemini smoke after configuring GEMINI_API_KEY."),
    proofArtifact("workspace-sync-log", "Workspace sync reconciliation log", hasLiveWorkspaceConnection && hasLiveWorkspaceSyncEvidence(snapshot.syncState), "security", "/api/workspace/sync/reconcile", "AI-native operations continuity.", "Redact email addresses, domains, and file names.", "Run reconciliation after OAuth install."),
    proofArtifact("financial-records", "Revenue, cost, CAC, and invoice proof", paidProofReady, "founder", "/api/financial-evidence/ledger", "Business Viability.", "Keep invoices/payment exports private and redacted.", "Attach real paid customer records and costs."),
    proofArtifact("user-consent", "Real user and testimonial consent proof", productionEvidence && snapshot.tenant.evidence.activeUsers > 0, "sales", "/api/evidence/vault", "Real user evidence.", "Share testimonials only when explicit consent is recorded.", "Register consent and active-user artifacts."),
    proofArtifact("repository-access", "Repository access proof", Boolean(sentinelConfig.repositoryUrl), "engineering", "XPRIZE_REPOSITORY_URL", "Submission testing.", "Keep secrets and private evidence out of source.", "Publish or privately share the complete source repository."),
    proofArtifact("demo-video", "Public under-three-minute demo video", hasDemoVideoClearance(), "sales", "XPRIZE_DEMO_VIDEO_URL", "Submission media.", "Use only owned/permitted assets and redacted data.", "Record, publish, and human-review the final video for duration, visibility, assets, and customer-data redaction."),
    proofArtifact(
      "license-ip-review",
      "License and IP clearance review",
      sentinelConfig.thirdPartyReviewApproved && manifest.summary.status === "passed",
      "legal",
      "/api/xprize/license-manifest",
      "Third-party use and IP ownership.",
      "Keep private review notes out of public copy.",
      "Review dependencies, Google API terms, screenshots, and video assets."
    )
  ];
}

function proofArtifact(
  id: string,
  label: string,
  ready: boolean,
  ownerRole: ProductionLaunchProofArtifact["ownerRole"],
  source: string,
  requiredFor: string,
  privateHandling: string,
  nextAction: string
): ProductionLaunchProofArtifact {
  return {
    id,
    label,
    status: ready ? "ready" : "external-required",
    ownerRole,
    source,
    requiredFor,
    privateHandling,
    nextAction
  };
}

function buildNextActions(
  workstreams: ProductionLaunchWorkstream[],
  envMatrix: ProductionLaunchEnvItem[],
  proofArtifacts: ProductionLaunchProofArtifact[]
) {
  const actions = [
    ...workstreams
      .filter((workstream) => workstream.status !== "ready")
      .map((workstream) => workstream.nextAction),
    ...envMatrix
      .filter((item) => item.status !== "configured")
      .map((item) => item.nextAction),
    ...proofArtifacts
      .filter((artifact) => artifact.status !== "ready")
      .map((artifact) => artifact.nextAction)
  ];

  return Array.from(new Set(actions)).slice(0, 10);
}

function resolveStatus(
  workstreams: ProductionLaunchWorkstream[],
  proofArtifacts: ProductionLaunchProofArtifact[],
  envMatrix: ProductionLaunchEnvItem[]
): ProductionLaunchStatus {
  if (workstreams.some((item) => item.status === "blocked") || envMatrix.some((item) => item.status === "secret-required")) {
    return "blocked";
  }

  if (
    workstreams.some((item) => item.status === "external-required") ||
    proofArtifacts.some((item) => item.status === "external-required") ||
    envMatrix.some((item) => item.status === "missing")
  ) {
    return "external-required";
  }

  if (workstreams.some((item) => item.status === "needs-review") || envMatrix.some((item) => item.status === "review-required")) {
    return "needs-review";
  }

  return "ready";
}

function resolveLaunchMode(status: ProductionLaunchStatus): ProductionLaunchCommandCenter["launchMode"] {
  if (status === "ready") {
    return "production-ready";
  }

  if (sentinelConfig.storageMode === "gcp-rest" || sentinelConfig.evidenceMode === "production" || Boolean(sentinelConfig.productUrl)) {
    return "production-candidate";
  }

  return "local-mock";
}
