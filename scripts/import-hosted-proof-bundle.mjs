/* global AbortController, URL, clearTimeout, console, fetch, process, setTimeout */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { deploymentImportRequiredCommandIds } from "./prepare-deployment-execution-checklist.mjs";

const defaultTimeoutMs = 15000;
const defaultAdminTokenEnv = "SENTINEL_ADMIN_ACTION_TOKEN";
const adminTokenHeader = "x-sentinel-admin-token";
const defaultVerifyFileName = "verify-production.json";
const bundleManifestFileName = "manifest.json";
const releaseEvidenceFileName = "release-evidence-manifest.json";
const deploymentExecutionChecklistFileName = "deployment-execution-checklist.json";
const requestFileName = "evidence-vault-import-request.json";
const responseFileName = "evidence-vault-import-response.json";
const summaryFileName = "evidence-vault-import-summary.json";

export function parseArgs(argv) {
  const args = {
    bundleDir: process.env.SENTINEL_HOSTED_PROOF_BUNDLE_DIR ?? "",
    sourceFile: "",
    url: process.env.NEXT_PUBLIC_PRODUCT_URL ?? "",
    adminTokenEnv: defaultAdminTokenEnv,
    adminToken: "",
    timeoutMs: defaultTimeoutMs,
    ownerNote: "",
    dryRun: false,
    confirmImport: false,
    allowLocal: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (isRawTokenArg(arg)) {
      throw new Error("Raw token CLI args are not supported. Use --admin-token-env with a private environment variable.");
    }

    if (arg === "--bundle-dir") {
      args.bundleDir = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--bundle-dir=")) {
      args.bundleDir = arg.slice("--bundle-dir=".length);
      continue;
    }

    if (arg === "--source-file") {
      args.sourceFile = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--source-file=")) {
      args.sourceFile = arg.slice("--source-file=".length);
      continue;
    }

    if (arg === "--url") {
      args.url = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--url=")) {
      args.url = arg.slice("--url=".length);
      continue;
    }

    if (arg === "--admin-token-env") {
      args.adminTokenEnv = argv[index + 1] ?? defaultAdminTokenEnv;
      index += 1;
      continue;
    }

    if (arg.startsWith("--admin-token-env=")) {
      args.adminTokenEnv = arg.slice("--admin-token-env=".length) || defaultAdminTokenEnv;
      continue;
    }

    if (arg === "--timeout-ms") {
      args.timeoutMs = parseTimeout(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--timeout-ms=")) {
      args.timeoutMs = parseTimeout(arg.slice("--timeout-ms=".length));
      continue;
    }

    if (arg === "--owner-note") {
      args.ownerNote = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--owner-note=")) {
      args.ownerNote = arg.slice("--owner-note=".length);
      continue;
    }

    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (arg === "--confirm-import") {
      args.confirmImport = true;
      continue;
    }

    if (arg === "--allow-local") {
      args.allowLocal = true;
    }
  }

  args.adminToken = process.env[args.adminTokenEnv] ?? "";
  args.sourceFile ||= args.bundleDir ? join(args.bundleDir, defaultVerifyFileName) : "";
  return args;
}

export async function importHostedProofBundle(options) {
  if (!options.bundleDir && !options.sourceFile) {
    throw new Error("Pass --bundle-dir artifacts/hosted-proof/RELEASE_ID or --source-file path/to/verify-production.json.");
  }

  const sourceFile = options.sourceFile || join(options.bundleDir, defaultVerifyFileName);
  const bundleDir = options.bundleDir || dirname(sourceFile);
  const verifyReport = parseJson(await readFile(sourceFile, "utf8"));
  const bundleMetadata = options.bundleDir ? await readBundleMetadata(bundleDir) : undefined;
  assertVerifyProductionReport(verifyReport);
  const baseUrl = normalizeBaseUrl(options.url || verifyReport.baseUrl || "");
  assertBundleConsistency({ verifyReport, bundleMetadata, baseUrl });
  assertHostedUrl(baseUrl, Boolean(options.allowLocal));
  assertRedacted(verifyReport);
  if (options.confirmImport) {
    assertDeploymentExecutionChecklist({
      checklist: bundleMetadata?.deploymentExecutionChecklist,
      releaseId: bundleMetadata?.releaseId ?? cleanString(verifyReport.releaseId),
      baseUrl
    });
  }
  await mkdir(bundleDir, { recursive: true });
  const releaseId = bundleMetadata?.releaseId ?? cleanString(verifyReport.releaseId);

  const requestBody = {
    source: "verify-production",
    redacted: true,
    sourceUrl: baseUrl,
    ownerNote:
      options.ownerNote ||
      `Imported release ${releaseId || "unbound-release"} from hosted proof bundle ${bundleDir}. Operator must keep raw bundle artifacts private and redacted.`,
    payload: verifyReport
  };
  await writeJson(join(bundleDir, requestFileName), redact(requestBody));

  if (options.dryRun) {
    const summary = buildSummary({
      status: "dry-run",
      bundleDir,
      sourceFile,
      baseUrl,
      adminTokenEnv: options.adminTokenEnv ?? defaultAdminTokenEnv,
      adminTokenConfigured: Boolean(options.adminToken),
      releaseId,
      releaseIntegrityStatus: bundleMetadata?.releaseIntegrityStatus ?? "",
      proofFlagStatus: bundleMetadata?.proofFlagStatus ?? "",
      deploymentExecutionChecklistStatus: checklistStatus(bundleMetadata?.deploymentExecutionChecklist),
      responseStatus: 0,
      responsePayload: { ok: true, dryRun: true }
    });
    await writeJson(join(bundleDir, summaryFileName), summary);
    return summary;
  }

  if (!options.confirmImport) {
    throw new Error("Pass --confirm-import to POST into the hosted Evidence Vault, or --dry-run to write the request only.");
  }

  if (!options.adminToken) {
    throw new Error(`Set ${options.adminTokenEnv ?? defaultAdminTokenEnv} before importing into the hosted Evidence Vault.`);
  }

  const responsePayload = await postImport({
    baseUrl,
    requestBody,
    adminToken: options.adminToken,
    timeoutMs: options.timeoutMs ?? defaultTimeoutMs
  });
  const redactedResponse = redact(responsePayload.payload);
  await writeJson(join(bundleDir, responseFileName), redactedResponse);
  const summary = buildSummary({
    status: responsePayload.ok ? "imported" : "failed",
    bundleDir,
    sourceFile,
    baseUrl,
    adminTokenEnv: options.adminTokenEnv ?? defaultAdminTokenEnv,
    adminTokenConfigured: Boolean(options.adminToken),
    releaseId,
    releaseIntegrityStatus: bundleMetadata?.releaseIntegrityStatus ?? "",
    proofFlagStatus: bundleMetadata?.proofFlagStatus ?? "",
    deploymentExecutionChecklistStatus: checklistStatus(bundleMetadata?.deploymentExecutionChecklist),
    responseStatus: responsePayload.httpStatus,
    responsePayload: redactedResponse
  });
  await writeJson(join(bundleDir, summaryFileName), summary);

  if (!responsePayload.ok) {
    throw new Error(`Evidence Vault import failed with HTTP ${responsePayload.httpStatus}. See ${responseFileName}.`);
  }

  return summary;
}

async function postImport(input) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await fetch(`${input.baseUrl}/api/evidence/vault/import`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        [adminTokenHeader]: input.adminToken
      },
      body: JSON.stringify(input.requestBody),
      signal: controller.signal
    });
    const text = await response.text();

    return {
      ok: response.ok,
      httpStatus: response.status,
      payload: parseJson(text)
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readBundleMetadata(bundleDir) {
  const manifest = await readRequiredJson(join(bundleDir, bundleManifestFileName), bundleManifestFileName);
  const releaseEvidence = await readRequiredJson(join(bundleDir, releaseEvidenceFileName), releaseEvidenceFileName);
  const deploymentExecutionChecklist = await readOptionalJson(join(bundleDir, deploymentExecutionChecklistFileName));
  const proofFlagChecks = Array.isArray(releaseEvidence.proofFlagChecks) ? releaseEvidence.proofFlagChecks : [];

  return {
    manifest,
    releaseEvidence,
    deploymentExecutionChecklist,
    proofFlagChecks,
    proofFlagStatus: cleanString(releaseEvidence.proofFlagStatus),
    releaseId: cleanString(manifest.releaseId),
    releaseIntegrityStatus: cleanString(releaseEvidence.releaseIntegrity?.status || manifest.releaseIntegrity?.status)
  };
}

async function readOptionalJson(path) {
  try {
    return parseJson(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function readRequiredJson(path, fileName) {
  try {
    return parseJson(await readFile(path, "utf8"));
  } catch {
    throw new Error(
      `Hosted proof bundle is missing ${fileName}. Use npm run collect:hosted-proof before importing release evidence.`
    );
  }
}

function assertBundleConsistency(input) {
  if (!input.bundleMetadata) {
    return;
  }

  const manifest = input.bundleMetadata.manifest;
  const releaseEvidence = input.bundleMetadata.releaseEvidence;
  const manifestReleaseId = cleanString(manifest.releaseId);
  const releaseEvidenceReleaseId = cleanString(releaseEvidence.releaseId);
  const verifyReleaseId = cleanString(input.verifyReport.releaseId);
  const manifestBaseUrl = cleanString(manifest.baseUrl);
  const releaseEvidenceBaseUrl = cleanString(releaseEvidence.baseUrl);
  const releaseIntegrityStatus = input.bundleMetadata.releaseIntegrityStatus;

  if (!manifestReleaseId || !releaseEvidenceReleaseId || !verifyReleaseId) {
    throw new Error(
      "Release consistency check failed: manifest.json, release-evidence-manifest.json, and verify-production.json must all include releaseId."
    );
  }

  if (manifestReleaseId !== releaseEvidenceReleaseId || manifestReleaseId !== verifyReleaseId) {
    throw new Error(
      `Release consistency check failed: manifest=${manifestReleaseId}, releaseEvidence=${releaseEvidenceReleaseId}, verifyProduction=${verifyReleaseId}.`
    );
  }

  if (manifestBaseUrl !== input.baseUrl || releaseEvidenceBaseUrl !== input.baseUrl) {
    throw new Error(
      `Release consistency check failed: bundle base URLs must match ${input.baseUrl}.`
    );
  }

  if (releaseIntegrityStatus !== "passed") {
    throw new Error(
      `Release integrity check failed: expected passed, received ${releaseIntegrityStatus || "missing"}. Rerun collect:hosted-proof after fixing bundle blockers.`
    );
  }

  assertProofFlagChecks(input.bundleMetadata.proofFlagChecks);
}

function assertProofFlagChecks(proofFlagChecks) {
  if (!Array.isArray(proofFlagChecks) || !proofFlagChecks.length) {
    return;
  }

  const blocked = proofFlagChecks.filter((check) => check?.status === "blocked" || check?.status === "needs-review");

  if (!blocked.length) {
    return;
  }

  throw new Error(
    `XPRIZE proof flag check failed: ${blocked.map((check) => `${cleanString(check.envName)} (${cleanString(check.detail)})`).join("; ")}`
  );
}

function assertDeploymentExecutionChecklist(input) {
  const checklist = input.checklist;

  if (!checklist || typeof checklist !== "object" || Array.isArray(checklist)) {
    throw new Error("Hosted proof import requires deployment-execution-checklist.json. Run npm run prepare:deployment-execution-checklist before --confirm-import.");
  }

  const releaseId = cleanString(input.releaseId);
  const checklistReleaseId = cleanString(checklist.releaseId);
  const sourceUrl = cleanString(checklist.sourceUrl);
  const overallStatus = cleanString(checklist.overallStatus);
  const entries = Array.isArray(checklist.entries) ? checklist.entries : [];
  const entriesByCommandId = new Map(entries.map((entry) => [cleanString(entry?.commandId), entry]));

  if (checklistReleaseId !== releaseId) {
    throw new Error(`Deployment execution checklist release mismatch: expected ${releaseId || "missing"}, received ${checklistReleaseId || "missing"}.`);
  }

  if (sourceUrl !== input.baseUrl) {
    throw new Error(`Deployment execution checklist URL mismatch: expected ${input.baseUrl}, received ${sourceUrl || "missing"}.`);
  }

  if (overallStatus !== "passed") {
    throw new Error(`Deployment execution checklist is ${overallStatus || "missing"}; every required command must pass before hosted proof import.`);
  }

  const missingEntries = deploymentImportRequiredCommandIds.filter((commandId) => !entriesByCommandId.has(commandId));

  if (missingEntries.length) {
    throw new Error(`Deployment execution checklist is missing required commands: ${missingEntries.join(", ")}.`);
  }

  const blockedEntries = deploymentImportRequiredCommandIds
    .map((commandId) => entriesByCommandId.get(commandId))
    .filter((entry) => cleanString(entry?.status) !== "passed" || !cleanString(entry?.recordedAt) || !cleanString(entry?.expectedArtifactPath));

  if (blockedEntries.length) {
    throw new Error(
      `Deployment execution checklist has incomplete entries: ${blockedEntries.map((entry) => cleanString(entry?.commandId) || "unknown").join(", ")}.`
    );
  }
}

function buildSummary(input) {
  const importResult = input.responsePayload?.importResult;
  const artifactCount =
    Number(importResult?.artifactCount ?? input.responsePayload?.artifacts?.length ?? 0) || 0;

  return {
    generatedAt: new Date().toISOString(),
    status: input.status,
    releaseId: input.releaseId || null,
    releaseIntegrityStatus: input.releaseIntegrityStatus || null,
    proofFlagStatus: input.proofFlagStatus || null,
    deploymentExecutionChecklistStatus: input.deploymentExecutionChecklistStatus || null,
    bundleDir: input.bundleDir,
    sourceFile: input.sourceFile,
    sourceUrl: input.baseUrl,
    requestFile: requestFileName,
    responseFile: input.status === "dry-run" ? null : responseFileName,
    writeAuth: {
      required: input.status !== "dry-run",
      configured: input.adminTokenConfigured,
      tokenEnv: input.adminTokenEnv,
      headerName: adminTokenHeader
    },
    response: {
      httpStatus: input.responseStatus,
      importStatus: importResult?.status ?? input.responsePayload?.status ?? input.status,
      artifactCount
    },
    nextActions: [
      "Open evidence-vault-import-response.json and confirm every candidate artifact status before relying on it.",
      "Keep deployment-execution-checklist.json passed before running --confirm-import.",
      "Confirm release-evidence-manifest.json proofFlagChecks passed before setting any XPRIZE proof flag true in production values.",
      "Run /api/evidence/vault and /api/production/hosted-evidence after import to confirm checksummed artifact records are visible.",
      "Keep the source hosted proof bundle private; do not commit generated proof, credentials, invoices, customer findings, or raw cloud responses.",
      "Rerun Claim Guard and the XPRIZE Submission Gate before final Devpost submission."
    ],
    disclaimer:
      "This script imports redacted hosted verification metadata into the Evidence Vault. It does not prove production readiness unless the source JSON came from the deployed product and the underlying checks passed."
  };
}

function checklistStatus(checklist) {
  if (!checklist || typeof checklist !== "object" || Array.isArray(checklist)) {
    return "missing";
  }

  return cleanString(checklist.overallStatus) || "missing";
}

function assertHostedUrl(baseUrl, allowLocal) {
  const parsed = new URL(baseUrl);
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);

  if (allowLocal) {
    return;
  }

  if (parsed.protocol !== "https:" || localHost) {
    throw new Error("Evidence Vault import requires a hosted HTTPS URL. Use --allow-local only for local smoke tests.");
  }
}

function assertVerifyProductionReport(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Source file must be a verify-production JSON object.");
  }

  if (typeof payload.baseUrl !== "string" || !payload.baseUrl) {
    throw new Error("Source file must be verify-production JSON with a baseUrl.");
  }

  if (!payload.summary || typeof payload.summary !== "object") {
    throw new Error("Source file must be verify-production JSON with a summary object.");
  }

  if (!Array.isArray(payload.results)) {
    throw new Error("Source file must be verify-production JSON with a results array.");
  }
}

function assertRedacted(payload) {
  const text = JSON.stringify(payload);
  const unsafePatterns = [
    /Bearer\s+(?!\[REDACTED\])[\w.~+/=-]+/iu,
    /AIza[0-9A-Za-z_-]{20,}/u,
    /private-admin-token/u,
    /should-not-leak-token-value/u,
    /refresh[_-]?token["':\s]+(?!\[REDACTED\])[\w.~+/=-]+/iu,
    /access[_-]?token["':\s]+(?!\[REDACTED\])[\w.~+/=-]+/iu,
    /admin[_-]?token["':\s]+(?!\[REDACTED\])[\w.~+/=-]+/iu
  ];
  const unsafe = unsafePatterns.find((pattern) => pattern.test(text));

  if (unsafe) {
    throw new Error(`verify-production JSON appears to contain unredacted sensitive data matching ${unsafe}.`);
  }
}

function isRawTokenArg(arg) {
  return [
    "--admin-token",
    "--token",
    "--bearer-token",
    "--access-token",
    "--refresh-token"
  ].some((name) => arg === name || arg.startsWith(`${name}=`));
}

function redact(value) {
  if (Array.isArray(value)) {
    return value.map(redact);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, isSecretKey(key) ? "[REDACTED]" : redact(nested)])
    );
  }

  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gu, "Bearer [REDACTED]")
      .replace(/(x-sentinel-admin-token['":\s]+)[A-Za-z0-9._~+/=-]+/giu, "$1[REDACTED]")
      .replace(/(api[_-]?key['":\s]+)[A-Za-z0-9._~+/=-]+/giu, "$1[REDACTED]")
      .replace(/private-admin-token/gu, "[REDACTED]");
  }

  return value;
}

function isSecretKey(key) {
  return /(token|secret|password|credential|authorization|cookie|apiKey|api_key|refresh|accessToken|adminAction)/iu.test(key);
}

async function writeJson(path, payload) {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function parseJson(text) {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function normalizeBaseUrl(rawUrl) {
  if (!rawUrl) {
    throw new Error("Set NEXT_PUBLIC_PRODUCT_URL, pass --url, or provide a verify-production JSON with baseUrl.");
  }

  const parsed = new URL(rawUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("URL must start with http:// or https://");
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/u, "");
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseTimeout(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : defaultTimeoutMs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const summary = await importHostedProofBundle(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
