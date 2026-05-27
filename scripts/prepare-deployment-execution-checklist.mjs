#!/usr/bin/env node
/* global console, process */

import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const defaultBundleDir = "artifacts/hosted-proof/RELEASE_ID";
const defaultChecklistFileName = "deployment-execution-checklist.json";
const defaultResultsPath = "";
const defaultResultsTemplatePath = "";

export const deploymentImportRequiredCommandIds = [
  "lint",
  "typecheck",
  "test",
  "build",
  "source-release",
  "provenance",
  "cloudrun-release-values",
  "cloudrun-render-handoff-verify",
  "cloudrun-render-values-audit",
  "cloudrun-render-evidence-verify",
  "cloudrun-render-manifest",
  "cloudrun-template-strict",
  "cloudrun-dry-run-preflight",
  "cloudrun-dry-run-packet-verify",
  "cloudrun-dry-run",
  "cloudrun-deploy",
  "cloudrun-describe",
  "cloudrun-deployment-transcript-collect",
  "hosted-readonly",
  "hosted-write-through",
  "hosted-evidence",
  "hosted-proof-bundle",
  "hosted-proof-import-dry-run"
];

export function parseArgs(argv) {
  const args = {
    bundleDir: process.env.SENTINEL_HOSTED_PROOF_BUNDLE_DIR ?? defaultBundleDir,
    resultsPath: defaultResultsPath,
    writeResultsTemplatePath: defaultResultsTemplatePath,
    outFile: "",
    strict: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (isRawSecretArg(arg)) {
      throw new Error("Raw secret CLI args are not supported. Use a private results JSON file and keep tokens out of the checklist.");
    }

    if (arg === "--bundle-dir") {
      args.bundleDir = argv[index + 1] ?? defaultBundleDir;
      index += 1;
      continue;
    }

    if (arg.startsWith("--bundle-dir=")) {
      args.bundleDir = arg.slice("--bundle-dir=".length) || defaultBundleDir;
      continue;
    }

    if (arg === "--results") {
      args.resultsPath = argv[index + 1] ?? defaultResultsPath;
      index += 1;
      continue;
    }

    if (arg.startsWith("--results=")) {
      args.resultsPath = arg.slice("--results=".length);
      continue;
    }

    if (arg === "--write-results-template") {
      args.writeResultsTemplatePath = argv[index + 1] ?? defaultResultsTemplatePath;
      index += 1;
      continue;
    }

    if (arg.startsWith("--write-results-template=")) {
      args.writeResultsTemplatePath = arg.slice("--write-results-template=".length);
      continue;
    }

    if (arg === "--out-file") {
      args.outFile = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--out-file=")) {
      args.outFile = arg.slice("--out-file=".length);
      continue;
    }

    if (arg === "--strict") {
      args.strict = true;
    }
  }

  return args;
}

