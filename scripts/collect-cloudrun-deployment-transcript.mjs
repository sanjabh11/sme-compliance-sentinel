#!/usr/bin/env node
/* global console, process, URL */

import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const deploymentContract = JSON.parse(
  readFileSync(new URL("../docs/deployment/cloudrun-deployment-contract.json", import.meta.url), "utf8")
);
const defaultOutDir = "artifacts/deployment";
const packetFileName = "cloudrun-deployment-transcript-packet.json";
const markdownFileName = "cloudrun-deployment-transcript-packet.md";
const maxEmbeddedChars = 12000;
const requiredNonSecretEnv = deploymentContract.requiredNonSecretEnv ?? [];
const requiredSecretEnv = deploymentContract.requiredSecretEnv ?? [];
const requiredSecretEnvNames = requiredSecretEnv.map((entry) => entry.envName);

const prohibitedCliPatterns = [
  /(^|-)token($|=)/iu,
  /(^|-)password($|=)/iu,
  /(^|-)secret($|=)/iu,
  /api[_-]?key=/iu,
  /authorization=/iu
];

const fatalOutputPatterns = [
  /\bERROR:\s/iu,
  /\bFAILED\b/iu,
  /\bPERMISSION_DENIED\b/iu,
  /\bPermission denied\b/iu,
  /\bunauthenticated\b/iu,
  /\bforbidden\b/iu
];

const redactionPatterns = [
  {
    label: "google-access-token",
    pattern: /\bya29\.[0-9A-Za-z._-]+/gu,
    replacement: "[REDACTED_GOOGLE_ACCESS_TOKEN]"
  },
  {
    label: "bearer-token",
    pattern: /Bearer\s+(?!\[REDACTED\])[\w.~+/=-]+/giu,
    replacement: "Bearer [REDACTED]"
  },
  {
    label: "google-api-key",
    pattern: /\bAIza[0-9A-Za-z_-]{20,}/gu,
    replacement: "[REDACTED_GOOGLE_API_KEY]"
  },
  {
    label: "google-oauth-secret",
    pattern: /\bGOCSPX-[0-9A-Za-z_-]{20,}/gu,
    replacement: "[REDACTED_GOOGLE_OAUTH_SECRET]"
  },
  {
    label: "private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
    replacement: "[REDACTED_PRIVATE_KEY]"
  },
  {
    label: "json-secret-field",
    pattern: /("(?:[^"]*(?:token|password|secret|api[_-]?key|authorization)[^"]*)"\s*:\s*)"[^"]*"/giu,
    replacement: (_match, prefix) => `${prefix}"[REDACTED]"`
  },
  {
    label: "env-secret-field",
    pattern: /\b([A-Z0-9_]*(?:TOKEN|PASSWORD|SECRET|API_KEY|AUTHORIZATION)[A-Z0-9_]*\s*=\s*)[^\s,;]+/gu,
    replacement: (_match, prefix) => `${prefix}[REDACTED]`
  }
];

