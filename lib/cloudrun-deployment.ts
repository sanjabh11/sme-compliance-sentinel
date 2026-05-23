import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CloudRunDeploymentEnvCheck,
  CloudRunDeploymentEvidence,
  CloudRunDeploymentReplacementFinding
} from "@/lib/types";

const defaultManifestPath = "cloudrun.service.yaml";
const defaultRenderedManifestPath = "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun.service.rendered.yaml";
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
  "SENTINEL_GEMINI_QUOTA_EVIDENCE_CONFIRMED",
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
] as const;

const requiredSecretEnvSet = new Set<string>(requiredSecretEnv);

const secretLookupNameByEnvName: Record<(typeof requiredSecretEnv)[number], string> = {
  SENTINEL_ADMIN_ACTION_TOKEN: "sentinel-admin-action-token",
  GEMINI_API_KEY: "gemini-api-key",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-oauth-client-secret",
  SENTINEL_EVIDENCE_SIGNING_SECRET: "sentinel-evidence-signing-secret",
  WORKSPACE_DRIVE_CHANNEL_TOKEN: "workspace-drive-channel-token"
} as const;

const prohibitedCredentialEnv = [
  {
    name: "GOOGLE_CLOUD_ACCESS_TOKEN",
    evidence: "Cloud Run should use the runtime service account and metadata server, not a committed access-token env var.",
    fix: "Remove this env var from cloudrun.service.yaml and grant the Cloud Run service account the required IAM roles."
  },
  {
    name: "GOOGLE_APPLICATION_CREDENTIALS",
    evidence: "Cloud Run should use the runtime service account, not a mounted or committed service-account key path.",
    fix: "Remove this env var and deploy with serviceAccountName plus least-privilege IAM."
  },
  {
    name: "GOOGLE_OAUTH_REFRESH_TOKEN",
    evidence: "Workspace OAuth refresh tokens must be stored per tenant in Secret Manager, not as shared service env vars.",
    fix: "Remove this env var and store tenant OAuth refresh-token payloads under WORKSPACE_SECRET_PREFIX."
  },
  {
    name: "WORKSPACE_REFRESH_TOKEN",
    evidence: "Workspace OAuth refresh tokens must be tenant-scoped Secret Manager entries.",
    fix: "Remove this env var and use the OAuth callback Secret Manager storage path."
  },
  {
    name: "XPRIZE_JUDGE_CREDENTIALS",
    evidence: "Judge credentials belong only in private Devpost testing instructions or an approved private channel.",
    fix: "Remove this env var and keep judge credentials outside source and deployment manifests."
  },
  {
    name: "XPRIZE_JUDGE_PASSWORD",
    evidence: "Judge credentials must not be committed or exposed through Cloud Run env metadata.",
    fix: "Remove this env var and provide credentials only through private judging instructions."
  }
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
  "XPRIZE_THIRD_PARTY_REVIEW_APPROVED",
  "SENTINEL_GEMINI_QUOTA_EVIDENCE_CONFIRMED"
]);

const booleanEnv = new Set([
  "SENTINEL_MOCK_MODE",
  "SENSITIVE_DATA_PROTECTION_ENABLED",
  ...manualReviewEnv
]);

const fixedProductionEnvValues: Record<string, string> = {
  SENTINEL_MOCK_MODE: "false",
  SENTINEL_STORAGE_MODE: "gcp-rest",
  SENTINEL_EVIDENCE_MODE: "production",
  SENTINEL_CLOUD_COST_CONTROLS_MODE: "production",
  SENTINEL_WORKSPACE_WEBHOOK_AUTH_MODE: "oidc",
  SENSITIVE_DATA_PROTECTION_ENABLED: "true"
};

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

const unsafeRawValuePatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bAIza[0-9A-Za-z_-]{20,}/u,
  /\bya29\.[0-9A-Za-z._-]+/u,
  /GOCSPX-[0-9A-Za-z_-]{20,}/u,
  /Bearer\s+(?!\[REDACTED\])[\w.~+/=-]+/iu,
  /\b(?:refresh_token|access_token|password|secret|api[_-]?key)\s*[:=]\s*[^,\s;]+/iu
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
  const secretAnnotations = parseSecretAnnotations(manifest);
  const image = extractScalar(manifest, "image") || "missing";
  const runtimeServiceAccount = extractScalar(manifest, "serviceAccountName") || "missing";
  const envChecks = [
    ...requiredNonSecretEnv.map((name) => checkNonSecretEnv(name, envByName.get(name))),
    ...requiredSecretEnv.flatMap((name) => [
      checkSecretEnv(name, envByName.get(name)),
      checkSecretAnnotation(name, envByName.get(name), secretAnnotations, envByName.get("GOOGLE_CLOUD_PROJECT_NUMBER")?.value)
    ]),
    ...prohibitedCredentialEnv.flatMap((item) => checkProhibitedCredentialEnv(item, envByName.get(item.name))),
    ...checkProductionValueInvariants(envByName, image, runtimeServiceAccount),
    ...checkDuplicateEnvEntries(envEntries),
    ...checkUnsafeRawEnvValues(envEntries)
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
  const commandManifestPath = manifestPath === defaultManifestPath ? defaultRenderedManifestPath : manifestPath;

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
    dryRunCommand: `gcloud run services replace ${commandManifestPath} --region ${deploymentRegion} --project ${projectId} --dry-run`,
    deployCommand: `gcloud run services replace ${commandManifestPath} --region ${deploymentRegion} --project ${projectId}`,
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
      "Cloud Run YAML secret env vars must have matching run.googleapis.com/secrets lookups for each Secret Manager resource.",
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

function parseSecretAnnotations(manifest: string) {
  const match = manifest.match(/run\.googleapis\.com\/secrets:\s*(?:"([^"]*)"|'([^']*)'|([^\n]*))/u);
  const rawAnnotation = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
  const annotations = new Map<string, string>();

  for (const item of rawAnnotation.split(",")) {
    const [lookupName, ...targetParts] = item.trim().split(":");
    const target = targetParts.join(":").trim();

    if (lookupName && target) {
      annotations.set(lookupName.trim(), target);
    }
  }

  return annotations;
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

function checkSecretAnnotation(
  envName: (typeof requiredSecretEnv)[number],
  entry: ParsedEnvEntry | undefined,
  annotations: Map<string, string>,
  projectNumber?: string
): CloudRunDeploymentEnvCheck {
  const lookupName = entry?.secretName || secretLookupNameByEnvName[envName];
  const annotationTarget = annotations.get(lookupName);
  const checkName = `${envName}_SECRET_ANNOTATION`;

  if (!annotationTarget) {
    return envCheck(
      checkName,
      "secret",
      "blocked",
      false,
      "missing",
      "Cloud Run YAML secret lookup is missing from run.googleapis.com/secrets.",
      `Add ${lookupName}:projects/PROJECT_NUMBER/secrets/${lookupName} to the Cloud Run secrets annotation.`
    );
  }

  if (hasPlaceholder(annotationTarget)) {
    return envCheck(
      checkName,
      "secret",
      "needs-value",
      false,
      annotationTarget,
      "Cloud Run YAML secret lookup still contains a project placeholder.",
      "Render GOOGLE_CLOUD_PROJECT_NUMBER into run.googleapis.com/secrets before Cloud Run dry-run."
    );
  }

  if (!annotationTarget.endsWith(`/secrets/${lookupName}`)) {
    return envCheck(
      checkName,
      "secret",
      "blocked",
      false,
      annotationTarget,
      "Cloud Run YAML secret lookup points at a different Secret Manager resource.",
      `Point ${lookupName} at projects/PROJECT_NUMBER/secrets/${lookupName}.`
    );
  }

  if (projectNumber && !hasPlaceholder(projectNumber) && annotationTarget !== `projects/${projectNumber}/secrets/${lookupName}`) {
    return envCheck(
      checkName,
      "secret",
      "blocked",
      false,
      annotationTarget,
      "Cloud Run YAML secret lookup points at a different Google Cloud project number than GOOGLE_CLOUD_PROJECT_NUMBER.",
      `Point ${lookupName} at projects/${projectNumber}/secrets/${lookupName}.`
    );
  }

  return envCheck(
    checkName,
    "secret",
    "passed",
    false,
    annotationTarget,
    "Cloud Run YAML secret lookup maps to a Secret Manager resource.",
    "No action."
  );
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

  if (!/^[1-9][0-9]*$/u.test(entry.secretVersion)) {
    return envCheck(
      name,
      "secret",
      "blocked",
      true,
      `${entry.secretName}:invalid-version`,
      "Secret Manager reference does not use a numeric reviewed version.",
      "Pin a numeric Secret Manager version before Cloud Run dry-run."
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

function checkProhibitedCredentialEnv(
  item: (typeof prohibitedCredentialEnv)[number],
  entry?: ParsedEnvEntry
): CloudRunDeploymentEnvCheck[] {
  if (!entry) {
    return [];
  }

  return [
    envCheck(
      item.name,
      "secret",
      "blocked",
      true,
      entry.secretName ? `secret:${entry.secretName}` : "raw-value",
      item.evidence,
      item.fix
    )
  ];
}

function checkDuplicateEnvEntries(envEntries: ParsedEnvEntry[]): CloudRunDeploymentEnvCheck[] {
  const counts = new Map<string, number>();

  for (const entry of envEntries) {
    counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name, count]) =>
      envCheck(
        `DUPLICATE_ENV_${name}`,
        requiredSecretEnvSet.has(name) ? "secret" : categoryForEnv(name),
        "blocked",
        requiredSecretEnvSet.has(name),
        `count:${count}`,
        "Cloud Run manifest contains duplicate env var names, which makes deployment evidence ambiguous.",
        `Keep exactly one ${name} env entry in cloudrun.service.yaml.`
      )
    );
}

function checkUnsafeRawEnvValues(envEntries: ParsedEnvEntry[]): CloudRunDeploymentEnvCheck[] {
  return envEntries
    .filter((entry) => entry.value && unsafeRawValuePatterns.some((pattern) => pattern.test(entry.value ?? "")))
    .map((entry) =>
      envCheck(
        `UNSAFE_RAW_VALUE_${entry.name}`,
        requiredSecretEnvSet.has(entry.name) ? "secret" : categoryForEnv(entry.name),
        "blocked",
        true,
        "raw-value",
        "Cloud Run manifest env value appears to contain a raw credential or secret-shaped token.",
        `Move any secret material for ${entry.name} to Secret Manager or remove it from the manifest.`
      )
    );
}

function checkProductionValueInvariants(
  envByName: Map<string, ParsedEnvEntry>,
  image: string,
  runtimeServiceAccount: string
): CloudRunDeploymentEnvCheck[] {
  const checks: CloudRunDeploymentEnvCheck[] = [];
  const projectId = cleanEnvValue(envByName, "GOOGLE_CLOUD_PROJECT");
  const projectNumber = cleanEnvValue(envByName, "GOOGLE_CLOUD_PROJECT_NUMBER");
  const region = cleanEnvValue(envByName, "SENTINEL_CLOUD_RUN_REGION");
  const productUrl = cleanEnvValue(envByName, "NEXT_PUBLIC_PRODUCT_URL");
  const billingAccountId = cleanEnvValue(envByName, "GOOGLE_CLOUD_BILLING_ACCOUNT_ID");
  const geminiModel = cleanEnvValue(envByName, "GEMINI_MODEL");
  const geminiAllowlist = cleanEnvValue(envByName, "SENTINEL_GEMINI_MODEL_ALLOWLIST");

  for (const [name, expectedValue] of Object.entries(fixedProductionEnvValues)) {
    const value = cleanEnvValue(envByName, name);
    if (value && value !== expectedValue) {
      checks.push(
        envCheck(
          `INVALID_VALUE_${name}`,
          categoryForEnv(name),
          "blocked",
          false,
          value,
          `${name} must be ${expectedValue} for the production Cloud Run deployment template.`,
          `Set ${name} to "${expectedValue}" before rendering the Cloud Run manifest.`
        )
      );
    }
  }

  for (const name of booleanEnv) {
    const value = cleanEnvValue(envByName, name);
    if (value && value !== "true" && value !== "false") {
      checks.push(
        envCheck(
          `INVALID_BOOLEAN_${name}`,
          categoryForEnv(name),
          "blocked",
          false,
          value,
          `${name} must be the literal string true or false.`,
          `Set ${name} to "true" only after evidence exists, otherwise keep "false".`
        )
      );
    }
  }

  if (projectId && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(projectId)) {
    checks.push(
      envCheck(
        "INVALID_GOOGLE_CLOUD_PROJECT",
        "google-cloud",
        "blocked",
        false,
        projectId,
        "GOOGLE_CLOUD_PROJECT does not look like a valid Google Cloud project id.",
        "Use the real lower-case Google Cloud project id before Cloud Run dry-run."
      )
    );
  }

  if (projectNumber && !/^[1-9][0-9]{5,20}$/u.test(projectNumber)) {
    checks.push(
      envCheck(
        "INVALID_GOOGLE_CLOUD_PROJECT_NUMBER",
        "google-cloud",
        "blocked",
        false,
        projectNumber,
        "GOOGLE_CLOUD_PROJECT_NUMBER does not look like a numeric Google Cloud project number.",
        "Use the numeric Google Cloud project number used by Secret Manager lookups."
      )
    );
  }

  if (productUrl && !isHttpsUrl(productUrl)) {
    checks.push(
      envCheck(
        "INVALID_NEXT_PUBLIC_PRODUCT_URL",
        "runtime",
        "blocked",
        false,
        productUrl,
        "NEXT_PUBLIC_PRODUCT_URL must be a hosted HTTPS URL, not localhost or plain HTTP.",
        "Use the final Cloud Run HTTPS service URL."
      )
    );
  }

  checks.push(
    ...checkHttpsUrl(envByName, "XPRIZE_REPOSITORY_URL", "xprize"),
    ...checkHttpsUrl(envByName, "XPRIZE_DEMO_VIDEO_URL", "xprize"),
    ...checkHttpsUrl(envByName, "GOOGLE_OAUTH_REDIRECT_URI", "workspace"),
    ...checkHttpsUrl(envByName, "WORKSPACE_PUBSUB_PUSH_AUDIENCE", "workspace")
  );

  if (productUrl && isHttpsUrl(productUrl)) {
    checks.push(
      ...checkExpectedUrl(envByName, "GOOGLE_OAUTH_REDIRECT_URI", `${trimTrailingSlash(productUrl)}/api/oauth/google/callback`),
      ...checkExpectedUrl(envByName, "WORKSPACE_PUBSUB_PUSH_AUDIENCE", `${trimTrailingSlash(productUrl)}/api/webhooks/pubsub/gmail`)
    );
  }

  if (projectId && !hasPlaceholder(projectId)) {
    checks.push(
      ...checkExpectedValue(envByName, "SENTINEL_BUDGET_PUBSUB_TOPIC", `projects/${projectId}/topics/sentinel-budget-alerts`, "cost"),
      ...checkExpectedValue(envByName, "WORKSPACE_GMAIL_TOPIC", `projects/${projectId}/topics/workspace-gmail-updates`, "workspace"),
      ...checkExpectedValue(envByName, "WORKSPACE_GMAIL_SUBSCRIPTION", `projects/${projectId}/subscriptions/workspace-gmail-push`, "workspace"),
      ...checkExpectedValue(envByName, "WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL", `workspace-push@${projectId}.iam.gserviceaccount.com`, "workspace")
    );

    if (runtimeServiceAccount !== "missing" && !hasPlaceholder(runtimeServiceAccount) && runtimeServiceAccount !== `sentinel-runtime@${projectId}.iam.gserviceaccount.com`) {
      checks.push(
        envCheck(
          "INVALID_CLOUD_RUN_SERVICE_ACCOUNT",
          "google-cloud",
          "blocked",
          false,
          runtimeServiceAccount,
          "Cloud Run runtime service account does not match GOOGLE_CLOUD_PROJECT.",
          `Use sentinel-runtime@${projectId}.iam.gserviceaccount.com or update the verifier only with a reviewed service-account policy.`
        )
      );
    }
  }

  if (projectId && region && image !== "missing" && !hasPlaceholder(image) && !image.startsWith(`${region}-docker.pkg.dev/${projectId}/`)) {
    checks.push(
      envCheck(
        "INVALID_CLOUD_RUN_IMAGE",
        "google-cloud",
        "blocked",
        false,
        image,
        "Container image registry does not match SENTINEL_CLOUD_RUN_REGION and GOOGLE_CLOUD_PROJECT.",
        "Render the image as REGION-docker.pkg.dev/PROJECT_ID/sentinel/web:RELEASE_ID."
      )
    );
  }

  if (billingAccountId && !/^[A-Z0-9]{6}-[A-Z0-9]{6}-[A-Z0-9]{6}$/u.test(billingAccountId)) {
    checks.push(
      envCheck(
        "INVALID_GOOGLE_CLOUD_BILLING_ACCOUNT_ID",
        "cost",
        "blocked",
        false,
        billingAccountId,
        "GOOGLE_CLOUD_BILLING_ACCOUNT_ID does not match the expected billing-account id shape.",
        "Use the real billing account id or keep the template placeholder until it is known."
      )
    );
  }

  if (billingAccountId) {
    const budgetId = cleanEnvValue(envByName, "SENTINEL_GCP_BUDGET_ID");
    if (budgetId && !budgetId.startsWith(`billingAccounts/${billingAccountId}/budgets/`)) {
      checks.push(
        envCheck(
          "INVALID_SENTINEL_GCP_BUDGET_ID",
          "cost",
          "blocked",
          false,
          budgetId,
          "SENTINEL_GCP_BUDGET_ID does not belong to GOOGLE_CLOUD_BILLING_ACCOUNT_ID.",
          "Render SENTINEL_GCP_BUDGET_ID from the same billing account id and reviewed budget id."
        )
      );
    }
  }

  if (projectNumber) {
    const geminiApiKeyId = cleanEnvValue(envByName, "SENTINEL_GEMINI_API_KEY_ID");
    if (geminiApiKeyId && !new RegExp(`^projects/${escapeRegExp(projectNumber)}/locations/global/keys/[A-Za-z0-9_-]+$`, "u").test(geminiApiKeyId)) {
      checks.push(
        envCheck(
          "INVALID_SENTINEL_GEMINI_API_KEY_ID",
          "gemini",
          "blocked",
          false,
          geminiApiKeyId,
          "SENTINEL_GEMINI_API_KEY_ID does not match the expected Google API key resource path.",
          "Render SENTINEL_GEMINI_API_KEY_ID as projects/PROJECT_NUMBER/locations/global/keys/KEY_ID."
        )
      );
    }
  }

  if (geminiModel && geminiAllowlist) {
    const allowed = geminiAllowlist.split(",").map((item) => item.trim()).filter(Boolean);
    if (!allowed.includes(geminiModel)) {
      checks.push(
        envCheck(
          "INVALID_GEMINI_MODEL_ALLOWLIST",
          "gemini",
          "blocked",
          false,
          geminiAllowlist,
          "GEMINI_MODEL is not present in SENTINEL_GEMINI_MODEL_ALLOWLIST.",
          "Add the selected Gemini model to the allowlist or choose an allowed model."
        )
      );
    }
  }

  return checks;
}

function checkHttpsUrl(
  envByName: Map<string, ParsedEnvEntry>,
  name: string,
  category: CloudRunDeploymentEnvCheck["category"]
): CloudRunDeploymentEnvCheck[] {
  const value = cleanEnvValue(envByName, name);
  if (!value || isHttpsUrl(value)) {
    return [];
  }

  return [
    envCheck(
      `INVALID_URL_${name}`,
      category,
      "blocked",
      false,
      value,
      `${name} must be an HTTPS URL before production deployment.`,
      `Set ${name} to a hosted HTTPS URL or keep the template placeholder until final evidence exists.`
    )
  ];
}

function checkExpectedUrl(envByName: Map<string, ParsedEnvEntry>, name: string, expectedValue: string): CloudRunDeploymentEnvCheck[] {
  const value = cleanEnvValue(envByName, name);
  if (!value || value === expectedValue) {
    return [];
  }

  return [
    envCheck(
      `MISMATCHED_${name}`,
      categoryForEnv(name),
      "blocked",
      false,
      value,
      `${name} does not match NEXT_PUBLIC_PRODUCT_URL.`,
      `Set ${name} to ${expectedValue}.`
    )
  ];
}

function checkExpectedValue(
  envByName: Map<string, ParsedEnvEntry>,
  name: string,
  expectedValue: string,
  category: CloudRunDeploymentEnvCheck["category"]
): CloudRunDeploymentEnvCheck[] {
  const value = cleanEnvValue(envByName, name);
  if (!value || value === expectedValue) {
    return [];
  }

  return [
    envCheck(
      `MISMATCHED_${name}`,
      category,
      "blocked",
      false,
      value,
      `${name} does not match the deployment project contract.`,
      `Set ${name} to ${expectedValue}.`
    )
  ];
}

function cleanEnvValue(envByName: Map<string, ParsedEnvEntry>, name: string) {
  const value = envByName.get(name)?.value;
  if (!value || hasPlaceholder(value)) {
    return "";
  }

  return value;
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
      "Run npm run render:cloudrun-manifest, verify the ignored rendered manifest, then execute the generated Cloud Run dry-run command.",
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

function isHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/u, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function redactSecretRef(value: string) {
  const [name, version] = value.split(":");
  return `${name}:version-${version ? "set" : "missing"}`;
}
