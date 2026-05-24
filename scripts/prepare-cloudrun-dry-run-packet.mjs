#!/usr/bin/env node
/* global console, process */

import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { renderCloudRunManifest } from "./render-cloudrun-manifest.mjs";

const defaultOutDir = "artifacts/deployment";
const defaultTemplate = "cloudrun.service.yaml";
const packetFileName = "cloudrun-dry-run-preflight-packet.json";
const markdownFileName = "cloudrun-dry-run-preflight-packet.md";
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

export function parseArgs(argv) {
  const args = {
    valuesPath: "",
    outDir: process.env.SENTINEL_CLOUD_RUN_RENDER_OUT_DIR ?? defaultOutDir,
    releaseId: process.env.SENTINEL_RELEASE_ID ?? "",
    template: defaultTemplate,
    verifyPacketPath: "",
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

    if (arg === "--template") {
      args.template = argv[index + 1] ?? defaultTemplate;
      index += 1;
      continue;
    }

    if (arg.startsWith("--template=")) {
      args.template = arg.slice("--template=".length) || defaultTemplate;
      continue;
    }

    if (arg === "--verify-packet") {
      args.verifyPacketPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--verify-packet=")) {
      args.verifyPacketPath = arg.slice("--verify-packet=".length);
      continue;
    }

    if (arg === "--strict") {
      args.strict = true;
    }
  }

  return args;
}

export async function prepareCloudRunDryRunPacket(options) {
  if (!options.valuesPath) {
    throw new Error("Cloud Run dry-run preflight requires --values /private/path/cloudrun-render-values.json.");
  }

  const renderSummary = await renderCloudRunManifest({
    template: options.template ?? defaultTemplate,
    valuesPath: options.valuesPath,
    outDir: options.outDir ?? defaultOutDir,
    releaseId: options.releaseId ?? "",
    strict: false
  });
  const outputDirectory = resolve(renderSummary.outputDirectory);
  const verifierPath = join(outputDirectory, renderSummary.verifierFile);
  const verifier = JSON.parse(await readRegularTextFileOrThrow(verifierPath, "Cloud Run manifest verifier"));
  const evidenceFileDigests = await buildEvidenceFileDigests(renderSummary);
  const packet = buildDryRunPacket({ renderSummary, verifier, valuesPath: options.valuesPath, evidenceFileDigests });

  await assertDirectoryPathSafe(outputDirectory, "Cloud Run dry-run packet output directory");
  await mkdir(outputDirectory, { recursive: true });
  await assertDirectoryExistsSafe(outputDirectory, "Cloud Run dry-run packet output directory");
  await writeJson(join(outputDirectory, packetFileName), packet);
  await writeTextFile(join(outputDirectory, markdownFileName), renderMarkdown(packet), "Cloud Run dry-run packet Markdown");

  if (options.strict && packet.status !== "ready-to-dry-run") {
    const error = new Error(`Cloud Run dry-run preflight is ${packet.status}; see ${join(outputDirectory, packetFileName)}.`);
    error.packet = packet;
    throw error;
  }

  return packet;
}