export function parseArgs(argv) {
  const args = {
    releaseId: process.env.SENTINEL_RELEASE_ID ?? "",
    outDir: process.env.SENTINEL_CLOUD_RUN_RENDER_OUT_DIR ?? defaultOutDir,
    dryRunLogPath: "",
    deployLogPath: "",
    describeJsonPath: "",
    strict: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (prohibitedCliPatterns.some((pattern) => pattern.test(arg))) {
      throw new Error("Raw secret CLI args are not supported. Provide file paths only; keep tokens in private files or environment variables.");
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

    if (arg === "--out-dir") {
      args.outDir = argv[index + 1] ?? defaultOutDir;
      index += 1;
      continue;
    }

    if (arg.startsWith("--out-dir=")) {
      args.outDir = arg.slice("--out-dir=".length) || defaultOutDir;
      continue;
    }

    if (arg === "--dry-run-log") {
      args.dryRunLogPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--dry-run-log=")) {
      args.dryRunLogPath = arg.slice("--dry-run-log=".length);
      continue;
    }

    if (arg === "--deploy-log") {
      args.deployLogPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--deploy-log=")) {
      args.deployLogPath = arg.slice("--deploy-log=".length);
      continue;
    }

    if (arg === "--describe-json") {
      args.describeJsonPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--describe-json=")) {
      args.describeJsonPath = arg.slice("--describe-json=".length);
      continue;
    }

    if (arg === "--strict") {
      args.strict = true;
    }
  }

  return args;
}

export async function collectCloudRunDeploymentTranscript(options) {
  const releaseId = String(options.releaseId ?? "").trim();
  if (!releaseId || hasPlaceholder(releaseId)) {
    throw new Error("Cloud Run deployment transcript collection requires a non-placeholder --release-id.");
  }

  const outputDirectory = resolve(options.outDir ?? defaultOutDir, sanitizePathSegment(releaseId));
  const dryRunLog = await readEvidenceFile("cloudrun-dry-run-log", options.dryRunLogPath, "text");
  const deployLog = await readEvidenceFile("cloudrun-deploy-log", options.deployLogPath, "text");
  const describeJson = await readEvidenceFile("cloudrun-describe-json", options.describeJsonPath, "json");
  const describeSummary = summarizeDescribeJson(describeJson.rawText);
  const deploymentContractChecks = buildDeploymentContractChecks({ releaseId, describeSummary });
  const blockers = buildBlockers({ dryRunLog, deployLog, describeJson, describeSummary, deploymentContractChecks });
  const status = blockers.length ? "blocked" : "ready-for-hosted-verification";
  const packet = {
    generatedAt: new Date().toISOString(),
    status,
    readyForHostedVerification: status === "ready-for-hosted-verification",
    releaseId,
    outputDirectory,
    inputs: [dryRunLog.summary, deployLog.summary, describeJson.summary],
    describeSummary,
    deploymentContractChecks,
    blockers,
    checks: [
      check("dry-run-log-present", dryRunLog.summary.status === "captured", dryRunLog.summary.status),
      check("deploy-log-present", deployLog.summary.status === "captured", deployLog.summary.status),
      check("describe-json-present", describeJson.summary.status === "captured", describeJson.summary.status),
      check("describe-json-parseable", describeSummary.parseStatus === "parsed", describeSummary.parseStatus),
      check("service-url-present", Boolean(describeSummary.url), describeSummary.url || "missing"),
      check("revision-present", Boolean(describeSummary.latestReadyRevisionName || describeSummary.latestCreatedRevisionName), describeSummary.latestReadyRevisionName || describeSummary.latestCreatedRevisionName || "missing"),
      check("no-fatal-dry-run-marker", dryRunLog.summary.fatalMarkerCount === 0, `${dryRunLog.summary.fatalMarkerCount} fatal marker(s)`),
      check("no-fatal-deploy-marker", deployLog.summary.fatalMarkerCount === 0, `${deployLog.summary.fatalMarkerCount} fatal marker(s)`),
      ...deploymentContractChecks
    ],
    redactedArtifacts: [
      dryRunLog.redactedArtifact,
      deployLog.redactedArtifact,
      describeJson.redactedArtifact
    ],
    nextActions: buildNextActions(status),
    privateHandling: [
      "Keep original gcloud dry-run, deploy, and describe outputs in the private evidence store; this packet embeds redacted copies only.",
      "Before judge sharing, review service URL, revision names, project ids, service-account names, env names, and Secret Manager reference names for customer or operator sensitivity.",
      "Do not treat this packet as hosted product proof until verify:production and hosted write-through checks pass against the deployed URL.",
      "Use the release id to tie this transcript packet to source provenance, rendered manifest digests, Cloud Run revision, and Evidence Vault imports."
    ],
    disclaimer:
      "This packet redacts and checksums operator-saved Cloud Run deployment transcripts. It does not run gcloud, deploy Cloud Run, call Gemini, or prove customer traction."
  };

  await mkdir(outputDirectory, { recursive: true });
  await writeJson(join(outputDirectory, packetFileName), packet);
  await writeFile(join(outputDirectory, markdownFileName), renderMarkdown(packet), "utf8");

  if (options.strict && packet.status !== "ready-for-hosted-verification") {
    const error = new Error(`Cloud Run deployment transcript packet is ${packet.status}; see ${join(outputDirectory, packetFileName)}.`);
    error.packet = packet;
    throw error;
  }

  return packet;
}

async function readEvidenceFile(role, path, expectedFormat) {
  if (!path) {
    return missingEvidenceFile(role, "missing-path");
  }

  try {
    const absolutePath = resolve(path);
    const rawText = await readFile(absolutePath, "utf8");
    const redaction = redactText(rawText);
    const rawBuffer = Buffer.from(rawText, "utf8");
    const redactedBuffer = Buffer.from(redaction.text, "utf8");
    const fatalMarkerCount = fatalOutputPatterns.reduce((count, pattern) => count + countMatches(rawText, pattern), 0);

    return {
      rawText,
      summary: {
        role,
        status: "captured",
        path: absolutePath,
        expectedFormat,
        byteLength: rawBuffer.length,
        sha256: sha256(rawBuffer),
        redactedByteLength: redactedBuffer.length,
        redactedSha256: sha256(redactedBuffer),
        redactionCount: redaction.count,
        redactionLabels: redaction.labels,
        fatalMarkerCount
      },
      redactedArtifact: {
        role,
        path: absolutePath,
        redactedText: truncate(redaction.text),
        truncated: redaction.text.length > maxEmbeddedChars
      }
    };
  } catch (error) {
    return missingEvidenceFile(role, error instanceof Error ? error.message : "read failed");
  }
}

function missingEvidenceFile(role, reason) {
  return {
    rawText: "",
    summary: {
      role,
      status: "missing",
      path: "",
      expectedFormat: "unknown",
      byteLength: 0,
      sha256: "",
      redactedByteLength: 0,
      redactedSha256: "",
      redactionCount: 0,
      redactionLabels: [],
      fatalMarkerCount: 0,
      reason
    },
    redactedArtifact: {
      role,
      path: "",
      redactedText: "",
      truncated: false
    }
  };
}

function summarizeDescribeJson(rawText) {
  if (!rawText) {
    return {
      parseStatus: "missing",
      serviceName: "",
      url: "",
      latestCreatedRevisionName: "",
      latestReadyRevisionName: "",
      serviceAccountName: "",
      image: "",
      releaseIdEnvValue: "",
      envNames: [],
      secretEnvNames: []
    };
  }

  try {
    const parsed = JSON.parse(rawText);
    const templateSpec = parsed?.spec?.template?.spec ?? parsed?.template?.spec ?? {};
    const firstContainer = Array.isArray(templateSpec.containers) ? templateSpec.containers[0] ?? {} : {};
    const env = Array.isArray(firstContainer.env) ? firstContainer.env : [];
    const envByName = new Map(env.map((entry) => [String(entry?.name ?? ""), entry]));

    return {
      parseStatus: "parsed",
      serviceName: String(parsed?.metadata?.name ?? ""),
      url: String(parsed?.status?.url ?? ""),
      latestCreatedRevisionName: String(parsed?.status?.latestCreatedRevisionName ?? ""),
      latestReadyRevisionName: String(parsed?.status?.latestReadyRevisionName ?? ""),
      serviceAccountName: String(templateSpec.serviceAccountName ?? ""),
      image: String(firstContainer.image ?? ""),
      releaseIdEnvValue: envValue(envByName.get("SENTINEL_RELEASE_ID")),
      envNames: env.map((entry) => String(entry?.name ?? "")).filter(Boolean).sort(),
      secretEnvNames: env
        .filter(hasSecretRef)
        .map((entry) => String(entry?.name ?? ""))
        .filter(Boolean)
        .sort()
    };
  } catch (error) {
    return {
      parseStatus: "invalid-json",
      parseError: error instanceof Error ? error.message : "JSON parse failed",
      serviceName: "",
      url: "",
      latestCreatedRevisionName: "",
      latestReadyRevisionName: "",
      serviceAccountName: "",
      image: "",
      releaseIdEnvValue: "",
      envNames: [],
      secretEnvNames: []
    };
  }
}

function buildDeploymentContractChecks({ releaseId, describeSummary }) {
  if (describeSummary.parseStatus !== "parsed") {
    return [
      check(
        "cloudrun-describe-contract-parseable",
        false,
        "Cloud Run describe JSON must be parsed before deployed env contract drift can be checked."
      )
    ];
  }

  const envNames = new Set(describeSummary.envNames);
  const secretEnvNames = new Set(describeSummary.secretEnvNames);
  const missingEnv = [...requiredNonSecretEnv, ...requiredSecretEnvNames].filter((name) => !envNames.has(name));
  const missingSecretEnv = requiredSecretEnvNames.filter((name) => !secretEnvNames.has(name));
  const expectedImageTag = dockerTag(releaseId);

  return [
    check(
      "cloudrun-required-env-present",
      missingEnv.length === 0,
      missingEnv.length
        ? `Missing deployed env var(s): ${missingEnv.join(", ")}.`
        : `${describeSummary.envNames.length} deployed env var(s) include the Cloud Run contract keys.`
    ),
    check(
      "cloudrun-required-secrets-use-secret-manager",
      missingSecretEnv.length === 0,
      missingSecretEnv.length
        ? `Missing Secret Manager env ref(s): ${missingSecretEnv.join(", ")}.`
        : `${missingSecretEnv.length || requiredSecretEnvNames.length} required secret env var(s) use Secret Manager references.`
    ),
    check(
      "cloudrun-release-id-env-matches",
      describeSummary.releaseIdEnvValue === releaseId,
      describeSummary.releaseIdEnvValue
        ? "SENTINEL_RELEASE_ID in the deployed revision matches the collected release id."
        : "SENTINEL_RELEASE_ID is missing from the deployed revision."
    ),
    check(
      "cloudrun-image-release-bound",
      Boolean(describeSummary.image) &&
        (describeSummary.image.includes(`:${expectedImageTag}`) || describeSummary.image.includes("@sha256:")),
      describeSummary.image
        ? "Cloud Run image is tied to the release tag or an immutable digest."
        : "Cloud Run describe JSON is missing the deployed image."
    ),
    check(
      "cloudrun-runtime-service-account-dedicated",
      /^sentinel-runtime@[^@\s]+\.iam\.gserviceaccount\.com$/u.test(describeSummary.serviceAccountName),
      describeSummary.serviceAccountName
        ? "Cloud Run revision uses the dedicated sentinel-runtime service account."
        : "Cloud Run describe JSON is missing the runtime service account."
    )
  ];
}

function buildBlockers({ dryRunLog, deployLog, describeJson, describeSummary, deploymentContractChecks }) {
  return [
    ...(dryRunLog.summary.status !== "captured" ? ["Cloud Run dry-run log is missing."] : []),
    ...(deployLog.summary.status !== "captured" ? ["Cloud Run deploy log is missing."] : []),
    ...(describeJson.summary.status !== "captured" ? ["Cloud Run describe JSON is missing."] : []),
    ...(describeSummary.parseStatus !== "parsed" ? [`Cloud Run describe JSON is ${describeSummary.parseStatus}.`] : []),
    ...(describeSummary.parseStatus === "parsed" && !describeSummary.url ? ["Cloud Run describe JSON does not include status.url."] : []),
    ...(describeSummary.parseStatus === "parsed" && !describeSummary.latestReadyRevisionName && !describeSummary.latestCreatedRevisionName
      ? ["Cloud Run describe JSON does not include a created or ready revision name."]
      : []),
    ...(dryRunLog.summary.fatalMarkerCount ? ["Cloud Run dry-run log contains fatal-looking output; review before deployment."] : []),
    ...(deployLog.summary.fatalMarkerCount ? ["Cloud Run deploy log contains fatal-looking output; review before hosted verification."] : []),
    ...deploymentContractChecks
      .filter((item) => item.status === "blocked")
      .map((item) => `${item.id}: ${item.evidence}`)
  ];
}

function buildNextActions(status) {
  if (status !== "ready-for-hosted-verification") {
    return [
      "Capture all three files from the private operator shell: dry-run log, deploy log, and gcloud describe JSON.",
      "Resolve any fatal-looking gcloud output before treating Cloud Run deployment proof as usable.",
      "Rerun this collector with --strict after the real deployment transcript is complete."
    ];
  }

  return [
    "Run npm run verify:production against the Cloud Run URL and preserve the JSON output privately.",
    "Run write-through hosted checks only after the admin action token, GCP persistence, Gemini, Workspace, and cost-control settings are configured.",
    "Import only redacted hosted proof JSON into the Evidence Vault and keep raw gcloud logs in the private evidence store."
  ];
}

function redactText(input) {
  let text = input;
  let count = 0;
  const labels = new Set();

  for (const item of redactionPatterns) {
    text = text.replace(item.pattern, (...match) => {
      count += 1;
      labels.add(item.label);
      if (typeof item.replacement === "function") {
        return item.replacement(...match);
      }
      return item.replacement;
    });
  }

  return { text, count, labels: [...labels].sort() };
}

function check(id, passed, evidence) {
  return {
    id,
    status: passed ? "passed" : "blocked",
    evidence
  };
}

function renderMarkdown(packet) {
  return [
    "# Cloud Run Deployment Transcript Packet",
    "",
    `Generated: ${packet.generatedAt}`,
    `Status: ${packet.status}`,
    `Release: ${packet.releaseId}`,
    `Ready for hosted verification: ${packet.readyForHostedVerification ? "yes" : "no"}`,
    "",
    "## Describe Summary",
    `- Service: ${packet.describeSummary.serviceName || "missing"}`,
    `- URL: ${packet.describeSummary.url || "missing"}`,
    `- Latest ready revision: ${packet.describeSummary.latestReadyRevisionName || "missing"}`,
    `- Latest created revision: ${packet.describeSummary.latestCreatedRevisionName || "missing"}`,
    `- Runtime service account: ${packet.describeSummary.serviceAccountName || "missing"}`,
    `- Image: ${packet.describeSummary.image || "missing"}`,
    `- Deployed release id env: ${packet.describeSummary.releaseIdEnvValue || "missing"}`,
    "",
    "## Deployment Contract Checks",
    ...packet.deploymentContractChecks.map((item) => `- ${item.id}: ${item.status}; ${item.evidence}`),
    "",
    "## Inputs",
    ...packet.inputs.map((input) => `- ${input.role}: ${input.status}; sha256=${input.sha256 || "missing"}; redactions=${input.redactionCount}`),
    "",
    "## Blockers",
    ...(packet.blockers.length ? packet.blockers.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Next Actions",
    ...packet.nextActions.map((item) => `- ${item}`),
    "",
    `Disclaimer: ${packet.disclaimer}`,
    ""
  ].join("\n");
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function truncate(text) {
  if (text.length <= maxEmbeddedChars) {
    return text;
  }

  return `${text.slice(0, maxEmbeddedChars)}\n[TRUNCATED ${text.length - maxEmbeddedChars} chars]`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hasSecretRef(entry) {
  return Boolean(entry?.valueFrom?.secretKeyRef || entry?.valueSource?.secretKeyRef);
}

function envValue(entry) {
  return typeof entry?.value === "string" ? entry.value : "";
}

function countMatches(text, pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...text.matchAll(new RegExp(pattern.source, flags))].length;
}

function hasPlaceholder(value) {
  return [
    /RELEASE_ID/u,
    /YOUR[-_A-Z0-9]*/u,
    /PROJECT_ID/u,
    /PROJECT_NUMBER/u
  ].some((pattern) => pattern.test(value));
}

function sanitizePathSegment(value) {
  return (
    String(value || "release-candidate")
      .replace(/[^A-Za-z0-9_.-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 120) || "release-candidate"
  );
}

function dockerTag(value) {
  return sanitizePathSegment(value).toLowerCase().replace(/[^a-z0-9_.-]+/gu, "-").slice(0, 128);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const packet = await collectCloudRunDeploymentTranscript(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(packet, null, 2));
  } catch (error) {
    if (error?.packet) {
      console.error(JSON.stringify(error.packet, null, 2));
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
}
