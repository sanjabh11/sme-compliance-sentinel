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
const renderedManifestPath = "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun.service.rendered.yaml";
const projectId = sentinelConfig.googleCloudProject || "PROJECT_ID";
const projectNumber = sentinelConfig.googleCloudProjectNumber || "PROJECT_NUMBER";
const imageTag = sentinelConfig.releaseId ? dockerTag(sentinelConfig.releaseId) : "$SENTINEL_RELEASE_ID";
const runtimeServiceAccount = `sentinel-runtime@${projectId}.iam.gserviceaccount.com`;
const workspacePushServiceAccount = `workspace-push@${projectId}.iam.gserviceaccount.com`;
const pubSubServiceAgent = `service-${projectNumber}@gcp-sa-pubsub.iam.gserviceaccount.com`;
const imageUrl = `${recommendedRegion}-docker.pkg.dev/${projectId}/sentinel/web:${imageTag}`;

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
  "roles/pubsub.subscriber"
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
        "write-render-values-template",
        "Write private render values template",
        "node scripts/render-cloudrun-manifest.mjs --write-values-template /secure/local/cloudrun-render-values.json",
        "engineering",
        false,
        false,
        "Private non-secret values file template ready for project ids, source revision metadata, hosted URLs, secret versions, and reviewed XPRIZE flags."
      ),
      command(
        "render-cloudrun-manifest",
        "Render private Cloud Run manifest",
        "npm run render:cloudrun-manifest -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --release-id $SENTINEL_RELEASE_ID --strict",
        "engineering",
        false,
        false,
        "Ignored private render bundle with rendered manifest, verifier JSON, and dry-run/deploy command files."
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
        "hosted-smoke",
        "Hosted production smoke",
        "npm run verify:production -- --url https://YOUR-CLOUD-RUN-URL --strict",
        "engineering",
        false,
        false,
        "JSON report from the hosted app across readiness, launch, submission, compliance, Devpost, license, and Claim Guard endpoints."
      ),
      command(
        "write-through-smoke",
        "Production write-through smoke",
        "npm run verify:production -- --url https://YOUR-CLOUD-RUN-URL --strict --include-write-checks",
        "engineering",
        false,
        true,
        "JSON report showing Firestore, BigQuery, Secret Manager, cost-control, and Workspace reconciliation checks after credentials and SENTINEL_ADMIN_ACTION_TOKEN are configured."
      ),
      command(
        "import-hosted-proof",
        "Import redacted hosted proof",
        "curl -s -X POST https://YOUR-CLOUD-RUN-URL/api/evidence/vault/import -H 'content-type: application/json' -H 'x-sentinel-admin-token: $SENTINEL_ADMIN_ACTION_TOKEN' --data @/secure/local/redacted-verify-production.json",
        "engineering",
        true,
        false,
        "Evidence Vault response with checksum-bearing Cloud Run, Gemini, GCP persistence, Workspace, cost-control, repository, and readiness artifact records."
      )
    ],
    blockers,
    privateHandlingRules: [
      "Never put API keys, OAuth client secrets, evidence-signing secrets, Drive channel tokens, judge credentials, invoices, or customer findings in the repository.",
      `Use ${renderValuesTemplatePath} only as a non-secret starting point; filled render values belong in a private path such as /secure/local/cloudrun-render-values.json.`,
      "Use Secret Manager for the runtime secrets and grant access only to the Cloud Run runtime service account.",
      "Use Devpost private testing instructions for judge credentials; keep public README and video free of login secrets.",
      "Use the admin action token only from private operator tooling when importing hosted proof JSON.",
      "Capture Cloud Run, Firestore, BigQuery, Secret Manager, Pub/Sub, Gemini, and Workspace proof as redacted screenshots or JSON logs for the private binder.",
      "Keep human-attestation flags false until the private proof exists; a deployed service URL alone is not XPRIZE readiness."
    ],
    sourceUrls: [
      "https://docs.cloud.google.com/run/docs/configuring/services/secrets",
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
