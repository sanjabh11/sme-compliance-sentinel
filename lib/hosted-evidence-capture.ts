import { hasDemoVideoClearance, hasJudgeProductAccess, judgeProductAccessSummary, sentinelConfig } from "@/lib/config";
import { collectCloudRunDeploymentEvidence } from "@/lib/cloudrun-deployment";
import { buildCloudCostControlCenter } from "@/lib/cloud-cost-controls";
import { buildEvidenceVault } from "@/lib/evidence-vault";
import { buildPersistenceReadiness } from "@/lib/persistence";
import { hasLiveWorkspaceSyncEvidence } from "@/lib/workspace-sync";
import type {
  DashboardSnapshot,
  EvidenceVaultArtifact,
  HostedEvidenceArtifactCheck,
  HostedEvidenceArtifactTemplate,
  HostedEvidenceCaptureCommand,
  HostedEvidenceCapturePacket
} from "@/lib/types";

type HostedEvidenceSnapshot = Pick<
  DashboardSnapshot,
  "tenant" | "connections" | "syncState" | "agentRuns" | "pilotRecords" | "evidenceVaultArtifacts"
>;

export function buildHostedEvidenceCapturePacket(snapshot: HostedEvidenceSnapshot): HostedEvidenceCapturePacket {
  const generatedAt = new Date().toISOString();
  const productUrl = sentinelConfig.productUrl || "missing";
  const hostedUrl = isHostedUrl(sentinelConfig.productUrl);
  const evidenceMode = sentinelConfig.evidenceMode === "production" ? "production" : "mock";
  const persistence = buildPersistenceReadiness();
  const deploymentEvidence = collectCloudRunDeploymentEvidence();
  const vault = buildEvidenceVault(snapshot);
  const vaultArtifactById = new Map(vault.requiredArtifacts.map((artifact) => [artifact.id, artifact]));
  const cloudRunDeploymentArtifact = vaultArtifactById.get("vault_cloud_run_deployment_proof");
  const productionReadinessArtifact = vaultArtifactById.get("vault_production_readiness_report");
  const geminiUsageArtifact = vaultArtifactById.get("vault_gemini_usage_log");
  const gcpPersistenceArtifact = vaultArtifactById.get("vault_gcp_persistence_proof");
  const workspaceOauthArtifact = vaultArtifactById.get("vault_workspace_oauth_log");
  const cloudBillingArtifact = vaultArtifactById.get("vault_cloud_billing_proof");
  const cloudCostControls = buildCloudCostControlCenter({ agentRuns: snapshot.agentRuns });
  const hasLiveGeminiRun = snapshot.agentRuns.some((run) => run.provider === "gemini-api");
  const hasMockGeminiRun = snapshot.agentRuns.some((run) => run.provider === "mock-gemini");
  const hasVerifiedGeminiArtifact = hasVerifiedVaultArtifact(geminiUsageArtifact);
  const hasUploadedGeminiArtifact = hasUploadedVaultArtifact(geminiUsageArtifact);
  const hasLiveWorkspaceConnection = snapshot.connections.some((connection) => connection.mode !== "mock");
  const hasLiveWorkspaceSync = hasLiveWorkspaceSyncEvidence(snapshot.syncState);
  const productionReadinessStatus = statusFromVaultArtifact({
    artifact: productionReadinessArtifact,
    fallback: hostedUrl ? "missing" : "mock-only"
  });
  const persistenceStatus = statusFromVaultArtifact({
    artifact: gcpPersistenceArtifact,
    fallback: persistence.configured ? "missing" : "mock-only"
  });
  const workspaceStatus = statusFromVaultArtifact({
    artifact: workspaceOauthArtifact,
    fallback: evidenceMode === "production" && hasLiveWorkspaceConnection && hasLiveWorkspaceSync ? "captured" : "mock-only"
  });
  const costControlsStatus = statusFromVaultArtifact({
    artifact: cloudBillingArtifact,
    fallback: "missing"
  });
  const paidPilotReady =
    evidenceMode === "production" &&
    snapshot.pilotRecords.some(
      (pilot) =>
        pilot.armsLength &&
        !pilot.relatedParty &&
        pilot.proofStatus === "financial-doc-ready" &&
        pilot.activeUsers > 0 &&
        pilot.monthlyRevenueUsd > 0
    );

  const checks: HostedEvidenceArtifactCheck[] = [
    artifactCheck({
      id: "hosted-product-url",
      label: "Hosted product URL and judge access",
      status: hostedUrl && hasJudgeProductAccess() ? "captured" : "missing",
      source: "NEXT_PUBLIC_PRODUCT_URL plus XPRIZE judge-access flags",
      requiredFor: "Submission Logistics",
      ownerRole: "engineering",
      evidence: judgeProductAccessSummary(),
      fix: "Deploy the product, verify signed-out access, then configure private judge access and free judging-period access outside the repository.",
      privateHandling: "Never commit judge credentials or private testing instructions."
    }),
    artifactCheck({
      id: "cloudrun-deployment-output",
      label: "Cloud Run deploy and revision evidence",
      status: statusFromVaultArtifact({
        artifact: cloudRunDeploymentArtifact,
        fallback: "missing"
      }),
      source: "/api/production/deployment-evidence",
      requiredFor: "AI-Native Operations",
      ownerRole: "engineering",
      evidence: evidenceFromVaultArtifact(
        cloudRunDeploymentArtifact,
        `${deploymentEvidence.overallStatus}; ${deploymentEvidence.replacementFindings.length} replacement value(s); ${deploymentEvidence.blockers.length} blocker(s).`
      ),
      fix: "Render production values, run the Cloud Run dry-run, deploy, then store revision URL/log output as a redacted private artifact.",
      privateHandling: "Keep rendered manifests private if they contain tenant ids, internal service accounts, or judge-only URLs."
    }),
    artifactCheck({
      id: "production-readiness-readonly",
      label: "Hosted read-only production verification JSON",
      status: productionReadinessStatus,
      source: "npm run verify:production -- --url",
      requiredFor: "Production Launch",
      ownerRole: "engineering",
      evidence: evidenceFromVaultArtifact(
        productionReadinessArtifact,
        hostedUrl
          ? "Hosted URL is configured, but no read-only smoke JSON is registered in this packet."
          : "Only local verification is possible until a hosted URL exists."
      ),
      fix: "Run the read-only verification command against the Cloud Run URL and register the JSON output after redacting internal ids when needed.",
      privateHandling: "Store the full JSON privately; public material should show only aggregate status and non-sensitive route names."
    }),
    artifactCheck({
      id: "production-readiness-write-through",
      label: "Hosted write-through verification JSON",
      status: productionReadinessStatus,
      source: "npm run verify:production -- --include-write-checks",
      requiredFor: "AI-Native Operations",
      ownerRole: "engineering",
      evidence: evidenceFromVaultArtifact(
        productionReadinessArtifact,
        persistence.configured
          ? "GCP persistence is configured, but write-through hosted verification output is not registered."
          : `Storage mode ${persistence.mode}; missing ${persistence.missingEnv.join(", ") || "gcp-rest mode"}.`
      ),
      fix: "After service-account IAM is configured, run write-through verification for persistence, cost controls, Gemini, and Workspace reconciliation.",
      privateHandling: "Run write-through checks only on consented test data and keep raw cloud responses private."
    }),
    artifactCheck({
      id: "live-gemini-proof",
      label: "Live Gemini API agent-run proof",
      status:
        evidenceMode === "production" && (hasLiveGeminiRun || hasVerifiedGeminiArtifact)
          ? "captured"
          : evidenceMode === "production" && hasUploadedGeminiArtifact
            ? "needs-review"
            : hasMockGeminiRun
              ? "mock-only"
              : "missing",
      source: "/api/production/gemini-smoke",
      requiredFor: "AI-Native Operations",
      ownerRole: "engineering",
      evidence:
        evidenceMode === "production" && hasVerifiedGeminiArtifact
          ? evidenceFromVaultArtifact(geminiUsageArtifact, "Verified Gemini usage artifact is registered in the Evidence Vault.")
          : hasLiveGeminiRun
            ? `${snapshot.agentRuns.filter((run) => run.provider === "gemini-api").length} provider=gemini-api run(s) recorded.`
            : hasMockGeminiRun
              ? "Only mock Gemini fallback runs are recorded."
              : "No Gemini API agent run is recorded.",
      fix: "Configure GEMINI_API_KEY in Cloud Run, run the synthetic smoke, then persist the redacted agent-run row to BigQuery.",
      privateHandling: "Expose provider, model, timestamp, token/cost estimates, and finding id only; never expose API keys, raw prompts, or customer text."
    }),
    artifactCheck({
      id: "gcp-persistence-proof",
      label: "Firestore, BigQuery, and Secret Manager proof",
      status: persistenceStatus,
      source: "/api/production/persistence",
      requiredFor: "AI-Native Operations",
      ownerRole: "engineering",
      evidence: evidenceFromVaultArtifact(
        gcpPersistenceArtifact,
        persistence.configured
          ? `Project ${persistence.projectId}; Firestore ${persistence.firestoreDatabase}; BigQuery ${persistence.bigQueryDataset}.`
          : `Storage mode ${persistence.mode}; local memory proof is not durable production evidence.`
      ),
      fix: "Set SENTINEL_STORAGE_MODE=gcp-rest, configure the Google Cloud targets, and run hosted persistence write-through verification.",
      privateHandling: "Keep token secret names and BigQuery row samples redacted if they identify pilots or tenants."
    }),
    artifactCheck({
      id: "workspace-oauth-sync-proof",
      label: "Workspace OAuth install and sync proof",
      status: workspaceStatus,
      source: "/api/workspace/sync/reconcile",
      requiredFor: "AI-Native Operations",
      ownerRole: "security",
      evidence: evidenceFromVaultArtifact(
        workspaceOauthArtifact,
        `Connection modes ${snapshot.connections.map((connection) => connection.mode).join(", ")}; sync mode ${snapshot.syncState.mode}.`
      ),
      fix: "Collect signed pilot consent, complete OAuth install, run /api/workspace/sync/bootstrap and /api/workspace/sync/renew from Cloud Run, and register redacted Drive/Gmail cursor and renewal output.",
      privateHandling: "Do not expose refresh tokens, file names, email addresses, or channel tokens."
    }),
    artifactCheck({
      id: "cloud-cost-controls-proof",
      label: "Cloud Billing and Gemini key-control proof",
      status: costControlsStatus,
      source: "/api/production/cost-controls",
      requiredFor: "Business Viability",
      ownerRole: "engineering",
      evidence: evidenceFromVaultArtifact(
        cloudBillingArtifact,
        `Cost-control mode ${cloudCostControls.mode}; status ${cloudCostControls.status}; budget ${cloudCostControls.budgetPlan.budgetId ?? "missing"}.`
      ),
      fix: "Create the Cloud Billing budget, configure Pub/Sub alerts, restrict the Gemini API key, and register redacted screenshots or API responses.",
      privateHandling: "Share budget ids and restriction metadata only; never share API key values."
    }),
    artifactCheck({
      id: "paid-pilot-proof",
      label: "Paid pilot, active-user, and invoice proof",
      status: paidPilotReady ? "captured" : snapshot.tenant.evidence.mrrUsd > 0 ? "mock-only" : "missing",
      source: "Evidence Vault and financial ledger",
      requiredFor: "Business Viability",
      ownerRole: "founder",
      evidence: `${snapshot.tenant.evidence.pilotCount} pilot row(s); $${snapshot.tenant.evidence.mrrUsd}/mo MRR; ${snapshot.tenant.evidence.activeUsers} active user(s).`,
      fix: "Replace seeded rows with arms-length paid pilot evidence, invoices, payment exports, active-user proof, and consented references.",
      privateHandling: "Keep customer names, invoices, payment ids, and contact details private or redacted."
    }),
    artifactCheck({
      id: "demo-video-proof",
      label: "Public under-three-minute demo proof",
      status: hasDemoVideoClearance() ? "captured" : "missing",
      source: "XPRIZE_DEMO_VIDEO_URL and demo clearance flags",
      requiredFor: "Submission Logistics",
      ownerRole: "sales",
      evidence: sentinelConfig.demoVideoUrl || "Demo video URL is missing.",
      fix: "Record the hosted product, confirm public access, duration, English/subtitle status, asset rights, and customer-data redaction.",
      privateHandling: "Do not show customer-identifying findings, private invoices, credentials, or OAuth tokens in the public video."
    }),
    artifactCheck({
      id: "evidence-vault-redaction",
      label: "Private Evidence Vault redaction and checksums",
      status:
        evidenceMode === "production" && vault.summary.verified > 0 && vault.summary["needs-redaction"] === 0
          ? "captured"
          : vault.summary["needs-redaction"] > 0
            ? "needs-redaction"
            : "missing",
      source: "/api/evidence/vault",
      requiredFor: "Submission Logistics",
      ownerRole: "legal",
      evidence: `${vault.summary.verified} verified; ${vault.summary.uploaded} uploaded; ${vault.summary.missing} missing; ${vault.summary["needs-redaction"]} need redaction.`,
      fix: "Register final artifacts with SHA-256 checksums and redaction complete before generating the judge packet.",
      privateHandling: "Only redacted aliases, artifact statuses, checksums, and owner routing should leave the private packet."
    })
  ];

  const blockers = [
    ...deploymentEvidence.blockers.map((blocker) => `Cloud Run manifest: ${blocker}`),
    ...checks.filter((check) => check.status === "needs-redaction").map((check) => `${check.label}: ${check.fix}`)
  ];
  const missing = checks.filter((check) => check.status === "missing" || check.status === "mock-only" || check.status === "needs-review");
  const overallStatus = blockers.length ? "blocked" : missing.length ? "needs-hosted-proof" : "ready-to-capture";

  return {
    generatedAt,
    overallStatus,
    productUrl,
    evidenceMode,
    storageMode: sentinelConfig.storageMode,
    checks,
    privateArtifactTemplates: buildPrivateArtifactTemplates(),
    captureCommands: buildCaptureCommands(sentinelConfig.productUrl),
    blockers,
    nextActions: buildNextActions({ hostedUrl, evidenceMode, persistenceConfigured: persistence.configured, missing }),
    privateHandling: [
      "Treat this packet as an operator capture list, not public proof.",
      "Local memory, mock Gemini, template manifests, and seeded pilots remain mock-only until the same checks run against hosted Cloud Run with production evidence mode.",
      "Store full JSON, screenshots, invoices, OAuth logs, and Cloud Billing output in the private Evidence Vault with redaction state and checksums.",
      "Public Devpost materials should show aggregate outcomes and the hosted app experience, not customer security findings or credentials."
    ],
    disclaimer:
      "Hosted evidence is not considered captured unless it comes from the deployed product or a private, verifiable Google Cloud/Gemini/Workspace artifact. This packet does not create production evidence by itself."
  };
}

