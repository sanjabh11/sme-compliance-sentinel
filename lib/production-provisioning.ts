import { sentinelConfig } from "@/lib/config";
import type {
  ProductionProvisioningChecklistItem,
  ProductionProvisioningCommand,
  ProductionProvisioningPack
} from "@/lib/types";

const serviceName = sentinelConfig.cloudRunServiceName || "sme-workspace-sentinel";
const recommendedRegion = sentinelConfig.cloudRunRegion || "us-central1";
const manifestPath = "cloudrun.service.yaml";
const renderValuesTemplatePath = "docs/deployment/cloudrun-render-values.template.json";
const privateRenderValuesPath = "/secure/local/cloudrun-render-values.json";
const cloudRunTranscriptDir = "/secure/local/cloudrun/$SENTINEL_RELEASE_ID";
const deploymentArtifactsDir = "artifacts/deployment";
const renderedManifestPath = "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun.service.rendered.yaml";
const dryRunPreflightPacketPath = "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-dry-run-preflight-packet.json";
const projectId = sentinelConfig.googleCloudProject || "PROJECT_ID";
const projectNumber = sentinelConfig.googleCloudProjectNumber || "PROJECT_NUMBER";
const imageTag = sentinelConfig.releaseId ? dockerTag(sentinelConfig.releaseId) : "$SENTINEL_RELEASE_ID";
const runtimeServiceAccount = `sentinel-runtime@${projectId}.iam.gserviceaccount.com`;
const workspacePushServiceAccount = `workspace-push@${projectId}.iam.gserviceaccount.com`;
const pubSubServiceAgent = `service-${projectNumber}@gcp-sa-pubsub.iam.gserviceaccount.com`;
const imageUrl = `${recommendedRegion}-docker.pkg.dev/${projectId}/sentinel/web:${imageTag}`;
const vpcConnectorName = sentinelConfig.cloudRunVpcConnector || "sentinel-egress";
const staticEgressIpName = "sentinel-gemini-egress-ip";
const cloudRouterName = "sentinel-egress-router";
const cloudNatName = "sentinel-egress-nat";

const requiredApis = [
  "run.googleapis.com",
  "artifactregistry.googleapis.com",
  "cloudbuild.googleapis.com",
  "storage.googleapis.com",
  "secretmanager.googleapis.com",
  "firestore.googleapis.com",
  "bigquery.googleapis.com",
  "pubsub.googleapis.com",
  "gmail.googleapis.com",
  "drive.googleapis.com",
  "dlp.googleapis.com",
  "apikeys.googleapis.com",
  "billingbudgets.googleapis.com",
  "compute.googleapis.com",
  "vpcaccess.googleapis.com",
  "generativelanguage.googleapis.com"
];

const secretNames = [
  "sentinel-admin-action-token",
  "gemini-api-key",
  "google-oauth-client-secret",
  "sentinel-evidence-signing-secret",
  "workspace-drive-channel-token"
];

const requiredIamRoles = [
  "roles/run.admin",
  "roles/iam.serviceAccountUser",
  "roles/datastore.user",
  "roles/bigquery.dataEditor",
  "roles/bigquery.jobUser",
  "roles/secretmanager.secretAccessor",
  "roles/secretmanager.secretVersionAdder",
  "roles/pubsub.publisher",
  "roles/pubsub.subscriber",
  "roles/vpcaccess.user"
];

