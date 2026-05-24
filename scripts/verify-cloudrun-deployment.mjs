/* global URL, console, process */

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
  "SENTINEL_CLOUD_RUN_SERVICE_NAME",
  "SENTINEL_CLOUD_RUN_REGION",
  "SENTINEL_RELEASE_ID",
  "SENTINEL_SOURCE_COMMIT",
  "SENTINEL_SOURCE_COMMIT_AT",
  "SENTINEL_SOURCE_BRANCH",
  "SENTINEL_PRIVATE_EVIDENCE_BUCKET",
  "NEXT_PUBLIC_PRODUCT_URL",
  "XPRIZE_REPOSITORY_URL",
  "XPRIZE_REPOSITORY_ACCESS_CONFIGURED",
  "XPRIZE_CATEGORY",
  "XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED",
  "XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED",
  "XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED",
  "XPRIZE_CATEGORY_IMPACT_EVIDENCE_CONFIGURED",
  "XPRIZE_AI_NATIVE_OPERATIONS_EVIDENCE_CONFIGURED",
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
  "XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED",
  "XPRIZE_EVIDENCE_RESPONSE_READY",
  "XPRIZE_TESTING_INSTRUCTIONS",
  "XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED",
  "XPRIZE_REVENUE_BY_MONTH_EVIDENCE_CONFIGURED",
  "XPRIZE_TOTAL_COSTS_EVIDENCE_CONFIGURED",
  "XPRIZE_CAC_SPEND_EVIDENCE_CONFIGURED",
  "XPRIZE_REAL_USER_EVIDENCE_CONFIGURED",
  "XPRIZE_TESTIMONIAL_CONSENT_CONFIRMED",
  "XPRIZE_RELATED_PARTY_REVENUE_REVIEWED",
  "XPRIZE_PRODUCT_RUNNING_EVIDENCE_CONFIGURED",
  "XPRIZE_AGENT_EXECUTION_LOGS_CONFIGURED",
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
];

const secretLookupNameByEnvName = {
  SENTINEL_ADMIN_ACTION_TOKEN: "sentinel-admin-action-token",
  GEMINI_API_KEY: "gemini-api-key",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-oauth-client-secret",
  SENTINEL_EVIDENCE_SIGNING_SECRET: "sentinel-evidence-signing-secret",
  WORKSPACE_DRIVE_CHANNEL_TOKEN: "workspace-drive-channel-token"
};

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
  "XPRIZE_REPOSITORY_ACCESS_CONFIGURED",
  "XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED",
  "XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED",
  "XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED",
  "XPRIZE_CATEGORY_IMPACT_EVIDENCE_CONFIGURED",
  "XPRIZE_AI_NATIVE_OPERATIONS_EVIDENCE_CONFIGURED",
  "XPRIZE_JUDGE_ACCESS_CONFIGURED",
  "XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED",
  "XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED",
  "XPRIZE_GENERAL_ELIGIBILITY_CONFIRMED",
  "XPRIZE_REPRESENTATIVE_AUTHORIZED",
  "XPRIZE_ORGANIZATION_UNDER_25_CONFIRMED",
  "XPRIZE_CORPORATE_ID_CONFIGURED",
  "XPRIZE_NO_PROMOTION_ENTITY_CONFLICT_CONFIRMED",
  "XPRIZE_THIRD_PARTY_REVIEW_APPROVED",
  "XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED",
  "XPRIZE_EVIDENCE_RESPONSE_READY",
  "XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED",
  "XPRIZE_REVENUE_BY_MONTH_EVIDENCE_CONFIGURED",
  "XPRIZE_TOTAL_COSTS_EVIDENCE_CONFIGURED",
  "XPRIZE_CAC_SPEND_EVIDENCE_CONFIGURED",
  "XPRIZE_REAL_USER_EVIDENCE_CONFIGURED",
  "XPRIZE_TESTIMONIAL_CONSENT_CONFIRMED",
  "XPRIZE_RELATED_PARTY_REVENUE_REVIEWED",
  "XPRIZE_PRODUCT_RUNNING_EVIDENCE_CONFIGURED",
  "XPRIZE_AGENT_EXECUTION_LOGS_CONFIGURED",
  "SENTINEL_GEMINI_QUOTA_EVIDENCE_CONFIRMED"
]);