function artifactCheck(input: HostedEvidenceArtifactCheck): HostedEvidenceArtifactCheck {
  return input;
}

function statusFromVaultArtifact(input: {
  artifact?: EvidenceVaultArtifact;
  fallback: HostedEvidenceArtifactCheck["status"];
}): HostedEvidenceArtifactCheck["status"] {
  if (hasVerifiedVaultArtifact(input.artifact)) {
    return "captured";
  }

  if (hasUploadedVaultArtifact(input.artifact)) {
    return "needs-review";
  }

  return input.fallback;
}

function hasVerifiedVaultArtifact(artifact?: EvidenceVaultArtifact) {
  return Boolean(artifact?.status === "verified" && artifact.redacted && artifact.checksumSha256);
}

function hasUploadedVaultArtifact(artifact?: EvidenceVaultArtifact) {
  return artifact?.status === "uploaded" || artifact?.status === "needs-redaction";
}

function evidenceFromVaultArtifact(artifact: EvidenceVaultArtifact | undefined, fallback: string) {
  if (!artifact || (artifact.status !== "uploaded" && artifact.status !== "verified" && artifact.status !== "needs-redaction")) {
    return fallback;
  }

  const checksum = artifact.checksumSha256 ? ` checksum ${artifact.checksumSha256.slice(0, 12)}...` : "";
  const statusNote =
    artifact.status === "verified"
      ? "Verified Evidence Vault artifact"
      : "Evidence Vault artifact is registered but still needs operator review before this can be claimed as final proof";

  return `${statusNote}: ${artifact.label}; status ${artifact.status}; redacted ${artifact.redacted ? "yes" : "no"};${checksum} next action: ${artifact.nextAction}`;
}

