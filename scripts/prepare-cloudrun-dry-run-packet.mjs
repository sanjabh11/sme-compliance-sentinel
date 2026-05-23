#!/usr/bin/env node
/* global console, process */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  const verifier = JSON.parse(await readFile(verifierPath, "utf8"));
  const evidenceFileDigests = await buildEvidenceFileDigests(renderSummary);
  const packet = buildDryRunPacket({ renderSummary, verifier, valuesPath: options.valuesPath, evidenceFileDigests });

  await mkdir(outputDirectory, { recursive: true });
  await writeJson(join(outputDirectory, packetFileName), packet);
  await writeFile(join(outputDirectory, markdownFileName), renderMarkdown(packet), "utf8");

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
  const packet = JSON.parse(await readFile(absolutePacketPath, "utf8"));
  const digestEntries = Array.isArray(packet.evidenceFileDigests) ? packet.evidenceFileDigests : [];
  const digestChecks = await Promise.all(digestEntries.map(verifyDigestEntry));
  const failedChecks = digestChecks.filter((check) => check.status !== "matched");
  const packetReady = packet.status === "ready-to-dry-run" && packet.readyForDryRun === true;
  const status = packetReady && digestEntries.length > 0 && failedChecks.length === 0 ? "verified" : "blocked";

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
    dryRunCommand: packet.dryRunCommand ?? "",
    stopConditions: buildVerificationStopConditions({ packetReady, digestEntries, failedChecks }),
    nextActions: buildVerificationNextActions({ status, packet }),
    disclaimer:
      "This verifies local preflight artifact digests only. It does not run Cloud Run dry-run, deploy Cloud Run, or prove hosted production readiness."
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

  return {
    generatedAt: new Date().toISOString(),
    status,
    readyForDryRun: status === "ready-to-dry-run",
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
    disclaimer:
      "This packet validates local deployment evidence readiness before Cloud Run dry-run. External proof remains pending until real Cloud Run, Gemini, GCP, Workspace, revenue, user, cost, CAC, judge-access, demo-video, and license/IP evidence is captured."
  };
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
    "## Next Actions",
    ...packet.nextActions.map((item) => `- ${item}`),
    "",
    `Disclaimer: ${packet.disclaimer}`,
    ""
  ].join("\n");
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
  const buffer = await readFile(file.path);

  return {
    ...file,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    byteLength: buffer.length
  };
}

async function verifyDigestEntry(entry) {
  const expectedSha256 = String(entry.sha256 ?? "");
  const expectedByteLength = Number(entry.byteLength ?? 0);

  try {
    const buffer = await readFile(entry.path);
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
  } catch {
    return {
      role: String(entry.role ?? "unknown"),
      path: String(entry.path ?? ""),
      status: "missing",
      expectedSha256,
      actualSha256: "missing",
      expectedByteLength,
      actualByteLength: 0,
      fix: "Regenerate the Cloud Run dry-run preflight packet; the referenced evidence file is missing."
    };
  }
}

function buildVerificationStopConditions({ packetReady, digestEntries, failedChecks }) {
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
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
