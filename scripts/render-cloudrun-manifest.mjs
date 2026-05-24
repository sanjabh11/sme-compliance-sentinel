/* global console, process, URL */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const deploymentContract = JSON.parse(
  readFileSync(new URL("../docs/deployment/cloudrun-deployment-contract.json", import.meta.url), "utf8")
);
const execFileAsync = promisify(execFile);
const defaultTemplate = "cloudrun.service.yaml";
const defaultOutDir = "artifacts/deployment";
const renderedFileName = "cloudrun.service.rendered.yaml";
const verifierFileName = "cloudrun-manifest-verifier.json";
const summaryFileName = "cloudrun-render-summary.json";
const dryRunCommandFileName = "cloudrun-dry-run-command.txt";
const deployCommandFileName = "cloudrun-deploy-command.txt";
const defaultValuesTemplatePath = "docs/deployment/cloudrun-render-values.template.json";

const renderValueKeys = deploymentContract.requiredNonSecretEnv ?? [];

const derivedValueKeys = [
  "SENTINEL_CLOUD_RUN_IMAGE",
  "SENTINEL_CLOUD_RUN_SERVICE_ACCOUNT_EMAIL",
  "SENTINEL_GCP_BUDGET_SHORT_ID",
  "SENTINEL_GEMINI_API_KEY_SHORT_ID"
];

const secretVersionKeys = (deploymentContract.requiredSecretEnv ?? []).map((entry) => entry.versionKey);

const secretVersionEnvNames = Object.fromEntries(
  (deploymentContract.requiredSecretEnv ?? []).map((entry) => [entry.versionKey, entry.envName])
);

const manualReviewValueKeys = deploymentContract.manualReviewEnv ?? [];

const prohibitedRawSecretKeys = [
  ...(deploymentContract.requiredSecretEnv ?? []).map((entry) => entry.envName),
  ...(deploymentContract.prohibitedCredentialEnv ?? [])
];

const prohibitedRenderedEnvKeys = prohibitedRawSecretKeys.filter(
  (key) => !Object.values(secretVersionEnvNames).includes(key)
);

const safeFileKeys = new Set([...renderValueKeys, ...derivedValueKeys, ...secretVersionKeys]);

const strictRequiredValueKeys = [
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_PROJECT_NUMBER",
  "SENTINEL_CLOUD_RUN_REGION",
  "SENTINEL_RELEASE_ID",
  "SENTINEL_SOURCE_COMMIT",
  "SENTINEL_SOURCE_COMMIT_AT",
  "SENTINEL_SOURCE_BRANCH",
  "SENTINEL_CLOUD_RUN_IMAGE",
  "SENTINEL_CLOUD_RUN_SERVICE_ACCOUNT_EMAIL",
  "SENTINEL_PRIVATE_EVIDENCE_BUCKET",
  "NEXT_PUBLIC_PRODUCT_URL",
  "XPRIZE_REPOSITORY_URL",
  "XPRIZE_REPOSITORY_ACCESS_MODE",
  "XPRIZE_REPOSITORY_JUDGE_ACCESS_EMAILS",
  "XPRIZE_CATEGORY",
  "XPRIZE_DEMO_VIDEO_URL",
  "XPRIZE_JUDGING_PERIOD_END_AT",
  "GOOGLE_CLOUD_BILLING_ACCOUNT_ID",
  "SENTINEL_GCP_BUDGET_ID",
  "SENTINEL_BUDGET_PUBSUB_TOPIC",
  "WORKSPACE_GMAIL_TOPIC",
  "WORKSPACE_GMAIL_SUBSCRIPTION",
  "WORKSPACE_PUBSUB_PUSH_AUDIENCE",
  "WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "SENTINEL_GEMINI_API_KEY_ID",
  "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS",
  "XPRIZE_ENTRANT_TYPE",
  ...secretVersionKeys
];