function buildPrivateArtifactTemplates(): HostedEvidenceArtifactTemplate[] {
  return [
    artifactTemplate({
      id: "cloud-run-url",
      label: "Cloud Run service URL",
      ownerRole: "engineering",
      requiredFor: "Submission Logistics",
      acceptedProof: ["Hosted HTTPS URL", "Cloud Run service/revision screenshot", "Signed-out browser check"],
      redactionRules: ["Do not include judge credentials", "Hide internal-only project notes"],
      storageTarget: "Evidence Vault product-url-proof artifact",
      registrationHint: "Register as product URL proof after judge access is configured."
    }),
    artifactTemplate({
      id: "cloudrun-deployment-evidence",
      label: "Cloud Run dry-run and deploy output",
      ownerRole: "engineering",
      requiredFor: "AI-Native Operations",
      acceptedProof: ["gcloud dry-run output", "deploy revision URL", "service-account/IAM summary"],
      redactionRules: ["Remove secrets", "Redact unrelated project resources"],
      storageTarget: "Private deployment evidence packet",
      registrationHint: "Attach to production launch binder and keep raw command output private."
    }),
    artifactTemplate({
      id: "production-readiness-json",
      label: "Hosted production verification JSON",
      ownerRole: "engineering",
      requiredFor: "Production Launch",
      acceptedProof: ["Read-only verify:production JSON", "Write-through verify:production JSON after IAM is configured"],
      redactionRules: ["Remove customer names", "Remove credential-like headers or tokens"],
      storageTarget: "Private launch packet",
      registrationHint: "Attach the latest hosted verification JSON before final submission."
    }),
    artifactTemplate({
      id: "live-gemini-log",
      label: "Live Gemini API run log",
      ownerRole: "engineering",
      requiredFor: "AI-Native Operations",
      acceptedProof: ["provider=gemini-api agent-run row", "model id", "timestamp", "token/cost estimate"],
      redactionRules: ["No raw prompts", "No customer document text", "No API keys"],
      storageTarget: "BigQuery agent_runs plus Evidence Vault gemini-usage-log",
      registrationHint: "Persist after POST /api/production/gemini-smoke succeeds on Cloud Run."
    }),
    artifactTemplate({
      id: "firestore-bigquery-secret-proof",
      label: "Firestore, BigQuery, and Secret Manager write-through",
      ownerRole: "engineering",
      requiredFor: "AI-Native Operations",
      acceptedProof: ["Firestore write/read result", "BigQuery audit row", "BigQuery agent-run row", "Secret Manager token-path access status"],
      redactionRules: ["No refresh-token values", "No raw document content", "No unredacted tenant emails"],
      storageTarget: "Private persistence evidence packet",
      registrationHint: "Attach write-through output from /api/production/persistence."
    }),
    artifactTemplate({
      id: "workspace-oauth-install",
      label: "Workspace OAuth install and reconciliation",
      ownerRole: "security",
      requiredFor: "AI-Native Operations",
      acceptedProof: ["Signed pilot consent", "OAuth install timestamp", "Drive page token", "Gmail history id", "bootstrap, renewal, and reconciliation output"],
      redactionRules: ["Hide refresh tokens", "Hide Drive channel tokens", "Redact file names and email addresses"],
      storageTarget: "Evidence Vault workspace-oauth-log artifact",
      registrationHint: "Register only after a consented pilot completes OAuth bootstrap and hosted watch renewal."
    }),
    artifactTemplate({
      id: "cloud-billing-budget",
      label: "Cloud Billing budget and Gemini key controls",
      ownerRole: "engineering",
      requiredFor: "Business Viability",
      acceptedProof: ["Cloud Billing budget id", "alert threshold screenshot or API output", "Gemini key restriction metadata", "quota plan"],
      redactionRules: ["No API key values", "No unrelated billing account details"],
      storageTarget: "Evidence Vault cloud-billing-proof artifact",
      registrationHint: "Register after /api/production/cost-controls passes in production mode."
    }),
    artifactTemplate({
      id: "paid-pilot-financial-proof",
      label: "Paid pilot and active-user proof",
      ownerRole: "founder",
      requiredFor: "Business Viability",
      acceptedProof: ["Invoice", "payment export", "active-user log", "customer consent record"],
      redactionRules: ["Redact customer name unless consented", "Hide payment identifiers", "Separate related-party revenue"],
      storageTarget: "Evidence Vault pilot invoice/payment/active-user artifacts",
      registrationHint: "Register every counted pilot before setting production evidence mode."
    }),
    artifactTemplate({
      id: "judge-access-proof",
      label: "Judge access and demo video proof",
      ownerRole: "sales",
      requiredFor: "Submission Logistics",
      acceptedProof: ["Private Devpost testing instructions", "free-access confirmation", "public video URL", "duration check"],
      redactionRules: ["Credentials stay in Devpost private fields", "No customer security findings in screenshots or video"],
      storageTarget: "Private submission binder",
      registrationHint: "Attach after the hosted app, demo video, and judge access are final."
    })
  ];
}

