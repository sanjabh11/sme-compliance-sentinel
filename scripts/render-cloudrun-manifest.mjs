/* global console, process */

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const defaultTemplate = "cloudrun.service.yaml";
const defaultOutDir = "artifacts/deployment";
const renderedFileName = "cloudrun.service.rendered.yaml";
const verifierFileName = "cloudrun-manifest-verifier.json";
const summaryFileName = "cloudrun-render-summary.json";
const dryRunCommandFileName = "cloudrun-dry-run-command.txt";
const deployCommandFileName = "cloudrun-deploy-command.txt";

const renderValueKeys = [
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

const derivedValueKeys = [
  "SENTINEL_CLOUD_RUN_IMAGE",
  "SENTINEL_CLOUD_RUN_SERVICE_ACCOUNT_EMAIL",
  "SENTINEL_GCP_BUDGET_SHORT_ID",
  "SENTINEL_GEMINI_API_KEY_SHORT_ID"
];

const secretVersionKeys = [
  "SENTINEL_ADMIN_ACTION_TOKEN_VERSION",
  "GEMINI_API_KEY_VERSION",
  "GOOGLE_OAUTH_CLIENT_SECRET_VERSION",
  "SENTINEL_EVIDENCE_SIGNING_SECRET_VERSION",
  "WORKSPACE_DRIVE_CHANNEL_TOKEN_VERSION"
];

const secretVersionEnvNames = {
  SENTINEL_ADMIN_ACTION_TOKEN_VERSION: "SENTINEL_ADMIN_ACTION_TOKEN",
  GEMINI_API_KEY_VERSION: "GEMINI_API_KEY",
  GOOGLE_OAUTH_CLIENT_SECRET_VERSION: "GOOGLE_OAUTH_CLIENT_SECRET",
  SENTINEL_EVIDENCE_SIGNING_SECRET_VERSION: "SENTINEL_EVIDENCE_SIGNING_SECRET",
  WORKSPACE_DRIVE_CHANNEL_TOKEN_VERSION: "WORKSPACE_DRIVE_CHANNEL_TOKEN"
};

const prohibitedRawSecretKeys = [
  "SENTINEL_ADMIN_ACTION_TOKEN",
  "GEMINI_API_KEY",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "SENTINEL_EVIDENCE_SIGNING_SECRET",
  "WORKSPACE_DRIVE_CHANNEL_TOKEN",
  "GOOGLE_CLOUD_ACCESS_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "WORKSPACE_REFRESH_TOKEN",
  "XPRIZE_JUDGE_CREDENTIALS",
  "XPRIZE_JUDGE_PASSWORD"
];

const prohibitedRenderedEnvKeys = prohibitedRawSecretKeys.filter(
  (key) => !Object.values(secretVersionEnvNames).includes(key)
);

const safeFileKeys = new Set([...renderValueKeys, ...derivedValueKeys, ...secretVersionKeys]);

export function parseArgs(argv) {
  const args = {
    template: defaultTemplate,
    valuesPath: "",
    outDir: process.env.SENTINEL_CLOUD_RUN_RENDER_OUT_DIR ?? defaultOutDir,
    releaseId: process.env.SENTINEL_RELEASE_ID ?? "",
    strict: false
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

    if (arg === "--strict") {
      args.strict = true;
    }
  }

  return args;
}

export async function renderCloudRunManifest(options) {
  const fileValues = await loadValuesFile(options.valuesPath);
  const renderValues = buildRenderValues(fileValues);
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
    const summary = await renderCloudRunManifest(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    if (error?.summary) {
      console.log(JSON.stringify(error.summary, null, 2));
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