export async function verifyCloudRunDryRunPacket(packetPath) {
  if (!packetPath) {
    throw new Error("Cloud Run dry-run packet verification requires --verify-packet artifacts/deployment/RELEASE_ID/cloudrun-dry-run-preflight-packet.json.");
  }

  const absolutePacketPath = resolve(packetPath);
  const packetVerifierPath = join(dirname(absolutePacketPath), packetVerifierFileName);
  const packetRead = await readRegularTextFileForVerification(absolutePacketPath, "Cloud Run dry-run packet");
  const packetReadChecks = [
    structureCheck(
      "packet-regular-file",
      packetRead.ok,
      packetRead.ok ? `${absolutePacketPath} is a regular file.` : packetRead.error
    )
  ];
  let packet = {};
  if (packetRead.ok) {
    try {
      packet = JSON.parse(packetRead.content);
      packetReadChecks.push(structureCheck("packet-json", true, `Packet JSON parsed from ${absolutePacketPath}.`));
    } catch (error) {
      packetReadChecks.push(
        structureCheck(
          "packet-json",
          false,
          `Packet JSON could not be parsed from ${absolutePacketPath}: ${error instanceof Error ? error.message : String(error)}.`
        )
      );
    }
  } else {
    packetReadChecks.push(structureCheck("packet-json", false, "Packet JSON was not parsed because the packet file boundary check failed."));
  }
  const digestEntries = Array.isArray(packet.evidenceFileDigests) ? packet.evidenceFileDigests : [];
  const digestChecks = await Promise.all(digestEntries.map(verifyDigestEntry));
  const failedChecks = digestChecks.filter((check) => check.status !== "matched");
  const structuralChecks = [
    ...packetReadChecks,
    ...(packetRead.ok && packetReadChecks.every((check) => check.status === "passed")
      ? await verifyPacketStructure({ packet, packetPath: absolutePacketPath, digestEntries })
      : [])
  ];
  const failedStructuralChecks = structuralChecks.filter((check) => check.status !== "passed");
  const packetReady = packet.status === "ready-to-dry-run" && packet.readyForDryRun === true;
  const status = packetReady && digestEntries.length > 0 && failedChecks.length === 0 && failedStructuralChecks.length === 0
    ? "verified"
    : "blocked";
  const verifiedDryRunCommand = structurePassed(structuralChecks, "dry-run-command-file-consistency")
    ? String(packet.dryRunCommand ?? "")
    : "";
  const packetForNextActions = {
    ...packet,
    dryRunCommand: verifiedDryRunCommand
  };

  const report = {
    generatedAt: new Date().toISOString(),
    status,
    readyForDryRun: status === "verified",
    packetPath: absolutePacketPath,
    packetVerifierPath,
    releaseId: packet.releaseId ?? "missing",
    packetStatus: packet.status ?? "missing",
    digestCount: digestEntries.length,
    matchedDigestCount: digestChecks.filter((check) => check.status === "matched").length,
    failedDigestCount: failedChecks.length,
    digestChecks,
    structuralCheckCount: structuralChecks.length,
    passedStructuralCheckCount: structuralChecks.filter((check) => check.status === "passed").length,
    failedStructuralCheckCount: failedStructuralChecks.length,
    structuralChecks,
    dryRunCommand: verifiedDryRunCommand,
    stopConditions: buildVerificationStopConditions({ packetReady, digestEntries, failedChecks, failedStructuralChecks }),
    nextActions: buildVerificationNextActions({ status, packet: packetForNextActions }),
    disclaimer:
      "This verifies local preflight artifact digests, operator handoff structure, and proof-boundary language only. It does not run Cloud Run dry-run, deploy Cloud Run, or prove hosted production readiness."
  };

  await writeJson(packetVerifierPath, report);

  return report;
}

export function buildDryRunPacket({ renderSummary, verifier, valuesPath, evidenceFileDigests = [] }) {
  const blockers = verifier.blockers ?? [];
  const replacementFindings = verifier.replacementFindings ?? [];
  const manualReviewFlags = (verifier.envChecks ?? [])
    .filter((check) => check.status === "manual-review")
    .map((check) => ({
      name: check.name,
      category: check.category,
      evidence: check.evidence,
      fix: check.fix
    }));
  const status = blockers.length || verifier.overallStatus === "blocked"
    ? "blocked"
    : verifier.overallStatus === "ready-to-dry-run"
      ? "ready-to-dry-run"
      : "needs-values";
  const operatorHandoff = buildOperatorHandoff({ status, renderSummary, replacementFindings, blockers });

  return {
    generatedAt: new Date().toISOString(),
    status,
    readyForDryRun: status === "ready-to-dry-run",
    bucket: "code-controllable",
    releaseId: renderSummary.releaseId,
    outputDirectory: renderSummary.outputDirectory,
    valuesPath,
    renderedManifestPath: renderSummary.renderedManifestPath,
    verifierPath: join(renderSummary.outputDirectory, renderSummary.verifierFile),
    dryRunCommandFile: join(renderSummary.outputDirectory, renderSummary.dryRunCommandFile),
    deployCommandFile: join(renderSummary.outputDirectory, renderSummary.deployCommandFile),
    dryRunCommand: renderSummary.dryRunCommand,
    deployCommand: renderSummary.deployCommand,
    verification: {
      overallStatus: verifier.overallStatus,
      blockerCount: blockers.length,
      replacementCount: replacementFindings.length,
      manualReviewCount: manualReviewFlags.length,
      secretRefCount: verifier.secretRefs?.length ?? 0
    },
    phaseProgress: buildPhaseProgress({ status, replacementFindings, blockers }),
    operatorHandoff,
    stopConditions: buildStopConditions({ status, blockers, replacementFindings }),
    manualReviewFlags,
    redactionChecklist: [
      "Do not share the filled render-values file outside the private operator channel.",
      "Do not share rendered manifests if they expose customer names, judge credentials, OAuth material, API key values, refresh tokens, or admin tokens.",
      "Before judge sharing, redact customer names, emails, file names, invoices, payment ids, Workspace resource ids, and raw security findings.",
      "Share Secret Manager resource names and numeric versions only when useful; never share secret values.",
      "Keep Cloud Run dry-run/deploy logs, service describe JSON, billing proof, and hosted write-through JSON in the private evidence store.",
      "Public Devpost copy should mention aggregate proof status and product behavior, not raw tenant security details."
    ],
    evidenceFilesToPreserve: [
      renderSummary.renderedManifestPath,
      join(renderSummary.outputDirectory, renderSummary.verifierFile),
      join(renderSummary.outputDirectory, renderSummary.summaryFile ?? "cloudrun-render-summary.json"),
      join(renderSummary.outputDirectory, packetFileName),
      join(renderSummary.outputDirectory, markdownFileName),
      join(renderSummary.outputDirectory, packetVerifierFileName),
      join(renderSummary.outputDirectory, renderSummary.dryRunCommandFile),
      join(renderSummary.outputDirectory, renderSummary.deployCommandFile)
    ],
    evidenceFileDigests,
    privateHandling: [
      "This preflight packet is an ignored private deployment artifact. It does not deploy Cloud Run or prove hosted readiness.",
      "A ready-to-dry-run status only means the rendered manifest has no local verifier blockers or missing placeholders.",
      "The packet hashes the rendered manifest bundle before dry-run so later evidence imports can detect file drift.",
      "The packet verifier writes cloudrun-dry-run-packet-verifier.json beside this packet and must be preserved with the private release evidence.",
      "Human-review flags may remain false at dry-run time; they become proof only after the private artifact exists.",
      "Run the dry-run command only from a private operator shell with approved Google Cloud credentials."
    ],
    nextActions: buildNextActions({ status, replacementFindings, blockers, dryRunCommand: renderSummary.dryRunCommand }),
    proofBoundary:
      "This packet completes the local render/digest preflight only. Cloud Run dry-run, deployment, hosted Gemini evidence, judge access, users, and revenue remain external proof until private artifacts are captured.",
    disclaimer:
      "This packet validates local deployment evidence readiness before Cloud Run dry-run. External proof remains pending until real Cloud Run, Gemini, GCP, Workspace, revenue, user, cost, CAC, judge-access, demo-video, and license/IP evidence is captured."
  };
}