export async function writeDeploymentCommandResultsTemplate(options) {
  const bundleDir = options.bundleDir || defaultBundleDir;
  const outputPath = options.outputPath || options.writeResultsTemplatePath || "";

  if (!outputPath) {
    throw new Error("Deployment command results template requires --write-results-template /private/path/deployment-command-results.json.");
  }

  const manifest = await readJson(join(bundleDir, "manifest.json"));
  const deploymentPacket = unwrapHostedEndpointPayload(await readJson(join(bundleDir, "deployment-packet.json")));
  const releaseId = cleanString(manifest.releaseId || deploymentPacket.releaseId);
  const sourceUrl = cleanString(manifest.baseUrl || deploymentPacket.productUrl);
  const commandById = new Map((Array.isArray(deploymentPacket.commandSequence) ? deploymentPacket.commandSequence : []).map((command) => [cleanString(command.id), command]));
  const artifactById = new Map((Array.isArray(deploymentPacket.artifactManifest) ? deploymentPacket.artifactManifest : []).map((artifact) => [cleanString(artifact.id), artifact]));
  const template = {
    generatedAt: new Date().toISOString(),
    releaseId,
    sourceUrl,
    bundleDir,
    instructions: [
      "Keep this file outside Git. Fill it only after each command has actually run for this release.",
      "Change status from pending to passed only when the command output has been reviewed and the evidence artifact exists.",
      "Replace recordedAt with the command completion timestamp and evidenceSha256 with the SHA-256 of the private evidence artifact.",
      "Do not paste admin tokens, OAuth secrets, API keys, customer names, raw security findings, invoices, or shell environment dumps into notes."
    ],
    entries: deploymentImportRequiredCommandIds.map((commandId) => {
      const command = commandById.get(commandId) ?? {};
      const expectedArtifactId = cleanString(command.expectedArtifactId);
      const expectedArtifactPath = cleanString(artifactById.get(expectedArtifactId)?.privateStorePath);

      return {
        commandId,
        status: "pending",
        releaseId,
        sourceUrl,
        recordedAt: "REPLACE_WITH_ISO_TIMESTAMP",
        expectedArtifactId,
        expectedArtifactPath,
        evidencePath: expectedArtifactPath || "REPLACE_WITH_PRIVATE_EVIDENCE_PATH",
        evidenceSha256: "REPLACE_WITH_SHA256_OF_PRIVATE_ARTIFACT",
        commandSha256: sha256(cleanString(command.command)),
        mutatesProduction: command.mutatesProduction === true,
        requiresAdminToken: command.requiresAdminToken === true,
        note: "Record reviewed private operator evidence. Do not include secrets or customer-sensitive details."
      };
    })
  };

  await assertWritableRegularFilePath(outputPath, "Deployment command results template output file");
  await writeJson(outputPath, template);

  return {
    generatedAt: template.generatedAt,
    path: outputPath,
    releaseId,
    sourceUrl,
    entryCount: template.entries.length,
    privateHandling: "This results template is non-secret until filled. Keep the filled copy outside Git with the private deployment evidence bundle."
  };
}

export async function prepareDeploymentExecutionChecklist(options) {
  const bundleDir = options.bundleDir || defaultBundleDir;
  const manifest = await readJson(join(bundleDir, "manifest.json"));
  const deploymentPacket = unwrapHostedEndpointPayload(await readJson(join(bundleDir, "deployment-packet.json")));
  const resultsPayload = options.resultsPath ? await readJson(options.resultsPath) : null;
  const normalizedResults = normalizeResults(resultsPayload);
  const results = normalizedResults.rowsByCommandId;
  const releaseId = cleanString(manifest.releaseId || deploymentPacket.releaseId);
  const sourceUrl = cleanString(manifest.baseUrl || deploymentPacket.productUrl);
  const commandById = new Map((Array.isArray(deploymentPacket.commandSequence) ? deploymentPacket.commandSequence : []).map((command) => [cleanString(command.id), command]));
  const artifactById = new Map((Array.isArray(deploymentPacket.artifactManifest) ? deploymentPacket.artifactManifest : []).map((artifact) => [cleanString(artifact.id), artifact]));
  const entries = await Promise.all(deploymentImportRequiredCommandIds.map((commandId) =>
    buildEntry({
      commandId,
      command: commandById.get(commandId),
      artifactById,
      result: results.get(commandId),
      releaseId,
      sourceUrl
    })
  ));
  const resultsTemplate = buildResultsTemplateLineage({
    payload: resultsPayload,
    releaseId,
    sourceUrl,
    expectedCommandCount: deploymentImportRequiredCommandIds.length,
    rowCount: normalizedResults.rowCount
  });
  const blockers = buildBlockers({ releaseId, sourceUrl, entries, resultsTemplate });
  const summary = entries.reduce(
    (accumulator, entry) => ({
      total: accumulator.total + 1,
      passed: accumulator.passed + (entry.status === "passed" ? 1 : 0),
      blocked: accumulator.blocked + (entry.status === "blocked" ? 1 : 0),
      needsReview: accumulator.needsReview + (entry.status === "needs-review" ? 1 : 0)
    }),
    { total: 0, passed: 0, blocked: 0, needsReview: 0 }
  );
  const checklist = {
    generatedAt: new Date().toISOString(),
    overallStatus: blockers.length ? "blocked" : "passed",
    releaseId,
    sourceUrl,
    bundleDir,
    requiredBeforeHostedProofImport: true,
    summary,
    resultsTemplate,
    entries,
    blockers,
    nextActions: buildNextActions(blockers),
    privateHandling: [
      "This checklist records operator command results for one release. Keep it with the private hosted proof bundle.",
      "Do not include admin tokens, OAuth secrets, API keys, customer names, raw security findings, invoices, or raw Workspace content in result notes.",
      "Final hosted proof import is allowed only after every required command has status passed, recordedAt, and evidencePath.",
      "A passed checklist is still operator evidence; it does not prove customer traction, revenue, legal/IP clearance, or judging outcome by itself."
    ],
    disclaimer:
      "This checklist verifies command-result bookkeeping for a deployment release. It does not run cloud commands, deploy Cloud Run, call Gemini, or certify external proof."
  };
  const { outFile, markdownFile } = resolveChecklistOutputFiles(options.outFile || join(bundleDir, defaultChecklistFileName));

  await assertWritableRegularFilePath(outFile, "Deployment execution checklist output file");
  await assertWritableRegularFilePath(markdownFile, "Deployment execution checklist Markdown output file");
  await writeJson(outFile, checklist);
  await writeTextFile(markdownFile, renderMarkdown(checklist), "Deployment execution checklist Markdown output file");

  if (options.strict && checklist.overallStatus !== "passed") {
    const error = new Error(`Deployment execution checklist is ${checklist.overallStatus}; see ${outFile}.`);
    error.checklist = checklist;
    throw error;
  }

  return checklist;
}