function artifactTemplate(input: HostedEvidenceArtifactTemplate): HostedEvidenceArtifactTemplate {
  return input;
}

function buildCaptureCommands(productUrl: string): HostedEvidenceCaptureCommand[] {
  const url = productUrl || "https://YOUR-CLOUD-RUN-URL";

  return [
    captureCommand({
      id: "cloudrun-template-strict",
      label: "Validate rendered Cloud Run manifest",
      command: "npm run verify:cloudrun-deployment -- --strict",
      mutatesProduction: false,
      expectedArtifact: "JSON showing ready-to-dry-run after production values are rendered.",
      privateHandling: "Run before deploy and attach output with project-only identifiers redacted if needed."
    }),
    captureCommand({
      id: "hosted-readonly",
      label: "Capture hosted read-only readiness",
      command: `npm run verify:production -- --url ${url} --release-id $SENTINEL_RELEASE_ID --strict --out /secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-readonly.json`,
      mutatesProduction: false,
      expectedArtifact: "Read-only hosted readiness JSON.",
      privateHandling: "Safe for repeated capture; store full output privately."
    }),
    captureCommand({
      id: "hosted-write-through",
      label: "Capture hosted write-through readiness",
      command: `npm run verify:production -- --url ${url} --release-id $SENTINEL_RELEASE_ID --strict --include-write-checks --out /secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-write.json`,
      mutatesProduction: true,
      expectedArtifact: "Write-through persistence, Gemini, cost-control, and Workspace reconciliation JSON.",
      privateHandling: "Run only after consented data, IAM, redaction, and budget controls are configured."
    }),
    captureCommand({
      id: "hosted-gemini-smoke",
      label: "Record live Gemini proof",
      command: `curl -s ${url}/api/production/gemini-smoke`,
      mutatesProduction: false,
      expectedArtifact: "GET status proving whether provider=gemini-api exists.",
      privateHandling: "Use POST only when ready to create a synthetic hosted agent run."
    }),
    captureCommand({
      id: "hosted-evidence-packet",
      label: "Refresh this capture packet",
      command: `curl -s ${url}/api/production/hosted-evidence`,
      mutatesProduction: false,
      expectedArtifact: "Latest private capture checklist after hosted verification.",
      privateHandling: "Store alongside the final submission binder."
    })
  ];
}