function buildPhaseProgress({ status, replacementFindings, blockers }) {
  return {
    phaseId: "cloudrun-render-dry-run",
    label: "Cloud Run dry-run preflight",
    ratingOutOf5: preflightRating({ status, replacementFindings, blockers }),
    currentSliceRemainingPercent: preflightRemainingPercent({ status, replacementFindings, blockers }),
    nextPhaseId: "hosted-proof-capture",
    nextPhaseBucket: "external-proof",
    overallGoalRemainingPercentSource: "Run npm run verify:local-submission for the aggregate goal percentage.",
    basis:
      "This measures the local manifest render, digest preflight, and operator handoff only. It is not hosted Cloud Run, Gemini, revenue, user, or judging proof."
  };
}

function preflightRating({ status, replacementFindings, blockers }) {
  if (status === "ready-to-dry-run") {
    return 4;
  }

  if (status === "blocked" || blockers.length) {
    return 1;
  }

  if (replacementFindings.length) {
    return 2;
  }

  return 2;
}

function preflightRemainingPercent({ status, replacementFindings, blockers }) {
  if (status === "ready-to-dry-run") {
    return 0;
  }

  if (status === "blocked" || blockers.length) {
    return 90;
  }

  if (replacementFindings.length) {
    return Math.min(85, 45 + replacementFindings.length * 2);
  }

  return 60;
}

function buildOperatorHandoff({ status, renderSummary, replacementFindings, blockers }) {
  const releaseId = renderSummary.releaseId || "$SENTINEL_RELEASE_ID";
  const privateBasePath = `/secure/local/cloudrun/${releaseId}`;
  const readyForGcloudDryRun = status === "ready-to-dry-run";

  return {
    status: readyForGcloudDryRun ? "ready-for-private-gcloud-dry-run" : "blocked-before-gcloud",
    nextPhaseId: "hosted-proof-capture",
    nextPhaseBucket: "external-proof",
    readyForPrivateGcloudDryRun: readyForGcloudDryRun,
    privateArtifactPaths: [
      `${privateBasePath}/cloudrun-dry-run.log`,
      `${privateBasePath}/cloudrun-deploy.log`,
      `${privateBasePath}/cloudrun-describe.json`,
      `${privateBasePath}/cloudrun-deployment-transcript-packet.json`
    ],
    commandSequence: buildOperatorCommandSequence({ renderSummary, releaseId, privateBasePath }),
    stopConditions: buildOperatorStopConditions({ readyForGcloudDryRun, replacementFindings, blockers }),
    proofBoundary:
      "This handoff lists the next private operator actions. It does not run gcloud, mutate Cloud Run, prove hosted availability, call Gemini, or create business traction evidence."
  };
}

