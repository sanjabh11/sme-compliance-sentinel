/* global console, process, URL */

import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const deploymentContract = JSON.parse(
  readFileSync(new URL("../docs/deployment/cloudrun-deployment-contract.json", import.meta.url), "utf8")
);
const execFileAsync = promisify(execFile);
const defaultTemplate = "cloudrun.service.yaml";
const defaultOutDir = "artifacts/deployment";
const defaultPrivateRoot = "/secure/local";
const renderedFileName = "cloudrun.service.rendered.yaml";
const verifierFileName = "cloudrun-manifest-verifier.json";
const summaryFileName = "cloudrun-render-summary.json";
const dryRunCommandFileName = "cloudrun-dry-run-command.txt";
const deployCommandFileName = "cloudrun-deploy-command.txt";
const defaultValuesTemplatePath = "docs/deployment/cloudrun-render-values.template.json";
const requiredSubmissionCloseAt = "2026-08-17T13:00:00-07:00";
const requiredJudgingPeriodEndAt = "2026-09-15T17:00:00-07:00";
const requiredEvidenceResponseSlaBusinessDays = 2;

const renderValueKeys = deploymentContract.requiredNonSecretEnv ?? [];

const derivedValueKeys = [
  "SENTINEL_CLOUD_RUN_IMAGE",
  "SENTINEL_CLOUD_RUN_SERVICE_ACCOUNT_EMAIL",
  "SENTINEL_GCP_BUDGET_SHORT_ID",
  "SENTINEL_GEMINI_API_KEY_SHORT_ID"
];

const secretVersionKeys = (deploymentContract.requiredSecretEnv ?? []).map((entry) => entry.versionKey);

const derivedValueGuidance = {
  SENTINEL_CLOUD_RUN_IMAGE:
    "Derived from SENTINEL_CLOUD_RUN_REGION, GOOGLE_CLOUD_PROJECT, and SENTINEL_RELEASE_ID.",
  SENTINEL_CLOUD_RUN_SERVICE_ACCOUNT_EMAIL: "Derived from GOOGLE_CLOUD_PROJECT.",
  SENTINEL_PRIVATE_EVIDENCE_BUCKET: "Derived from GOOGLE_CLOUD_PROJECT.",
  SENTINEL_BUDGET_PUBSUB_TOPIC: "Derived from GOOGLE_CLOUD_PROJECT.",
  WORKSPACE_GMAIL_TOPIC: "Derived from GOOGLE_CLOUD_PROJECT.",
  WORKSPACE_GMAIL_SUBSCRIPTION: "Derived from GOOGLE_CLOUD_PROJECT.",
  WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL: "Derived from GOOGLE_CLOUD_PROJECT.",
  WORKSPACE_DRIVE_WEBHOOK_URL: "Derived from NEXT_PUBLIC_PRODUCT_URL.",
  WORKSPACE_PUBSUB_PUSH_AUDIENCE: "Derived from NEXT_PUBLIC_PRODUCT_URL.",
  GOOGLE_OAUTH_REDIRECT_URI: "Derived from NEXT_PUBLIC_PRODUCT_URL.",
  SENTINEL_GCP_BUDGET_ID: "Derived from GOOGLE_CLOUD_BILLING_ACCOUNT_ID and SENTINEL_GCP_BUDGET_SHORT_ID.",
  SENTINEL_GEMINI_API_KEY_ID: "Derived from GOOGLE_CLOUD_PROJECT_NUMBER and SENTINEL_GEMINI_API_KEY_SHORT_ID."
};

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
  "SENTINEL_CLOUD_RUN_VPC_CONNECTOR",
  "SENTINEL_CLOUD_RUN_VPC_EGRESS",
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
  "WORKSPACE_DRIVE_WEBHOOK_URL",
  "WORKSPACE_GMAIL_TOPIC",
  "WORKSPACE_GMAIL_SUBSCRIPTION",
  "WORKSPACE_PUBSUB_PUSH_AUDIENCE",
  "WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "GOOGLE_OAUTH_REQUESTED_SCOPES",
  "GOOGLE_OAUTH_DEFERRED_RESTRICTED_SCOPES",
  "SENTINEL_GEMINI_API_KEY_ID",
  "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS",
  "XPRIZE_ENTRANT_TYPE",
  ...secretVersionKeys
];
const releaseMetadataValueKeys = [
  "SENTINEL_RELEASE_ID",
  "SENTINEL_SOURCE_COMMIT",
  "SENTINEL_SOURCE_COMMIT_AT",
  "SENTINEL_SOURCE_BRANCH"
];