async function buildEntry(input) {
  const result = input.result ?? {};
  const expectedArtifactId = cleanString(input.command?.expectedArtifactId);
  const expectedArtifactPath = cleanString(input.artifactById.get(expectedArtifactId)?.privateStorePath);
  const status = cleanString(result.status) || "blocked";
  const resultReleaseId = cleanString(result.releaseId);
  const resultSourceUrl = cleanString(result.sourceUrl);
  const recordedAt = cleanString(result.recordedAt);
  const evidencePath = cleanString(result.evidencePath);
  const evidenceSha256 = cleanString(result.evidenceSha256);
  const note = cleanString(result.note);
  const evidenceFileVerification = await verifyEvidenceFile({ commandId: input.commandId, evidencePath, evidenceSha256 });
  const blockers = [
    ...(input.command ? [] : [`${input.commandId} is missing from deployment-packet commandSequence.`]),
    ...(expectedArtifactId ? [] : [`${input.commandId} is missing an expectedArtifactId.`]),
    ...(expectedArtifactPath ? [] : [`${input.commandId} is missing an expected artifact path.`]),
    ...(status === "passed" ? [] : [`${input.commandId} status is ${status || "missing"}, not passed.`]),
    ...(resultReleaseId === input.releaseId ? [] : [`${input.commandId} releaseId ${resultReleaseId || "missing"} does not match ${input.releaseId || "missing"}.`]),
    ...(resultSourceUrl === input.sourceUrl ? [] : [`${input.commandId} sourceUrl ${resultSourceUrl || "missing"} does not match ${input.sourceUrl || "missing"}.`]),
    ...(recordedAt ? [] : [`${input.commandId} is missing recordedAt.`]),
    ...(isIsoTimestamp(recordedAt) ? [] : [`${input.commandId} recordedAt must be an ISO timestamp.`]),
    ...(evidencePath ? [] : [`${input.commandId} is missing evidencePath.`]),
    ...(evidencePath && expectedArtifactPath && evidencePath === expectedArtifactPath
      ? []
      : [`${input.commandId} evidencePath must match expectedArtifactPath.`]),
    ...(isSha256(evidenceSha256) ? [] : [`${input.commandId} is missing a valid evidenceSha256.`]),
    ...evidenceFileVerification.blockers,
    ...(hasUnsafeText(`${evidencePath} ${note}`) ? [`${input.commandId} evidence fields contain secret-shaped text.`] : [])
  ];

  return {
    commandId: input.commandId,
    label: cleanString(input.command?.label) || input.commandId,
    releaseId: input.releaseId,
    sourceUrl: input.sourceUrl,
    resultReleaseId,
    resultSourceUrl,
    status: blockers.length ? "blocked" : "passed",
    operatorStatus: status || "missing",
    recordedAt,
    expectedArtifactId,
    expectedArtifactPath,
    evidencePath,
    evidenceSha256,
    evidenceFileVerification,
    commandSha256: sha256(cleanString(input.command?.command)),
    mutatesProduction: input.command?.mutatesProduction === true,
    requiresAdminToken: input.command?.requiresAdminToken === true,
    note,
    blockers,
    nextAction: blockers.length ? "Record the command result and attach the expected private evidence before hosted proof import." : "Preserve this command result with the release proof bundle."
  };
}