const renderValuesTemplate = {
  GOOGLE_CLOUD_PROJECT: "PROJECT_ID",
  GOOGLE_CLOUD_PROJECT_NUMBER: "PROJECT_NUMBER",
  SENTINEL_CLOUD_RUN_REGION: "us-central1",
  SENTINEL_RELEASE_ID: "RELEASE_ID",
  SENTINEL_SOURCE_COMMIT: "SOURCE_COMMIT",
  SENTINEL_SOURCE_COMMIT_AT: "SOURCE_COMMIT_AT",
  SENTINEL_SOURCE_BRANCH: "origin/main",
  NEXT_PUBLIC_PRODUCT_URL: "https://YOUR-SERVICE-URL",
  XPRIZE_REPOSITORY_URL: "https://github.com/sanjabh11/sme-compliance-sentinel",
  XPRIZE_REPOSITORY_ACCESS_CONFIGURED: "false",
  XPRIZE_REPOSITORY_ACCESS_MODE: "private-shared",
  XPRIZE_REPOSITORY_JUDGE_ACCESS_EMAILS: "testing@devpost.com,judging@hacker.fund",
  XPRIZE_CATEGORY: "Small Business Services",
  XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED: "false",
  XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED: "false",
  XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED: "false",
  XPRIZE_CATEGORY_IMPACT_EVIDENCE_CONFIGURED: "false",
  XPRIZE_AI_NATIVE_OPERATIONS_EVIDENCE_CONFIGURED: "false",
  XPRIZE_DEMO_VIDEO_URL: "https://youtu.be/YOUR_VIDEO",
  XPRIZE_DEMO_VIDEO_UNDER_3_MIN_CONFIRMED: "false",
  XPRIZE_DEMO_VIDEO_PUBLICLY_ACCESSIBLE_CONFIRMED: "false",
  XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED: "false",
  XPRIZE_DEMO_VIDEO_CUSTOMER_DATA_REDACTED_CONFIRMED: "false",
  XPRIZE_DEMO_VIDEO_ENGLISH_OR_SUBTITLED_CONFIRMED: "false",
  XPRIZE_JUDGE_ACCESS_CONFIGURED: "false",
  XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED: "false",
  XPRIZE_JUDGING_PERIOD_END_AT: "2026-09-15T17:00:00-07:00",
  XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED: "false",
  XPRIZE_GENERAL_ELIGIBILITY_CONFIRMED: "false",
  XPRIZE_REPRESENTATIVE_AUTHORIZED: "false",
  XPRIZE_ORGANIZATION_UNDER_25_CONFIRMED: "false",
  XPRIZE_CORPORATE_ID_CONFIGURED: "false",
  XPRIZE_NO_PROMOTION_ENTITY_CONFLICT_CONFIRMED: "false",
  XPRIZE_THIRD_PARTY_REVIEW_APPROVED: "false",
  XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED: "false",
  XPRIZE_EVIDENCE_RESPONSE_READY: "false",
  XPRIZE_TESTING_INSTRUCTIONS: "Provide hosted URL and private judge credentials in Devpost testing instructions; do not commit credentials.",
  XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED: "false",
  XPRIZE_REVENUE_BY_MONTH_EVIDENCE_CONFIGURED: "false",
  XPRIZE_TOTAL_COSTS_EVIDENCE_CONFIGURED: "false",
  XPRIZE_CAC_SPEND_EVIDENCE_CONFIGURED: "false",
  XPRIZE_REAL_USER_EVIDENCE_CONFIGURED: "false",
  XPRIZE_TESTIMONIAL_CONSENT_CONFIRMED: "false",
  XPRIZE_RELATED_PARTY_REVENUE_REVIEWED: "false",
  XPRIZE_PRODUCT_RUNNING_EVIDENCE_CONFIGURED: "false",
  XPRIZE_AGENT_EXECUTION_LOGS_CONFIGURED: "false",
  GOOGLE_CLOUD_BILLING_ACCOUNT_ID: "BILLING_ACCOUNT_ID",
  SENTINEL_GCP_BUDGET_SHORT_ID: "BUDGET_ID",
  GOOGLE_OAUTH_CLIENT_ID: "YOUR_OAUTH_CLIENT_ID.apps.googleusercontent.com",
  SENTINEL_GEMINI_API_KEY_SHORT_ID: "GEMINI_API_KEY_ID",
  SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS: "STATIC_EGRESS_IPS",
  SENTINEL_GEMINI_QUOTA_EVIDENCE_CONFIRMED: "false",
  XPRIZE_ENTRANT_TYPE: "team",
  SENTINEL_ADMIN_ACTION_TOKEN_VERSION: "1",
  GEMINI_API_KEY_VERSION: "1",
  GOOGLE_OAUTH_CLIENT_SECRET_VERSION: "1",
  SENTINEL_EVIDENCE_SIGNING_SECRET_VERSION: "1",
  WORKSPACE_DRIVE_CHANNEL_TOKEN_VERSION: "1"
};

export function parseArgs(argv) {
  const args = {
    template: defaultTemplate,
    valuesPath: "",
    outDir: process.env.SENTINEL_CLOUD_RUN_RENDER_OUT_DIR ?? defaultOutDir,
    releaseId: process.env.SENTINEL_RELEASE_ID ?? "",
    strict: false,
    writeValuesTemplatePath: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (isRawSecretArg(arg)) {
      throw new Error("Raw secret CLI args are not supported. Put only non-secret render values in --values JSON.");
    }

    if (arg === "--template") {
      args.template = argv[index + 1] ?? defaultTemplate;
      index += 1;
      continue;
    }

    if (arg.startsWith("--template=")) {
      args.template = arg.slice("--template=".length) || defaultTemplate;
      continue;
    }

    if (arg === "--values") {
      args.valuesPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--values=")) {
      args.valuesPath = arg.slice("--values=".length);
      continue;
    }

    if (arg === "--out-dir") {
      args.outDir = argv[index + 1] ?? defaultOutDir;
      index += 1;
      continue;
    }

    if (arg.startsWith("--out-dir=")) {
      args.outDir = arg.slice("--out-dir=".length) || defaultOutDir;
      continue;
    }

    if (arg === "--release-id") {
      args.releaseId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--release-id=")) {
      args.releaseId = arg.slice("--release-id=".length);
      continue;
    }

    if (arg === "--write-values-template") {
      args.writeValuesTemplatePath = argv[index + 1] ?? defaultValuesTemplatePath;
      index += 1;
      continue;
    }

    if (arg.startsWith("--write-values-template=")) {
      args.writeValuesTemplatePath = arg.slice("--write-values-template=".length) || defaultValuesTemplatePath;
      continue;
    }

    if (arg === "--strict") {
      args.strict = true;
    }
  }

  return args;
}