function buildOperatorCommandSequence({ renderSummary, releaseId, privateBasePath }) {
  return [
    {
      id: "cloudrun-dry-run",
      owner: "engineering",
      command: renderSummary.dryRunCommand,
      mutatesCloudRun: false,
      expectedPrivateArtifact: `${privateBasePath}/cloudrun-dry-run.log`,
      stopCondition: "Do not continue if dry-run output references the wrong project, region, image tag, service account, or secret versions."
    },
    {
      id: "cloudrun-deploy",
      owner: "engineering",
      command: renderSummary.deployCommand,
      mutatesCloudRun: true,
      expectedPrivateArtifact: `${privateBasePath}/cloudrun-deploy.log`,
      stopCondition: "Do not deploy unless the reviewed dry-run output is clean and preserved in the private evidence store."
    },
    {
      id: "cloudrun-describe",
      owner: "engineering",
      command:
        "gcloud run services describe $SENTINEL_CLOUD_RUN_SERVICE_NAME --region $SENTINEL_CLOUD_RUN_REGION --project $GOOGLE_CLOUD_PROJECT --format=json",
      mutatesCloudRun: false,
      expectedPrivateArtifact: `${privateBasePath}/cloudrun-describe.json`,
      stopCondition: "Do not collect hosted proof until the describe JSON includes the expected release id, revision, service URL, and service account."
    },
    {
      id: "collect-cloudrun-deployment",
      owner: "engineering",
      command:
        `npm run collect:cloudrun-deployment -- --release-id ${releaseId} --dry-run-log ${privateBasePath}/cloudrun-dry-run.log --deploy-log ${privateBasePath}/cloudrun-deploy.log --describe-json ${privateBasePath}/cloudrun-describe.json --out-dir artifacts/deployment --strict`,
      mutatesCloudRun: false,
      expectedPrivateArtifact: `${privateBasePath}/cloudrun-deployment-transcript-packet.json`,
      stopCondition: "Do not run hosted verification until the transcript packet is ready-for-hosted-verification."
    }
  ];
}

function buildOperatorStopConditions({ readyForGcloudDryRun, replacementFindings, blockers }) {
  if (!readyForGcloudDryRun) {
    return [
      "Do not run gcloud dry-run from this packet.",
      ...blockers.slice(0, 4),
      ...replacementFindings.slice(0, 4).map((finding) => `${finding.target}: ${finding.fix}`)
    ];
  }

  return [
    "Run these commands only from a private operator shell with approved Google Cloud credentials.",
    "Do not paste admin tokens, OAuth client secrets, API keys, refresh tokens, customer findings, invoices, or judge credentials into shell commands or logs.",
    "Preserve redacted and original command outputs in the private evidence store before hosted verification."
  ];
}

function buildStopConditions({ status, blockers, replacementFindings }) {
  if (status === "blocked") {
    return [
      "Do not run Cloud Run dry-run while verifier blockers exist.",
      ...blockers.slice(0, 5)
    ];
  }

  if (replacementFindings.length) {
    return [
      "Do not run Cloud Run dry-run while template placeholders or required empty values remain.",
      ...replacementFindings.slice(0, 5).map((finding) => `${finding.target}: ${finding.fix}`)
    ];
  }

  return [
    "Stop if dry-run output references a different image tag, source commit, service account, project, region, or Secret Manager project number than this packet.",
    "Stop if any terminal output includes raw credentials, OAuth tokens, admin tokens, customer findings, invoices, or unredacted Workspace data.",
    "Stop if the operator cannot preserve dry-run output in the private evidence store before deployment."
  ];
}

function buildNextActions({ status, replacementFindings, blockers, dryRunCommand }) {
  if (status === "blocked") {
    return [
      "Fix Cloud Run manifest verifier blockers.",
      ...blockers.slice(0, 4),
      "Rerun this preflight before any dry-run."
    ];
  }

  if (replacementFindings.length) {
    return [
      "Fill the remaining non-secret render values in the private values file.",
      "Keep business, demo, judge-access, and eligibility flags false until evidence exists.",
      "Rerun this preflight until status is ready-to-dry-run."
    ];
  }

  return [
    `Run the generated dry-run command from a private operator shell: ${dryRunCommand}`,
    "Save the dry-run output next to this packet in the private evidence store.",
    "Deploy only after dry-run review, then run hosted production verification and hosted proof collection."
  ];
}