async function verifyEvidenceFile(input) {
  if (!input.evidencePath || !isSha256(input.evidenceSha256)) {
    return {
      status: "not-checked",
      local: false,
      path: input.evidencePath,
      expectedSha256: input.evidenceSha256,
      actualSha256: "",
      byteLength: 0,
      blockers: []
    };
  }

  if (!isLocalEvidencePath(input.evidencePath)) {
    return {
      status: "external-private",
      local: false,
      path: input.evidencePath,
      expectedSha256: input.evidenceSha256,
      actualSha256: "",
      byteLength: 0,
      blockers: [],
      note: "Remote/private evidence path was recorded but not read by this local verifier."
    };
  }

  try {
    const localFileBoundary = await verifyLocalEvidenceFileBoundary(input);
    if (localFileBoundary.blockers.length) {
      return {
        status: "blocked",
        local: true,
        path: input.evidencePath,
        expectedSha256: input.evidenceSha256,
        actualSha256: "",
        byteLength: 0,
        fileType: localFileBoundary.fileType,
        blockers: localFileBoundary.blockers
      };
    }

    const buffer = await readFile(input.evidencePath);
    const actualSha256 = sha256(buffer);
    const contentPreview = buffer.toString("utf8");
    const blockers = [
      ...(actualSha256 === input.evidenceSha256
        ? []
        : [`${input.commandId} local evidence SHA-256 ${actualSha256} does not match recorded ${input.evidenceSha256}.`]),
      ...(hasUnsafeText(contentPreview) ? [`${input.commandId} local evidence file contains secret-shaped text.`] : [])
    ];

    return {
      status: blockers.length ? "blocked" : "verified",
      local: true,
      path: input.evidencePath,
      expectedSha256: input.evidenceSha256,
      actualSha256,
      byteLength: buffer.length,
      fileType: "regular-file",
      blockers
    };
  } catch (error) {
    return {
      status: "blocked",
      local: true,
      path: input.evidencePath,
      expectedSha256: input.evidenceSha256,
      actualSha256: "",
      byteLength: 0,
      fileType: "unreadable",
      blockers: [`${input.commandId} local evidence file is not readable: ${error instanceof Error ? error.message : "unknown error"}.`]
    };
  }
}

async function verifyLocalEvidenceFileBoundary(input) {
  try {
    const stats = await lstat(input.evidencePath);

    if (stats.isSymbolicLink()) {
      return {
        fileType: "symbolic-link",
        blockers: [`${input.commandId} local evidence file is a symbolic link; copy the reviewed artifact into a regular private file before hosted proof import.`]
      };
    }

    if (!stats.isFile()) {
      return {
        fileType: "not-regular-file",
        blockers: [`${input.commandId} local evidence path is not a regular file.`]
      };
    }

    return {
      fileType: "regular-file",
      blockers: []
    };
  } catch (error) {
    return {
      fileType: "unreadable",
      blockers: [`${input.commandId} local evidence file is not readable: ${error instanceof Error ? error.message : "unknown error"}.`]
    };
  }
}

function buildBlockers(input) {
  return [
    ...(input.releaseId ? [] : ["Release id is missing from manifest.json or deployment-packet.json."]),
    ...(input.sourceUrl ? [] : ["Source URL is missing from manifest.json or deployment-packet.json."]),
    ...input.resultsTemplate.blockers,
    ...input.entries.flatMap((entry) => entry.blockers)
  ];
}

function buildNextActions(blockers) {
  if (blockers.length) {
    return [
      "Record all required deployment command results in a private JSON results file.",
      "Rerun this checklist with --results /secure/local/deployment-command-results.json --strict.",
      "Do not run npm run import:hosted-proof -- --confirm-import until the checklist is passed."
    ];
  }

  return [
    "Review the already-generated evidence-vault-import-request.json from npm run import:hosted-proof -- --dry-run.",
    "Run npm run import:hosted-proof -- --confirm-import only from a private operator shell with SENTINEL_ADMIN_ACTION_TOKEN configured.",
    "Keep deployment-execution-checklist.json with the private judge proof bundle."
  ];
}