export async function renderCloudRunManifest(options) {
  const fileValues = await loadValuesFile(options.valuesPath);
  const renderValues = buildRenderValues(fileValues);
  assertReleaseIdConsistency(options.releaseId, renderValues.SENTINEL_RELEASE_ID);
  if (options.strict) {
    assertStrictRenderValues(renderValues);
  }
  const releaseId = sanitizePathSegment(options.releaseId || renderValues.SENTINEL_RELEASE_ID || "release-candidate");
  const outputDirectory = resolve(options.outDir ?? defaultOutDir, releaseId);
  await mkdir(outputDirectory, { recursive: true });

  const templatePath = options.template ?? defaultTemplate;
  const template = await readFile(templatePath, "utf8");
  const renderedManifest = renderManifest(template, renderValues);
  assertNoUnsafeRenderedSecrets(renderedManifest);

  const renderedManifestPath = join(outputDirectory, renderedFileName);
  await writeFile(renderedManifestPath, renderedManifest, "utf8");

  const verifier = await runManifestVerifier(renderedManifestPath);
  await writeJson(join(outputDirectory, verifierFileName), verifier);

  const projectId = renderValues.GOOGLE_CLOUD_PROJECT || verifier.projectId || "PROJECT_ID";
  const region = renderValues.SENTINEL_CLOUD_RUN_REGION || "REGION";
  const dryRunCommand = `gcloud run services replace ${shellQuote(renderedManifestPath)} --region ${shellQuote(region)} --project ${shellQuote(projectId)} --dry-run`;
  const deployCommand = `gcloud run services replace ${shellQuote(renderedManifestPath)} --region ${shellQuote(region)} --project ${shellQuote(projectId)}`;
  await writeFile(join(outputDirectory, dryRunCommandFileName), `${dryRunCommand}\n`, "utf8");
  await writeFile(join(outputDirectory, deployCommandFileName), `${deployCommand}\n`, "utf8");

  const summary = {
    generatedAt: new Date().toISOString(),
    status: verifier.overallStatus,
    templatePath,
    outputDirectory,
    releaseId,
    renderedManifestPath,
    verifierFile: verifierFileName,
    dryRunCommandFile: dryRunCommandFileName,
    deployCommandFile: deployCommandFileName,
    dryRunCommand,
    deployCommand,
    appliedValueKeys: Object.keys(renderValues).sort(),
    secretVersionKeys: Object.entries(secretVersionEnvNames)
      .filter(([versionKey]) => Boolean(renderValues[versionKey]))
      .map(([versionKey, envName]) => ({ envName, versionKey })),
    verification: {
      overallStatus: verifier.overallStatus,
      replacementCount: verifier.replacementFindings?.length ?? 0,
      blockerCount: verifier.blockers?.length ?? 0,
      secretRefCount: verifier.secretRefs?.length ?? 0
    },
    privateHandling: [
      "The rendered manifest and command files are private deployment artifacts and are ignored by Git.",
      "The renderer accepts non-secret deployment values and numeric Secret Manager versions only.",
      "Do not place API keys, OAuth secrets, refresh tokens, service-account key files, judge credentials, invoices, or customer findings in render values.",
      "A ready-to-dry-run render is still not hosted proof; Cloud Run dry-run/deploy output and hosted verification must be captured separately."
    ],
    nextActions:
      verifier.overallStatus === "ready-to-dry-run"
        ? [
            "Run the generated dry-run command from a private operator shell and store the output in the private evidence packet.",
            "Deploy only after dry-run review, then run hosted production verification and the hosted proof collector."
          ]
        : [
            "Review cloudrun-manifest-verifier.json, fill remaining non-secret values, and rerun this renderer.",
            "Keep human attestation flags false until the corresponding private evidence exists."
          ],
    disclaimer:
      "This renderer creates a private deployment candidate and local verifier output. It does not deploy Cloud Run or prove production readiness."
  };
  await writeJson(join(outputDirectory, summaryFileName), summary);

  if (options.strict && verifier.overallStatus !== "ready-to-dry-run") {
    const error = new Error(`Rendered manifest is ${verifier.overallStatus}; see ${join(outputDirectory, verifierFileName)}.`);
    error.summary = summary;
    throw error;
  }

  return summary;
}

export function buildRenderValuesTemplate() {
  return { ...renderValuesTemplate };
}

export function getCloudRunRenderContractSummary() {
  return {
    renderValueKeys: [...renderValueKeys],
    manualReviewValueKeys: [...manualReviewValueKeys],
    secretVersionKeys: [...secretVersionKeys],
    secretVersionEnvNames: { ...secretVersionEnvNames },
    prohibitedRawSecretKeys: [...prohibitedRawSecretKeys]
  };
}