export function buildProductionProvisioningPack(): ProductionProvisioningPack {
  const checklist = buildChecklist();
  const blockers = checklist
    .filter((item) => item.status !== "configured")
    .map((item) => `${item.label}: ${item.verification}`);
  const dryRunCommand = `gcloud run services replace ${renderedManifestPath} --region ${recommendedRegion} --project ${projectId} --dry-run`;
  const deployCommand = `gcloud run services replace ${renderedManifestPath} --region ${recommendedRegion} --project ${projectId}`;

  return {
    generatedAt: new Date().toISOString(),
    status: blockers.length ? "needs-values" : "ready-to-run",
    manifestPath,
    renderValuesTemplatePath,
    serviceName,
    recommendedRegion,
    requiredApis,
    secretNames,
    requiredIamRoles,
    checklist,
    commands: buildCommands(dryRunCommand, deployCommand),
    dryRunCommand,
    deployCommand,
    verificationSequence: [
      command(
        "local-quality-gates",
        "Local source gates",
        "npm run lint && npm run typecheck && npm test && npm run build",
        "engineering",
        false,
        false,
        "Terminal output showing the submitted source passes before cloud deployment."
      ),
      command(
        "write-release-render-values",
        "Prepare Cloud Run render handoff",
        `npm run prepare:cloudrun-render-handoff -- --values ${privateRenderValuesPath} --out-dir ${deploymentArtifactsDir} --strict`,
        "engineering",
        false,
        false,
        "Private non-secret values file prefilled with SENTINEL_RELEASE_ID, source commit, source timestamp, branch, and repository URL plus cloudrun-render-handoff.json/.md, non-strict audit, owner evidence packet, and packet verifier; project ids, hosted URLs, secret versions, and reviewed XPRIZE flags still need operator values."
      ),
      command(
        "verify-cloudrun-render-handoff",
        "Verify Cloud Run render handoff",
        "npm run verify:cloudrun-render-handoff -- artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-handoff.json --strict",
        "engineering",
        false,
        false,
        "Private cloudrun-render-handoff-verifier.json showing the handoff JSON, regenerated Markdown, owner packet verifier, proof boundary, stop conditions, and secret-shaped text checks still pass after transfer or owner edits."
      ),
      command(
        "audit-render-values",
        "Audit private render values",
        `npm run audit:cloudrun-values -- --values ${privateRenderValuesPath} --out-dir ${deploymentArtifactsDir} --release-id $SENTINEL_RELEASE_ID --strict`,
        "engineering",
        false,
        false,
        "Private cloudrun-render-values-audit.json showing status ready-to-render before any manifest render."
      ),
      command(
        "verify-render-evidence-packet",
        "Verify Cloud Run render evidence packet",
        "npm run verify:cloudrun-render-evidence -- artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-evidence-packet.json --strict",
        "engineering",
        false,
        false,
        "Private cloudrun-render-evidence-packet-verifier.json showing the audit packet, owner packet, regenerated Markdown, command gates, stop conditions, and secret-shaped text checks still match before manifest render."
      ),
      command(
        "render-cloudrun-manifest",
        "Render private Cloud Run manifest",
        `npm run render:cloudrun-manifest -- --values ${privateRenderValuesPath} --out-dir ${deploymentArtifactsDir} --release-id $SENTINEL_RELEASE_ID --strict`,
        "engineering",
        false,
        false,
        "Ignored private render bundle with rendered manifest, verifier JSON, and dry-run/deploy command files after the values audit is ready-to-render."
      ),
      command(
        "prepare-cloudrun-dry-run",
        "Prepare Cloud Run dry-run preflight packet",
        `npm run prepare:cloudrun-dry-run -- --values ${privateRenderValuesPath} --out-dir ${deploymentArtifactsDir} --release-id $SENTINEL_RELEASE_ID --strict`,
        "engineering",
        false,
        false,
        "Private cloudrun-dry-run-preflight-packet.json showing status ready-to-dry-run and SHA-256 digests for the rendered manifest bundle."
      ),
      command(
        "verify-cloudrun-dry-run-packet",
        "Verify Cloud Run dry-run packet digests",
        `npm run verify:cloudrun-dry-run-packet -- ${dryRunPreflightPacketPath} --strict`,
        "engineering",
        false,
        false,
        "Private cloudrun-dry-run-packet-verifier.json showing status verified immediately before the real gcloud dry-run."
      ),
      command(
        "manifest-regression",
        "Manifest regression",
        "npm test -- tests/cloudrun-manifest.test.ts && npm test -- tests/cloudrun-render.test.ts",
        "engineering",
        false,
        false,
        "Test output showing required Cloud Run env, Secret Manager placeholders, and private render safety checks are present."
      ),
      command(
        "collect-cloudrun-deployment-transcript",
        "Collect redacted Cloud Run deployment transcript",
        `npm run collect:cloudrun-deployment -- --release-id $SENTINEL_RELEASE_ID --dry-run-log ${cloudRunTranscriptDir}/cloudrun-dry-run.log --deploy-log ${cloudRunTranscriptDir}/cloudrun-deploy.log --describe-json ${cloudRunTranscriptDir}/cloudrun-describe.json --out-dir artifacts/deployment --strict`,
        "engineering",
        false,
        false,
        "Private cloudrun-deployment-transcript-packet.json with SHA-256 hashes and redacted dry-run, deploy, and describe evidence."
      ),
      command(
        "hosted-smoke",
        "Hosted production smoke",
        "npm run verify:production -- --url https://YOUR-CLOUD-RUN-URL --release-id $SENTINEL_RELEASE_ID --strict --out /secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-readonly.json",
        "engineering",
        false,
        false,
        "JSON report from the hosted app across readiness, launch, submission, compliance, Devpost, license, and Claim Guard endpoints."
      ),
      command(
        "write-through-smoke",
        "Production write-through smoke",
        "npm run verify:production -- --url https://YOUR-CLOUD-RUN-URL --release-id $SENTINEL_RELEASE_ID --strict --include-write-checks --out /secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-write.json",
        "engineering",
        false,
        true,
        "JSON report showing Firestore, BigQuery, Secret Manager, cost-control, and Workspace reconciliation checks after credentials and SENTINEL_ADMIN_ACTION_TOKEN are configured."
      ),
      command(
        "collect-hosted-proof-bundle",
        "Collect release-bound hosted proof bundle",
        "npm run collect:hosted-proof -- --url https://YOUR-CLOUD-RUN-URL --release-id $SENTINEL_RELEASE_ID --include-write-checks --strict",
        "engineering",
        false,
        true,
        "Ignored artifacts/hosted-proof/$SENTINEL_RELEASE_ID bundle with verify-production.json, release-evidence-manifest.json, manifest.json, release-integrity status, and proof-flag status."
      ),
      command(
        "dry-run-hosted-proof-import",
        "Dry-run hosted proof Evidence Vault import",
        "npm run import:hosted-proof -- --bundle-dir artifacts/hosted-proof/$SENTINEL_RELEASE_ID --url https://YOUR-CLOUD-RUN-URL --dry-run",
        "legal",
        false,
        false,
        "evidence-vault-import-request.json and evidence-vault-import-summary.json generated without a hosted write."
      ),
      command(
        "write-deployment-results-template",
        "Write deployment command results template",
        "npm run prepare:deployment-execution-checklist -- --bundle-dir artifacts/hosted-proof/$SENTINEL_RELEASE_ID --write-results-template /secure/local/deployment-command-results.json",
        "engineering",
        false,
        false,
        "Private deployment-command-results.json template listing every required command id, release id, hosted URL, expected artifact path, and checksum placeholder."
      ),
      command(
        "prepare-deployment-execution-checklist",
        "Prepare deployment execution checklist",
        "npm run prepare:deployment-execution-checklist -- --bundle-dir artifacts/hosted-proof/$SENTINEL_RELEASE_ID --results /secure/local/deployment-command-results.json --strict",
        "engineering",
        false,
        false,
        "deployment-execution-checklist.json showing every required deployment command passed with recordedAt and private evidencePath before hosted proof import."
      ),
      command(
        "import-hosted-proof",
        "Import redacted hosted proof",
        "npm run import:hosted-proof -- --bundle-dir artifacts/hosted-proof/$SENTINEL_RELEASE_ID --url https://YOUR-CLOUD-RUN-URL --confirm-import",
        "engineering",
        true,
        false,
        "Evidence Vault response with checksum-bearing Cloud Run, Gemini, GCP persistence, Workspace, cost-control, repository, and readiness artifact records."
      )
    ],
    blockers,
    privateHandlingRules: [
      "Never put API keys, OAuth client secrets, evidence-signing secrets, Drive channel tokens, judge credentials, invoices, or customer findings in the repository.",
      `Use ${renderValuesTemplatePath} only as a non-secret starting point; filled render values belong in a private path such as ${privateRenderValuesPath}.`,
      "Run npm run audit:cloudrun-values against the filled private values file before rendering; stop if the audit is not ready-to-render.",
      "Run npm run verify:cloudrun-render-evidence against the owner packet before rendering; stop if the packet verifier is not verified.",
      "Run npm run prepare:cloudrun-dry-run and npm run verify:cloudrun-dry-run-packet before gcloud dry-run; preserve both JSON outputs in the private evidence store.",
      `Run npm run collect:cloudrun-deployment after Cloud Run dry-run, deploy, and describe; save raw gcloud logs under ${cloudRunTranscriptDir}/, keep them private, and share only the redacted transcript packet.`,
      "Run npm run collect:hosted-proof, npm run import:hosted-proof --dry-run, npm run prepare:deployment-execution-checklist -- --write-results-template, and npm run prepare:deployment-execution-checklist -- --results before the final hosted Evidence Vault import; do not bypass release-integrity checks with raw curl.",
      "Use Secret Manager for the runtime secrets and grant access only to the Cloud Run runtime service account.",
      "Use the Serverless VPC Access connector and Cloud NAT static IP path before relying on Gemini API key server-IP restrictions.",
      "Use Devpost private testing instructions for judge credentials; keep public README and video free of login secrets.",
      "Use the admin action token only from private operator tooling when importing hosted proof JSON.",
      "Capture Cloud Run, Firestore, BigQuery, Secret Manager, Pub/Sub, Gemini, and Workspace proof as redacted screenshots or JSON logs for the private binder.",
      "Keep human-attestation flags false until the private proof exists; a deployed service URL alone is not XPRIZE readiness."
    ],
    sourceUrls: [
      "https://docs.cloud.google.com/run/docs/configuring/services/secrets",
      "https://docs.cloud.google.com/run/docs/configuring/services/environment-variables",
      "https://cloud.google.com/run/docs/configuring/vpc-connectors",
      "https://cloud.google.com/run/docs/configuring/static-outbound-ip",
      "https://cloud.google.com/sdk/gcloud/reference/run/services/replace",
      "https://ai.google.dev/api/all-methods"
    ],
    disclaimer:
      "This pack is a non-secret deployment runbook. It prepares operators for Cloud Run deployment but does not create cloud resources or prove hosted readiness until the commands are run in the real Google Cloud project."
  };
}