function normalizeResults(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.entries)
      ? payload.entries
      : Array.isArray(payload?.results)
        ? payload.results
        : Object.entries(payload ?? {}).map(([commandId, value]) => ({ commandId, ...(value && typeof value === "object" ? value : {}) }));

  return {
    rowCount: rows.length,
    rowsByCommandId: new Map(rows.map((row) => [cleanString(row.commandId), row]).filter(([commandId]) => commandId))
  };
}

function buildResultsTemplateLineage(input) {
  const payload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload) ? input.payload : {};
  const generatedAt = cleanString(payload.generatedAt);
  const templateReleaseId = cleanString(payload.releaseId);
  const templateSourceUrl = cleanString(payload.sourceUrl);
  const instructions = Array.isArray(payload.instructions) ? payload.instructions.map(cleanString).filter(Boolean) : [];
  const instructionText = instructions.join(" ");
  const blockers = [
    ...(input.payload ? [] : ["Deployment command results template is missing. Run --write-results-template before filling results."]),
    ...(generatedAt && isIsoTimestamp(generatedAt) ? [] : ["Deployment command results template generatedAt must be an ISO timestamp."]),
    ...(templateReleaseId === input.releaseId ? [] : [`Deployment command results template releaseId ${templateReleaseId || "missing"} does not match ${input.releaseId || "missing"}.`]),
    ...(templateSourceUrl === input.sourceUrl ? [] : [`Deployment command results template sourceUrl ${templateSourceUrl || "missing"} does not match ${input.sourceUrl || "missing"}.`]),
    ...(input.rowCount === input.expectedCommandCount
      ? []
      : [`Deployment command results template must contain ${input.expectedCommandCount} command entries; found ${input.rowCount}.`]),
    ...(instructionText.includes("Change status from pending to passed")
      ? []
      : ["Deployment command results template instructions are missing; regenerate with --write-results-template."])
  ];

  return {
    status: blockers.length ? "blocked" : "passed",
    generatedAt,
    releaseId: templateReleaseId,
    sourceUrl: templateSourceUrl,
    entryCount: input.rowCount,
    expectedCommandCount: input.expectedCommandCount,
    blockers
  };
}

async function readJson(path) {
  try {
    return JSON.parse(await readRegularTextFileOrThrow(path, "Deployment execution checklist JSON input"));
  } catch (error) {
    throw new Error(`Unable to read JSON from ${path}: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

function unwrapHostedEndpointPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  if (
    Object.prototype.hasOwnProperty.call(value, "payload") &&
    (Object.prototype.hasOwnProperty.call(value, "endpoint") || Object.prototype.hasOwnProperty.call(value, "httpStatus"))
  ) {
    const payload = value.payload;
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  }

  return value;
}

async function writeJson(path, value) {
  await writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`, "Deployment execution checklist JSON output file");
}

async function writeTextFile(path, content, label) {
  const absolutePath = resolve(path);
  await assertWritableRegularFilePath(absolutePath, label);
  const tempPath = join(dirname(absolutePath), `.${basename(absolutePath)}.${randomUUID()}.tmp`);

  try {
    await writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, absolutePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function readRegularTextFileOrThrow(path, label) {
  const resolvedPath = resolve(path);
  await assertDirectoryPathSafe(dirname(resolvedPath), `${label} parent directory`);
  const stats = await lstat(resolvedPath);

  if (stats.isSymbolicLink()) {
    throw new Error(`${label} ${resolvedPath} is a symbolic link; copy the reviewed JSON into a regular private file before checklist preparation.`);
  }

  if (!stats.isFile()) {
    throw new Error(`${label} ${resolvedPath} is not a regular file.`);
  }

  return readFile(resolvedPath, "utf8");
}

function resolveChecklistOutputFiles(outputPath) {
  const outFile = resolve(outputPath);

  if (!outFile.endsWith(".json")) {
    throw new Error("Deployment execution checklist --out-file must end in .json so the Markdown evidence file cannot overwrite JSON.");
  }

  const markdownFile = `${outFile.slice(0, -".json".length)}.md`;

  if (resolve(markdownFile) === outFile) {
    throw new Error("Deployment execution checklist JSON and Markdown output paths must be distinct.");
  }

  return { outFile, markdownFile };
}

async function assertWritableRegularFilePath(path, label) {
  const absolutePath = resolve(path);
  const parentDirectory = dirname(absolutePath);

  await assertDirectoryPathSafe(parentDirectory, `${label} parent directory`);
  await mkdir(parentDirectory, { recursive: true });
  await assertDirectoryExistsSafe(parentDirectory, `${label} parent directory`);
  await assertRegularFileIfExists(absolutePath, label);
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
      throw new Error(`${label} ${directory} is a symbolic link; use a regular private directory before deployment checklist preparation.`);
    }

    if (!fileStat.isDirectory()) {
      throw new Error(`${label} ${directory} is not a directory; use a regular private directory before deployment checklist preparation.`);
    }
  }
}

async function assertDirectoryExistsSafe(path, label) {
  const fileStat = await lstat(path);

  if (fileStat.isSymbolicLink()) {
    throw new Error(`${label} ${path} is a symbolic link; use a regular private directory before deployment checklist preparation.`);
  }

  if (!fileStat.isDirectory()) {
    throw new Error(`${label} ${path} is not a directory; use a regular private directory before deployment checklist preparation.`);
  }
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
    throw new Error(`${label} ${path} is a symbolic link; use a regular private file path before deployment checklist preparation.`);
  }

  if (!fileStat.isFile()) {
    throw new Error(`${label} ${path} is not a regular file; use a regular private file path before deployment checklist preparation.`);
  }
}