export async function writeRenderValuesTemplate(outputPath = defaultValuesTemplatePath) {
  const absolutePath = resolve(outputPath || defaultValuesTemplatePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeJson(absolutePath, buildRenderValuesTemplate());

  return {
    generatedAt: new Date().toISOString(),
    path: absolutePath,
    keyCount: Object.keys(renderValuesTemplate).length,
    privateHandling:
      "This is a non-secret template. Copy it to a private path, replace placeholders with reviewed production values, and keep filled values out of Git."
  };
}

export async function auditCloudRunRenderValues(options = {}) {
  if (!options.valuesPath) {
    throw new Error("Cloud Run render-values audit requires --values /private/path/cloudrun-render-values.json.");
  }

  const fileValues = await loadValuesFile(options.valuesPath);
  const renderValues = buildRenderValues(fileValues);
  const missingStrictKeys = strictRequiredValueKeys.filter((key) => isMissingStrictValue(renderValues[key]));
  const placeholderKeys = Object.entries(renderValues)
    .filter(([, value]) => hasTemplatePlaceholder(String(value)))
    .map(([key]) => key)
    .sort();
  const releaseIdConsistency = buildReleaseIdConsistency(options.releaseId, renderValues.SENTINEL_RELEASE_ID);
  const valueConsistencyChecks = buildValueConsistencyChecks(renderValues, releaseIdConsistency);
  const valueConsistencyBlockers = valueConsistencyChecks.filter((check) => check.status === "blocked");
  const derivedValues = derivedValueKeys.map((key) => ({
    key,
    status: fileValues[key] !== undefined ? "provided" : renderValues[key] !== undefined ? "derived" : "unused"
  }));
  const manualReviewFlags = manualReviewValueKeys.map((key) => ({
    key,
    status: renderValues[key] === "true" ? "attested" : "not-attested",
    requiredBeforePublicClaim: true
  }));
  const secretVersionKeysStatus = Object.entries(secretVersionEnvNames).map(([versionKey, envName]) => ({
    envName,
    versionKey,
    status: isMissingStrictValue(renderValues[versionKey]) ? "needs-value" : "version-set"
  }));
  const releaseId = String(options.releaseId || renderValues.SENTINEL_RELEASE_ID || "release-candidate");
  const status = releaseIdConsistency.blocking
    ? "release-id-mismatch"
    : missingStrictKeys.length
      ? "needs-values"
      : valueConsistencyBlockers.length
        ? "value-consistency-blocked"
        : "ready-to-render";

  return {
    generatedAt: new Date().toISOString(),
    status,
    readyForStrictRender: status === "ready-to-render",
    releaseId,
    releaseIdConsistency,
    valuesPath: options.valuesPath,
    sourceValueKeyCount: Object.keys(fileValues).length,
    appliedValueKeyCount: Object.keys(renderValues).length,
    missingStrictKeys,
    placeholderKeys,
    valueConsistencyChecks,
    valueConsistencyBlockers,
    derivedValues,
    manualReviewFlags,
    secretVersionKeys: secretVersionKeysStatus,
    stopConditions: buildAuditStopConditions({ missingStrictKeys, placeholderKeys, releaseIdConsistency, valueConsistencyBlockers }),
    redactionChecklist: [
      "Keep the filled render-values file private; it can expose project ids, URLs, budget ids, and evidence-state decisions.",
      "Never place raw API keys, OAuth secrets, refresh tokens, service-account key paths, judge credentials, invoices, or customer findings in render values.",
      "Before sharing this audit packet, review valuesPath, project ids, URLs, billing ids, and evidence-state flags for customer or operator sensitivity.",
      "Only mark manual XPRIZE/evidence flags true after the private proof exists and the responsible owner has reviewed it."
    ],
    nextActions: buildAuditNextActions({ missingStrictKeys, releaseIdConsistency, valueConsistencyBlockers }),
    disclaimer:
      "This audit validates the private render-values input before rendering a Cloud Run manifest. It does not deploy Cloud Run, call Gemini, prove Workspace sync, or prove XPRIZE business evidence."
  };
}

async function loadValuesFile(valuesPath) {
  if (!valuesPath) {
    return {};
  }

  const parsed = JSON.parse(await readFile(valuesPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--values must point to a JSON object of non-secret render values.");
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (prohibitedRawSecretKeys.includes(key)) {
      throw new Error(`Render values must not include raw secret key ${key}.`);
    }
    if (!safeFileKeys.has(key)) {
      throw new Error(`Unsupported render value key ${key}. Add only approved non-secret deployment fields.`);
    }
    assertSafeValue(key, value);
  }

  return parsed;
}

function buildRenderValues(fileValues) {
  const values = {};

  for (const key of [...renderValueKeys, ...derivedValueKeys, ...secretVersionKeys]) {
    const value = fileValues[key] ?? process.env[key];
    if (value !== undefined && value !== "") {
      assertSafeValue(key, value);
      values[key] = String(value);
    }
  }

  const projectId = values.GOOGLE_CLOUD_PROJECT;
  const projectNumber = values.GOOGLE_CLOUD_PROJECT_NUMBER;
  const region = values.SENTINEL_CLOUD_RUN_REGION || "us-central1";
  const releaseId = values.SENTINEL_RELEASE_ID;
  const productUrl = trimTrailingSlash(values.NEXT_PUBLIC_PRODUCT_URL);
  const billingAccountId = values.GOOGLE_CLOUD_BILLING_ACCOUNT_ID;

  values.SENTINEL_CLOUD_RUN_REGION ||= region;
  if (projectId) {
    values.SENTINEL_PRIVATE_EVIDENCE_BUCKET ||= `gs://${projectId}-sentinel-private-evidence`;
    values.SENTINEL_BUDGET_PUBSUB_TOPIC ||= `projects/${projectId}/topics/sentinel-budget-alerts`;
    values.WORKSPACE_GMAIL_TOPIC ||= `projects/${projectId}/topics/workspace-gmail-updates`;
    values.WORKSPACE_GMAIL_SUBSCRIPTION ||= `projects/${projectId}/subscriptions/workspace-gmail-push`;
    values.WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL ||= `workspace-push@${projectId}.iam.gserviceaccount.com`;
    values.SENTINEL_CLOUD_RUN_SERVICE_ACCOUNT_EMAIL ||= `sentinel-runtime@${projectId}.iam.gserviceaccount.com`;
    values.SENTINEL_CLOUD_RUN_IMAGE ||= `${region}-docker.pkg.dev/${projectId}/sentinel/web:${dockerTag(releaseId || "latest")}`;
  }

  if (productUrl) {
    values.NEXT_PUBLIC_PRODUCT_URL = productUrl;
    values.WORKSPACE_PUBSUB_PUSH_AUDIENCE ||= `${productUrl}/api/webhooks/pubsub/gmail`;
    values.GOOGLE_OAUTH_REDIRECT_URI ||= `${productUrl}/api/oauth/google/callback`;
  }

  if (billingAccountId && values.SENTINEL_GCP_BUDGET_SHORT_ID && !values.SENTINEL_GCP_BUDGET_ID) {
    values.SENTINEL_GCP_BUDGET_ID = `billingAccounts/${billingAccountId}/budgets/${values.SENTINEL_GCP_BUDGET_SHORT_ID}`;
  }

  if (projectNumber && values.SENTINEL_GEMINI_API_KEY_SHORT_ID && !values.SENTINEL_GEMINI_API_KEY_ID) {
    values.SENTINEL_GEMINI_API_KEY_ID = `projects/${projectNumber}/locations/global/keys/${values.SENTINEL_GEMINI_API_KEY_SHORT_ID}`;
  }

  return values;
}

function assertStrictRenderValues(values) {
  const missing = strictRequiredValueKeys.filter((key) => isMissingStrictValue(values[key]));

  if (missing.length) {
    throw new Error(
      `Strict Cloud Run render values missing or placeholder: ${missing.join(", ")}. Copy ${defaultValuesTemplatePath} to a private path, fill production values, and rerun with --strict.`
    );
  }
}

function assertReleaseIdConsistency(requestedReleaseId, valueReleaseId) {
  const consistency = buildReleaseIdConsistency(requestedReleaseId, valueReleaseId);

  if (consistency.blocking) {
    throw new Error(consistency.fix);
  }
}

function buildValueConsistencyChecks(values, releaseIdConsistency) {
  const productUrl = trimTrailingSlash(values.NEXT_PUBLIC_PRODUCT_URL);
  const normalizedReleaseId =
    releaseIdConsistency.normalizedValueReleaseId ||
    releaseIdConsistency.normalizedRequestedReleaseId ||
    sanitizePathSegment(values.SENTINEL_RELEASE_ID || "");
  const expectedDockerTag = dockerTag(normalizedReleaseId || values.SENTINEL_RELEASE_ID || "");
  const projectId = values.GOOGLE_CLOUD_PROJECT;
  const projectNumber = values.GOOGLE_CLOUD_PROJECT_NUMBER;
  const billingAccountId = values.GOOGLE_CLOUD_BILLING_ACCOUNT_ID;
  const region = values.SENTINEL_CLOUD_RUN_REGION || "us-central1";
  const repositoryAccessMode = String(values.XPRIZE_REPOSITORY_ACCESS_MODE ?? "");
  const repositoryJudgeAccessEmails = parseCsv(values.XPRIZE_REPOSITORY_JUDGE_ACCESS_EMAILS).map((email) => email.toLowerCase());
  const requiredRepositoryJudgeEmails = ["testing@devpost.com", "judging@hacker.fund"];
  const requiredJudgingPeriodEndAt = "2026-09-15T17:00:00-07:00";

  return [
    valueCheck(
      "source-commit-shape",
      "SENTINEL_SOURCE_COMMIT",
      /^[a-f0-9]{40}$/iu.test(String(values.SENTINEL_SOURCE_COMMIT ?? "")),
      "Use the 40-character Git commit SHA that produced the container image."
    ),
    valueCheck(
      "source-commit-time",
      "SENTINEL_SOURCE_COMMIT_AT",
      isIsoTimestamp(values.SENTINEL_SOURCE_COMMIT_AT),
      "Use the exact ISO timestamp for the deployed source commit."
    ),
    valueCheck(
      "hosted-product-url",
      "NEXT_PUBLIC_PRODUCT_URL",
      isPublicHttpsUrl(productUrl),
      "Use the public HTTPS Cloud Run/custom-domain URL, not localhost, HTTP, or a placeholder."
    ),
    valueCheck(
      "demo-video-host",
      "XPRIZE_DEMO_VIDEO_URL",
      isAcceptedDemoVideoUrl(values.XPRIZE_DEMO_VIDEO_URL),
      "Use a public YouTube, Vimeo, or Youku demo URL before strict render."
    ),
    valueCheck(
      "repository-access-mode",
      "XPRIZE_REPOSITORY_ACCESS_MODE",
      ["public", "private-shared"].includes(repositoryAccessMode),
      "Set repository access mode to public or private-shared."
    ),
    valueCheck(
      "repository-judge-access-emails",
      "XPRIZE_REPOSITORY_JUDGE_ACCESS_EMAILS",
      repositoryAccessMode !== "private-shared" ||
        requiredRepositoryJudgeEmails.every((email) => repositoryJudgeAccessEmails.includes(email)),
      "For private-shared repositories, include testing@devpost.com and judging@hacker.fund."
    ),
    valueCheck(
      "judging-period-end",
      "XPRIZE_JUDGING_PERIOD_END_AT",
      isTimestampAtOrAfter(values.XPRIZE_JUDGING_PERIOD_END_AT, requiredJudgingPeriodEndAt),
      `Keep judge access available through ${requiredJudgingPeriodEndAt} or later if official rules change.`
    ),
    valueCheck(
      "category-fit",
      "XPRIZE_CATEGORY",
      values.XPRIZE_CATEGORY === "Small Business Services",
      "Keep the deployment category aligned to Small Business Services unless strategy is formally changed."
    ),
    valueCheck(
      "entrant-type",
      "XPRIZE_ENTRANT_TYPE",
      ["individual", "team", "organization"].includes(String(values.XPRIZE_ENTRANT_TYPE ?? "")),
      "Set XPRIZE_ENTRANT_TYPE to individual, team, or organization after human review."
    ),
    valueCheck(
      "cloud-run-image-release",
      "SENTINEL_CLOUD_RUN_IMAGE",
      String(values.SENTINEL_CLOUD_RUN_IMAGE ?? "").startsWith(`${region}-docker.pkg.dev/${projectId}/`) &&
        String(values.SENTINEL_CLOUD_RUN_IMAGE ?? "").endsWith(`:${expectedDockerTag}`),
      "Use the Artifact Registry image in the selected project/region and tag it with SENTINEL_RELEASE_ID."
    ),
    valueCheck(
      "cloud-run-service-account-project",
      "SENTINEL_CLOUD_RUN_SERVICE_ACCOUNT_EMAIL",
      String(values.SENTINEL_CLOUD_RUN_SERVICE_ACCOUNT_EMAIL ?? "") === `sentinel-runtime@${projectId}.iam.gserviceaccount.com`,
      "Use the dedicated sentinel-runtime service account in the production project."
    ),
    valueCheck(
      "private-evidence-bucket-project",
      "SENTINEL_PRIVATE_EVIDENCE_BUCKET",
      String(values.SENTINEL_PRIVATE_EVIDENCE_BUCKET ?? "") === `gs://${projectId}-sentinel-private-evidence`,
      "Use the private evidence bucket derived from the production Google Cloud project."
    ),
    valueCheck(
      "oauth-redirect-product-url",
      "GOOGLE_OAUTH_REDIRECT_URI",
      values.GOOGLE_OAUTH_REDIRECT_URI === `${productUrl}/api/oauth/google/callback`,
      "Keep the OAuth callback bound to NEXT_PUBLIC_PRODUCT_URL."
    ),
    valueCheck(
      "pubsub-push-audience-product-url",
      "WORKSPACE_PUBSUB_PUSH_AUDIENCE",
      values.WORKSPACE_PUBSUB_PUSH_AUDIENCE === `${productUrl}/api/webhooks/pubsub/gmail`,
      "Keep the Pub/Sub push audience bound to the hosted Gmail webhook URL."
    ),
    valueCheck(
      "gmail-topic-project",
      "WORKSPACE_GMAIL_TOPIC",
      String(values.WORKSPACE_GMAIL_TOPIC ?? "").startsWith(`projects/${projectId}/topics/`),
      "Use a Gmail Pub/Sub topic in the production Google Cloud project."
    ),
    valueCheck(
      "gmail-subscription-project",
      "WORKSPACE_GMAIL_SUBSCRIPTION",
      String(values.WORKSPACE_GMAIL_SUBSCRIPTION ?? "").startsWith(`projects/${projectId}/subscriptions/`),
      "Use a Gmail Pub/Sub subscription in the production Google Cloud project."
    ),
    valueCheck(
      "pubsub-service-account-project",
      "WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL",
      String(values.WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL ?? "") === `workspace-push@${projectId}.iam.gserviceaccount.com`,
      "Use the dedicated workspace-push service account in the production project."
    ),
    valueCheck(
      "budget-resource-billing-account",
      "SENTINEL_GCP_BUDGET_ID",
      String(values.SENTINEL_GCP_BUDGET_ID ?? "").startsWith(`billingAccounts/${billingAccountId}/budgets/`),
      "Use a Cloud Billing budget resource under GOOGLE_CLOUD_BILLING_ACCOUNT_ID."
    ),
    valueCheck(
      "budget-pubsub-topic-project",
      "SENTINEL_BUDGET_PUBSUB_TOPIC",
      String(values.SENTINEL_BUDGET_PUBSUB_TOPIC ?? "").startsWith(`projects/${projectId}/topics/`),
      "Use a budget-alert Pub/Sub topic in the production Google Cloud project."
    ),
    valueCheck(
      "gemini-api-key-project-number",
      "SENTINEL_GEMINI_API_KEY_ID",
      String(values.SENTINEL_GEMINI_API_KEY_ID ?? "").startsWith(`projects/${projectNumber}/locations/global/keys/`),
      "Use the Gemini API key resource id from GOOGLE_CLOUD_PROJECT_NUMBER."
    ),
    valueCheck(
      "gemini-ip-allowlist",
      "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS",
      parseCsv(values.SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS).every(isIpv4Address),
      "Use a comma-separated allowlist of concrete server IPv4 addresses; do not use wildcards or placeholders."
    ),
    ...secretVersionKeys.map((key) =>
      valueCheck(
        `secret-version-${key.toLowerCase()}`,
        key,
        /^[1-9][0-9]*$/u.test(String(values[key] ?? "")),
        `${key} must be a positive numeric Secret Manager version.`
      )
    )
  ];
}

function valueCheck(id, key, passed, fix) {
  return {
    id,
    key,
    status: passed ? "passed" : "blocked",
    fix
  };
}

function renderManifest(template, values) {
  let rendered = template;

  if (values.SENTINEL_CLOUD_RUN_IMAGE) {
    rendered = rendered.replace(/(\n\s+-\s+image:\s*)[^\n]+/u, `$1${values.SENTINEL_CLOUD_RUN_IMAGE}`);
  }

  if (values.SENTINEL_CLOUD_RUN_SERVICE_ACCOUNT_EMAIL) {
    rendered = rendered.replace(
      /(\n\s+serviceAccountName:\s*)[^\n]+/u,
      `$1${values.SENTINEL_CLOUD_RUN_SERVICE_ACCOUNT_EMAIL}`
    );
  }

  if (values.GOOGLE_CLOUD_PROJECT_NUMBER) {
    rendered = rendered.replace(
      /projects\/PROJECT_NUMBER\/secrets\//gu,
      `projects/${values.GOOGLE_CLOUD_PROJECT_NUMBER}/secrets/`
    );
  }

  for (const key of renderValueKeys) {
    if (values[key] !== undefined) {
      rendered = replaceEnvValue(rendered, key, values[key]);
    }
  }

  for (const [versionKey, envName] of Object.entries(secretVersionEnvNames)) {
    if (values[versionKey] !== undefined) {
      rendered = replaceSecretVersion(rendered, envName, values[versionKey]);
    }
  }

  return rendered;
}

function replaceEnvValue(manifest, name, value) {
  const pattern = new RegExp(`(- name: ${escapeRegExp(name)}\\n)([\\s\\S]*?)(?=\\n\\s+- name: [A-Z0-9_]+\\n|$)`, "u");

  return manifest.replace(pattern, (match, prefix, body) => {
    if (!/(?:^|\n)\s+value:\s*"/u.test(body)) {
      return match;
    }

    return `${prefix}${body.replace(/(^|\n)(\s+)value:\s*"[^"]*"/u, `$1$2value: ${JSON.stringify(String(value))}`)}`;
  });
}

function replaceSecretVersion(manifest, envName, version) {
  if (!/^[1-9][0-9]*$/u.test(String(version))) {
    throw new Error(`${envName} Secret Manager version must be a positive numeric version.`);
  }

  const pattern = new RegExp(`(- name: ${escapeRegExp(envName)}\\n)([\\s\\S]*?)(?=\\n\\s+- name: [A-Z0-9_]+\\n|$)`, "u");

  return manifest.replace(pattern, (match, prefix, body) => {
    if (!/secretKeyRef:/u.test(body)) {
      return match;
    }

    return `${prefix}${body.replace(/\n(\s+)key:\s*"[^"]*"/u, `\n$1key: ${JSON.stringify(String(version))}`)}`;
  });
}

async function runManifestVerifier(renderedManifestPath) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["scripts/verify-cloudrun-deployment.mjs", `--manifest=${renderedManifestPath}`],
    { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 5 }
  );

  return JSON.parse(stdout);
}

