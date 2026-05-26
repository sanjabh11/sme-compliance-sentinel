#!/usr/bin/env node
/* global console, process */

import { constants } from "node:fs";
import { access, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";

const defaultPrivateRoot = "/secure/local";
const defaultOutFileName = "cloudrun-operator-environment.json";
const defaultMarkdownFileName = "cloudrun-operator-environment.md";
const packetVerifierFileName = "cloudrun-dry-run-packet-verifier.json";

const prohibitedCliPatterns = [
  /(^|-)token($|=)/iu,
  /(^|-)password($|=)/iu,
  /(^|-)secret($|=)/iu,
  /gemini-api-key/iu,
  /oauth-client-secret/iu,
  /drive-channel-token/iu,
  /judge-(credential|password)/iu
];

const commonGcloudPaths = [
  "/opt/homebrew/bin/gcloud",
  "/usr/local/bin/gcloud",
  `${process.env.HOME ?? ""}/google-cloud-sdk/bin/gcloud`
].filter(Boolean);

export function parseArgs(argv) {
  const args = {
    packetPath: process.env.SENTINEL_CLOUDRUN_DRY_RUN_PACKET_PATH ?? "",
    privateRoot: process.env.SENTINEL_PRIVATE_ROOT ?? "",
    gcloudBin: process.env.GCLOUD_BIN ?? "",
    outFile: "",
    strict: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (prohibitedCliPatterns.some((pattern) => pattern.test(arg))) {
      throw new Error("Raw secret CLI args are not supported. Use environment variables and private evidence files instead.");
    }

    if (arg === "--packet") {
      args.packetPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--packet=")) {
      args.packetPath = arg.slice("--packet=".length);
      continue;
    }

    if (arg === "--private-root") {
      args.privateRoot = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--private-root=")) {
      args.privateRoot = arg.slice("--private-root=".length);
      continue;
    }

    if (arg === "--gcloud-bin") {
      args.gcloudBin = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--gcloud-bin=")) {
      args.gcloudBin = arg.slice("--gcloud-bin=".length);
      continue;
    }

    if (arg === "--out") {
      args.outFile = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--out=")) {
      args.outFile = arg.slice("--out=".length);
      continue;
    }

    if (arg === "--strict") {
      args.strict = true;
    }
  }

  return args;
}

export async function verifyCloudRunOperatorEnvironment(options) {
  if (!options.packetPath) {
    throw new Error("Cloud Run operator environment verification requires --packet artifacts/deployment/RELEASE_ID/cloudrun-dry-run-preflight-packet.json.");
  }

  const packetPath = resolve(options.packetPath);
  const packetRead = await readJsonForCheck(packetPath, "Cloud Run dry-run preflight packet");
  const packet = packetRead.ok ? packetRead.value : {};
  const releaseId = cleanString(packet.releaseId) || "missing-release";
  const packetDirectory = dirname(packetPath);
  const packetPrivateRoot = normalizeRoot(packet.privateRoot || defaultPrivateRoot);
  const operatorPrivateRoot = normalizeRoot(options.privateRoot || packetPrivateRoot || defaultPrivateRoot);
  const operatorPrivateBasePath = join(operatorPrivateRoot, "cloudrun", releaseId);
  const packetVerifierPath = join(packetDirectory, packetVerifierFileName);
  const packetVerifierRead = await readJsonForCheck(packetVerifierPath, "Cloud Run dry-run packet verifier");
  const packetVerifier = packetVerifierRead.ok ? packetVerifierRead.value : {};
  const gcloud = await resolveGcloudBinary(options.gcloudBin);
  const privateRootProbe = await probePrivateRoot(operatorPrivateBasePath);
  const dryRunCommand = cleanString(packet.dryRunCommand);
  const deployCommand = cleanString(packet.deployCommand);
  const operatorHandoff = packet.operatorHandoff && typeof packet.operatorHandoff === "object" ? packet.operatorHandoff : {};
  const commandSequence = Array.isArray(operatorHandoff.commandSequence) ? operatorHandoff.commandSequence : [];
  const artifactPaths = Array.isArray(operatorHandoff.privateArtifactPaths) ? operatorHandoff.privateArtifactPaths.map(cleanString) : [];
  const expectedPacketPrivateBasePath = join(packetPrivateRoot, "cloudrun", releaseId);
  const packetCommands = {
    dryRun: cleanString(commandSequence.find((command) => cleanString(command?.id) === "cloudrun-dry-run")?.command),
    deploy: cleanString(commandSequence.find((command) => cleanString(command?.id) === "cloudrun-deploy")?.command)
  };

  const checks = [
    check("packet-readable", packetRead.ok, packetRead.ok ? packetPath : packetRead.error, "Regenerate the Cloud Run dry-run preflight packet before operator execution."),
    check(
      "packet-ready-for-dry-run",
      packet.status === "ready-to-dry-run" && packet.readyForDryRun === true,
      `status=${cleanString(packet.status) || "missing"} readyForDryRun=${String(packet.readyForDryRun ?? "missing")}`,
      "Run prepare:cloudrun-dry-run and verify:cloudrun-dry-run-packet until the packet is ready-to-dry-run."
    ),
    check(
      "packet-verifier-ready",
      packetVerifierRead.ok && packetVerifier.status === "verified" && packetVerifier.readyForDryRun === true,
      packetVerifierRead.ok ? `status=${cleanString(packetVerifier.status)} readyForDryRun=${String(packetVerifier.readyForDryRun ?? "missing")}` : packetVerifierRead.error,
      "Run verify:cloudrun-dry-run-packet and preserve cloudrun-dry-run-packet-verifier.json before operator execution."
    ),
    check(
      "packet-private-root-aligned",
      operatorPrivateRoot === packetPrivateRoot,
      `packetPrivateRoot=${packetPrivateRoot}; operatorPrivateRoot=${operatorPrivateRoot}`,
      `Rerun prepare:cloudrun-dry-run with SENTINEL_PRIVATE_ROOT=${operatorPrivateRoot} so packet artifact paths match the operator evidence root.`
    ),
    check(
      "packet-private-artifact-paths-aligned",
      artifactPaths.length >= 4 && artifactPaths.every((path) => path.startsWith(expectedPacketPrivateBasePath)),
      `expected packet artifact base=${expectedPacketPrivateBasePath}; count=${artifactPaths.length}`,
      "Regenerate the dry-run packet so operatorHandoff.privateArtifactPaths use the packet private root and release id."
    ),
    check(
      "private-root-writable",
      privateRootProbe.ok,
      privateRootProbe.ok ? `${operatorPrivateBasePath} accepted a create/write/delete probe.` : privateRootProbe.error,
      `Use a regular writable private root, for example: SENTINEL_PRIVATE_ROOT=${shellQuote(fallbackPrivateRoot())}.`
    ),
    check(
      "gcloud-binary-available",
      gcloud.ok,
      gcloud.ok ? gcloud.path : gcloud.error,
      "Install Google Cloud CLI or pass --gcloud-bin /absolute/path/to/gcloud from a private operator terminal."
    ),
    check(
      "dry-run-command-safe",
      isSafeDryRunCommand(dryRunCommand),
      dryRunCommand || "missing",
      "Regenerate the dry-run packet; the dry-run command must be `gcloud run services replace ... --dry-run` with --region and --project."
    ),
    check(
      "deploy-command-safe",
      isSafeDeployCommand(deployCommand),
      deployCommand || "missing",
      "Regenerate the dry-run packet; the deploy command must be `gcloud run services replace ...` with --region and --project and without --dry-run."
    ),
    check(
      "operator-command-consistency",
      packetCommands.dryRun === dryRunCommand && packetCommands.deploy === deployCommand,
      "operator handoff commands must exactly match packet dryRunCommand and deployCommand.",
      "Regenerate the dry-run packet before operator execution."
    ),
    check(
      "no-raw-secret-shapes",
      !containsRawSecretShape(JSON.stringify({ dryRunCommand, deployCommand, operatorHandoff })),
      "operator command and handoff raw secret pattern scan",
      "Remove raw credentials from generated operator artifacts and regenerate from non-secret render values."
    )
  ];
  const blockers = checks.filter((item) => item.status !== "passed");
  const status = blockers.length ? "blocked" : "ready-for-private-gcloud-dry-run";
  const outFile = resolve(options.outFile || join(packetDirectory, defaultOutFileName));
  const markdownFile = outFile.endsWith(".json")
    ? `${outFile.slice(0, -".json".length)}.md`
    : join(dirname(outFile), defaultMarkdownFileName);
  const report = {
    generatedAt: new Date().toISOString(),
    status,
    readyForPrivateGcloudDryRun: status === "ready-for-private-gcloud-dry-run",
    bucket: "external-proof",
    releaseId,
    packetPath,
    packetVerifierPath,
    outFile,
    markdownFile,
    packetPrivateRoot,
    operatorPrivateRoot,
    operatorPrivateBasePath,
    gcloud: {
      status: gcloud.ok ? "available" : "missing",
      path: gcloud.ok ? gcloud.path : "",
      source: gcloud.source,
      note: "Availability is checked by executable lookup only; this script does not run gcloud, verify auth, or mutate Cloud Run."
    },
    checks,
    blockerCount: blockers.length,
    blockers,
    stopConditions: buildStopConditions({ blockers, operatorPrivateRoot, packetPrivateRoot }),
    manualCommands: buildManualCommands({
      status,
      gcloudPath: gcloud.ok ? gcloud.path : "gcloud",
      packet,
      operatorPrivateBasePath
    }),
    nextActions: buildNextActions({ status, blockers, operatorPrivateRoot }),
    proofBoundary:
      "This verifies the local operator environment only. It does not run gcloud, deploy Cloud Run, call Gemini, prove hosted production readiness, prove revenue, prove active users, approve judge access, or complete human attestation.",
    privateHandling: [
      "Keep this report with the private Cloud Run evidence bundle.",
      "Do not paste API keys, OAuth secrets, refresh tokens, customer findings, invoices, or judge credentials into shell commands, logs, or this report.",
      "A ready environment only means the operator machine can attempt the private dry-run. Hosted proof starts after reviewed Cloud Run dry-run, deploy, describe, and hosted smoke artifacts exist."
    ]
  };

  await writeJson(outFile, report);
  await writeFile(markdownFile, renderMarkdown(report), "utf8");

  if (options.strict && status !== "ready-for-private-gcloud-dry-run") {
    const error = new Error(`Cloud Run operator environment is ${status}; see ${outFile}.`);
    error.report = report;
    throw error;
  }

  return report;
}

async function readJsonForCheck(path, label) {
  try {
    const stat = await lstat(path);

    if (stat.isSymbolicLink()) {
      return { ok: false, error: `${label} at ${path} is a symbolic link.` };
    }

    if (!stat.isFile()) {
      return { ok: false, error: `${label} at ${path} is not a regular file.` };
    }

    return { ok: true, value: JSON.parse(await readFile(path, "utf8")) };
  } catch (error) {
    return {
      ok: false,
      error: `${label} at ${path} is not readable JSON: ${error instanceof Error ? error.message : String(error)}.`
    };
  }
}

async function probePrivateRoot(privateBasePath) {
  const markerPath = join(privateBasePath, `.sentinel-operator-preflight-${process.pid}-${Date.now()}.tmp`);

  try {
    await mkdir(privateBasePath, { recursive: true });
    await assertDirectorySafe(privateBasePath);
    await writeFile(markerPath, "sentinel operator environment probe\n", { encoding: "utf8", flag: "wx" });
    await rm(markerPath, { force: true });
    return { ok: true };
  } catch (error) {
    await rm(markerPath, { force: true }).catch(() => {});
    return {
      ok: false,
      error: `${privateBasePath} is not writable as a private evidence root: ${error instanceof Error ? error.message : String(error)}.`
    };
  }
}

async function assertDirectorySafe(path) {
  const stat = await lstat(path);

  if (stat.isSymbolicLink()) {
    throw new Error(`${path} is a symbolic link; use a regular private directory.`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`${path} is not a directory; use a regular private directory.`);
  }
}

async function resolveGcloudBinary(explicitPath) {
  const requested = cleanString(explicitPath);
  const candidates = requested ? [requested] : [...pathCandidates("gcloud"), ...commonGcloudPaths];

  for (const candidate of candidates) {
    const resolved = requested && requested !== "gcloud" ? resolve(candidate) : candidate;
    const executable = await isExecutable(resolved);

    if (executable) {
      return {
        ok: true,
        path: resolved,
        source: requested ? "explicit" : "discovered"
      };
    }
  }

  return {
    ok: false,
    path: "",
    source: requested ? "explicit" : "discovered",
    error: requested
      ? `${requested} is not executable or not found.`
      : "gcloud was not found on PATH or common Google Cloud SDK locations."
  };
}

function pathCandidates(binaryName) {
  return String(process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((entry) => join(entry, binaryName));
}

async function isExecutable(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isSafeDryRunCommand(command) {
  return /^gcloud run services replace\b/u.test(command) &&
    /--dry-run\b/u.test(command) &&
    /--region\b/u.test(command) &&
    /--project\b/u.test(command) &&
    !/\b(delete|remove|destroy)\b/iu.test(command) &&
    !containsRawSecretShape(command);
}

function isSafeDeployCommand(command) {
  return /^gcloud run services replace\b/u.test(command) &&
    !/--dry-run\b/u.test(command) &&
    /--region\b/u.test(command) &&
    /--project\b/u.test(command) &&
    !/\b(delete|remove|destroy)\b/iu.test(command) &&
    !containsRawSecretShape(command);
}

function buildStopConditions({ blockers, operatorPrivateRoot, packetPrivateRoot }) {
  if (blockers.length) {
    return [
      "Do not run Cloud Run dry-run until every operator-environment check passes.",
      ...(operatorPrivateRoot === packetPrivateRoot ? [] : [`Rerun dry-run preflight with SENTINEL_PRIVATE_ROOT=${operatorPrivateRoot} before using this operator root.`]),
      ...blockers.slice(0, 5).map((blocker) => `${blocker.id}: ${blocker.fix}`)
    ];
  }

  return [
    "Run gcloud dry-run only from this private operator terminal.",
    "Stop if gcloud output references the wrong project, region, release id, image, revision, service account, or Secret Manager project.",
    "Stop if terminal output includes raw credentials, OAuth tokens, API keys, customer findings, invoices, or unredacted Workspace content.",
    "Deploy only after preserving and reviewing the dry-run log."
  ];
}

function buildNextActions({ status, blockers, operatorPrivateRoot }) {
  if (status === "ready-for-private-gcloud-dry-run") {
    return [
      "Run the dry-run command from this report and preserve the log in the private evidence root.",
      "Review the dry-run log for project, region, image, revision, service account, Secret Manager version, and VPC egress correctness.",
      "Deploy only after dry-run review, then capture describe JSON and run collect:cloudrun-deployment."
    ];
  }

  const rootMismatch = blockers.some((blocker) => blocker.id === "packet-private-root-aligned");

  return [
    ...(rootMismatch ? [`Set SENTINEL_PRIVATE_ROOT=${operatorPrivateRoot} and rerun prepare:cloudrun-dry-run plus verify:cloudrun-dry-run-packet.`] : []),
    "Install or expose Google Cloud CLI in the operator terminal if gcloud is missing.",
    "Use a writable private evidence root outside Git.",
    "Rerun verify:cloudrun-operator-env with --strict before any Cloud Run dry-run."
  ];
}

function buildManualCommands({ status, gcloudPath, packet, operatorPrivateBasePath }) {
  const dryRunCommand = rewriteLeadingGcloud(cleanString(packet.dryRunCommand), gcloudPath);
  const deployCommand = rewriteLeadingGcloud(cleanString(packet.deployCommand), gcloudPath);
  const describeCommand = rewriteLeadingGcloud(
    cleanString(packet.operatorHandoff?.commandSequence?.find((command) => cleanString(command?.id) === "cloudrun-describe")?.command),
    gcloudPath
  );
  const collectCommand = cleanString(packet.operatorHandoff?.commandSequence?.find((command) => cleanString(command?.id) === "collect-cloudrun-deployment")?.command);

  return [
    {
      id: "prepare-private-root",
      status: "ready",
      command: `mkdir -p ${shellQuote(operatorPrivateBasePath)}`,
      mutatesCloudRun: false
    },
    {
      id: "cloudrun-dry-run",
      status: status === "ready-for-private-gcloud-dry-run" ? "ready" : "blocked",
      command: `${dryRunCommand} 2>&1 | tee ${shellQuote(join(operatorPrivateBasePath, "cloudrun-dry-run.log"))}`,
      mutatesCloudRun: false
    },
    {
      id: "cloudrun-deploy",
      status: status === "ready-for-private-gcloud-dry-run" ? "review-dry-run-first" : "blocked",
      command: `${deployCommand} 2>&1 | tee ${shellQuote(join(operatorPrivateBasePath, "cloudrun-deploy.log"))}`,
      mutatesCloudRun: true
    },
    {
      id: "cloudrun-describe",
      status: status === "ready-for-private-gcloud-dry-run" ? "after-deploy" : "blocked",
      command: `${describeCommand} > ${shellQuote(join(operatorPrivateBasePath, "cloudrun-describe.json"))}`,
      mutatesCloudRun: false
    },
    {
      id: "collect-cloudrun-deployment",
      status: status === "ready-for-private-gcloud-dry-run" ? "after-describe" : "blocked",
      command: collectCommand,
      mutatesCloudRun: false
    }
  ];
}

function rewriteLeadingGcloud(command, gcloudPath) {
  const safeCommand = cleanString(command);
  const safeGcloudPath = cleanString(gcloudPath);

  if (!safeCommand || !safeGcloudPath || safeGcloudPath === "gcloud") {
    return safeCommand;
  }

  return safeCommand.replace(/^gcloud\b/u, shellQuote(safeGcloudPath));
}

function check(id, passed, evidence, fix) {
  return {
    id,
    status: passed ? "passed" : "blocked",
    evidence,
    fix: passed ? "No action." : fix
  };
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function renderMarkdown(report) {
  return [
    "# Cloud Run Operator Environment Preflight",
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    `Release: ${report.releaseId}`,
    `Ready for private gcloud dry-run: ${report.readyForPrivateGcloudDryRun ? "yes" : "no"}`,
    "",
    "## Environment",
    `- Packet private root: ${report.packetPrivateRoot}`,
    `- Operator private root: ${report.operatorPrivateRoot}`,
    `- Operator private base path: ${report.operatorPrivateBasePath}`,
    `- gcloud: ${report.gcloud.status}${report.gcloud.path ? ` (${report.gcloud.path})` : ""}`,
    "",
    "## Checks",
    "| Check | Status | Evidence | Fix |",
    "|---|---|---|---|",
    ...report.checks.map((item) => `| ${escapeTable(item.id)} | ${item.status} | ${escapeTable(item.evidence)} | ${escapeTable(item.fix)} |`),
    "",
    "## Stop Conditions",
    ...report.stopConditions.map((item) => `- ${item}`),
    "",
    "## Manual Commands",
    "| Step | Status | Mutates Cloud Run | Command |",
    "|---|---|---:|---|",
    ...report.manualCommands.map((item) => `| ${escapeTable(item.id)} | ${escapeTable(item.status)} | ${item.mutatesCloudRun ? "yes" : "no"} | ${escapeTable(item.command)} |`),
    "",
    "## Next Actions",
    ...report.nextActions.map((item) => `- ${item}`),
    "",
    `Proof boundary: ${report.proofBoundary}`,
    "",
    ...report.privateHandling.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function containsRawSecretShape(text) {
  const secretPatterns = [
    /\bAIza[0-9A-Za-z_-]{20,}/u,
    /\bGOCSPX-[0-9A-Za-z_-]{20,}/u,
    /\bya29\.[0-9A-Za-z._-]+/u,
    /Bearer\s+(?!\[REDACTED\])[\w.~+/=-]{20,}/iu,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u
  ];

  return secretPatterns.some((pattern) => pattern.test(String(text ?? "")));
}

function normalizeRoot(value) {
  const root = cleanString(value) || defaultPrivateRoot;
  return root.replace(/\/+$/u, "") || defaultPrivateRoot;
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function fallbackPrivateRoot() {
  return "/private/tmp/sentinel-secure/local";
}

function shellQuote(value) {
  const text = String(value ?? "");

  if (/^[A-Za-z0-9_./:=@%+-]+$/u.test(text)) {
    return text;
  }

  return `'${text.replace(/'/gu, "'\\''")}'`;
}

function escapeTable(value) {
  return String(value ?? "").replace(/\|/gu, "\\|").replace(/\n/gu, " ");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = await verifyCloudRunOperatorEnvironment(options);
    console.log(JSON.stringify(report, null, 2));
    if (options.strict && report.status !== "ready-for-private-gcloud-dry-run") {
      process.exitCode = 1;
    }
  } catch (error) {
    if (error?.report) {
      console.error(JSON.stringify(error.report, null, 2));
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
}