const booleanEnv = new Set([
  "SENTINEL_MOCK_MODE",
  "SENSITIVE_DATA_PROTECTION_ENABLED",
  ...manualReviewEnv
]);

const fixedProductionEnvValues = {
  SENTINEL_MOCK_MODE: "false",
  SENTINEL_STORAGE_MODE: "gcp-rest",
  SENTINEL_EVIDENCE_MODE: "production",
  SENTINEL_CLOUD_COST_CONTROLS_MODE: "production",
  XPRIZE_CATEGORY: "Small Business Services",
  SENTINEL_WORKSPACE_WEBHOOK_AUTH_MODE: "oidc",
  SENSITIVE_DATA_PROTECTION_ENABLED: "true"
};

const allowedEntrantTypes = new Set(["individual", "team", "organization"]);

const placeholderPatterns = [
  /PROJECT_ID/u,
  /PROJECT_NUMBER/u,
  /REGION/u,
  /YOUR[-_A-Z0-9]*/u,
  /BILLING_ACCOUNT_ID/u,
  /BUDGET_ID/u,
  /GEMINI_API_KEY_ID/u,
  /RELEASE_ID/u,
  /SOURCE_COMMIT/u,
  /SOURCE_COMMIT_AT/u,
  /SOURCE_BRANCH/u,
  /STATIC_EGRESS_IPS/u
];

const unsafeRawValuePatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bAIza[0-9A-Za-z_-]{20,}/u,
  /\bya29\.[0-9A-Za-z._-]+/u,
  /GOCSPX-[0-9A-Za-z_-]{20,}/u,
  /Bearer\s+(?!\[REDACTED\])[\w.~+/=-]+/iu,
  /\b(?:refresh_token|access_token|password|secret|api[_-]?key)\s*[:=]\s*[^,\s;]+/iu
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
  const secretAnnotations = parseSecretAnnotations(manifest);
  const image = extractScalar(manifest, "image") || "missing";
  const runtimeServiceAccount = extractScalar(manifest, "serviceAccountName") || "missing";
  const checks = [
    ...requiredNonSecretEnv.map((name) => checkNonSecret(name, envByName.get(name))),
    ...requiredSecretEnv.flatMap((name) => [
      checkSecret(name, envByName.get(name)),
      checkSecretAnnotation(name, envByName.get(name), secretAnnotations, envByName.get("GOOGLE_CLOUD_PROJECT_NUMBER")?.value)
    ]),
    ...prohibitedCredentialEnv.flatMap((item) => checkProhibitedCredentialEnv(item, envByName.get(item.name))),
    ...checkProductionValueInvariants(envByName, image, runtimeServiceAccount),
    ...checkDuplicateEnvEntries(envEntries),
    ...checkUnsafeRawEnvValues(envEntries)
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
    envChecks: checks,
    replacementFindings: replacements,
    manualReviewFlags: checks.filter((check) => check.status === "manual-review").map((check) => check.name),
    secretRefs: requiredSecretEnv
      .map((name) => envByName.get(name))
      .filter((entry) => entry?.secretName)
      .map((entry) => ({ envName: entry.name, secretName: entry.secretName, version: entry.secretVersion })),
    blockers,
    nextActions:
      status === "ready-to-dry-run"
        ? ["Run Cloud Run dry-run, deploy after review, then run hosted production verification."]
        : [
            "Render production placeholders into an ignored manifest, keep secrets in Secret Manager, then rerun this verifier.",
            "Confirm every secretKeyRef name is mapped in run.googleapis.com/secrets before Cloud Run dry-run."
          ]
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

function parseSecretAnnotations(manifest) {
  const match = manifest.match(/run\.googleapis\.com\/secrets:\s*(?:"([^"]*)"|'([^']*)'|([^\n]*))/u);
  const rawAnnotation = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
  const annotations = new Map();

  for (const item of rawAnnotation.split(",")) {
    const [lookupName, ...targetParts] = item.trim().split(":");
    const target = targetParts.join(":").trim();

    if (lookupName && target) {
      annotations.set(lookupName.trim(), target);
    }
  }

  return annotations;
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
  if (manualReviewEnv.has(name)) {
    const attested = entry.value === "true";
    return check(
      name,
      "manual-review",
      entry.value,
      attested
        ? "Human attestation is set true; Cloud Run manifest review must still verify the private evidence packet."
        : "Human attestation is not confirmed.",
      attested
        ? "Confirm the linked private evidence exists before relying on this deployment flag in XPRIZE materials."
        : "Set true only after private proof exists."
    );
  }
  return check(name, "passed", entry.value, "Value is present.", "No action.");
}

function checkSecretAnnotation(envName, entry, annotations, projectNumber) {
  const lookupName = entry?.secretName || secretLookupNameByEnvName[envName];
  const annotationTarget = annotations.get(lookupName);
  const checkName = `${envName}_SECRET_ANNOTATION`;

  if (!annotationTarget) {
    return check(
      checkName,
      "blocked",
      "missing",
      "Cloud Run YAML secret lookup is missing from run.googleapis.com/secrets.",
      `Add ${lookupName}:projects/PROJECT_NUMBER/secrets/${lookupName} to the Cloud Run secrets annotation.`
    );
  }

  if (hasPlaceholder(annotationTarget)) {
    return check(
      checkName,
      "needs-value",
      annotationTarget,
      "Cloud Run YAML secret lookup still contains a project placeholder.",
      "Render GOOGLE_CLOUD_PROJECT_NUMBER into run.googleapis.com/secrets before Cloud Run dry-run."
    );
  }

  if (!annotationTarget.endsWith(`/secrets/${lookupName}`)) {
    return check(
      checkName,
      "blocked",
      annotationTarget,
      "Cloud Run YAML secret lookup points at a different Secret Manager resource.",
      `Point ${lookupName} at projects/PROJECT_NUMBER/secrets/${lookupName}.`
    );
  }

  if (projectNumber && !hasPlaceholder(projectNumber) && annotationTarget !== `projects/${projectNumber}/secrets/${lookupName}`) {
    return check(
      checkName,
      "blocked",
      annotationTarget,
      "Cloud Run YAML secret lookup points at a different Google Cloud project number than GOOGLE_CLOUD_PROJECT_NUMBER.",
      `Point ${lookupName} at projects/${projectNumber}/secrets/${lookupName}.`
    );
  }

  return check(
    checkName,
    "passed",
    annotationTarget,
    "Cloud Run YAML secret lookup maps to a Secret Manager resource.",
    "No action."
  );
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
  if (!/^[1-9][0-9]*$/u.test(entry.secretVersion)) {
    return check(name, "blocked", `${entry.secretName}:invalid-version`, "Secret reference does not use a numeric reviewed version.", "Pin a numeric version.");
  }
  return check(name, "passed", `${entry.secretName}:version-set`, "Secret reference uses an explicit version.", "No action.");
}

function checkProhibitedCredentialEnv(item, entry) {
  if (!entry) {
    return [];
  }

  return [
    check(
      item.name,
      "blocked",
      entry.secretName ? `secret:${entry.secretName}` : "raw-value",
      item.evidence,
      item.fix
    )
  ];
}

function checkProductionValueInvariants(envByName, image, runtimeServiceAccount) {
  const checks = [];
  const projectId = cleanEnvValue(envByName, "GOOGLE_CLOUD_PROJECT");
  const projectNumber = cleanEnvValue(envByName, "GOOGLE_CLOUD_PROJECT_NUMBER");
  const region = cleanEnvValue(envByName, "SENTINEL_CLOUD_RUN_REGION");
  const productUrl = cleanEnvValue(envByName, "NEXT_PUBLIC_PRODUCT_URL");
  const billingAccountId = cleanEnvValue(envByName, "GOOGLE_CLOUD_BILLING_ACCOUNT_ID");
  const geminiModel = cleanEnvValue(envByName, "GEMINI_MODEL");
  const geminiAllowlist = cleanEnvValue(envByName, "SENTINEL_GEMINI_MODEL_ALLOWLIST");
  const releaseId = cleanEnvValue(envByName, "SENTINEL_RELEASE_ID");
  const sourceCommit = cleanEnvValue(envByName, "SENTINEL_SOURCE_COMMIT");
  const sourceCommitAt = cleanEnvValue(envByName, "SENTINEL_SOURCE_COMMIT_AT");
  const demoVideoUrl = cleanEnvValue(envByName, "XPRIZE_DEMO_VIDEO_URL");
  const entrantType = cleanEnvValue(envByName, "XPRIZE_ENTRANT_TYPE");
  const oauthClientId = cleanEnvValue(envByName, "GOOGLE_OAUTH_CLIENT_ID");

  for (const [name, expectedValue] of Object.entries(fixedProductionEnvValues)) {
    const value = cleanEnvValue(envByName, name);
    if (value && value !== expectedValue) {
      checks.push(check(`INVALID_VALUE_${name}`, "blocked", value, `${name} must be ${expectedValue} for production Cloud Run.`, `Set ${name} to "${expectedValue}".`));
    }
  }

  for (const name of booleanEnv) {
    const value = cleanEnvValue(envByName, name);
    if (value && value !== "true" && value !== "false") {
      checks.push(check(`INVALID_BOOLEAN_${name}`, "blocked", value, `${name} must be the literal string true or false.`, `Set ${name} to "true" only after evidence exists, otherwise keep "false".`));
    }
  }

  if (projectId && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(projectId)) {
    checks.push(check("INVALID_GOOGLE_CLOUD_PROJECT", "blocked", projectId, "GOOGLE_CLOUD_PROJECT does not look like a valid Google Cloud project id.", "Use the real lower-case Google Cloud project id."));
  }

  if (projectNumber && !/^[1-9][0-9]{5,20}$/u.test(projectNumber)) {
    checks.push(check("INVALID_GOOGLE_CLOUD_PROJECT_NUMBER", "blocked", projectNumber, "GOOGLE_CLOUD_PROJECT_NUMBER does not look like a numeric Google Cloud project number.", "Use the numeric Google Cloud project number."));
  }

  if (productUrl && !isHttpsUrl(productUrl)) {
    checks.push(check("INVALID_NEXT_PUBLIC_PRODUCT_URL", "blocked", productUrl, "NEXT_PUBLIC_PRODUCT_URL must be a hosted HTTPS URL.", "Use the final Cloud Run HTTPS service URL."));
  }

  checks.push(
    ...checkHttpsUrl(envByName, "XPRIZE_REPOSITORY_URL"),
    ...checkHttpsUrl(envByName, "XPRIZE_DEMO_VIDEO_URL"),
    ...checkHttpsUrl(envByName, "GOOGLE_OAUTH_REDIRECT_URI"),
    ...checkHttpsUrl(envByName, "WORKSPACE_PUBSUB_PUSH_AUDIENCE")
  );

  if (demoVideoUrl && isHttpsUrl(demoVideoUrl) && !isAllowedDemoVideoHost(demoVideoUrl)) {
    checks.push(
      check(
        "INVALID_XPRIZE_DEMO_VIDEO_URL_HOST",
        "blocked",
        demoVideoUrl,
        "XPRIZE_DEMO_VIDEO_URL must point to YouTube, Vimeo, or Youku for the final public demo video.",
        "Use the final public YouTube, Vimeo, or Youku video URL before Cloud Run dry-run."
      )
    );
  }

  if (entrantType && !allowedEntrantTypes.has(entrantType)) {
    checks.push(
      check(
        "INVALID_XPRIZE_ENTRANT_TYPE",
        "blocked",
        entrantType,
        "XPRIZE_ENTRANT_TYPE must be individual, team, or organization.",
        "Set XPRIZE_ENTRANT_TYPE to individual, team, or organization after eligibility review."
      )
    );
  }

  if (oauthClientId && !/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/u.test(oauthClientId)) {
    checks.push(
      check(
        "INVALID_GOOGLE_OAUTH_CLIENT_ID",
        "blocked",
        oauthClientId,
        "GOOGLE_OAUTH_CLIENT_ID does not match the expected Google OAuth web-client id shape.",
        "Use the hosted Google OAuth web client id ending in .apps.googleusercontent.com."
      )
    );
  }

  if (productUrl && isHttpsUrl(productUrl)) {
    checks.push(
      ...checkExpectedValue(envByName, "GOOGLE_OAUTH_REDIRECT_URI", `${trimTrailingSlash(productUrl)}/api/oauth/google/callback`),
      ...checkExpectedValue(envByName, "WORKSPACE_PUBSUB_PUSH_AUDIENCE", `${trimTrailingSlash(productUrl)}/api/webhooks/pubsub/gmail`)
    );
  }

  if (projectId && !hasPlaceholder(projectId)) {
    checks.push(
      ...checkExpectedValue(envByName, "SENTINEL_BUDGET_PUBSUB_TOPIC", `projects/${projectId}/topics/sentinel-budget-alerts`),
      ...checkExpectedValue(envByName, "WORKSPACE_GMAIL_TOPIC", `projects/${projectId}/topics/workspace-gmail-updates`),
      ...checkExpectedValue(envByName, "WORKSPACE_GMAIL_SUBSCRIPTION", `projects/${projectId}/subscriptions/workspace-gmail-push`),
      ...checkExpectedValue(envByName, "WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL", `workspace-push@${projectId}.iam.gserviceaccount.com`)
    );

    if (runtimeServiceAccount !== "missing" && !hasPlaceholder(runtimeServiceAccount) && runtimeServiceAccount !== `sentinel-runtime@${projectId}.iam.gserviceaccount.com`) {
      checks.push(check("INVALID_CLOUD_RUN_SERVICE_ACCOUNT", "blocked", runtimeServiceAccount, "Cloud Run runtime service account does not match GOOGLE_CLOUD_PROJECT.", `Use sentinel-runtime@${projectId}.iam.gserviceaccount.com or update the verifier only with reviewed policy.`));
    }
  }

  if (projectId && region && image !== "missing" && !hasPlaceholder(image) && !image.startsWith(`${region}-docker.pkg.dev/${projectId}/`)) {
    checks.push(check("INVALID_CLOUD_RUN_IMAGE", "blocked", image, "Container image registry does not match SENTINEL_CLOUD_RUN_REGION and GOOGLE_CLOUD_PROJECT.", "Render the image as REGION-docker.pkg.dev/PROJECT_ID/sentinel/web:RELEASE_ID."));
  }

  if (image !== "missing" && !hasPlaceholder(image)) {
    const imageTag = extractImageTag(image);
    if (!imageTag && !image.includes("@sha256:")) {
      checks.push(check("INVALID_CLOUD_RUN_IMAGE_TAG", "blocked", image, "Container image is missing an explicit release tag or digest.", "Render the image with a tag derived from SENTINEL_RELEASE_ID before Cloud Run dry-run."));
    }

    if (imageTag === "latest") {
      checks.push(check("INVALID_CLOUD_RUN_IMAGE_TAG", "blocked", imageTag, "Container image uses the mutable latest tag.", "Use the release-id tag generated by render:cloudrun-manifest so source, image, and Cloud Run revision evidence can be tied together."));
    }

    if (releaseId && imageTag && imageTag !== dockerTag(releaseId)) {
      checks.push(check("MISMATCHED_CLOUD_RUN_IMAGE_TAG", "blocked", imageTag, "Container image tag does not match SENTINEL_RELEASE_ID.", `Render the image tag as ${dockerTag(releaseId)} or rerender the manifest for the intended release id.`));
    }
  }

  if (sourceCommit && !/^[a-f0-9]{40}$/iu.test(sourceCommit)) {
    checks.push(check("INVALID_SENTINEL_SOURCE_COMMIT", "blocked", sourceCommit, "SENTINEL_SOURCE_COMMIT must be the full 40-character Git commit SHA used to build the deployed image.", "Render SENTINEL_SOURCE_COMMIT from git rev-parse HEAD before Cloud Run dry-run."));
  }

  if (sourceCommitAt && Number.isNaN(Date.parse(sourceCommitAt))) {
    checks.push(check("INVALID_SENTINEL_SOURCE_COMMIT_AT", "blocked", sourceCommitAt, "SENTINEL_SOURCE_COMMIT_AT must be an ISO timestamp for the source commit used to build the deployed image.", "Render SENTINEL_SOURCE_COMMIT_AT from git log -1 --format=%cI before Cloud Run dry-run."));
  }

  if (billingAccountId && !/^[A-Z0-9]{6}-[A-Z0-9]{6}-[A-Z0-9]{6}$/u.test(billingAccountId)) {
    checks.push(check("INVALID_GOOGLE_CLOUD_BILLING_ACCOUNT_ID", "blocked", billingAccountId, "GOOGLE_CLOUD_BILLING_ACCOUNT_ID does not match the expected billing-account id shape.", "Use the real billing account id or keep the template placeholder."));
  }

  if (billingAccountId) {
    const budgetId = cleanEnvValue(envByName, "SENTINEL_GCP_BUDGET_ID");
    if (budgetId && !budgetId.startsWith(`billingAccounts/${billingAccountId}/budgets/`)) {
      checks.push(check("INVALID_SENTINEL_GCP_BUDGET_ID", "blocked", budgetId, "SENTINEL_GCP_BUDGET_ID does not belong to GOOGLE_CLOUD_BILLING_ACCOUNT_ID.", "Render the budget id from the same billing account."));
    }
  }

  if (projectNumber) {
    const geminiApiKeyId = cleanEnvValue(envByName, "SENTINEL_GEMINI_API_KEY_ID");
    if (geminiApiKeyId && !new RegExp(`^projects/${escapeRegExp(projectNumber)}/locations/global/keys/[A-Za-z0-9_-]+$`, "u").test(geminiApiKeyId)) {
      checks.push(check("INVALID_SENTINEL_GEMINI_API_KEY_ID", "blocked", geminiApiKeyId, "SENTINEL_GEMINI_API_KEY_ID does not match the expected Google API key resource path.", "Render SENTINEL_GEMINI_API_KEY_ID as projects/PROJECT_NUMBER/locations/global/keys/KEY_ID."));
    }
  }

  if (geminiModel && geminiAllowlist) {
    const allowed = geminiAllowlist.split(",").map((item) => item.trim()).filter(Boolean);
    if (!allowed.includes(geminiModel)) {
      checks.push(check("INVALID_GEMINI_MODEL_ALLOWLIST", "blocked", geminiAllowlist, "GEMINI_MODEL is not present in SENTINEL_GEMINI_MODEL_ALLOWLIST.", "Add the selected Gemini model to the allowlist or choose an allowed model."));
    }
  }

  checks.push(
    ...checkGeminiServerIpAllowlist(envByName),
    ...checkPositiveNumberEnv(envByName, "SENTINEL_GEMINI_MONTHLY_BUDGET_USD"),
    ...checkPositiveNumberEnv(envByName, "SENTINEL_GEMINI_MAX_CONTENT_BYTES_PER_EVENT", true),
    ...checkPositiveNumberEnv(envByName, "SENTINEL_GEMINI_DAILY_REQUEST_QUOTA", true),
    ...checkPositiveNumberEnv(envByName, "SENTINEL_GEMINI_DAILY_TOKEN_QUOTA", true),
    ...checkPositiveNumberEnv(envByName, "GEMINI_INPUT_PER_1K_USD"),
    ...checkPositiveNumberEnv(envByName, "GEMINI_OUTPUT_PER_1K_USD")
  );

  return checks;
}

function checkDuplicateEnvEntries(envEntries) {
  const counts = new Map();
  for (const entry of envEntries) {
    counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => check(`DUPLICATE_ENV_${name}`, "blocked", `count:${count}`, "Cloud Run manifest contains duplicate env var names.", `Keep exactly one ${name} env entry.`));
}

function checkUnsafeRawEnvValues(envEntries) {
  return envEntries
    .filter((entry) => entry.value && unsafeRawValuePatterns.some((pattern) => pattern.test(entry.value ?? "")))
    .map((entry) => check(`UNSAFE_RAW_VALUE_${entry.name}`, "blocked", "raw-value", "Cloud Run manifest env value appears to contain a raw credential or secret-shaped token.", `Move any secret material for ${entry.name} to Secret Manager or remove it.`));
}

function checkHttpsUrl(envByName, name) {
  const value = cleanEnvValue(envByName, name);
  if (!value || isHttpsUrl(value)) {
    return [];
  }

  return [check(`INVALID_URL_${name}`, "blocked", value, `${name} must be an HTTPS URL before production deployment.`, `Set ${name} to a hosted HTTPS URL or keep the template placeholder.`)];
}

function checkExpectedValue(envByName, name, expectedValue) {
  const value = cleanEnvValue(envByName, name);
  if (!value || value === expectedValue) {
    return [];
  }

  return [check(`MISMATCHED_${name}`, "blocked", value, `${name} does not match the deployment contract.`, `Set ${name} to ${expectedValue}.`)];
}

function checkPositiveNumberEnv(envByName, name, integer = false) {
  const value = cleanEnvValue(envByName, name);
  if (!value) {
    return [];
  }

  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0 || (integer && !Number.isInteger(numberValue))) {
    return [
      check(
        `INVALID_NUMBER_${name}`,
        "blocked",
        value,
        `${name} must be a positive${integer ? " integer" : ""} value.`,
        `Set ${name} to a reviewed positive${integer ? " integer" : ""} deployment value.`
      )
    ];
  }

  return [];
}