function assertSafeValue(key, value) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new Error(`Render value ${key} must be a string, number, or boolean.`);
  }

  const text = String(value);
  const unsafePatterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
    /\bAIza[0-9A-Za-z_-]{20,}/u,
    /\bya29\.[0-9A-Za-z._-]+/u,
    /GOCSPX-[0-9A-Za-z_-]{20,}/u,
    /Bearer\s+(?!\[REDACTED\])[\w.~+/=-]+/iu,
    /\b(?:refresh_token|access_token|password|secret|api[_-]?key)\s*[:=]\s*[^,\s;]+/iu
  ];

  if (unsafePatterns.some((pattern) => pattern.test(text))) {
    throw new Error(`Render value ${key} appears to contain a raw secret or credential.`);
  }
}

function isMissingStrictValue(value) {
  return value === undefined || value === "" || hasTemplatePlaceholder(String(value));
}

function hasTemplatePlaceholder(value) {
  return [
    /PROJECT_ID/u,
    /PROJECT_NUMBER/u,
    /YOUR[-_A-Z0-9]*/u,
    /BILLING_ACCOUNT_ID/u,
    /BUDGET_ID/u,
    /GEMINI_API_KEY_ID/u,
    /RELEASE_ID/u,
    /SOURCE_COMMIT/u,
    /SOURCE_COMMIT_AT/u,
    /STATIC_EGRESS_IPS/u
  ].some((pattern) => pattern.test(value));
}

