import { readFileSync } from "node:fs";
import { join } from "node:path";
import deploymentContract from "@/docs/deployment/cloudrun-deployment-contract.json";
import type {
  CloudRunDeploymentEnvCheck,
  CloudRunDeploymentEvidence,
  CloudRunDeploymentReplacementFinding
} from "@/lib/types";

const defaultManifestPath = "cloudrun.service.yaml";
const defaultRenderedManifestPath = "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun.service.rendered.yaml";
const serviceName = "sme-workspace-sentinel";
const recommendedRegion = "us-central1";

const requiredNonSecretEnv = deploymentContract.requiredNonSecretEnv;
const requiredSecretEnv = deploymentContract.requiredSecretEnv.map((entry) => entry.envName);
const requiredSecretEnvSet = new Set<string>(requiredSecretEnv);
const secretLookupNameByEnvName = Object.fromEntries(
  deploymentContract.requiredSecretEnv.map((entry) => [entry.envName, entry.secretName])
) as Record<string, string>;

const prohibitedCredentialMetadata: Record<string, { evidence: string; fix: string }> = {
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

const prohibitedCredentialEnv = deploymentContract.prohibitedCredentialEnv.map((name) => ({
  name,
  evidence:
    prohibitedCredentialMetadata[name]?.evidence ??
    "Cloud Run deployment env must not expose raw credentials, tokens, private customer proof, or judge access material.",
  fix:
    prohibitedCredentialMetadata[name]?.fix ??
    "Remove this env var and store the value only in the approved private evidence or Secret Manager path."
}));

const manualReviewEnv = new Set(deploymentContract.manualReviewEnv);

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
  XPRIZE_CATEGORY: "Small Business Services",
  SENTINEL_WORKSPACE_WEBHOOK_AUTH_MODE: "oidc",
  SENSITIVE_DATA_PROTECTION_ENABLED: "true"
};

const allowedEntrantTypes = new Set(["individual", "team", "organization"]);
const allowedRepositoryAccessModes = new Set(["public", "private-shared"]);
const requiredRepositoryJudgeEmails = ["testing@devpost.com", "judging@hacker.fund"];
const requiredSubmissionCloseAt = "2026-08-17T13:00:00-07:00";
const requiredJudgingPeriodEndAt = "2026-09-15T17:00:00-07:00";
const requiredEvidenceResponseSlaBusinessDays = 2;
const requiredPilotOauthScopes = [
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/gmail.metadata"
];
const deferredRestrictedOauthScopes = ["https://www.googleapis.com/auth/drive"];
const evidenceFlagDependencies = deploymentContract.evidenceFlagDependencies;

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

  if (manualReviewEnv.has(name)) {
    const attested = value === "true";

    return envCheck(
      name,
      categoryForEnv(name),
      "manual-review",
      false,
      value,
      attested
        ? "Human attestation is set true; Cloud Run manifest review must still verify the private evidence packet."
        : "Human attestation is intentionally not confirmed in the template.",
      attested
        ? "Confirm the linked private evidence exists before relying on this deployment flag in XPRIZE materials."
        : "Set true only after private evidence exists and the responsible owner approves."
    );
  }

  return envCheck(name, categoryForEnv(name), "passed", false, value, "Value is present and has no template placeholder.", "No action.");
}

