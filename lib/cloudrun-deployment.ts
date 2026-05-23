import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CloudRunDeploymentEnvCheck,
  CloudRunDeploymentEvidence,
  CloudRunDeploymentReplacementFinding
} from "@/lib/types";

const defaultManifestPath = "cloudrun.service.yaml";
const serviceName = "sme-workspace-sentinel";
const recommendedRegion = "us-central1";

const requiredNonSecretEnv = [
  "NEXT_PUBLIC_APP_NAME",
  "SENTINEL_TENANT_ID",
  "SENTINEL_MOCK_MODE",
  "SENTINEL_STORAGE_MODE",
  "SENTINEL_EVIDENCE_MODE",
  "SENTINEL_CLOUD_COST_CONTROLS_MODE",
  "SENTINEL_CLOUD_RUN_SERVICE_NAME",
  "SENTINEL_CLOUD_RUN_REGION",
  "SENTINEL_RELEASE_ID",
  "SENTINEL_PRIVATE_EVIDENCE_BUCKET",
  "NEXT_PUBLIC_PRODUCT_URL",
  "XPRIZE_REPOSITORY_URL",
  "XPRIZE_DEMO_VIDEO_URL",
  "XPRIZE_DEMO_VIDEO_UNDER_3_MIN_CONFIRMED",
  "XPRIZE_DEMO_VIDEO_PUBLICLY_ACCESSIBLE_CONFIRMED",
  "XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED",
  "XPRIZE_DEMO_VIDEO_CUSTOMER_DATA_REDACTED_CONFIRMED",
  "XPRIZE_DEMO_VIDEO_ENGLISH_OR_SUBTITLED_CONFIRMED",
  "XPRIZE_JUDGE_ACCESS_CONFIGURED",
  "XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED",
  "XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED",
  "XPRIZE_ENTRANT_TYPE",
  "XPRIZE_GENERAL_ELIGIBILITY_CONFIRMED",
  "XPRIZE_REPRESENTATIVE_AUTHORIZED",
  "XPRIZE_ORGANIZATION_UNDER_25_CONFIRMED",
  "XPRIZE_CORPORATE_ID_CONFIGURED",
  "XPRIZE_NO_PROMOTION_ENTITY_CONFLICT_CONFIRMED",
  "XPRIZE_THIRD_PARTY_REVIEW_APPROVED",
  "XPRIZE_TESTING_INSTRUCTIONS",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_PROJECT_NUMBER",
  "GOOGLE_CLOUD_BILLING_ACCOUNT_ID",
  "SENTINEL_GCP_BUDGET_ID",
  "SENTINEL_BUDGET_PUBSUB_TOPIC",
  "FIRESTORE_DATABASE",
  "BIGQUERY_DATASET",
  "BIGQUERY_AUDIT_TABLE",
  "BIGQUERY_AGENT_RUNS_TABLE",
  "WORKSPACE_SECRET_PREFIX",
  "WORKSPACE_GMAIL_TOPIC",
  "WORKSPACE_GMAIL_SUBSCRIPTION",
  "SENTINEL_WORKSPACE_WEBHOOK_AUTH_MODE",
  "WORKSPACE_PUBSUB_PUSH_AUDIENCE",
  "WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "GEMINI_MODEL",
  "SENTINEL_GEMINI_MODEL_ALLOWLIST",
  "SENTINEL_GEMINI_MONTHLY_BUDGET_USD",
  "SENTINEL_GEMINI_MAX_CONTENT_BYTES_PER_EVENT",
  "SENTINEL_GEMINI_API_KEY_ID",
  "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS",
  "SENTINEL_GEMINI_DAILY_REQUEST_QUOTA",
  "SENTINEL_GEMINI_DAILY_TOKEN_QUOTA",
  "GEMINI_INPUT_PER_1K_USD",
  "GEMINI_OUTPUT_PER_1K_USD",
  "SENSITIVE_DATA_PROTECTION_ENABLED"
];

const requiredSecretEnv = [
  "SENTINEL_ADMIN_ACTION_TOKEN",
  "GEMINI_API_KEY",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "SENTINEL_EVIDENCE_SIGNING_SECRET",
  "WORKSPACE_DRIVE_CHANNEL_TOKEN"
];