function assertNoUnsafeRenderedSecrets(renderedManifest) {
  for (const secretKey of prohibitedRenderedEnvKeys) {
    if (renderedManifest.includes(`- name: ${secretKey}`)) {
      throw new Error(`Rendered manifest includes prohibited credential env ${secretKey}.`);
    }
  }

  for (const envName of Object.values(secretVersionEnvNames)) {
    const pattern = new RegExp(`- name: ${escapeRegExp(envName)}\\n([\\s\\S]*?)(?=\\n\\s+- name: [A-Z0-9_]+\\n|$)`, "u");
    const block = renderedManifest.match(pattern)?.[1] ?? "";

    if (/(?:^|\n)\s+value:\s*"/u.test(block)) {
      throw new Error(`Rendered manifest includes raw value for secret env ${envName}.`);
    }
  }

  const unsafeCredentialPatterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
    /\bAIza[0-9A-Za-z_-]{20,}/u,
    /\bya29\.[0-9A-Za-z._-]+/u,
    /GOCSPX-[0-9A-Za-z_-]{20,}/u,
    /Bearer\s+(?!\[REDACTED\])[\w.~+/=-]+/iu
  ];

  if (unsafeCredentialPatterns.some((pattern) => pattern.test(renderedManifest))) {
    throw new Error("Rendered manifest appears to contain a raw credential.");
  }
}