function renderMarkdown(packet) {
  return [
    `# Cloud Run Dry-Run Preflight Packet`,
    "",
    `Generated: ${packet.generatedAt}`,
    `Status: ${packet.status}`,
    `Release: ${packet.releaseId}`,
    `Ready for dry-run: ${packet.readyForDryRun ? "yes" : "no"}`,
    "",
    "## Phase Progress",
    `- Phase: ${packet.phaseProgress.phaseId}`,
    `- Rating: ${packet.phaseProgress.ratingOutOf5}/5`,
    `- Current slice remaining: ${packet.phaseProgress.currentSliceRemainingPercent}%`,
    `- Next phase: ${packet.phaseProgress.nextPhaseId} (${packet.phaseProgress.nextPhaseBucket})`,
    `- Basis: ${packet.phaseProgress.basis}`,
    "",
    "## Verification",
    `- Overall manifest status: ${packet.verification.overallStatus}`,
    `- Blockers: ${packet.verification.blockerCount}`,
    `- Replacement findings: ${packet.verification.replacementCount}`,
    `- Manual review flags: ${packet.verification.manualReviewCount}`,
    `- Secret references: ${packet.verification.secretRefCount}`,
    "",
    "## Stop Conditions",
    ...packet.stopConditions.map((item) => `- ${item}`),
    "",
    "## Redaction Checklist",
    ...packet.redactionChecklist.map((item) => `- ${item}`),
    "",
    "## Evidence Files",
    ...packet.evidenceFilesToPreserve.map((item) => `- ${item}`),
    "",
    "## Evidence File Digests",
    ...packet.evidenceFileDigests.map((item) => `- ${item.role}: ${item.sha256} (${item.byteLength} bytes) ${item.path}`),
    "",
    "## Operator Handoff",
    `- Status: ${packet.operatorHandoff.status}`,
    `- Next phase: ${packet.operatorHandoff.nextPhaseId} (${packet.operatorHandoff.nextPhaseBucket})`,
    `- Proof boundary: ${packet.operatorHandoff.proofBoundary}`,
    "",
    "| ID | Mutates Cloud Run | Expected Private Artifact | Stop Condition |",
    "|---|---:|---|---|",
    ...packet.operatorHandoff.commandSequence.map(
      (command) =>
        `| ${escapeTable(command.id)} | ${command.mutatesCloudRun ? "yes" : "no"} | ${escapeTable(command.expectedPrivateArtifact)} | ${escapeTable(command.stopCondition)} |`
    ),
    "",
    "## Next Actions",
    ...packet.nextActions.map((item) => `- ${item}`),
    "",
    `Proof boundary: ${packet.proofBoundary}`,
    "",
    `Disclaimer: ${packet.disclaimer}`,
    ""
  ].join("\n");
}

function escapeTable(value) {
  return String(value ?? "").replace(/\|/gu, "\\|").replace(/\n/gu, " ");
}

async function buildEvidenceFileDigests(renderSummary) {
  const files = [
    {
      role: "rendered-manifest",
      path: renderSummary.renderedManifestPath
    },
    {
      role: "manifest-verifier",
      path: join(renderSummary.outputDirectory, renderSummary.verifierFile)
    },
    {
      role: "render-summary",
      path: join(renderSummary.outputDirectory, renderSummary.summaryFile ?? "cloudrun-render-summary.json")
    },
    {
      role: "dry-run-command",
      path: join(renderSummary.outputDirectory, renderSummary.dryRunCommandFile)
    },
    {
      role: "deploy-command",
      path: join(renderSummary.outputDirectory, renderSummary.deployCommandFile)
    }
  ];

  return Promise.all(files.map(readDigest));
}

async function readDigest(file) {
  const buffer = await readRegularBufferFileOrThrow(file.path, `${file.role} evidence file`);

  return {
    ...file,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    byteLength: buffer.length
  };
}

async function verifyDigestEntry(entry) {
  const expectedSha256 = String(entry.sha256 ?? "");
  const expectedByteLength = Number(entry.byteLength ?? 0);

  const fileRead = await readRegularBufferFileForVerification(entry.path, `${String(entry.role ?? "unknown")} evidence file`);

  if (!fileRead.ok) {
    return {
      role: String(entry.role ?? "unknown"),
      path: String(entry.path ?? ""),
      status: "invalid-file",
      expectedSha256,
      actualSha256: "invalid-file",
      expectedByteLength,
      actualByteLength: 0,
      fix: `${fileRead.error} Regenerate the Cloud Run dry-run preflight packet from regular private files before running gcloud dry-run.`
    };
  }

  const buffer = fileRead.buffer;
  const actualSha256 = createHash("sha256").update(buffer).digest("hex");
  const actualByteLength = buffer.length;
  const matched = actualSha256 === expectedSha256 && actualByteLength === expectedByteLength;

  return {
    role: String(entry.role ?? "unknown"),
    path: String(entry.path ?? ""),
    status: matched ? "matched" : "mismatch",
    expectedSha256,
    actualSha256,
    expectedByteLength,
    actualByteLength,
    fix: matched ? "No action." : "Regenerate the Cloud Run dry-run preflight packet before running gcloud dry-run."
  };
}