const manualReviewEnv = new Set([
  "XPRIZE_DEMO_VIDEO_UNDER_3_MIN_CONFIRMED",
  "XPRIZE_DEMO_VIDEO_PUBLICLY_ACCESSIBLE_CONFIRMED",
  "XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED",
  "XPRIZE_DEMO_VIDEO_CUSTOMER_DATA_REDACTED_CONFIRMED",
  "XPRIZE_DEMO_VIDEO_ENGLISH_OR_SUBTITLED_CONFIRMED",
  "XPRIZE_JUDGE_ACCESS_CONFIGURED",
  "XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED",
  "XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED",
  "XPRIZE_GENERAL_ELIGIBILITY_CONFIRMED",
  "XPRIZE_REPRESENTATIVE_AUTHORIZED",
  "XPRIZE_ORGANIZATION_UNDER_25_CONFIRMED",
  "XPRIZE_CORPORATE_ID_CONFIGURED",
  "XPRIZE_NO_PROMOTION_ENTITY_CONFLICT_CONFIRMED",
  "XPRIZE_THIRD_PARTY_REVIEW_APPROVED"
]);

const placeholderPatterns = [
  /PROJECT_ID/u,
  /PROJECT_NUMBER/u,
  /REGION/u,
  /YOUR[-_A-Z0-9]*/u,
  /BILLING_ACCOUNT_ID/u,
  /BUDGET_ID/u,
  /GEMINI_API_KEY_ID/u,
  /RELEASE_ID/u
];

interface ParsedEnvEntry {
  name: string;
  value?: string;
  secretName?: string;
  secretVersion?: string;
}

export function collectCloudRunDeploymentEvidence(
  manifestPath = defaultManifestPath,
  rootDir = process.cwd()
): CloudRunDeploymentEvidence {
  const absolutePath = join(rootDir, manifestPath);
  return buildCloudRunDeploymentEvidence(readFileSync(absolutePath, "utf8"), { manifestPath });
}

export function buildCloudRunDeploymentEvidence(
  manifest: string,
  options: { manifestPath?: string; generatedAt?: string } = {}
): CloudRunDeploymentEvidence {
  const manifestPath = options.manifestPath ?? defaultManifestPath;
  const envEntries = parseEnvEntries(manifest);
  const envByName = new Map(envEntries.map((entry) => [entry.name, entry]));
  const image = extractScalar(manifest, "image") || "missing";
  const runtimeServiceAccount = extractScalar(manifest, "serviceAccountName") || "missing";
  const envChecks = [
    ...requiredNonSecretEnv.map((name) => checkNonSecretEnv(name, envByName.get(name))),
    ...requiredSecretEnv.map((name) => checkSecretEnv(name, envByName.get(name)))
  ];
  const replacementFindings = buildReplacementFindings({ image, runtimeServiceAccount, envChecks });
  const secretRefs = requiredSecretEnv
    .map((name) => envByName.get(name))
    .filter((entry): entry is ParsedEnvEntry => Boolean(entry?.secretName))
    .map((entry) => ({
      envName: entry.name,
      secretName: entry.secretName ?? "",
      version: entry.secretVersion ?? ""
    }));
  const blockers = [
    ...envChecks
      .filter((check) => check.status === "blocked")
      .map((check) => `${check.name}: ${check.fix}`),
    ...(image === "missing" ? ["container image is missing from the Cloud Run manifest."] : []),
    ...(runtimeServiceAccount === "missing" ? ["runtime service account is missing from the Cloud Run manifest."] : [])
  ];
  const needsValues = envChecks.some((check) => check.status === "needs-value") || replacementFindings.length > 0;
  const overallStatus = blockers.length ? "blocked" : needsValues ? "template-needs-values" : "ready-to-dry-run";
  const projectId = envByName.get("GOOGLE_CLOUD_PROJECT")?.value || "PROJECT_ID";
  const deploymentRegion = envByName.get("SENTINEL_CLOUD_RUN_REGION")?.value || recommendedRegion;
  const configuredServiceName = envByName.get("SENTINEL_CLOUD_RUN_SERVICE_NAME")?.value || serviceName;

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    overallStatus,
    manifestPath,
    serviceName: configuredServiceName,
    image,
    runtimeServiceAccount,
    envChecks,
    replacementFindings,
    manualReviewFlags: envChecks.filter((check) => check.status === "manual-review").map((check) => check.name),
    secretRefs,
    dryRunCommand: `gcloud run services replace ${manifestPath} --region ${deploymentRegion} --project ${projectId} --dry-run`,
    deployCommand: `gcloud run services replace ${manifestPath} --region ${deploymentRegion} --project ${projectId}`,
    postDeployVerification: [
      "npm run verify:production -- --url https://YOUR-CLOUD-RUN-URL --strict",
      "npm run verify:production -- --url https://YOUR-CLOUD-RUN-URL --strict --include-write-checks",
      "POST /api/production/gemini-smoke from the hosted service after GEMINI_API_KEY is configured.",
      "POST /api/production/persistence from the hosted service after Firestore, BigQuery, and Secret Manager IAM are configured.",
      "POST /api/evidence/vault/import with x-sentinel-admin-token after redacting the hosted verify:production JSON.",
      "Register the resulting redacted JSON/screenshot artifacts in the private Evidence Vault."
    ],
    blockers,
    nextActions: buildNextActions({ blockers, replacementFindings, envChecks }),
    privateHandling: [
      "Do not commit rendered manifests that contain secret values, judge credentials, customer evidence, raw findings, invoices, or OAuth tokens.",
      "Secret env vars must use Secret Manager references pinned to explicit versions, not raw values or `latest`.",
      "False XPRIZE attestation flags are safe for deployment dry-runs; set them true only after private evidence and human review exist.",
      "A ready-to-dry-run manifest is not hosted proof. Hosted proof requires Cloud Run URL, production smoke reports, and private Google Cloud/Gemini evidence."
    ],
    disclaimer:
      "This evidence packet validates the local Cloud Run deployment template. It does not deploy Cloud Run, create Google Cloud resources, or prove XPRIZE readiness by itself."
  };
}