function checkSecretAnnotation(
  envName: string,
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
  const submissionCloseAt = cleanEnvValue(envByName, "XPRIZE_SUBMISSION_CLOSE_AT");
  const judgingPeriodEndAt = cleanEnvValue(envByName, "XPRIZE_JUDGING_PERIOD_END_AT");
  const evidenceResponseSlaBusinessDays = cleanEnvValue(envByName, "XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS");

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

  if (demoVideoUrl && isHttpsUrl(demoVideoUrl) && !isAllowedDemoVideoHost(demoVideoUrl)) {
    checks.push(
      envCheck(
        "INVALID_XPRIZE_DEMO_VIDEO_URL_HOST",
        "xprize",
        "blocked",
        false,
        demoVideoUrl,
        "XPRIZE_DEMO_VIDEO_URL must point to YouTube, Vimeo, or Youku for the final public demo video.",
        "Use the final public YouTube, Vimeo, or Youku video URL before Cloud Run dry-run."
      )
    );
  }

  if (entrantType && !allowedEntrantTypes.has(entrantType)) {
    checks.push(
      envCheck(
        "INVALID_XPRIZE_ENTRANT_TYPE",
        "xprize",
        "blocked",
        false,
        entrantType,
        "XPRIZE_ENTRANT_TYPE must be individual, team, or organization.",
        "Set XPRIZE_ENTRANT_TYPE to individual, team, or organization after eligibility review."
      )
    );
  }

  if (repositoryAccessMode && !allowedRepositoryAccessModes.has(repositoryAccessMode)) {
    checks.push(
      envCheck(
        "INVALID_XPRIZE_REPOSITORY_ACCESS_MODE",
        "xprize",
        "blocked",
        false,
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
        envCheck(
          "MISSING_XPRIZE_REPOSITORY_JUDGE_ACCESS_EMAILS",
          "xprize",
          "blocked",
          false,
          missingEmails.join(","),
          "Private repository judging access is missing one or more required judge/testing emails.",
          `Share the repository with ${requiredRepositoryJudgeEmails.join(", ")} or set XPRIZE_REPOSITORY_ACCESS_MODE to public after making the repository public.`
        )
      );
    }
  }

  if (freeJudgeAccessConfirmed === "true" && judgeAccessConfigured !== "true") {
    checks.push(
      envCheck(
        "INCONSISTENT_XPRIZE_JUDGE_ACCESS_FLAGS",
        "xprize",
        "blocked",
        false,
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
        envCheck(
          "INVALID_XPRIZE_JUDGING_PERIOD_END_AT",
          "xprize",
          "blocked",
          false,
          judgingPeriodEndAt,
          "XPRIZE_JUDGING_PERIOD_END_AT must cover the official judging period end.",
          `Set XPRIZE_JUDGING_PERIOD_END_AT to ${requiredJudgingPeriodEndAt} or later if official rules change.`
        )
      );
    }
  }

  if (submissionCloseAt) {
    const submissionCloseTimestamp = Date.parse(submissionCloseAt);

    if (!Number.isFinite(submissionCloseTimestamp) || submissionCloseTimestamp !== Date.parse(requiredSubmissionCloseAt)) {
      checks.push(
        envCheck(
          "INVALID_XPRIZE_SUBMISSION_CLOSE_AT",
          "xprize",
          "blocked",
          false,
          submissionCloseAt,
          "XPRIZE_SUBMISSION_CLOSE_AT must match the official submission deadline used for deployment freeze planning.",
          `Set XPRIZE_SUBMISSION_CLOSE_AT to ${requiredSubmissionCloseAt} unless official rules change and the verifier is updated.`
        )
      );
    }
  }

  if (evidenceResponseSlaBusinessDays) {
    const slaDays = Number(evidenceResponseSlaBusinessDays);

    if (!Number.isInteger(slaDays) || slaDays < 1 || slaDays > requiredEvidenceResponseSlaBusinessDays) {
      checks.push(
        envCheck(
          "INVALID_XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS",
          "xprize",
          "blocked",
          false,
          evidenceResponseSlaBusinessDays,
          "XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS must be a positive integer no greater than the official response window.",
          `Set XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS to ${requiredEvidenceResponseSlaBusinessDays} or less.`
        )
      );
    }
  }

  if (oauthClientId && !/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/u.test(oauthClientId)) {
    checks.push(
      envCheck(
        "INVALID_GOOGLE_OAUTH_CLIENT_ID",
        "workspace",
        "blocked",
        false,
        oauthClientId,
        "GOOGLE_OAUTH_CLIENT_ID does not match the expected Google OAuth web-client id shape.",
        "Use the hosted Google OAuth web client id ending in .apps.googleusercontent.com."
      )
    );
  }

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

  if (image !== "missing" && !hasPlaceholder(image)) {
    const imageTag = extractImageTag(image);
    if (!imageTag && !image.includes("@sha256:")) {
      checks.push(
        envCheck(
          "INVALID_CLOUD_RUN_IMAGE_TAG",
          "google-cloud",
          "blocked",
          false,
          image,
          "Container image is missing an explicit release tag or digest.",
          "Render the image with a tag derived from SENTINEL_RELEASE_ID before Cloud Run dry-run."
        )
      );
    }

    if (imageTag === "latest") {
      checks.push(
        envCheck(
          "INVALID_CLOUD_RUN_IMAGE_TAG",
          "google-cloud",
          "blocked",
          false,
          imageTag,
          "Container image uses the mutable latest tag.",
          "Use the release-id tag generated by render:cloudrun-manifest so source, image, and Cloud Run revision evidence can be tied together."
        )
      );
    }

    if (releaseId && imageTag && imageTag !== dockerTag(releaseId)) {
      checks.push(
        envCheck(
          "MISMATCHED_CLOUD_RUN_IMAGE_TAG",
          "google-cloud",
          "blocked",
          false,
          imageTag,
          "Container image tag does not match SENTINEL_RELEASE_ID.",
          `Render the image tag as ${dockerTag(releaseId)} or rerender the manifest for the intended release id.`
        )
      );
    }
  }

  if (sourceCommit && !/^[a-f0-9]{40}$/iu.test(sourceCommit)) {
    checks.push(
      envCheck(
        "INVALID_SENTINEL_SOURCE_COMMIT",
        "evidence",
        "blocked",
        false,
        sourceCommit,
        "SENTINEL_SOURCE_COMMIT must be the full 40-character Git commit SHA used to build the deployed image.",
        "Render SENTINEL_SOURCE_COMMIT from git rev-parse HEAD before Cloud Run dry-run."
      )
    );
  }

  if (sourceCommitAt && Number.isNaN(Date.parse(sourceCommitAt))) {
    checks.push(
      envCheck(
        "INVALID_SENTINEL_SOURCE_COMMIT_AT",
        "evidence",
        "blocked",
        false,
        sourceCommitAt,
        "SENTINEL_SOURCE_COMMIT_AT must be an ISO timestamp for the source commit used to build the deployed image.",
        "Render SENTINEL_SOURCE_COMMIT_AT from git log -1 --format=%cI before Cloud Run dry-run."
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

  checks.push(
    ...checkGeminiServerIpAllowlist(envByName),
    ...checkPositiveNumberEnv(envByName, "SENTINEL_GEMINI_MONTHLY_BUDGET_USD", "gemini"),
    ...checkPositiveNumberEnv(envByName, "SENTINEL_GEMINI_MAX_CONTENT_BYTES_PER_EVENT", "gemini", true),
    ...checkPositiveNumberEnv(envByName, "SENTINEL_GEMINI_DAILY_REQUEST_QUOTA", "gemini", true),
    ...checkPositiveNumberEnv(envByName, "SENTINEL_GEMINI_DAILY_TOKEN_QUOTA", "gemini", true),
    ...checkPositiveNumberEnv(envByName, "GEMINI_INPUT_PER_1K_USD", "cost"),
    ...checkPositiveNumberEnv(envByName, "GEMINI_OUTPUT_PER_1K_USD", "cost"),
    ...checkOauthScopeBoundary(envByName)
  );

  return checks;
}

function checkOauthScopeBoundary(envByName: Map<string, ParsedEnvEntry>): CloudRunDeploymentEnvCheck[] {
  const requestedScopes = parseScopeList(cleanEnvValue(envByName, "GOOGLE_OAUTH_REQUESTED_SCOPES"));
  const deferredScopes = parseScopeList(cleanEnvValue(envByName, "GOOGLE_OAUTH_DEFERRED_RESTRICTED_SCOPES"));
  const checks: CloudRunDeploymentEnvCheck[] = [];

  if (requestedScopes.length) {
    const unexpectedRequested = requestedScopes.filter((scope) => !requiredPilotOauthScopes.includes(scope));
    const missingRequired = requiredPilotOauthScopes.filter((scope) => !requestedScopes.includes(scope));

    if (unexpectedRequested.length) {
      checks.push(
        envCheck(
          "INVALID_GOOGLE_OAUTH_REQUESTED_SCOPES",
          "workspace",
          "blocked",
          false,
          unexpectedRequested.join(","),
          "Requested OAuth scopes must stay limited to metadata-only Drive and Gmail pilot scopes before Marketplace verification.",
          "Remove restricted or content-access scopes from GOOGLE_OAUTH_REQUESTED_SCOPES and keep them in GOOGLE_OAUTH_DEFERRED_RESTRICTED_SCOPES until explicit review."
        )
      );
    }

    if (missingRequired.length) {
      checks.push(
        envCheck(
          "MISSING_GOOGLE_OAUTH_REQUESTED_SCOPES",
          "workspace",
          "blocked",
          false,
          missingRequired.join(","),
          "The Cloud Run deployment metadata no longer matches the app's least-privilege pilot OAuth launch plan.",
          `Keep GOOGLE_OAUTH_REQUESTED_SCOPES aligned with ${requiredPilotOauthScopes.join(",")}.`
        )
      );
    }
  }

  const missingDeferred = deferredRestrictedOauthScopes.filter((scope) => !deferredScopes.includes(scope));
  if (deferredScopes.length && missingDeferred.length) {
    checks.push(
      envCheck(
        "MISSING_GOOGLE_OAUTH_DEFERRED_RESTRICTED_SCOPES",
        "workspace",
        "blocked",
        false,
        missingDeferred.join(","),
        "Restricted Drive mutation scope must remain documented as deferred rather than silently disappearing from the deployment review.",
        `Keep GOOGLE_OAUTH_DEFERRED_RESTRICTED_SCOPES aligned with ${deferredRestrictedOauthScopes.join(",")}.`
      )
    );
  }

  const requestedRestricted = requestedScopes.filter((scope) => deferredRestrictedOauthScopes.includes(scope));
  if (requestedRestricted.length) {
    checks.push(
      envCheck(
        "REQUESTED_RESTRICTED_GOOGLE_OAUTH_SCOPES",
        "workspace",
        "blocked",
        false,
        requestedRestricted.join(","),
        "Restricted remediation scopes cannot be requested in the first-pilot OAuth set.",
        "Keep restricted mutation scopes deferred until the tenant explicitly enables human-approved remediation and OAuth review is complete."
      )
    );
  }

  return checks;
}

function checkEvidenceFlagDependencies(envByName: Map<string, ParsedEnvEntry>): CloudRunDeploymentEnvCheck[] {
  return evidenceFlagDependencies.flatMap((definition) => {
    if (cleanEnvValue(envByName, definition.flag) !== "true") {
      return [];
    }

    const missing = definition.requires.filter((name) => cleanEnvValue(envByName, name) !== "true");
    if (!missing.length) {
      return [];
    }

    return [
      envCheck(
        `INCONSISTENT_${definition.flag}`,
        "xprize",
        "blocked",
        false,
        missing.join(","),
        definition.evidence,
        `${definition.flag}=true requires ${missing.join(", ")}. Keep ${definition.flag}=false until those private proof flags are reviewed.`
      )
    ];
  });
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

function checkPositiveNumberEnv(
  envByName: Map<string, ParsedEnvEntry>,
  name: string,
  category: CloudRunDeploymentEnvCheck["category"],
  integer = false
): CloudRunDeploymentEnvCheck[] {
  const value = cleanEnvValue(envByName, name);
  if (!value) {
    return [];
  }

  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0 || (integer && !Number.isInteger(numberValue))) {
    return [
      envCheck(
        `INVALID_NUMBER_${name}`,
        category,
        "blocked",
        false,
        value,
        `${name} must be a positive${integer ? " integer" : ""} value.`,
        `Set ${name} to a reviewed positive${integer ? " integer" : ""} deployment value.`
      )
    ];
  }

  return [];
}

function checkGeminiServerIpAllowlist(envByName: Map<string, ParsedEnvEntry>): CloudRunDeploymentEnvCheck[] {
  const value = cleanEnvValue(envByName, "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS");
  if (!value) {
    return [];
  }

  const entries = value.split(",").map((item) => item.trim()).filter(Boolean);
  const invalidEntries = entries.filter((entry) => !isValidIpv4OrCidr(entry) || entry === "0.0.0.0/0");
  if (invalidEntries.length) {
    return [
      envCheck(
        "INVALID_SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS",
        "gemini",
        "blocked",
        false,
        invalidEntries.join(","),
        "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS must be a comma-separated allowlist of concrete IPv4 addresses or narrow CIDR ranges, not wildcards.",
        "Use the reviewed static Cloud Run egress IP addresses configured on the Gemini API key restriction."
      )
    ];
  }

  return [];
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

  if (name.includes("EVIDENCE") || name === "SENTINEL_RELEASE_ID" || name.startsWith("SENTINEL_SOURCE_")) {
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

function isAllowedDemoVideoHost(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./u, "");
    return hostname === "youtu.be" || hostname === "youtube.com" || hostname === "vimeo.com" || hostname === "youku.com";
  } catch {
    return false;
  }
}

function isValidIpv4OrCidr(value: string) {
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

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/u, "");
}

function parseCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseScopeList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\s,]+/u)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function extractImageTag(image: string) {
  const imageWithoutDigest = image.split("@sha256:")[0] ?? image;
  const lastSlashIndex = imageWithoutDigest.lastIndexOf("/");
  const lastColonIndex = imageWithoutDigest.lastIndexOf(":");

  if (lastColonIndex <= lastSlashIndex) {
    return "";
  }

  return imageWithoutDigest.slice(lastColonIndex + 1);
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function redactSecretRef(value: string) {
  const [name, version] = value.split(":");
  return `${name}:version-${version ? "set" : "missing"}`;
}