function buildAuditStopConditions({ missingStrictKeys, placeholderKeys, releaseIdConsistency, valueConsistencyBlockers }) {
  if (releaseIdConsistency.blocking) {
    return [
      "Do not render or dry-run while the CLI release id and SENTINEL_RELEASE_ID disagree.",
      releaseIdConsistency.fix
    ];
  }

  if (missingStrictKeys.length) {
    return [
      "Do not run strict render or Cloud Run dry-run while required render values are missing or placeholder-shaped.",
      ...missingStrictKeys.slice(0, 8).map((key) => `${key}: fill a reviewed non-secret production value.`)
    ];
  }

  if (valueConsistencyBlockers.length) {
    return [
      "Do not render or dry-run while production render values are stale, mismatched, or invalid.",
      ...valueConsistencyBlockers.slice(0, 8).map((check) => `${check.key}: ${check.fix}`)
    ];
  }

  if (placeholderKeys.length) {
    return [
      "Review placeholder-shaped optional values before dry-run.",
      ...placeholderKeys.slice(0, 8).map((key) => `${key}: still appears placeholder-shaped.`)
    ];
  }

  return [
    "Stop if the rendered manifest verifier reports blockers or replacement findings.",
    "Stop if the dry-run command references a different release id, source commit, project, region, image, or service account than this audit."
  ];
}