async function verifyPacketStructure({ packet, packetPath, digestEntries = [] }) {
  const releaseId = String(packet.releaseId ?? "");
  const operatorHandoff = packet.operatorHandoff ?? {};
  const commandSequence = Array.isArray(operatorHandoff.commandSequence) ? operatorHandoff.commandSequence : [];
  const commandById = new Map(commandSequence.map((command) => [String(command?.id ?? ""), command]));
  const markdownPath = packetPath.endsWith(".json")
    ? `${packetPath.slice(0, -".json".length)}.md`
    : join(dirname(packetPath), markdownFileName);
  const expectedPrivateBasePath = `/secure/local/cloudrun/${releaseId || "$SENTINEL_RELEASE_ID"}`;
  const expectedCommands = [
    ["cloudrun-dry-run", false],
    ["cloudrun-deploy", true],
    ["cloudrun-describe", false],
    ["collect-cloudrun-deployment", false]
  ];
  const dryRunCommandFileRead = await readDigestTextByRole(digestEntries, "dry-run-command", "Cloud Run dry-run command file");
  const deployCommandFileRead = await readDigestTextByRole(digestEntries, "deploy-command", "Cloud Run deploy command file");
  const dryRunCommand = String(packet.dryRunCommand ?? "");
  const deployCommand = String(packet.deployCommand ?? "");
  const operatorDryRunCommand = String(commandById.get("cloudrun-dry-run")?.command ?? "");
  const operatorDeployCommand = String(commandById.get("cloudrun-deploy")?.command ?? "");
  const operatorDescribeCommand = String(commandById.get("cloudrun-describe")?.command ?? "");
  const operatorCollectCommand = String(commandById.get("collect-cloudrun-deployment")?.command ?? "");
  const checks = [
    structureCheck("packet-bucket", packet.bucket === "code-controllable", `bucket=${String(packet.bucket ?? "missing")}`),
    structureCheck(
      "packet-proof-boundary",
      includesAll(packet.proofBoundary, [
        "local render/digest preflight only",
        "Cloud Run dry-run",
        "hosted Gemini evidence",
        "judge access",
        "users",
        "revenue remain external proof"
      ]),
      String(packet.proofBoundary ?? "missing")
    ),
    structureCheck(
      "operator-proof-boundary",
      includesAll(operatorHandoff.proofBoundary, ["does not run gcloud", "prove hosted availability", "create business traction evidence"]),
      String(operatorHandoff.proofBoundary ?? "missing")
    ),
    structureCheck(
      "operator-private-artifact-base",
      Array.isArray(operatorHandoff.privateArtifactPaths) &&
        operatorHandoff.privateArtifactPaths.length >= 4 &&
        operatorHandoff.privateArtifactPaths.every((path) => String(path).startsWith(expectedPrivateBasePath)),
      `expected base=${expectedPrivateBasePath}`
    ),
    structureCheck(
      "operator-command-order",
      commandSequence.map((command) => String(command?.id ?? "")).join(",") === expectedCommands.map(([id]) => id).join(","),
      commandSequence.map((command) => String(command?.id ?? "missing")).join(",") || "missing"
    ),
    structureCheck(
      "operator-stop-conditions",
      Array.isArray(operatorHandoff.stopConditions) &&
        operatorHandoff.stopConditions.length > 0 &&
        operatorHandoff.stopConditions.some((item) => /private operator shell|Do not run gcloud dry-run/iu.test(String(item))),
      `count=${Array.isArray(operatorHandoff.stopConditions) ? operatorHandoff.stopConditions.length : 0}`
    ),
    structureCheck(
      "dry-run-command-file-readable",
      dryRunCommandFileRead.ok,
      dryRunCommandFileRead.ok ? dryRunCommandFileRead.path : dryRunCommandFileRead.error
    ),
    structureCheck(
      "deploy-command-file-readable",
      deployCommandFileRead.ok,
      deployCommandFileRead.ok ? deployCommandFileRead.path : deployCommandFileRead.error
    ),
    structureCheck(
      "dry-run-command-file-consistency",
      dryRunCommandFileRead.ok && dryRunCommand === dryRunCommandFileRead.content.trim(),
      dryRunCommandFileRead.ok ? "packet dryRunCommand matches the hashed dry-run command file." : dryRunCommandFileRead.error
    ),
    structureCheck(
      "deploy-command-file-consistency",
      deployCommandFileRead.ok && deployCommand === deployCommandFileRead.content.trim(),
      deployCommandFileRead.ok ? "packet deployCommand matches the hashed deploy command file." : deployCommandFileRead.error
    ),
    structureCheck(
      "operator-dry-run-command-consistency",
      operatorDryRunCommand === dryRunCommand,
      "operator cloudrun-dry-run command must exactly match packet dryRunCommand."
    ),
    structureCheck(
      "operator-deploy-command-consistency",
      operatorDeployCommand === deployCommand,
      "operator cloudrun-deploy command must exactly match packet deployCommand."
    ),
    structureCheck("dry-run-command-contains-dry-run", /--dry-run\b/u.test(dryRunCommand), dryRunCommand || "missing"),
    structureCheck(
      "dry-run-command-shape",
      /^gcloud run services replace\b/u.test(dryRunCommand) && /--region\b/u.test(dryRunCommand) && /--project\b/u.test(dryRunCommand),
      dryRunCommand || "missing"
    ),
    structureCheck(
      "deploy-command-shape",
      /^gcloud run services replace\b/u.test(deployCommand) && /--region\b/u.test(deployCommand) && /--project\b/u.test(deployCommand) && !/--dry-run\b/u.test(deployCommand),
      deployCommand || "missing"
    ),
    structureCheck(
      "operator-describe-command-shape",
      /^gcloud run services describe\b/u.test(operatorDescribeCommand) &&
        /--region\b/u.test(operatorDescribeCommand) &&
        /--project\b/u.test(operatorDescribeCommand) &&
        /--format=json\b/u.test(operatorDescribeCommand),
      operatorDescribeCommand || "missing"
    ),
    structureCheck(
      "operator-collect-command-shape",
      operatorCollectCommand.includes("npm run collect:cloudrun-deployment") &&
        operatorCollectCommand.includes(expectedPrivateBasePath) &&
        /--strict\b/u.test(operatorCollectCommand),
      operatorCollectCommand || "missing"
    ),
    structureCheck("packet-no-raw-secret-shapes", !containsRawSecretShape(JSON.stringify(packet)), "packet JSON raw secret pattern scan")
  ];

  for (const [commandId, mutatesCloudRun] of expectedCommands) {
    const command = commandById.get(commandId) ?? {};
    checks.push(
      structureCheck(
        `operator-${commandId}-mutates`,
        Boolean(command.mutatesCloudRun) === mutatesCloudRun,
        `mutatesCloudRun=${String(command.mutatesCloudRun ?? "missing")}`
      )
    );
    checks.push(
      structureCheck(
        `operator-${commandId}-artifact`,
        String(command.expectedPrivateArtifact ?? "").startsWith(expectedPrivateBasePath),
        String(command.expectedPrivateArtifact ?? "missing")
      )
    );
    checks.push(
      structureCheck(
        `operator-${commandId}-stop-condition`,
        String(command.stopCondition ?? "").trim().length > 20,
        String(command.stopCondition ?? "missing")
      )
    );
  }

  try {
    const markdownRead = await readRegularTextFileForVerification(markdownPath, "Cloud Run dry-run packet Markdown");
    if (!markdownRead.ok) {
      checks.push(structureCheck("packet-markdown-regenerated", false, markdownRead.error));
      return checks;
    }

    const markdown = markdownRead.content;
    const expectedMarkdown = renderMarkdown(packet);
    checks.push(
      structureCheck(
        "packet-markdown-regenerated",
        markdown === expectedMarkdown,
        markdown === expectedMarkdown
          ? markdownPath
          : `${markdownPath} differs from regenerated preflight Markdown; rerun prepare:cloudrun-dry-run.`
      )
    );
    checks.push(structureCheck("packet-markdown-no-raw-secret-shapes", !containsRawSecretShape(markdown), `${markdownPath} raw secret pattern scan`));
  } catch {
    checks.push(structureCheck("packet-markdown-regenerated", false, `${markdownPath} is missing or unreadable.`));
  }

  return checks;
}

