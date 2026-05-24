/* global URL, console, process */

import { readFileSync } from "node:fs";

const deploymentContract = JSON.parse(
  readFileSync(new URL("../docs/deployment/cloudrun-deployment-contract.json", import.meta.url), "utf8")
);
const manifestPath = process.argv.find((arg) => arg.startsWith("--manifest="))?.slice("--manifest=".length) ?? "cloudrun.service.yaml";
const strict = process.argv.includes("--strict");

const requiredNonSecretEnv = deploymentContract.requiredNonSecretEnv ?? [];
const requiredSecretEnv = (deploymentContract.requiredSecretEnv ?? []).map((entry) => entry.envName);
const secretLookupNameByEnvName = Object.fromEntries(
  (deploymentContract.requiredSecretEnv ?? []).map((entry) => [entry.envName, entry.secretName])
);

const prohibitedCredentialMetadata = {
  GOOGLE_CLOUD_ACCESS_TOKEN: {
    evidence: "Cloud Run should use the runtime service account and metadata server, not a committed access-token env var.",
    fix: "Remove this env var from cloudrun.service.yaml and grant the Cloud Run service account the required IAM roles."
  },
  GOOGLE_APPLICATION_CREDENTIALS: {
    evidence: "Cloud Run should use the runtime service account, not a mounted or committed service-account key path.",
    fix: "Remove this env var and deploy with serviceAccountName plus least-privilege IAM."
  },
  GOOGLE_OAUTH_REFRESH_TOKEN: {
    evidence: "Workspace OAuth refresh tokens must be stored per tenant in Secret Manager, not as shared service env vars.",
    fix: "Remove this env var and store tenant OAuth refresh-token payloads under WORKSPACE_SECRET_PREFIX."
  },
  WORKSPACE_REFRESH_TOKEN: {
    evidence: "Workspace OAuth refresh tokens must be tenant-scoped Secret Manager entries.",
    fix: "Remove this env var and use the OAuth callback Secret Manager storage path."
  },
  XPRIZE_JUDGE_CREDENTIALS: {
    evidence: "Judge credentials belong only in private Devpost testing instructions or an approved private channel.",
    fix: "Remove this env var and keep judge credentials outside source and deployment manifests."
  },
  XPRIZE_JUDGE_PASSWORD: {
    evidence: "Judge credentials must not be committed or exposed through Cloud Run env metadata.",
    fix: "Remove this env var and provide credentials only through private judging instructions."
  }
};

const prohibitedCredentialEnv = (deploymentContract.prohibitedCredentialEnv ?? []).map((name) => ({
  name,
  evidence:
    prohibitedCredentialMetadata[name]?.evidence ??
    "Cloud Run deployment env must not expose raw credentials, tokens, private customer proof, or judge access material.",
  fix:
    prohibitedCredentialMetadata[name]?.fix ??
    "Remove this env var and store the value only in the approved private evidence or Secret Manager path."
}));

const manualReviewEnv = new Set(deploymentContract.manualReviewEnv ?? []);

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
const allowedRepositoryAccessModes = new Set(["public", "private-shared"]);
const requiredRepositoryJudgeEmails = ["testing@devpost.com", "judging@hacker.fund"];
const requiredJudgingPeriodEndAt = "2026-09-15T17:00:00-07:00";
const evidenceFlagDependencies = deploymentContract.evidenceFlagDependencies ?? [];

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
  const repositoryAccessMode = cleanEnvValue(envByName, "XPRIZE_REPOSITORY_ACCESS_MODE");
  const repositoryJudgeAccessEmails = cleanEnvValue(envByName, "XPRIZE_REPOSITORY_JUDGE_ACCESS_EMAILS");
  const judgeAccessConfigured = cleanEnvValue(envByName, "XPRIZE_JUDGE_ACCESS_CONFIGURED");
  const freeJudgeAccessConfirmed = cleanEnvValue(envByName, "XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED");
  const judgingPeriodEndAt = cleanEnvValue(envByName, "XPRIZE_JUDGING_PERIOD_END_AT");

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

  if (repositoryAccessMode && !allowedRepositoryAccessModes.has(repositoryAccessMode)) {
    checks.push(
      check(
        "INVALID_XPRIZE_REPOSITORY_ACCESS_MODE",
        "blocked",
        repositoryAccessMode,
        "XPRIZE_REPOSITORY_ACCESS_MODE must be public or private-shared.",
        "Set repository access mode to public for a public repository or private-shared after verifying required judge/testing access."
      )
    );
  }

  if (repositoryAccessMode === "private-shared") {
    const configuredEmails = parseCsv(repositoryJudgeAccessEmails).map((email) => email.toLowerCase());
    const missingEmails = requiredRepositoryJudgeEmails.filter((email) => !configuredEmails.includes(email));

    if (missingEmails.length) {
      checks.push(
        check(
          "MISSING_XPRIZE_REPOSITORY_JUDGE_ACCESS_EMAILS",
          "blocked",
          missingEmails.join(","),
          "Private repository judging access is missing one or more required judge/testing emails.",
          `Share the repository with ${requiredRepositoryJudgeEmails.join(", ")} or set XPRIZE_REPOSITORY_ACCESS_MODE to public after making the repository public.`
        )
      );
    }
  }

  if (freeJudgeAccessConfirmed === "true" && judgeAccessConfigured !== "true") {
    checks.push(
      check(
        "INCONSISTENT_XPRIZE_JUDGE_ACCESS_FLAGS",
        "blocked",
        "free-access-true-without-judge-access",
        "Free judging-period access cannot be confirmed before judge access itself is configured.",
        "Set XPRIZE_JUDGE_ACCESS_CONFIGURED=true only after hosted judge access exists, then confirm free access through the judging period."
      )
    );
  }
  checks.push(...checkEvidenceFlagDependencies(envByName));

  if (judgingPeriodEndAt) {
    const judgingEndTimestamp = Date.parse(judgingPeriodEndAt);

    if (!Number.isFinite(judgingEndTimestamp) || judgingEndTimestamp < Date.parse(requiredJudgingPeriodEndAt)) {
      checks.push(
        check(
          "INVALID_XPRIZE_JUDGING_PERIOD_END_AT",
          "blocked",
          judgingPeriodEndAt,
          "XPRIZE_JUDGING_PERIOD_END_AT must cover the official judging period end.",
          `Set XPRIZE_JUDGING_PERIOD_END_AT to ${requiredJudgingPeriodEndAt} or later if official rules change.`
        )
      );
    }
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

function checkEvidenceFlagDependencies(envByName) {
  return evidenceFlagDependencies.flatMap((definition) => {
    if (cleanEnvValue(envByName, definition.flag) !== "true") {
      return [];
    }

    const missing = definition.requires.filter((name) => cleanEnvValue(envByName, name) !== "true");
    if (!missing.length) {
      return [];
    }

    return [
      check(
        `INCONSISTENT_${definition.flag}`,
        "blocked",
        missing.join(","),
        definition.evidence,
        `${definition.flag}=true requires ${missing.join(", ")}. Keep ${definition.flag}=false until those private proof flags are reviewed.`
      )
    ];
  });
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

function parseCsv(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