const renderValuesTemplate = {
  GOOGLE_CLOUD_PROJECT: "PROJECT_ID",
  GOOGLE_CLOUD_PROJECT_NUMBER: "PROJECT_NUMBER",
  SENTINEL_CLOUD_RUN_REGION: "us-central1",
  SENTINEL_CLOUD_RUN_VPC_CONNECTOR: "sentinel-egress",
  SENTINEL_CLOUD_RUN_VPC_EGRESS: "all-traffic",
  SENTINEL_RELEASE_ID: "RELEASE_ID",
  SENTINEL_SOURCE_COMMIT: "SOURCE_COMMIT",
  SENTINEL_SOURCE_COMMIT_AT: "SOURCE_COMMIT_AT",
  SENTINEL_SOURCE_BRANCH: "origin/main",
  NEXT_PUBLIC_PRODUCT_URL: "https://YOUR-SERVICE-URL",
  XPRIZE_REPOSITORY_URL: "https://github.com/sanjabh11/sme-compliance-sentinel",
  XPRIZE_REPOSITORY_ACCESS_CONFIGURED: "false",
  XPRIZE_REPOSITORY_ACCESS_MODE: "private-shared",
  XPRIZE_REPOSITORY_JUDGE_ACCESS_EMAILS: "testing@devpost.com,judging@hacker.fund",
  XPRIZE_SOURCE_CODE_COMPLETE_CONFIRMED: "false",
  XPRIZE_SUBMISSION_CLOSE_AT: requiredSubmissionCloseAt,
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
  XPRIZE_WORKING_PROJECT_ACCESS_CONFIGURED: "false",
  XPRIZE_TESTING_INSTRUCTIONS_CONFIGURED: "false",
  XPRIZE_JUDGE_ACCESS_CONFIGURED: "false",
  XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED: "false",
  XPRIZE_JUDGING_PERIOD_END_AT: requiredJudgingPeriodEndAt,
  XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED: "false",
  XPRIZE_GENERAL_ELIGIBILITY_CONFIRMED: "false",
  XPRIZE_REPRESENTATIVE_AUTHORIZED: "false",
  XPRIZE_ORGANIZATION_UNDER_25_CONFIRMED: "false",
  XPRIZE_CORPORATE_ID_CONFIGURED: "false",
  XPRIZE_NO_PROMOTION_ENTITY_CONFLICT_CONFIRMED: "false",
  XPRIZE_THIRD_PARTY_REVIEW_APPROVED: "false",
  XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED: "false",
  XPRIZE_EVIDENCE_RESPONSE_READY: "false",
  XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS: String(requiredEvidenceResponseSlaBusinessDays),
  XPRIZE_EVIDENCE_RESPONSE_PRIVATE_CONTACT_CONFIGURED: "false",
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
  WORKSPACE_DRIVE_WEBHOOK_URL: "https://YOUR-SERVICE-URL/api/webhooks/pubsub/drive",
  GOOGLE_OAUTH_REQUESTED_SCOPES: "https://www.googleapis.com/auth/drive.metadata.readonly,https://www.googleapis.com/auth/gmail.metadata",
  GOOGLE_OAUTH_DEFERRED_RESTRICTED_SCOPES: "https://www.googleapis.com/auth/drive",
  GOOGLE_OAUTH_SCOPE_REVIEW_CONFIRMED: "false",
  SENTINEL_GEMINI_API_KEY_SHORT_ID: "GEMINI_API_KEY_ID",
  SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS: "CONCRETE_EXTERNAL_IPV4_NO_CIDR",
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
    writeValuesTemplatePath: "",
    writeReleaseValuesPath: ""
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
      const outputPath = nextOptionalValue(argv, index);
      args.writeValuesTemplatePath = outputPath || defaultCloudRunValuesPath();
      if (outputPath) {
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--write-values-template=")) {
      args.writeValuesTemplatePath = arg.slice("--write-values-template=".length) || defaultCloudRunValuesPath();
      continue;
    }

    if (arg === "--write-release-values") {
      const outputPath = nextOptionalValue(argv, index);
      args.writeReleaseValuesPath = outputPath || defaultCloudRunValuesPath();
      if (outputPath) {
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--write-release-values=")) {
      args.writeReleaseValuesPath = arg.slice("--write-release-values=".length) || defaultCloudRunValuesPath();
      continue;
    }

    if (arg === "--strict") {
      args.strict = true;
    }
  }

  return args;
}

function nextOptionalValue(argv, index) {
  const next = argv[index + 1] ?? "";

  return next && !next.startsWith("-") ? next : "";
}

function defaultCloudRunValuesPath() {
  return join(privateRoot(), "cloudrun-render-values.json");
}