function structureCheck(id, passed, evidence) {
  return {
    id,
    status: passed ? "passed" : "blocked",
    evidence,
    fix: passed ? "No action." : "Regenerate the Cloud Run dry-run preflight packet and do not run gcloud dry-run until this check passes."
  };
}

function structurePassed(checks, id) {
  return checks.some((check) => check.id === id && check.status === "passed");
}

function includesAll(value, fragments) {
  const text = String(value ?? "");
  return fragments.every((fragment) => text.includes(fragment));
}

function containsRawSecretShape(text) {
  const secretPatterns = [
    /\bAIza[0-9A-Za-z_-]{20,}/u,
    /\bGOCSPX-[0-9A-Za-z_-]{20,}/u,
    /\bya29\.[0-9A-Za-z._-]+/u,
    /Bearer\s+(?!\[REDACTED\])[\w.~+/=-]{20,}/iu,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u
  ];

  return secretPatterns.some((pattern) => pattern.test(text));
}

async function readRegularTextFileOrThrow(path, label) {
  const result = await readRegularTextFileForVerification(path, label);

  if (!result.ok) {
    throw new Error(result.error);
  }

  return result.content;
}

async function readRegularBufferFileOrThrow(path, label) {
  const result = await readRegularBufferFileForVerification(path, label);

  if (!result.ok) {
    throw new Error(result.error);
  }

  return result.buffer;
}

async function readRegularTextFileForVerification(path, label) {
  const result = await readRegularBufferFileForVerification(path, label);

  if (!result.ok) {
    return result;
  }

  return {
    ...result,
    content: result.buffer.toString("utf8")
  };
}

async function readDigestTextByRole(digestEntries, role, label) {
  const entry = digestEntries.find((item) => String(item?.role ?? "") === role);

  if (!entry || !entry.path) {
    return {
      ok: false,
      path: "",
      error: `${label} digest entry is missing from the preflight packet.`
    };
  }

  const result = await readRegularTextFileForVerification(entry.path, label);

  return {
    ...result,
    path: String(entry.path)
  };
}