function buildChecklist(): ProductionProvisioningChecklistItem[] {
  return [
    item(
      "project",
      "Google Cloud project selected",
      Boolean(sentinelConfig.googleCloudProject),
      "engineering",
      "Cloud Run, Firestore, BigQuery, Secret Manager, Pub/Sub, Sensitive Data Protection, and Gemini API evidence.",
      "Set GOOGLE_CLOUD_PROJECT to the production project id.",
      "Project id can appear in private judge evidence; redact unrelated project metadata."
    ),
    item(
      "project-number",
      "Google Cloud project number recorded",
      Boolean(sentinelConfig.googleCloudProjectNumber),
      "engineering",
      "API key restriction checks and cross-resource Secret Manager references.",
      "Set GOOGLE_CLOUD_PROJECT_NUMBER before applying the Cloud Run manifest.",
      "Project number is not a secret but should stay in private operator proof unless needed for judges."
    ),
    item(
      "billing",
      "Billing budget targets configured",
      Boolean(sentinelConfig.googleCloudBillingAccountId && sentinelConfig.googleCloudBudgetId),
      "engineering",
      "Cloud Billing budget proof and cost-control evidence.",
      "Set GOOGLE_CLOUD_BILLING_ACCOUNT_ID and SENTINEL_GCP_BUDGET_ID after creating a budget.",
      "Share budget ids and thresholds without exposing billing account administration details."
    ),
    item(
      "private-evidence-store",
      "Private evidence bucket or store configured",
      Boolean(sentinelConfig.privateEvidenceBucket),
      "engineering",
      "Private storage for hosted verification JSON, Cloud Run proof, billing screenshots, and redacted judge packet artifacts.",
      "Set SENTINEL_PRIVATE_EVIDENCE_BUCKET after creating a private evidence store.",
      "Never put raw invoices, OAuth tokens, customer findings, or security screenshots in the public repository."
    ),
    item(
      "release-identity",
      "Release id configured",
      Boolean(sentinelConfig.releaseId),
      "engineering",
      "Traceability from Cloud Run revision, source commit, production smoke output, and Evidence Vault import checksum.",
      "Set SENTINEL_RELEASE_ID before dry-run and deployment.",
      "Release ids are non-secret, but tie them only to redacted proof packets."
    ),
    item(
      "source-revision-metadata",
      "Source revision metadata configured",
      Boolean(sentinelConfig.sourceCommit && sentinelConfig.sourceCommitAt && sentinelConfig.sourceBranch),
      "engineering",
      "Hosted provenance fallback and Cloud Run revision-to-source traceability.",
      "Set SENTINEL_SOURCE_COMMIT, SENTINEL_SOURCE_COMMIT_AT, and SENTINEL_SOURCE_BRANCH from the pushed source commit before rendering Cloud Run.",
      "Source commit metadata is non-secret; keep the full local provenance transcript in the private judge packet."
    ),
    item(
      "gemini-key-resource",
      "Gemini API key resource id recorded",
      Boolean(sentinelConfig.geminiApiKeyId),
      "engineering",
      "API-key restriction and quota proof.",
      "Set SENTINEL_GEMINI_API_KEY_ID to the API Keys API resource name, not the secret key value.",
      "Never include the API key value in screenshots or logs."
    ),
    item(
      "static-egress",
      "Static egress path configured",
      Boolean(
        sentinelConfig.cloudRunVpcConnector &&
          sentinelConfig.cloudRunVpcEgress === "all-traffic" &&
          sentinelConfig.geminiApiAllowedServerIps.length
      ),
      "security",
      "Gemini API key server-IP restrictions and public-launch cost/security control.",
      "Create the Serverless VPC Access connector, Cloud Router, Cloud NAT, static IP, and set SENTINEL_CLOUD_RUN_VPC_CONNECTOR, SENTINEL_CLOUD_RUN_VPC_EGRESS, and SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS before production render.",
      "Static egress IPs and network names are non-secret but should stay in private deployment proof until launch."
    ),
    item(
      "oauth-client",
      "Workspace OAuth client configured",
      Boolean(sentinelConfig.oauthClientId && sentinelConfig.oauthRedirectUri),
      "security",
      "Consent-gated Google Workspace OAuth install.",
      "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_REDIRECT_URI to the hosted callback values.",
      "Keep the OAuth client secret in Secret Manager only."
    ),
    item(
      "admin-action-token",
      "Admin action token configured",
      sentinelConfig.adminActionTokenConfigured,
      "security",
      "Production evidence import protection.",
      "Create sentinel-admin-action-token in Secret Manager and deploy it as SENTINEL_ADMIN_ACTION_TOKEN.",
      "Do not print the token in terminal logs, screenshots, README files, or Devpost."
    ),
    item(
      "workspace-pubsub",
      "Workspace Pub/Sub push resources configured",
      Boolean(
        sentinelConfig.gmailPubSubTopic &&
          sentinelConfig.gmailPubSubSubscription &&
          sentinelConfig.workspacePubSubPushAudience &&
          sentinelConfig.workspacePubSubServiceAccountEmail
      ),
      "security",
      "Authenticated Gmail Pub/Sub push intake and reconciliation hints.",
      "Create the Gmail topic/subscription and set OIDC audience plus service-account email.",
      "Do not expose tenant domains, user emails, or message payloads in public evidence."
    ),
    item(
      "xprize-logistics",
      "XPRIZE URLs and access logistics filled",
      Boolean(sentinelConfig.productUrl && sentinelConfig.repositoryUrl && sentinelConfig.demoVideoUrl),
      "founder",
      "Devpost product URL, repository URL, and public demo-video evidence.",
      "Set NEXT_PUBLIC_PRODUCT_URL, XPRIZE_REPOSITORY_URL, and XPRIZE_DEMO_VIDEO_URL after the artifacts exist.",
      "Store judge credentials only in Devpost private testing instructions."
    ),
    item(
      "xprize-category",
      "XPRIZE category locked",
      sentinelConfig.xprizeCategory === "Small Business Services",
      "founder",
      "Small Business Services category positioning and submission consistency.",
      "Keep XPRIZE_CATEGORY=Small Business Services unless the final strategy is formally changed.",
      "Category is public submission metadata; do not use it to imply eligibility or judging outcome."
    ),
    item(
      "xprize-business-evidence-attestations",
      "Business, user, and running-product evidence flags reviewed",
      sentinelConfig.xprizeTotalRevenueEvidenceConfigured &&
        sentinelConfig.xprizeRevenueByMonthEvidenceConfigured &&
        sentinelConfig.xprizeTotalCostsEvidenceConfigured &&
        sentinelConfig.xprizeCacSpendEvidenceConfigured &&
        sentinelConfig.xprizeRealUserEvidenceConfigured &&
        sentinelConfig.xprizeTestimonialConsentConfirmed &&
        sentinelConfig.xprizeRelatedPartyRevenueReviewed &&
        sentinelConfig.xprizeProductRunningEvidenceConfigured &&
        sentinelConfig.xprizeAgentExecutionLogsConfigured,
      "founder",
      "Private judge evidence for revenue, costs, CAC, real users, consented feedback, related-party separation, and product-running proof.",
      "Keep the Cloud Run flags false until each evidence packet exists in the private vault and has been human-reviewed.",
      "Do not expose invoices, customer contacts, security findings, user emails, or unconsented testimonials publicly.",
      "manual-review"
    ),
    item(
      "human-attestations",
      "Human attestation flags reviewed",
      false,
      "legal",
      "Eligibility, judge access, demo clearance, free judging access, and third-party review.",
      "Keep all attestation env flags false until the private evidence exists and a human owner approves.",
      "Do not use env flags as proof by themselves; pair each with private evidence.",
      "manual-review"
    )
  ];
}