function privateRoot() {
  const configuredRoot = String(process.env.SENTINEL_PRIVATE_ROOT ?? defaultPrivateRoot).trim();
  const root = configuredRoot || defaultPrivateRoot;

  return root.replace(/\/+$/u, "") || defaultPrivateRoot;
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
  await assertDirectoryPathSafe(outputDirectory, "Cloud Run output directory");
  await mkdir(outputDirectory, { recursive: true });
  await assertDirectoryExistsSafe(outputDirectory, "Cloud Run output directory");

  const templatePath = options.template ?? defaultTemplate;
  const template = await readFile(templatePath, "utf8");
  const renderedManifest = renderManifest(template, renderValues);
  assertNoUnsafeRenderedSecrets(renderedManifest);

  const renderedManifestPath = join(outputDirectory, renderedFileName);
  const verifierPath = join(outputDirectory, verifierFileName);
  const dryRunCommandPath = join(outputDirectory, dryRunCommandFileName);
  const deployCommandPath = join(outputDirectory, deployCommandFileName);
  const summaryPath = join(outputDirectory, summaryFileName);
  await assertWritableTextFilePath(renderedManifestPath, "Cloud Run rendered manifest");
  await assertWritableTextFilePath(verifierPath, "Cloud Run manifest verifier JSON");
  await assertWritableTextFilePath(dryRunCommandPath, "Cloud Run dry-run command file");
  await assertWritableTextFilePath(deployCommandPath, "Cloud Run deploy command file");
  await assertWritableTextFilePath(summaryPath, "Cloud Run render summary JSON");
  await writeTextFile(renderedManifestPath, renderedManifest, "Cloud Run rendered manifest");

  const verifier = await runManifestVerifier(renderedManifestPath);
  await writeJson(verifierPath, verifier);

  const projectId = renderValues.GOOGLE_CLOUD_PROJECT || verifier.projectId || "PROJECT_ID";
  const region = renderValues.SENTINEL_CLOUD_RUN_REGION || "REGION";
  const dryRunCommand = `gcloud run services replace ${shellQuote(renderedManifestPath)} --region ${shellQuote(region)} --project ${shellQuote(projectId)} --dry-run`;
  const deployCommand = `gcloud run services replace ${shellQuote(renderedManifestPath)} --region ${shellQuote(region)} --project ${shellQuote(projectId)}`;
  await writeTextFile(dryRunCommandPath, `${dryRunCommand}\n`, "Cloud Run dry-run command file");
  await writeTextFile(deployCommandPath, `${deployCommand}\n`, "Cloud Run deploy command file");

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
  await writeJson(summaryPath, summary);

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

export async function writeRenderValuesTemplate(outputPath = defaultCloudRunValuesPath()) {
  const absolutePath = resolve(outputPath || defaultCloudRunValuesPath());
  await assertDirectoryPathSafe(dirname(absolutePath), "Cloud Run render values parent directory");
  await mkdir(dirname(absolutePath), { recursive: true });
  await assertDirectoryExistsSafe(dirname(absolutePath), "Cloud Run render values parent directory");
  await writeJson(absolutePath, buildRenderValuesTemplate());

  return {
    generatedAt: new Date().toISOString(),
    path: absolutePath,
    keyCount: Object.keys(renderValuesTemplate).length,
    privateHandling:
      "This is a non-secret template. Copy it to a private path, replace placeholders with reviewed production values, and keep filled values out of Git."
  };
}

export function buildReleaseCandidateValues(options = {}) {
  const gitRunner = options.gitRunner ?? runGit;
  const headCommit = gitRunner(["rev-parse", "HEAD"]);
  const rawSourceCommitAt = gitRunner(["log", "-1", "--format=%cI"]);
  const upstreamBranch = runOptionalGit(gitRunner, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const currentBranch = runOptionalGit(gitRunner, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const remoteUrl = normalizeRepositoryUrl(runOptionalGit(gitRunner, ["remote", "get-url", "origin"]));

  if (!/^[a-f0-9]{40}$/iu.test(headCommit) || !isIsoLikeTimestamp(rawSourceCommitAt)) {
    throw new Error("Release candidate values require Git HEAD and commit timestamp metadata.");
  }

  const sourceCommitAt = new Date(Date.parse(rawSourceCommitAt)).toISOString();
  const commitDate = sourceCommitAt.slice(0, 10).replace(/-/gu, "");

  return {
    ...buildRenderValuesTemplate(),
    SENTINEL_RELEASE_ID: `release-${commitDate}-${headCommit.slice(0, 7).toLowerCase()}`,
    SENTINEL_SOURCE_COMMIT: headCommit,
    SENTINEL_SOURCE_COMMIT_AT: sourceCommitAt,
    SENTINEL_SOURCE_BRANCH: upstreamBranch || currentBranch || "main",
    ...(remoteUrl ? { XPRIZE_REPOSITORY_URL: remoteUrl } : {})
  };
}

export async function writeReleaseCandidateValues(outputPath, options = {}) {
  if (!outputPath) {
    throw new Error("--write-release-values requires a private output path.");
  }

  const absolutePath = resolve(outputPath);
  await assertDirectoryPathSafe(dirname(absolutePath), "Cloud Run release values parent directory");
  await mkdir(dirname(absolutePath), { recursive: true });
  await assertDirectoryExistsSafe(dirname(absolutePath), "Cloud Run release values parent directory");
  const existingValues = await loadValuesFileIfExists(absolutePath);
  const releaseValues = buildReleaseCandidateValues(options);
  const values = mergeReleaseCandidateValues(existingValues, releaseValues);
  await writeJson(absolutePath, values);

  const preservedKeys = Object.keys(existingValues).filter(
    (key) => values[key] === existingValues[key] && !releaseMetadataValueKeys.includes(key)
  );
  const refreshedReleaseMetadataKeys = releaseMetadataValueKeys.filter((key) => releaseValues[key] !== undefined);

  return {
    generatedAt: new Date().toISOString(),
    path: absolutePath,
    keyCount: Object.keys(values).length,
    releaseId: values.SENTINEL_RELEASE_ID,
    sourceCommit: values.SENTINEL_SOURCE_COMMIT,
    sourceCommitAt: values.SENTINEL_SOURCE_COMMIT_AT,
    sourceBranch: values.SENTINEL_SOURCE_BRANCH,
    repositoryUrl: values.XPRIZE_REPOSITORY_URL,
    preservedExistingValueCount: preservedKeys.length,
    preservedExistingValueKeys: preservedKeys,
    refreshedReleaseMetadataKeys,
    privateHandling:
      "This release-candidate values file is a non-secret private starter. It refreshes source/release metadata from Git while preserving existing non-secret values. Project ids, hosted URL, repository access URL, OAuth ids, billing ids, Gemini key resource ids, static egress IPs, Secret Manager versions, and evidence flags still require operator review.",
    nextActions: [
      "Fill the remaining non-secret production values in this private file.",
      "Review preserved release-bound values such as SENTINEL_CLOUD_RUN_IMAGE before strict render.",
      "Keep every XPRIZE evidence attestation false until the private proof exists.",
      `Run npm run audit:cloudrun-values -- --values ${absolutePath} --out-dir artifacts/deployment --release-id ${values.SENTINEL_RELEASE_ID} --strict before rendering.`
    ]
  };
}

export function mergeReleaseCandidateValues(existingValues = {}, releaseValues = {}) {
  const merged = {
    ...releaseValues,
    ...existingValues
  };

  for (const key of releaseMetadataValueKeys) {
    if (releaseValues[key] !== undefined) {
      merged[key] = releaseValues[key];
    }
  }

  return merged;
}

async function loadValuesFileIfExists(valuesPath) {
  try {
    await lstat(valuesPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }

  return loadValuesFile(valuesPath);
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
  const renderValueIntake = buildRenderValueIntake({
    fileValues,
    renderValues,
    missingStrictKeys,
    placeholderKeys,
    valueConsistencyBlockers,
    manualReviewFlags,
    secretVersionKeysStatus
  });
  const renderValueIntakeSummary = summarizeRenderValueIntake(renderValueIntake);
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
    renderValueIntakeSummary,
    renderValueIntake,
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

function buildRenderValueIntake({
  fileValues,
  renderValues,
  missingStrictKeys,
  placeholderKeys,
  valueConsistencyBlockers,
  manualReviewFlags,
  secretVersionKeysStatus
}) {
  const blockerByKey = new Map(valueConsistencyBlockers.map((check) => [check.key, check]));
  const manualFlagByKey = new Map(manualReviewFlags.map((flag) => [flag.key, flag]));
  const secretVersionByKey = new Map(secretVersionKeysStatus.map((item) => [item.versionKey, item]));
  const keys = unique([
    ...strictRequiredValueKeys,
    ...manualReviewValueKeys,
    ...secretVersionKeys,
    ...Object.keys(fileValues),
    ...Object.keys(renderValues)
  ]).sort();

  return keys.map((key) => {
    const blocker = blockerByKey.get(key);
    const manualFlag = manualFlagByKey.get(key);
    const secretVersion = secretVersionByKey.get(key);
    const metadata = intakeMetadataForKey(key);
    const source = Object.prototype.hasOwnProperty.call(fileValues, key)
      ? "values-file"
      : renderValues[key] !== undefined
        ? "derived-or-env"
        : "missing";
    const valuePreview = previewRenderValue(key, renderValues[key]);
    const status = renderValueIntakeStatus({
      key,
      value: renderValues[key],
      blocker,
      manualFlag,
      secretVersion,
      missingStrictKeys,
      placeholderKeys
    });

    return {
      key,
      label: metadata.label,
      category: metadata.category,
      owner: metadata.owner,
      status,
      source,
      valuePreview,
      safeToStoreInValuesFile: !prohibitedRawSecretKeys.includes(key),
      requiredBeforeDryRun: strictRequiredValueKeys.includes(key),
      requiredBeforePublicClaim: Boolean(manualFlag),
      acceptedProof: metadata.acceptedProof,
      privateHandling: metadata.privateHandling,
      derivationHint: metadata.derivationHint,
      fix: renderValueIntakeFix({ key, status, blocker, manualFlag, secretVersion, metadata })
    };
  });
}

function renderValueIntakeStatus({ key, value, blocker, manualFlag, secretVersion, missingStrictKeys, placeholderKeys }) {
  if (blocker) {
    return "blocked";
  }

  if (placeholderKeys.includes(key) || hasTemplatePlaceholder(String(value ?? ""))) {
    return "placeholder";
  }

  if (missingStrictKeys.includes(key) || secretVersion?.status === "needs-value") {
    return "missing";
  }

  if (manualFlag) {
    return manualFlag.status === "attested" ? "attested" : "manual-review";
  }

  return "ready";
}

function renderValueIntakeFix({ key, status, blocker, manualFlag, secretVersion, metadata }) {
  if (blocker) {
    return blocker.fix;
  }

  if (secretVersion?.status === "needs-value") {
    return `Create or verify the Secret Manager secret for ${secretVersion.envName}, then record only the positive numeric version in ${key}.`;
  }

  if (status === "missing" || status === "placeholder") {
    if (metadata.derivationHint) {
      return `${key} is normally derived. ${metadata.derivationHint} Fill the base value(s), rerun the audit, and set ${key} directly only if the generated value is wrong for your environment.`;
    }

    return `Fill ${key} in the private render-values file with reviewed ${metadata.valueKind}.`;
  }

  if (manualFlag?.status === "not-attested") {
    return `Keep ${key}=false until ${metadata.owner} attaches private proof and approves the matching evidence flag.`;
  }

  if (manualFlag?.status === "attested") {
    return `Preserve the private proof that justified ${key}=true before using it in judge or public claims.`;
  }

  return "No action.";
}

function summarizeRenderValueIntake(items) {
  const byStatus = Object.fromEntries(
    ["ready", "attested", "manual-review", "missing", "placeholder", "blocked"].map((status) => [
      status,
      items.filter((item) => item.status === status).length
    ])
  );
  const byCategory = items.reduce((summary, item) => {
    summary[item.category] = (summary[item.category] ?? 0) + 1;
    return summary;
  }, {});
  const pendingItems = items.filter((item) => item.status !== "ready" && item.status !== "attested");

  return {
    total: items.length,
    ready: byStatus.ready,
    attested: byStatus.attested,
    manualReview: byStatus["manual-review"],
    missing: byStatus.missing,
    placeholder: byStatus.placeholder,
    blocked: byStatus.blocked,
    pending: pendingItems.length,
    byCategory,
    readyForStrictRender: byStatus.missing === 0 && byStatus.placeholder === 0 && byStatus.blocked === 0,
    claimFlagsPending: items.filter((item) => item.requiredBeforePublicClaim && item.status === "manual-review").length
  };
}

function intakeMetadataForKey(key) {
  const category = intakeCategoryForKey(key);
  const owner = intakeOwnerForCategory(category);

  return {
    label: key.replace(/_/gu, " ").toLowerCase(),
    category,
    owner,
    valueKind: valueKindForCategory(category),
    acceptedProof: acceptedProofForCategory(category),
    privateHandling: privateHandlingForCategory(category),
    derivationHint: derivedValueGuidance[key] ?? ""
  };
}

function intakeCategoryForKey(key) {
  const explicitCategories = {
    XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED: "google-cloud-proof",
    XPRIZE_PRODUCT_RUNNING_EVIDENCE_CONFIGURED: "hosted-product-proof",
    XPRIZE_AI_NATIVE_OPERATIONS_EVIDENCE_CONFIGURED: "ai-native-operations",
    XPRIZE_AGENT_EXECUTION_LOGS_CONFIGURED: "ai-native-operations",
    XPRIZE_CATEGORY_IMPACT_EVIDENCE_CONFIGURED: "category-impact",
    XPRIZE_CATEGORY: "category-impact",
    XPRIZE_SOURCE_CODE_COMPLETE_CONFIRMED: "judge-access"
  };

  if (explicitCategories[key]) {
    return explicitCategories[key];
  }

  if (secretVersionKeys.includes(key)) {
    return "secret-manager-version";
  }

  if (key.includes("BILLING") || key.includes("BUDGET") || key.includes("COST") || key.includes("CAC")) {
    return "cost-controls";
  }

  if (key.startsWith("GOOGLE_CLOUD_") || key.startsWith("SENTINEL_CLOUD_RUN_") || key === "SENTINEL_PRIVATE_EVIDENCE_BUCKET") {
    return "gcp-foundation";
  }

  if (key.startsWith("SENTINEL_SOURCE_") || key === "SENTINEL_RELEASE_ID") {
    return "release-integrity";
  }

  if (key.includes("GEMINI")) {
    return "gemini-controls";
  }

  if (key.startsWith("GOOGLE_OAUTH_") || key.startsWith("WORKSPACE_")) {
    return "workspace-oauth";
  }

  if (
    key.includes("DEMO") ||
    key.includes("JUDGE") ||
    key.includes("TESTING") ||
    key.includes("REPOSITORY") ||
    key.includes("WORKING_PROJECT") ||
    key === "NEXT_PUBLIC_PRODUCT_URL"
  ) {
    return "judge-access";
  }

  if (key.includes("REVENUE") || key.includes("BUSINESS") || key.includes("USER") || key.includes("TESTIMONIAL") || key.includes("RELATED_PARTY")) {
    return "business-evidence";
  }

  if (key.startsWith("XPRIZE_")) {
    return "xprize-attestation";
  }

  return "deployment-value";
}

function intakeOwnerForCategory(category) {
  if (["business-evidence", "category-impact"].includes(category)) {
    return "founder/sales";
  }

  if (["xprize-attestation", "judge-access"].includes(category)) {
    return "founder/legal";
  }

  return "engineering";
}

function valueKindForCategory(category) {
  if (category === "secret-manager-version") {
    return "positive numeric Secret Manager version metadata, not the secret value";
  }

  if (category === "business-evidence" || category === "xprize-attestation") {
    return "evidence-backed boolean or non-secret submission metadata";
  }

  if (category === "judge-access") {
    return "non-secret hosted URL, repository, demo, or access-state metadata";
  }

  if (category === "google-cloud-proof" || category === "hosted-product-proof" || category === "ai-native-operations") {
    return "evidence-backed production proof flag or non-secret runtime metadata";
  }

  return "non-secret production infrastructure metadata";
}

function acceptedProofForCategory(category) {
  const proofByCategory = {
    "gcp-foundation": "Reviewed Google Cloud project, project number, region, service account, VPC connector, and private evidence bucket metadata.",
    "release-integrity": "Git commit, release id, source timestamp, branch, image tag, and build provenance for the exact deployment.",
    "cost-controls": "Cloud Billing budget id, budget-alert topic, cost records, and CAC/hosting/AI API cost evidence.",
    "gemini-controls": "Gemini API key resource id, server-IP allowlist, quota/usage proof, and hosted provider=gemini-api agent-run evidence.",
    "workspace-oauth": "OAuth consent configuration, requested/deferred scopes, redirect URL, Pub/Sub topic/subscription, and Workspace watch renewal proof.",
    "judge-access": "Hosted product URL, repository access review, public demo URL, private testing instructions, and free judging-period access proof.",
    "google-cloud-proof": "Cloud Run service URL, revision, service account, Cloud Billing, Secret Manager, Firestore/BigQuery, and deployment transcript evidence.",
    "hosted-product-proof": "Hosted product smoke output, signed-out browser proof, production write-through verification, and release-bound hosted proof bundle.",
    "ai-native-operations": "Hosted Gemini provider logs, agent execution rows, AI-operation timeline, and production workflow evidence.",
    "category-impact": "Small Business Services category rationale, customer workflow impact, buyer proof points, and market-positioning evidence.",
    "business-evidence": "Private invoices/payment exports, revenue-by-month, active-user logs, testimonial consent, and related-party review.",
    "xprize-attestation": "Private human-review packet for eligibility, IP/API terms, project-newness, evidence response, and submission claims.",
    "secret-manager-version": "Secret Manager resource and numeric version captured without exposing the secret value.",
    "deployment-value": "Reviewed non-secret deployment value from the private operator runbook."
  };

  return proofByCategory[category] ?? proofByCategory["deployment-value"];
}

function privateHandlingForCategory(category) {
  if (category === "secret-manager-version") {
    return "Store only the Secret Manager version number in render values; keep secret payloads in Secret Manager.";
  }

  if (category === "business-evidence") {
    return "Keep customer, invoice, payment, testimonial, and active-user artifacts in the private evidence store with redaction and consent.";
  }

  if (category === "google-cloud-proof" || category === "hosted-product-proof" || category === "ai-native-operations") {
    return "Keep production logs, API usage records, screenshots, and hosted proof JSON in the private evidence store until redacted.";
  }

  if (category === "judge-access") {
    return "Keep credentials and detailed testing instructions out of source; place them only in private Devpost testing instructions.";
  }

  return "Keep filled render values in a private ignored path and share only redacted evidence packets.";
}

function previewRenderValue(key, value) {
  if (value === undefined || value === "") {
    return "missing";
  }

  if (secretVersionKeys.includes(key)) {
    return /^[1-9][0-9]*$/u.test(String(value)) ? "version-set" : "version-missing";
  }

  if (key === "XPRIZE_TESTING_INSTRUCTIONS") {
    return hasTemplatePlaceholder(String(value)) ? "placeholder" : "instructions-present";
  }

  const text = String(value);

  if (text === "true" || text === "false") {
    return text;
  }

  if (hasTemplatePlaceholder(text)) {
    return "placeholder";
  }

  if (text.length <= 32) {
    return text;
  }

  return `${text.slice(0, 16)}...${text.slice(-8)}`;
}

async function loadValuesFile(valuesPath) {
  if (!valuesPath) {
    return {};
  }

  const absolutePath = resolve(valuesPath);
  await assertDirectoryPathSafe(dirname(absolutePath), "Cloud Run render values parent directory");
  await assertRegularFileIfExists(absolutePath, "Cloud Run render values file");
  const parsed = JSON.parse(await readFile(absolutePath, "utf8"));
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
  values.SENTINEL_CLOUD_RUN_VPC_CONNECTOR ||= "sentinel-egress";
  values.SENTINEL_CLOUD_RUN_VPC_EGRESS ||= "all-traffic";
  if (projectId) {
    values.SENTINEL_PRIVATE_EVIDENCE_BUCKET ||= `gs://${projectId}-sentinel-private-evidence`;
    values.SENTINEL_BUDGET_PUBSUB_TOPIC ||= `projects/${projectId}/topics/sentinel-budget-alerts`;
    values.WORKSPACE_GMAIL_TOPIC ||= `projects/${projectId}/topics/workspace-gmail-updates`;
    values.WORKSPACE_GMAIL_SUBSCRIPTION ||= `projects/${projectId}/subscriptions/workspace-gmail-push`;
    values.WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL ||= `workspace-push@${projectId}.iam.gserviceaccount.com`;
    values.SENTINEL_CLOUD_RUN_SERVICE_ACCOUNT_EMAIL ||= `sentinel-runtime@${projectId}.iam.gserviceaccount.com`;
    values.SENTINEL_CLOUD_RUN_IMAGE ||= `${region}-docker.pkg.dev/${projectId}/sentinel/web:${releaseId ? dockerTag(releaseId) : "RELEASE_ID"}`;
  }

  if (productUrl) {
    values.NEXT_PUBLIC_PRODUCT_URL = productUrl;
    if (!values.WORKSPACE_DRIVE_WEBHOOK_URL || hasTemplatePlaceholder(values.WORKSPACE_DRIVE_WEBHOOK_URL)) {
      values.WORKSPACE_DRIVE_WEBHOOK_URL = `${productUrl}/api/webhooks/pubsub/drive`;
    }
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
      "submission-close",
      "XPRIZE_SUBMISSION_CLOSE_AT",
      isSameTimestamp(values.XPRIZE_SUBMISSION_CLOSE_AT, requiredSubmissionCloseAt),
      `Keep the deployment submission-freeze timestamp aligned to ${requiredSubmissionCloseAt}.`
    ),
    valueCheck(
      "evidence-response-sla",
      "XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS",
      isBusinessDaySlaAtOrBelow(values.XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS, requiredEvidenceResponseSlaBusinessDays),
      `Use ${requiredEvidenceResponseSlaBusinessDays} business days or less for evidence-response ownership.`
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
      "cloud-run-vpc-connector",
      "SENTINEL_CLOUD_RUN_VPC_CONNECTOR",
      isCloudRunVpcConnector(values.SENTINEL_CLOUD_RUN_VPC_CONNECTOR),
      "Use the reviewed Serverless VPC Access connector name for static egress."
    ),
    valueCheck(
      "cloud-run-vpc-egress",
      "SENTINEL_CLOUD_RUN_VPC_EGRESS",
      values.SENTINEL_CLOUD_RUN_VPC_EGRESS === "all-traffic",
      "Set SENTINEL_CLOUD_RUN_VPC_EGRESS to all-traffic so Gemini API key IP restrictions use the static egress path."
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
      "drive-webhook-product-url",
      "WORKSPACE_DRIVE_WEBHOOK_URL",
      values.WORKSPACE_DRIVE_WEBHOOK_URL === `${productUrl}/api/webhooks/pubsub/drive`,
      "Keep the Drive watch webhook bound to NEXT_PUBLIC_PRODUCT_URL."
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
      parseCsv(values.SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS).every(isConcreteIpv4Address),
      "Use a comma-separated allowlist of concrete reviewed external IPv4 addresses for the API key server restriction; do not use CIDR ranges, wildcards, or placeholders, and keep hosted Gemini smoke proof separate because Google APIs can use Private Google Access behavior."
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

  if (values.SENTINEL_CLOUD_RUN_VPC_CONNECTOR) {
    rendered = replaceAnnotation(
      rendered,
      "run.googleapis.com/vpc-access-connector",
      values.SENTINEL_CLOUD_RUN_VPC_CONNECTOR
    );
  }

  if (values.SENTINEL_CLOUD_RUN_VPC_EGRESS) {
    rendered = replaceAnnotation(rendered, "run.googleapis.com/vpc-access-egress", values.SENTINEL_CLOUD_RUN_VPC_EGRESS);
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

function replaceAnnotation(manifest, name, value) {
  const pattern = new RegExp(`(\\n\\s+${escapeRegExp(name)}:\\s*)[^\\n]+`, "u");
  return manifest.replace(pattern, `$1${String(value)}`);
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
    /STATIC_EGRESS_IPS/u,
    /CONCRETE_EXTERNAL_IPV4_NO_CIDR/u
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

function runGit(args) {
  return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function runOptionalGit(gitRunner, args) {
  try {
    return gitRunner(args).trim();
  } catch {
    return "";
  }
}

function normalizeRepositoryUrl(value) {
  const url = String(value || "").trim();
  if (url.startsWith("git@github.com:")) {
    return `https://github.com/${url.slice("git@github.com:".length).replace(/\.git$/u, "")}`;
  }

  return url.replace(/\.git$/u, "");
}

function isIsoLikeTimestamp(value) {
  return Number.isFinite(Date.parse(String(value || "")));
}

async function writeJson(path, payload) {
  await writeTextFile(path, `${JSON.stringify(payload, null, 2)}\n`, "Cloud Run render JSON");
}

async function writeTextFile(path, content, label) {
  const absolutePath = resolve(path);
  const parentDirectory = dirname(absolutePath);
  const tempPath = join(parentDirectory, `.${basename(absolutePath)}.${randomUUID()}.tmp`);
  const parentIdentity = await assertWritableTextFilePath(absolutePath, label);

  try {
    await writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    await assertSameDirectoryIdentity(parentDirectory, parentIdentity, `${label} parent directory`);
    await rename(tempPath, absolutePath);
    await assertSameDirectoryIdentity(parentDirectory, parentIdentity, `${label} parent directory`);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function assertDirectoryPathSafe(path, label) {
  const directories = [];
  let cursor = resolve(path);

  while (true) {
    directories.push(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  for (const directory of directories.reverse()) {
    let fileStat;

    try {
      fileStat = await lstat(directory);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    if (fileStat.isSymbolicLink()) {
      throw new Error(`${label} ${directory} is a symbolic link; use a regular private directory before Cloud Run render.`);
    }

    if (!fileStat.isDirectory()) {
      throw new Error(`${label} ${directory} is not a directory; use a regular private directory before Cloud Run render.`);
    }
  }
}

async function assertDirectoryExistsSafe(path, label) {
  const fileStat = await lstat(path);

  if (fileStat.isSymbolicLink()) {
    throw new Error(`${label} ${path} is a symbolic link; use a regular private directory before Cloud Run render.`);
  }

  if (!fileStat.isDirectory()) {
    throw new Error(`${label} ${path} is not a directory; use a regular private directory before Cloud Run render.`);
  }
}

async function assertWritableTextFilePath(path, label) {
  const absolutePath = resolve(path);
  const parentDirectory = dirname(absolutePath);

  await assertDirectoryPathSafe(parentDirectory, `${label} parent directory`);
  await assertRegularFileIfExists(absolutePath, label);

  return readDirectoryIdentity(parentDirectory, `${label} parent directory`);
}

async function assertSameDirectoryIdentity(path, expected, label) {
  const actual = await readDirectoryIdentity(path, label);

  if (actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new Error(`${label} ${resolve(path)} changed while writing; regenerate the render artifacts in a stable private directory.`);
  }
}

async function readDirectoryIdentity(path, label) {
  const fileStat = await lstat(resolve(path));

  if (fileStat.isSymbolicLink()) {
    throw new Error(`${label} ${resolve(path)} is a symbolic link; use a regular private directory before Cloud Run render.`);
  }

  if (!fileStat.isDirectory()) {
    throw new Error(`${label} ${resolve(path)} is not a directory; use a regular private directory before Cloud Run render.`);
  }

  return {
    dev: fileStat.dev,
    ino: fileStat.ino
  };
}

async function assertRegularFileIfExists(path, label) {
  let fileStat;

  try {
    fileStat = await lstat(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  if (fileStat.isSymbolicLink()) {
    throw new Error(`${label} ${path} is a symbolic link; use a regular private file path before Cloud Run render.`);
  }

  if (!fileStat.isFile()) {
    throw new Error(`${label} ${path} is not a regular file; use a regular private file path before Cloud Run render.`);
  }
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

function isSameTimestamp(value, expectedValue) {
  const timestamp = Date.parse(String(value ?? ""));
  const expectedTimestamp = Date.parse(String(expectedValue));

  return Number.isFinite(timestamp) && timestamp === expectedTimestamp;
}

function isBusinessDaySlaAtOrBelow(value, maximumDays) {
  const days = Number(value);

  return Number.isInteger(days) && days > 0 && days <= maximumDays;
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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isConcreteIpv4Address(value) {
  const text = String(value ?? "");
  if (text.includes("/")) {
    return false;
  }

  const parts = text.split(".");
  const validAddress =
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) >= 0 && Number(part) <= 255) &&
    text !== "0.0.0.0";

  return validAddress;
}

function isCloudRunVpcConnector(value) {
  const text = String(value ?? "");
  return (
    /^[a-z][a-z0-9-]{0,23}[a-z0-9]$/u.test(text) ||
    /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/[a-z0-9-]+\/connectors\/[a-z][a-z0-9-]{0,23}[a-z0-9]$/u.test(text)
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
    const summary = options.writeReleaseValuesPath
      ? await writeReleaseCandidateValues(options.writeReleaseValuesPath)
      : options.writeValuesTemplatePath
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