function parseEnvEntries(manifest: string): ParsedEnvEntry[] {
  const envStart = manifest.indexOf("\n          env:");

  if (envStart < 0) {
    return [];
  }

  const envText = manifest.slice(envStart);
  const entries: ParsedEnvEntry[] = [];
  const entryPattern = /\n\s+- name: ([A-Z0-9_]+)\n([\s\S]*?)(?=\n\s+- name: [A-Z0-9_]+\n|$)/gu;

  for (const match of envText.matchAll(entryPattern)) {
    const block = match[2] ?? "";
    const value = block.match(/(?:^|\n)\s+value: "([^"]*)"/u)?.[1];
    const secretName = block.match(/secretKeyRef:\n\s+name: ([^\n]+)\n/u)?.[1]?.trim();
    const secretVersion = block.match(/secretKeyRef:\n\s+name: [^\n]+\n\s+key: "([^"]+)"/u)?.[1];

    entries.push({
      name: match[1],
      value,
      secretName,
      secretVersion
    });
  }

  return entries;
}

function checkNonSecretEnv(name: string, entry?: ParsedEnvEntry): CloudRunDeploymentEnvCheck {
  if (!entry) {
    return envCheck(name, categoryForEnv(name), "blocked", false, "missing", "Required env var is absent.", "Add this env var to cloudrun.service.yaml.");
  }

  if (entry.secretName) {
    return envCheck(
      name,
      categoryForEnv(name),
      "blocked",
      true,
      `secret:${entry.secretName}`,
      "Non-secret deployment metadata is configured as a secret.",
      "Use a normal value for this non-secret env var."
    );
  }

  const value = entry.value ?? "";

  if (!value && name === "XPRIZE_ENTRANT_TYPE") {
    return envCheck(
      name,
      categoryForEnv(name),
      "manual-review",
      false,
      "empty",
      "Entrant type is intentionally blank until human review chooses individual, team, or organization.",
      "Set individual, team, or organization only after final entrant review."
    );
  }

  if (!value) {
    return envCheck(name, categoryForEnv(name), "needs-value", false, "empty", "Value is empty.", "Fill this value before Cloud Run dry-run.");
  }

  if (hasPlaceholder(value)) {
    return envCheck(
      name,
      categoryForEnv(name),
      "needs-value",
      false,
      value,
      "Value still contains a template placeholder.",
      "Replace this placeholder with the production value before Cloud Run dry-run."
    );
  }

  if (manualReviewEnv.has(name) && value !== "true") {
    return envCheck(
      name,
      categoryForEnv(name),
      "manual-review",
      false,
      value,
      "Human attestation is intentionally not confirmed in the template.",
      "Set true only after private evidence exists and the responsible owner approves."
    );
  }

  return envCheck(name, categoryForEnv(name), "passed", false, value, "Value is present and has no template placeholder.", "No action.");
}

function checkSecretEnv(name: string, entry?: ParsedEnvEntry): CloudRunDeploymentEnvCheck {
  if (!entry) {
    return envCheck(name, "secret", "blocked", true, "missing", "Secret env var is absent.", "Add a Secret Manager valueFrom reference.");
  }

  if (entry.value) {
    return envCheck(
      name,
      "secret",
      "blocked",
      true,
      "raw-value",
      "Secret env var uses a raw value.",
      "Move the value to Secret Manager and reference the explicit secret version."
    );
  }

  if (!entry.secretName || !entry.secretVersion) {
    return envCheck(
      name,
      "secret",
      "blocked",
      true,
      "incomplete-secret-ref",
      "Secret Manager reference is incomplete.",
      "Provide both secret name and explicit version."
    );
  }

  if (entry.secretVersion === "latest") {
    return envCheck(
      name,
      "secret",
      "blocked",
      true,
      `${entry.secretName}:latest`,
      "Secret Manager reference uses latest.",
      "Pin a reviewed numeric secret version and deploy a new revision after rotation."
    );
  }

  return envCheck(
    name,
    "secret",
    "passed",
    true,
    `${entry.secretName}:${entry.secretVersion}`,
    "Secret Manager reference uses an explicit version.",
    "No action."
  );
}