function renderMarkdown(checklist) {
  return [
    "# Deployment Execution Checklist",
    "",
    `Generated: ${checklist.generatedAt}`,
    `Status: ${checklist.overallStatus}`,
    `Release: ${checklist.releaseId || "missing"}`,
    `Source URL: ${checklist.sourceUrl || "missing"}`,
    "",
    "## Summary",
    `- Total: ${checklist.summary.total}`,
    `- Passed: ${checklist.summary.passed}`,
    `- Blocked: ${checklist.summary.blocked}`,
    `- Needs review: ${checklist.summary.needsReview}`,
    "",
    "## Results Template",
    `- Status: ${checklist.resultsTemplate.status}`,
    `- Generated: ${checklist.resultsTemplate.generatedAt || "missing"}`,
    `- Entries: ${checklist.resultsTemplate.entryCount}/${checklist.resultsTemplate.expectedCommandCount}`,
    "",
    "## Required Commands",
    ...checklist.entries.map((entry) => `- ${entry.commandId}: ${entry.status}; recordedAt=${entry.recordedAt || "missing"}; evidence=${entry.evidencePath || "missing"}`),
    "",
    "## Blockers",
    ...(checklist.blockers.length ? checklist.blockers.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Next Actions",
    ...checklist.nextActions.map((item) => `- ${item}`),
    "",
    `Disclaimer: ${checklist.disclaimer}`,
    ""
  ].join("\n");
}

function isRawSecretArg(arg) {
  return [
    "--token",
    "--admin-token",
    "--api-key",
    "--password",
    "--secret",
    "--oauth-secret"
  ].some((name) => arg === name || arg.startsWith(`${name}=`));
}

function hasUnsafeText(value) {
  return [
    /Bearer\s+(?!\[REDACTED\])[\w.~+/=-]+/iu,
    /\bAIza[0-9A-Za-z_-]{20,}/u,
    /GOCSPX-[0-9A-Za-z_-]{20,}/u,
    /private-admin-token/u,
    /refresh[_-]?token["':\s]+(?!\[REDACTED\])[\w.~+/=-]+/iu,
    /access[_-]?token["':\s]+(?!\[REDACTED\])[\w.~+/=-]+/iu
  ].some((pattern) => pattern.test(value));
}

function isLocalEvidencePath(value) {
  return !/^[a-z][a-z0-9+.-]*:\/\//iu.test(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isIsoTimestamp(value) {
  if (!value) {
    return false;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/u.test(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = args.writeResultsTemplatePath
      ? await writeDeploymentCommandResultsTemplate({
          bundleDir: args.bundleDir,
          outputPath: args.writeResultsTemplatePath
        })
      : await prepareDeploymentExecutionChecklist(args);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error?.checklist) {
      console.error(JSON.stringify(error.checklist, null, 2));
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
}