function captureCommand(input: HostedEvidenceCaptureCommand): HostedEvidenceCaptureCommand {
  return input;
}

function buildNextActions(input: {
  hostedUrl: boolean;
  evidenceMode: "mock" | "production";
  persistenceConfigured: boolean;
  missing: HostedEvidenceArtifactCheck[];
}) {
  return [
    ...(input.hostedUrl ? [] : ["Deploy to Cloud Run and set NEXT_PUBLIC_PRODUCT_URL to the hosted HTTPS service URL."]),
    ...(input.evidenceMode === "production"
      ? []
      : ["Keep SENTINEL_EVIDENCE_MODE=mock until real paid-pilot, hosted Gemini, GCP, Workspace, and redacted private artifacts exist."]),
    ...(input.persistenceConfigured
      ? []
      : ["Configure SENTINEL_STORAGE_MODE=gcp-rest, Firestore, BigQuery, Secret Manager, and service-account IAM before write-through proof."]),
    ...(input.missing.length
      ? [`Capture or replace ${input.missing.length} missing/mock production artifact(s): ${input.missing.slice(0, 4).map((check) => check.label).join(", ")}.`]
      : []),
    "Register each final artifact in the private Evidence Vault with redaction complete and SHA-256 checksum.",
    "Use only aggregated, consented metrics in public Devpost screenshots and demo video."
  ];
}

function isHostedUrl(rawUrl: string) {
  if (!rawUrl) {
    return false;
  }

  try {
    const url = new URL(rawUrl);
    const localHosts = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
    return url.protocol === "https:" && !localHosts.has(url.hostname);
  } catch {
    return false;
  }
}