function buildReplacementFindings(input: {
  image: string;
  runtimeServiceAccount: string;
  envChecks: CloudRunDeploymentEnvCheck[];
}): CloudRunDeploymentReplacementFinding[] {
  return [
    ...resourceFinding("container image", input.image),
    ...resourceFinding("runtime service account", input.runtimeServiceAccount),
    ...input.envChecks
      .filter((check) => check.status === "needs-value")
      .map((check) => ({
        target: check.name,
        value: check.currentValue,
        reason: check.evidence,
        fix: check.fix
      }))
  ];
}

function resourceFinding(target: string, value: string): CloudRunDeploymentReplacementFinding[] {
  if (value === "missing") {
    return [
      {
        target,
        value,
        reason: "Required Cloud Run field is missing.",
        fix: `Set the ${target} before Cloud Run dry-run.`
      }
    ];
  }

  if (!hasPlaceholder(value)) {
    return [];
  }

  return [
    {
      target,
      value,
      reason: "Value still contains a template placeholder.",
      fix: `Replace the ${target} placeholder before Cloud Run dry-run.`
    }
  ];
}

function buildNextActions(input: {
  blockers: string[];
  replacementFindings: CloudRunDeploymentReplacementFinding[];
  envChecks: CloudRunDeploymentEnvCheck[];
}) {
  if (input.blockers.length) {
    return [
      "Fix blocked Cloud Run manifest entries before attempting dry-run.",
      ...input.blockers.slice(0, 4),
      "Rerun npm run verify:cloudrun-deployment after fixing the manifest."
    ];
  }

  if (input.replacementFindings.length) {
    return [
      "Replace all template placeholders with production values, leaving human attestation flags false until evidence exists.",
      "Create the referenced Secret Manager secrets and keep values out of source.",
      "Run npm run verify:cloudrun-deployment, then gcloud run services replace cloudrun.service.yaml --dry-run.",
      "After deployment, run npm run verify:production against the hosted Cloud Run URL."
    ];
  }

  return [
    "Run the Cloud Run dry-run command and save the JSON/terminal output for private evidence.",
    "Deploy a new Cloud Run revision only after the dry-run passes.",
    "Run hosted read-only and write-through production verification commands.",
    "Keep manual XPRIZE attestation flags false until private proof is reviewed."
  ];
}

function envCheck(
  name: string,
  category: CloudRunDeploymentEnvCheck["category"],
  status: CloudRunDeploymentEnvCheck["status"],
  secret: boolean,
  currentValue: string,
  evidence: string,
  fix: string
): CloudRunDeploymentEnvCheck {
  return {
    name,
    category,
    status,
    secret,
    currentValue: secret && currentValue !== "missing" && currentValue !== "raw-value" ? redactSecretRef(currentValue) : currentValue,
    evidence,
    fix
  };
}

function categoryForEnv(name: string): CloudRunDeploymentEnvCheck["category"] {
  if (name.startsWith("XPRIZE_")) {
    return "xprize";
  }

  if (name.startsWith("GOOGLE_CLOUD_") || name.startsWith("FIRESTORE_") || name.startsWith("BIGQUERY_")) {
    return "google-cloud";
  }

  if (name.includes("EVIDENCE") || name === "SENTINEL_RELEASE_ID") {
    return "evidence";
  }

  if (name.startsWith("WORKSPACE_") || name.startsWith("GOOGLE_OAUTH_")) {
    return "workspace";
  }

  if (name.startsWith("GEMINI_") || name.startsWith("SENTINEL_GEMINI_") || name === "SENSITIVE_DATA_PROTECTION_ENABLED") {
    return "gemini";
  }

  if (name.includes("BUDGET") || name.includes("COST")) {
    return "cost";
  }

  return "runtime";
}

function extractScalar(manifest: string, key: "image" | "serviceAccountName") {
  const prefix = key === "image" ? "\\s+-\\s+" : "\\s+";
  return manifest.match(new RegExp(`\\n${prefix}${key}:\\s*([^\\n]+)`, "u"))?.[1]?.trim();
}

function hasPlaceholder(value: string) {
  return placeholderPatterns.some((pattern) => pattern.test(value));
}

function redactSecretRef(value: string) {
  const [name, version] = value.split(":");
  return `${name}:version-${version ? "set" : "missing"}`;
}