function buildCommands(dryRunCommand: string, deployCommand: string): ProductionProvisioningCommand[] {
  return [
    command(
      "enable-apis",
      "Enable required APIs",
      `gcloud services enable ${requiredApis.join(" ")} --project ${projectId}`,
      "engineering",
      false,
      true,
      "APIs enabled in the production project."
    ),
    command(
      "create-runtime-service-account",
      "Create runtime service account",
      `gcloud iam service-accounts create sentinel-runtime --display-name "SME Workspace Sentinel runtime" --project ${projectId}`,
      "engineering",
      false,
      true,
      "Runtime service account exists for Cloud Run."
    ),
    command(
      "create-push-service-account",
      "Create Pub/Sub push service account",
      `gcloud iam service-accounts create workspace-push --display-name "Workspace Pub/Sub push identity" --project ${projectId}`,
      "security",
      false,
      true,
      "Dedicated Pub/Sub push identity exists for authenticated webhook delivery."
    ),
    command(
      "grant-pubsub-token-creator",
      "Allow Pub/Sub to mint push OIDC tokens",
      `gcloud iam service-accounts add-iam-policy-binding ${workspacePushServiceAccount} --member serviceAccount:${pubSubServiceAgent} --role roles/iam.serviceAccountTokenCreator --project ${projectId}`,
      "security",
      false,
      true,
      "Pub/Sub service agent can mint OIDC tokens for the dedicated push identity."
    ),
    ...requiredIamRoles
      .filter((role) => !["roles/run.admin", "roles/iam.serviceAccountUser"].includes(role))
      .map((role) =>
        command(
          `grant-${role.replace(/[./]/g, "-")}`,
          "Grant runtime IAM",
          `gcloud projects add-iam-policy-binding ${projectId} --member serviceAccount:${runtimeServiceAccount} --role ${role}`,
          "engineering",
          false,
          true,
          `${role} granted to the Cloud Run runtime service account.`
        )
      ),
    ...secretNames.flatMap((secretName) => [
      command(
        `create-secret-${secretName}`,
        "Create Secret Manager secret",
        `gcloud secrets create ${secretName} --replication-policy=automatic --project ${projectId}`,
        "security",
        false,
        true,
        `${secretName} exists in Secret Manager.`
      ),
      command(
        `add-secret-version-${secretName}`,
        "Add secret version from local private file",
        `gcloud secrets versions add ${secretName} --data-file=/secure/local/${secretName}.txt --project ${projectId}`,
        "security",
        true,
        true,
        `${secretName} has a current version; secret value is not printed or committed.`
      ),
      command(
        `grant-secret-${secretName}`,
        "Grant runtime secret access",
        `gcloud secrets add-iam-policy-binding ${secretName} --member serviceAccount:${runtimeServiceAccount} --role roles/secretmanager.secretAccessor --project ${projectId}`,
        "security",
        false,
        true,
        `${secretName} can be read by Cloud Run at instance startup.`
      )
    ]),
    command(
      "create-artifact-repository",
      "Create Artifact Registry repository",
      `gcloud artifacts repositories create sentinel --repository-format=docker --location ${recommendedRegion} --project ${projectId}`,
      "engineering",
      false,
      true,
      "Docker repository exists for the Cloud Run image."
    ),
    command(
      "create-private-evidence-bucket",
      "Create private evidence bucket",
      `gcloud storage buckets create gs://${projectId}-sentinel-private-evidence --location ${recommendedRegion} --uniform-bucket-level-access --project ${projectId}`,
      "engineering",
      false,
      true,
      "Private bucket exists for redacted hosted verification JSON, screenshots, and judge packet artifacts."
    ),
    command(
      "reserve-static-egress-ip",
      "Reserve static egress IP",
      `gcloud compute addresses create ${staticEgressIpName} --region ${recommendedRegion} --project ${projectId}`,
      "security",
      false,
      true,
      "Regional static IP exists for Gemini API key server restrictions."
    ),
    command(
      "create-egress-router",
      "Create Cloud Router",
      `gcloud compute routers create ${cloudRouterName} --network default --region ${recommendedRegion} --project ${projectId}`,
      "security",
      false,
      true,
      "Cloud Router exists for NAT-backed serverless egress."
    ),
    command(
      "create-egress-nat",
      "Create Cloud NAT with static IP",
      `gcloud compute routers nats create ${cloudNatName} --router ${cloudRouterName} --region ${recommendedRegion} --nat-all-subnet-ip-ranges --nat-external-ip-pool ${staticEgressIpName} --enable-logging --project ${projectId}`,
      "security",
      false,
      true,
      "Cloud NAT routes connector egress through the reserved static IP."
    ),
    command(
      "create-vpc-connector",
      "Create Serverless VPC Access connector",
      `gcloud compute networks vpc-access connectors create ${vpcConnectorName} --region ${recommendedRegion} --network default --range 10.8.0.0/28 --project ${projectId}`,
      "security",
      false,
      true,
      "Serverless VPC Access connector exists for Cloud Run all-traffic egress."
    ),
    command(
      "build-container",
      "Build production container",
      `gcloud builds submit --tag ${imageUrl} --project ${projectId}`,
      "engineering",
      false,
      true,
      "Container image built and pushed to Artifact Registry."
    ),
    command(
      "create-pubsub-topic",
      "Create Workspace Gmail Pub/Sub topic",
      `gcloud pubsub topics create workspace-gmail-updates --project ${projectId}`,
      "security",
      false,
      true,
      "Gmail watch topic exists."
    ),
    command(
      "create-budget-topic",
      "Create budget alert Pub/Sub topic",
      `gcloud pubsub topics create sentinel-budget-alerts --project ${projectId}`,
      "engineering",
      false,
      true,
      "Budget alert topic exists for cost-control evidence."
    ),
    command(
      "dry-run-cloudrun",
      "Validate Cloud Run manifest",
      dryRunCommand,
      "engineering",
      false,
      false,
      "Cloud Run accepts the rendered manifest schema without applying a revision."
    ),
    command(
      "deploy-cloudrun",
      "Apply Cloud Run manifest",
      deployCommand,
      "engineering",
      false,
      true,
      "Cloud Run revision is deployed from the ignored rendered manifest."
    ),
    command(
      "describe-cloudrun",
      "Capture Cloud Run proof",
      `gcloud run services describe ${serviceName} --region ${recommendedRegion} --project ${projectId} --format=json`,
      "engineering",
      false,
      false,
      "Redacted service JSON with URL, revision, service account, env names, and secret references."
    )
  ];
}

function item(
  id: string,
  label: string,
  configured: boolean,
  ownerRole: ProductionProvisioningChecklistItem["ownerRole"],
  requiredFor: string,
  verification: string,
  privateHandling: string,
  status: ProductionProvisioningChecklistItem["status"] = configured ? "configured" : "missing"
): ProductionProvisioningChecklistItem {
  return {
    id,
    label,
    status,
    ownerRole,
    requiredFor,
    verification,
    privateHandling
  };
}

function command(
  id: string,
  stage: string,
  commandText: string,
  ownerRole: ProductionProvisioningCommand["ownerRole"],
  requiresSecretInput: boolean,
  mutatesCloudResources: boolean,
  expectedProof: string
): ProductionProvisioningCommand {
  return {
    id,
    stage,
    command: commandText,
    ownerRole,
    requiresSecretInput,
    mutatesCloudResources,
    expectedProof
  };
}

function dockerTag(value: string) {
  return (
    String(value || "latest")
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 120) || "latest"
  );
}
