/* global console, process */

import { readFileSync } from "node:fs";

const manifestPath = process.argv.find((arg) => arg.startsWith("--manifest="))?.slice("--manifest=".length) ?? "cloudrun.service.yaml";
const strict = process.argv.includes("--strict");

const requiredNonSecretEnv = [
  "NEXT_PUBLIC_APP_NAME",
  "SENTINEL_TENANT_ID",
  "SENTINEL_MOCK_MODE",
  "SENTINEL_STORAGE_MODE",
  "SENTINEL_EVIDENCE_MODE",
  "SENTINEL_CLOUD_COST_CONTROLS_MODE",
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
  /GEMINI_API_KEY_ID/u
];

try {
  const manifest = readFileSync(manifestPath, "utf8");
  const report = buildReport(manifest);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = strict && report.overallStatus !== "ready-to-dry-run" ? 1 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function buildReport(manifest) {
  const envEntries = parseEnvEntries(manifest);
  const envByName = new Map(envEntries.map((entry) => [entry.name, entry]));
  const image = extractScalar(manifest, "image") || "missing";
  const runtimeServiceAccount = extractScalar(manifest, "serviceAccountName") || "missing";
  const checks = [
    ...requiredNonSecretEnv.map((name) => checkNonSecret(name, envByName.get(name))),
    ...requiredSecretEnv.map((name) => checkSecret(name, envByName.get(name)))
  ];
  const replacements = [
    ...resourceFinding("container image", image),
    ...resourceFinding("runtime service account", runtimeServiceAccount),
    ...checks
      .filter((check) => check.status === "needs-value")
      .map((check) => ({ target: check.name, value: check.currentValue, reason: check.evidence, fix: check.fix }))
  ];
  const blockers = checks.filter((check) => check.status === "blocked").map((check) => `${check.name}: ${check.fix}`);
  const status = blockers.length ? "blocked" : replacements.length ? "template-needs-values" : "ready-to-dry-run";
  const summary = checks.reduce(
    (totals, check) => {
      totals[check.status] += 1;
      return totals;
    },
    { passed: 0, "needs-value": 0, "manual-review": 0, blocked: 0 }
  );

  return {
    generatedAt: new Date().toISOString(),
    overallStatus: status,
    manifestPath,
    image,
    runtimeServiceAccount,
    summary,
    replacementFindings: replacements,
    secretRefs: requiredSecretEnv
      .map((name) => envByName.get(name))
      .filter((entry) => entry?.secretName)
      .map((entry) => ({ envName: entry.name, secretName: entry.secretName, version: entry.secretVersion })),
    blockers,
    nextActions:
      status === "ready-to-dry-run"
        ? ["Run Cloud Run dry-run, deploy after review, then run hosted production verification."]
        : ["Replace template placeholders, keep secrets in Secret Manager, then rerun this verifier."]
  };
}

function parseEnvEntries(manifest) {
  const envStart = manifest.indexOf("\n          env:");
  if (envStart < 0) {
    return [];
  }

  const entries = [];
  const entryPattern = /\n\s+- name: ([A-Z0-9_]+)\n([\s\S]*?)(?=\n\s+- name: [A-Z0-9_]+\n|$)/gu;

  for (const match of manifest.slice(envStart).matchAll(entryPattern)) {
    const block = match[2] ?? "";
    entries.push({
      name: match[1],
      value: block.match(/(?:^|\n)\s+value: "([^"]*)"/u)?.[1],
      secretName: block.match(/secretKeyRef:\n\s+name: ([^\n]+)\n/u)?.[1]?.trim(),
      secretVersion: block.match(/secretKeyRef:\n\s+name: [^\n]+\n\s+key: "([^"]+)"/u)?.[1]
    });
  }

  return entries;
}

function checkNonSecret(name, entry) {
  if (!entry) {
    return check(name, "blocked", "missing", "Required env var is absent.", "Add this env var.");
  }
  if (entry.secretName) {
    return check(name, "blocked", `secret:${entry.secretName}`, "Non-secret env var is configured as a secret.", "Use a normal value.");
  }
  if (!entry.value && name === "XPRIZE_ENTRANT_TYPE") {
    return check(name, "manual-review", "empty", "Entrant type awaits human review.", "Set individual, team, or organization after review.");
  }
  if (!entry.value) {
    return check(name, "needs-value", "empty", "Value is empty.", "Fill this value before dry-run.");
  }
  if (hasPlaceholder(entry.value)) {
    return check(name, "needs-value", entry.value, "Value still contains a template placeholder.", "Replace with production value.");
  }
  if (manualReviewEnv.has(name) && entry.value !== "true") {
    return check(name, "manual-review", entry.value, "Human attestation is not confirmed.", "Set true only after private proof exists.");
  }
  return check(name, "passed", entry.value, "Value is present.", "No action.");
}

function checkSecret(name, entry) {
  if (!entry) {
    return check(name, "blocked", "missing", "Secret env var is absent.", "Add a Secret Manager reference.");
  }
  if (entry.value) {
    return check(name, "blocked", "raw-value", "Secret env var uses a raw value.", "Move the value to Secret Manager.");
  }
  if (!entry.secretName || !entry.secretVersion) {
    return check(name, "blocked", "incomplete-secret-ref", "Secret reference is incomplete.", "Provide name and explicit version.");
  }
  if (entry.secretVersion === "latest") {
    return check(name, "blocked", `${entry.secretName}:latest`, "Secret reference uses latest.", "Pin a numeric version.");
  }
  return check(name, "passed", `${entry.secretName}:version-set`, "Secret reference uses an explicit version.", "No action.");
}

function check(name, status, currentValue, evidence, fix) {
  return { name, status, currentValue, evidence, fix };
}

function resourceFinding(target, value) {
  if (value === "missing") {
    return [{ target, value, reason: "Required Cloud Run field is missing.", fix: `Set the ${target}.` }];
  }
  if (!hasPlaceholder(value)) {
    return [];
  }
  return [{ target, value, reason: "Value still contains a template placeholder.", fix: `Replace the ${target} placeholder.` }];
}

function extractScalar(manifest, key) {
  const prefix = key === "image" ? "\\s+-\\s+" : "\\s+";
  return manifest.match(new RegExp(`\\n${prefix}${key}:\\s*([^\\n]+)`, "u"))?.[1]?.trim();
}

function hasPlaceholder(value) {
  return placeholderPatterns.some((pattern) => pattern.test(value));
}
