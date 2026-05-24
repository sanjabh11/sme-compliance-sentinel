#!/usr/bin/env node
/* global console, process */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const officialSourceReview = {
  reviewedAt: "2026-05-24",
  sources: [
    {
      id: "gemini-models",
      url: "https://ai.google.dev/gemini-api/docs/models",
      officialLastUpdated: "2026-05-18 UTC",
      evidence:
        "Models page lists Gemini 3.5 Flash as stable, lists Gemini 2.5 Flash/Pro families, and recommends stable model IDs for production apps."
    },
    {
      id: "gemini-libraries",
      url: "https://ai.google.dev/gemini-api/docs/libraries",
      officialLastUpdated: "2025-12-29 UTC",
      evidence:
        "Libraries page recommends the Google GenAI SDK and identifies @google/genai as the maintained JavaScript/TypeScript package."
    },
    {
      id: "gemini-deprecations",
      url: "https://ai.google.dev/gemini-api/docs/deprecations",
      officialLastUpdated: "reviewed alongside current models page",
      evidence:
        "Deprecation guidance moves older Gemini 2.0 Flash models to Gemini 2.5 Flash or Flash-Lite replacements."
    }
  ]
};

const recommendedProductionModels = new Set(["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-pro"]);
const deprecatedOrShutDownModels = new Set([
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash-lite-001",
  "gemini-3-pro-preview"
]);

export function parseArgs(argv) {
  const args = {
    strict: false,
    outPath: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--strict") {
      args.strict = true;
      continue;
    }

    if (arg === "--out") {
      args.outPath = argv[index + 1] ?? "";
      if (!args.outPath) {
        throw new Error("--out requires a non-secret output path.");
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--out=")) {
      args.outPath = arg.slice("--out=".length);
      continue;
    }

    throw new Error(`Unsupported argument: ${arg}`);
  }

  return args;
}