function buildAuditNextActions({ missingStrictKeys, releaseIdConsistency, valueConsistencyBlockers }) {
  if (releaseIdConsistency.blocking) {
    return [
      "Use the same non-placeholder release id in --release-id and SENTINEL_RELEASE_ID.",
      "Regenerate the render-values audit before rendering the Cloud Run manifest.",
      "Keep source commit, image tag, Cloud Run revision, hosted proof, and Evidence Vault imports bound to that release id."
    ];
  }

  if (missingStrictKeys.length) {
    return [
      "Fill the missing non-secret values in the private render-values file.",
      "Keep manual evidence flags false until private proof exists.",
      "Rerun this audit before rendering the Cloud Run manifest."
    ];
  }

  if (valueConsistencyBlockers.length) {
    return [
      "Fix blocked value-consistency checks in the private render-values file.",
      "Regenerate this audit before rendering the Cloud Run manifest.",
      "Keep release id, source commit, product URL, OAuth, Pub/Sub, billing, Gemini key, and Secret Manager versions bound to the same deployment."
    ];
  }

  return [
    "Run npm run render:cloudrun-manifest with the same private values file and --strict.",
    "Run npm run prepare:cloudrun-dry-run with the same private values file and --strict.",
    "Preserve the audit packet, render summary, verifier JSON, and preflight packet in the private evidence store."
  ];
}

function buildReleaseIdConsistency(requestedReleaseId, valueReleaseId) {
  const requested = String(requestedReleaseId || "").trim();
  const value = String(valueReleaseId || "").trim();
  const requestedPlaceholder = Boolean(requested && hasTemplatePlaceholder(requested));
  const valuePlaceholder = Boolean(value && hasTemplatePlaceholder(value));
  const normalizedRequested = requested && !requestedPlaceholder ? sanitizePathSegment(requested) : "";
  const normalizedValue = value && !valuePlaceholder ? sanitizePathSegment(value) : "";

  if (requestedPlaceholder) {
    return {
      status: "requested-placeholder",
      blocking: true,
      requestedReleaseId: requested,
      valueReleaseId: value || "missing",
      normalizedRequestedReleaseId: "",
      normalizedValueReleaseId: normalizedValue,
      fix: "--release-id is still placeholder-shaped. Use the reviewed SENTINEL_RELEASE_ID value before rendering."
    };
  }

  if (normalizedRequested && normalizedValue && normalizedRequested !== normalizedValue) {
    return {
      status: "mismatch",
      blocking: true,
      requestedReleaseId: requested,
      valueReleaseId: value,
      normalizedRequestedReleaseId: normalizedRequested,
      normalizedValueReleaseId: normalizedValue,
      fix: `--release-id (${normalizedRequested}) does not match SENTINEL_RELEASE_ID (${normalizedValue}). Rerun with one reviewed release id.`
    };
  }

  if (normalizedRequested && normalizedValue) {
    return {
      status: "matched",
      blocking: false,
      requestedReleaseId: requested,
      valueReleaseId: value,
      normalizedRequestedReleaseId: normalizedRequested,
      normalizedValueReleaseId: normalizedValue,
      fix: "No action."
    };
  }

  if (normalizedRequested) {
    return {
      status: "requested-only",
      blocking: false,
      requestedReleaseId: requested,
      valueReleaseId: value || "missing",
      normalizedRequestedReleaseId: normalizedRequested,
      normalizedValueReleaseId: "",
      fix: "Set SENTINEL_RELEASE_ID in the private values file so the rendered manifest records the same release id."
    };
  }

  if (normalizedValue) {
    return {
      status: "value-only",
      blocking: false,
      requestedReleaseId: requested || "missing",
      valueReleaseId: value,
      normalizedRequestedReleaseId: "",
      normalizedValueReleaseId: normalizedValue,
      fix: "No action."
    };
  }

  return {
    status: "missing",
    blocking: false,
    requestedReleaseId: requested || "missing",
    valueReleaseId: value || "missing",
    normalizedRequestedReleaseId: "",
    normalizedValueReleaseId: "",
    fix: "Set SENTINEL_RELEASE_ID before strict render."
  };
}

function isRawSecretArg(arg) {
  return [
    "--admin-token",
    "--token",
    "--gemini-api-key",
    "--oauth-client-secret",
    "--workspace-refresh-token",
    "--judge-password"
  ].some((name) => arg === name || arg.startsWith(`${name}=`));
}

async function writeJson(path, payload) {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function sanitizePathSegment(value) {
  return String(value || "release-candidate")
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120) || "release-candidate";
}

function dockerTag(value) {
  return String(value || "latest")
    .replace(/[^A-Za-z0-9_.-]+/gu, "-")
    .replace(/^[.-]+/u, "")
    .slice(0, 120) || "latest";
}

function trimTrailingSlash(value) {
  return value ? String(value).replace(/\/+$/u, "") : "";
}

function isIsoTimestamp(value) {
  if (!value) {
    return false;
  }

  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === String(value);
}

function isTimestampAtOrAfter(value, minimumValue) {
  const timestamp = Date.parse(String(value ?? ""));
  const minimumTimestamp = Date.parse(String(minimumValue));

  return Number.isFinite(timestamp) && timestamp >= minimumTimestamp;
}

function isPublicHttpsUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function isAcceptedDemoVideoUrl(value) {
  try {
    const host = new URL(String(value)).hostname.toLowerCase();
    return (
      host === "youtu.be" ||
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "vimeo.com" ||
      host.endsWith(".vimeo.com") ||
      host === "youku.com" ||
      host.endsWith(".youku.com")
    );
  } catch {
    return false;
  }
}

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isIpv4Address(value) {
  const parts = String(value).split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) >= 0 && Number(part) <= 255) &&
    value !== "0.0.0.0"
  );
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@-]+$/u.test(text)) {
    return text;
  }

  return `'${text.replace(/'/gu, "'\\''")}'`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const summary = options.writeValuesTemplatePath
      ? await writeRenderValuesTemplate(options.writeValuesTemplatePath)
      : await renderCloudRunManifest(options);
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    if (error?.summary) {
      console.log(JSON.stringify(error.summary, null, 2));
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
