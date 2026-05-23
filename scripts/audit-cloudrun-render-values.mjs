#!/usr/bin/env node
/* global console, process */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { auditCloudRunRenderValues } from "./render-cloudrun-manifest.mjs";

const defaultOutDir = "artifacts/deployment";
const auditFileName = "cloudrun-render-values-audit.json";
const markdownFileName = "cloudrun-render-values-audit.md";

const prohibitedCliPatterns = [
  /(^|-)token($|=)/iu,
  /(^|-)password($|=)/iu,
  /(^|-)secret($|=)/iu,
  /gemini-api-key/iu,
  /oauth-client-secret/iu,
  /drive-channel-token/iu,
  /judge-(credential|password)/iu
];

export function parseArgs(argv) {
  const args = {
    valuesPath: "",
    outDir: process.env.SENTINEL_CLOUD_RUN_RENDER_OUT_DIR ?? defaultOutDir,
    releaseId: process.env.SENTINEL_RELEASE_ID ?? "",
    strict: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (prohibitedCliPatterns.some((pattern) => pattern.test(arg))) {
      throw new Error("Raw secret CLI args are not supported. Use --values with non-secret render metadata only.");
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

export async function writeCloudRunRenderValuesAudit(options) {
  const audit = await auditCloudRunRenderValues({
    valuesPath: options.valuesPath,
    releaseId: options.releaseId ?? ""
  });
  const outputDirectory = resolve(options.outDir ?? defaultOutDir, sanitizePathSegment(audit.releaseId));
  const packet = {
    ...audit,
    outputDirectory,
    auditPath: join(outputDirectory, auditFileName),
    markdownPath: join(outputDirectory, markdownFileName)
  };

  await mkdir(outputDirectory, { recursive: true });
  await writeJson(packet.auditPath, packet);
  await writeFile(packet.markdownPath, renderMarkdown(packet), "utf8");

  if (options.strict && packet.status !== "ready-to-render") {
    const error = new Error(`Cloud Run render-values audit is ${packet.status}; see ${packet.auditPath}.`);
    error.packet = packet;
    throw error;
  }

  return packet;
}

function renderMarkdown(packet) {
  return [
    "# Cloud Run Render-Values Audit",
    "",
    `Generated: ${packet.generatedAt}`,
    `Status: ${packet.status}`,
    `Release: ${packet.releaseId}`,
    `Ready for strict render: ${packet.readyForStrictRender ? "yes" : "no"}`,
    "",
    "## Release Identity",
    `- Status: ${packet.releaseIdConsistency.status}`,
    `- CLI release id: ${packet.releaseIdConsistency.requestedReleaseId}`,
    `- Values release id: ${packet.releaseIdConsistency.valueReleaseId}`,
    `- Fix: ${packet.releaseIdConsistency.fix}`,
    "",
    "## Counts",
    `- Source value keys: ${packet.sourceValueKeyCount}`,
    `- Applied value keys: ${packet.appliedValueKeyCount}`,
    `- Missing strict keys: ${packet.missingStrictKeys.length}`,
    `- Placeholder keys: ${packet.placeholderKeys.length}`,
    `- Manual review flags: ${packet.manualReviewFlags.length}`,
    "",
    "## Missing Strict Keys",
    ...(packet.missingStrictKeys.length ? packet.missingStrictKeys.map((key) => `- ${key}`) : ["- none"]),
    "",
    "## Stop Conditions",
    ...packet.stopConditions.map((item) => `- ${item}`),
    "",
    "## Redaction Checklist",
    ...packet.redactionChecklist.map((item) => `- ${item}`),
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

function sanitizePathSegment(value) {
  return String(value || "release-candidate")
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120) || "release-candidate";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const packet = await writeCloudRunRenderValuesAudit(options);
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