async function readRegularBufferFileForVerification(path, label) {
  const resolvedPath = typeof path === "string" && path ? resolve(path) : "";

  if (!resolvedPath) {
    return {
      ok: false,
      error: `${label} path is missing.`
    };
  }

  try {
    const fileStat = await lstat(resolvedPath);

    if (fileStat.isSymbolicLink()) {
      return {
        ok: false,
        error: `${label} at ${resolvedPath} is a symbolic link; regenerate the packet from regular private files before verification.`
      };
    }

    if (!fileStat.isFile()) {
      return {
        ok: false,
        error: `${label} at ${resolvedPath} is not a regular file.`
      };
    }

    return {
      ok: true,
      buffer: await readFile(resolvedPath),
      stat: fileStat
    };
  } catch (error) {
    return {
      ok: false,
      error: `${label} at ${resolvedPath} is not readable: ${error instanceof Error ? error.message : String(error)}.`
    };
  }
}

function buildVerificationStopConditions({ packetReady, digestEntries, failedChecks, failedStructuralChecks = [] }) {
  if (!packetReady) {
    return ["Do not run Cloud Run dry-run because the packet itself is not ready-to-dry-run."];
  }

  if (!digestEntries.length) {
    return ["Do not run Cloud Run dry-run because the packet has no evidenceFileDigests to verify."];
  }

  if (failedChecks.length) {
    return [
      "Do not run Cloud Run dry-run because one or more rendered artifact digests changed after preflight.",
      ...failedChecks.slice(0, 5).map((check) => `${check.role}: ${check.fix}`)
    ];
  }

  if (failedStructuralChecks.length) {
    return [
      "Do not run Cloud Run dry-run because the preflight packet handoff or proof-boundary checks failed.",
      ...failedStructuralChecks.slice(0, 5).map((check) => `${check.id}: ${check.fix}`)
    ];
  }

  return [
    "Stop if the dry-run command printed by this verifier differs from the command in the private operator runbook.",
    "Stop if terminal output includes raw credentials, OAuth tokens, admin tokens, customer findings, invoices, or unredacted Workspace data."
  ];
}

function buildVerificationNextActions({ status, packet }) {
  if (status !== "verified") {
    return [
      "Regenerate the preflight packet from the private render-values file.",
      "Rerun this packet verifier before any Cloud Run dry-run.",
      "Do not edit the rendered manifest bundle by hand between preflight and dry-run."
    ];
  }

  return [
    `Run the generated dry-run command from a private operator shell: ${packet.dryRunCommand}`,
    "Preserve cloudrun-dry-run-packet-verifier.json beside this packet before running gcloud dry-run.",
    "Save the dry-run output beside the verified preflight packet in the private evidence store.",
    "Deploy only after dry-run review and then capture hosted production proof."
  ];
}

async function writeJson(path, value) {
  await assertDirectoryPathSafe(dirname(path), "Cloud Run dry-run packet output parent directory");
  await assertRegularFileIfExists(path, "Cloud Run dry-run packet output file");
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeTextFile(path, content, label) {
  await assertDirectoryPathSafe(dirname(path), `${label} parent directory`);
  await assertRegularFileIfExists(path, label);
  await writeFile(path, content, "utf8");
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
      throw new Error(`${label} ${directory} is a symbolic link; use a regular private directory before Cloud Run dry-run preflight.`);
    }

    if (!fileStat.isDirectory()) {
      throw new Error(`${label} ${directory} is not a directory; use a regular private directory before Cloud Run dry-run preflight.`);
    }
  }
}

async function assertDirectoryExistsSafe(path, label) {
  const fileStat = await lstat(path);

  if (fileStat.isSymbolicLink()) {
    throw new Error(`${label} ${path} is a symbolic link; use a regular private directory before Cloud Run dry-run preflight.`);
  }

  if (!fileStat.isDirectory()) {
    throw new Error(`${label} ${path} is not a directory; use a regular private directory before Cloud Run dry-run preflight.`);
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
    throw new Error(`${label} ${path} is a symbolic link; use a regular private file path before Cloud Run dry-run preflight.`);
  }

  if (!fileStat.isFile()) {
    throw new Error(`${label} ${path} is not a regular file; use a regular private file path before Cloud Run dry-run preflight.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.verifyPacketPath) {
      const report = await verifyCloudRunDryRunPacket(options.verifyPacketPath);
      console.log(JSON.stringify(report, null, 2));
      if (options.strict && report.status !== "verified") {
        process.exitCode = 1;
      }
    } else {
      const packet = await prepareCloudRunDryRunPacket(options);
      console.log(JSON.stringify(packet, null, 2));
    }
  } catch (error) {
    if (error?.packet) {
      console.error(JSON.stringify(error.packet, null, 2));
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
}