function checkGeminiServerIpAllowlist(envByName) {
  const value = cleanEnvValue(envByName, "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS");
  if (!value) {
    return [];
  }

  const entries = value.split(",").map((item) => item.trim()).filter(Boolean);
  const invalidEntries = entries.filter((entry) => !isValidIpv4OrCidr(entry) || entry === "0.0.0.0/0");
  if (invalidEntries.length) {
    return [
      check(
        "INVALID_SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS",
        "blocked",
        invalidEntries.join(","),
        "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS must be a comma-separated allowlist of concrete IPv4 addresses or narrow CIDR ranges, not wildcards.",
        "Use the reviewed static Cloud Run egress IP addresses configured on the Gemini API key restriction."
      )
    ];
  }

  return [];
}

function cleanEnvValue(envByName, name) {
  const value = envByName.get(name)?.value;
  if (!value || hasPlaceholder(value)) {
    return "";
  }

  return value;
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

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

function isAllowedDemoVideoHost(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./u, "");
    return hostname === "youtu.be" || hostname === "youtube.com" || hostname === "vimeo.com" || hostname === "youku.com";
  } catch {
    return false;
  }
}

function isValidIpv4OrCidr(value) {
  const [address, prefix] = value.split("/");
  const octets = address.split(".");
  if (octets.length !== 4) {
    return false;
  }

  if (
    !octets.every((octet) => {
      if (!/^[0-9]{1,3}$/u.test(octet)) {
        return false;
      }
      const parsed = Number(octet);
      return parsed >= 0 && parsed <= 255;
    })
  ) {
    return false;
  }

  if (prefix === undefined) {
    return true;
  }

  if (!/^[0-9]{1,2}$/u.test(prefix)) {
    return false;
  }

  const parsedPrefix = Number(prefix);
  return parsedPrefix >= 1 && parsedPrefix <= 32;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/u, "");
}

function extractImageTag(image) {
  const imageWithoutDigest = image.split("@sha256:")[0] ?? image;
  const lastSlashIndex = imageWithoutDigest.lastIndexOf("/");
  const lastColonIndex = imageWithoutDigest.lastIndexOf(":");

  if (lastColonIndex <= lastSlashIndex) {
    return "";
  }

  return imageWithoutDigest.slice(lastColonIndex + 1);
}

function dockerTag(value) {
  return String(value || "latest")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120) || "latest";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