export function buildGeminiModelReadinessReport(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const packageJson = readJson("package.json");
  const packageLock = readJson("package-lock.json");
  const configSource = readText("lib/config.ts");
  const dockerfile = readText("Dockerfile");
  const cloudRunManifest = readText("cloudrun.service.yaml");
  const deploymentContract = readJson("docs/deployment/cloudrun-deployment-contract.json");

  const defaultModel = extractConfigDefault(configSource, "geminiModel") ?? "";
  const defaultAllowlist = extractConfigDefault(configSource, "geminiModelAllowlist") ?? "";
  const allowlistModels = splitCsv(defaultAllowlist);
  const manifestModel = extractCloudRunEnvValue(cloudRunManifest, "GEMINI_MODEL");
  const manifestAllowlist = splitCsv(extractCloudRunEnvValue(cloudRunManifest, "SENTINEL_GEMINI_MODEL_ALLOWLIST"));
  const packageDependencies = packageJson.dependencies ?? {};
  const lockPackages = packageLock.packages ?? {};
  const reviewAgeDays = daysSince(officialSourceReview.reviewedAt, now);

  const checks = [
    check({
      id: "official-source-review",
      passed: reviewAgeDays <= 45,
      warning: reviewAgeDays > 45 && reviewAgeDays <= 75,
      evidence: `Current Gemini docs reviewed ${officialSourceReview.reviewedAt}; age ${reviewAgeDays} day(s).`,
      fix: "Re-review the official Gemini model, library, and deprecation pages before final submission."
    }),
    check({
      id: "current-genai-sdk-direct-dependency",
      passed: Boolean(packageDependencies["@google/genai"] && lockPackages["node_modules/@google/genai"]),
      evidence: `@google/genai dependency ${packageDependencies["@google/genai"] ?? "missing"}.`,
      fix: "Install @google/genai as the direct server-side Gemini SDK dependency."
    }),
    check({
      id: "legacy-generative-ai-sdk-removed",
      passed: !packageDependencies["@google/generative-ai"] && !lockPackages["node_modules/@google/generative-ai"],
      evidence: `Legacy direct dependency present: ${Boolean(packageDependencies["@google/generative-ai"])}; legacy lock entry present: ${Boolean(lockPackages["node_modules/@google/generative-ai"])}.`,
      fix: "Remove @google/generative-ai and migrate imports to @google/genai."
    }),
    check({
      id: "node-runtime-compatible",
      passed: /FROM node:2[0-9]-slim AS runner/u.test(dockerfile),
      evidence: "Dockerfile runner uses Node 22, satisfying @google/genai Node 20+ requirement.",
      fix: "Use Node 20 or newer in Cloud Run and local production builds."
    }),
    check({
      id: "default-model-current-stable",
      passed: recommendedProductionModels.has(defaultModel),
      evidence: `Default GEMINI_MODEL is ${defaultModel || "missing"}.`,
      fix: "Use a current stable Gemini model from the reviewed production allowlist."
    }),
    check({
      id: "allowlist-includes-default",
      passed: Boolean(defaultModel) && allowlistModels.includes(defaultModel),
      evidence: `Allowlist models: ${allowlistModels.join(", ") || "missing"}.`,
      fix: "Ensure SENTINEL_GEMINI_MODEL_ALLOWLIST includes GEMINI_MODEL."
    }),
    check({
      id: "allowlist-excludes-deprecated-preview-latest",
      passed: allowlistModels.every(isStableProductionModel),
      evidence: `Deprecated/preview/latest entries: ${allowlistModels.filter((model) => !isStableProductionModel(model)).join(", ") || "none"}.`,
      fix: "Remove deprecated, shut down, preview, latest-alias, or experimental model IDs from the production allowlist."
    }),
    check({
      id: "cloudrun-model-aligned",
      passed: manifestModel === defaultModel && arraysEqual(manifestAllowlist, allowlistModels),
      evidence: `Cloud Run GEMINI_MODEL=${manifestModel || "missing"}; manifest allowlist=${manifestAllowlist.join(", ") || "missing"}.`,
      fix: "Keep cloudrun.service.yaml aligned with lib/config.ts defaults before rendering private values."
    }),
    check({
      id: "deployment-contract-carries-model-keys",
      passed:
        Array.isArray(deploymentContract.requiredNonSecretEnv) &&
        deploymentContract.requiredNonSecretEnv.includes("GEMINI_MODEL") &&
        deploymentContract.requiredNonSecretEnv.includes("SENTINEL_GEMINI_MODEL_ALLOWLIST"),
      evidence: "Cloud Run deployment contract includes GEMINI_MODEL and SENTINEL_GEMINI_MODEL_ALLOWLIST.",
      fix: "Keep model routing keys in the deployment contract so deployment verification can block drift."
    })
  ];
  const summary = countStatuses(checks);
  const overallStatus = summary.blocked > 0 ? "blocked" : summary.warning > 0 ? "warning" : "passed";

  return {
    generatedAt: now.toISOString(),
    overallStatus,
    summary,
    selectedModel: defaultModel,
    allowlistModels,
    sdkPackage: "@google/genai",
    officialSourceReview,
    checks,
    blockers: checks.filter((item) => item.status === "blocked").map((item) => `${item.id}: ${item.fix}`),
    warnings: checks.filter((item) => item.status === "warning").map((item) => `${item.id}: ${item.fix}`),
    nextActions:
      overallStatus === "passed"
        ? [
            "Before final hosted submission, rerun this verifier and a live hosted Gemini smoke test with Secret Manager-backed GEMINI_API_KEY.",
            "Keep provider=gemini-api agent-run proof separate from local/mock classifier output."
          ]
        : checks.filter((item) => item.status !== "passed").map((item) => item.fix),
    proofBoundary:
      "This verifies local Gemini SDK/model configuration against the reviewed official docs snapshot. It does not call Gemini, prove hosted API access, or prove XPRIZE judging acceptance."
  };
}

function check(input) {
  const status = input.passed ? "passed" : input.warning ? "warning" : "blocked";

  return {
    id: input.id,
    status,
    evidence: input.evidence,
    fix: input.fix
  };
}

function isStableProductionModel(model) {
  return recommendedProductionModels.has(model) && !deprecatedOrShutDownModels.has(model) && !/-preview\b/u.test(model) && !/-latest\b/u.test(model) && !/-exp/u.test(model);
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function readText(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function extractConfigDefault(source, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`${escaped}:\\s*[^?]+\\?\\?\\s*"([^"]+)"`, "u");
  return source.match(pattern)?.[1] ?? "";
}

function extractCloudRunEnvValue(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`name:\\s*${escaped}\\s*\\n\\s*value:\\s*"([^"]*)"`, "u");
  return source.match(pattern)?.[1] ?? "";
}

function splitCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function daysSince(dateText, now) {
  const then = new Date(`${dateText}T00:00:00.000Z`);
  if (Number.isNaN(then.getTime())) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));
}

function countStatuses(checks) {
  return checks.reduce(
    (counts, item) => {
      counts[item.status] += 1;
      return counts;
    },
    { passed: 0, warning: 0, blocked: 0 }
  );
}

function writeJson(path, value) {
  const absolutePath = resolve(process.cwd(), path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = buildGeminiModelReadinessReport();

    if (args.outPath) {
      writeJson(args.outPath, report);
    }

    console.log(JSON.stringify(report, null, 2));

    if (args.strict && report.overallStatus !== "passed") {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
