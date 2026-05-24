#!/usr/bin/env node
/* global console, process */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { verifyCloudRunRenderEvidencePacket, writeCloudRunRenderValuesAudit } from "./audit-cloudrun-render-values.mjs";
import { writeReleaseCandidateValues } from "./render-cloudrun-manifest.mjs";

const defaultValuesPath = "/secure/local/cloudrun-render-values.json";
const defaultOutDir = "artifacts/deployment";
const handoffFileName = "cloudrun-render-handoff.json";
const handoffMarkdownFileName = "cloudrun-render-handoff.md";

export function parseArgs(argv) {
  const args = {
    valuesPath: process.env.SENTINEL_CLOUD_RUN_VALUES_PATH ?? defaultValuesPath,
    outDir: process.env.SENTINEL_CLOUD_RUN_RENDER_OUT_DIR ?? defaultOutDir,
    releaseId: process.env.SENTINEL_RELEASE_ID ?? "",
    strict: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (isRawSecretArg(arg)) {
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
      continue;
    }

    if (!arg.startsWith("-") && args.valuesPath === defaultValuesPath) {
      args.valuesPath = arg;
    }
  }

  if (!args.valuesPath) {
    throw new Error("Cloud Run render handoff requires --values /private/path/cloudrun-render-values.json.");
  }

  return args;
}

export async function prepareCloudRunRenderHandoff(options = {}) {
  const valuesPath = resolve(options.valuesPath || defaultValuesPath);
  const releaseValues = await writeReleaseCandidateValues(valuesPath, {
    ...(options.gitRunner ? { gitRunner: options.gitRunner } : {})
  });
  const releaseId = options.releaseId || releaseValues.releaseId;
  const audit = await writeCloudRunRenderValuesAudit({
    valuesPath,
    outDir: options.outDir || defaultOutDir,
    releaseId
  });
  const evidenceVerification = await verifyCloudRunRenderEvidencePacket(audit.evidencePacketPath);
  const outputDirectory = audit.outputDirectory;
  const handoffPath = join(outputDirectory, handoffFileName);
  const handoffMarkdownPath = join(outputDirectory, handoffMarkdownFileName);
  const blockers = buildBlockers({ audit, evidenceVerification, releaseValues });
  const handoff = {
    generatedAt: new Date().toISOString(),
    generatedFrom: "prepare-cloudrun-render-handoff",
    phaseId: "cloudrun-render-dry-run",
    bucket: "code-controllable",
    overallStatus: blockers.length ? "blocked" : audit.readyForStrictRender ? "ready-to-render" : "ready-for-private-values",
    releaseId,
    valuesPath,
    outputDirectory,
    handoffPath,
    handoffMarkdownPath,
    releaseValues: {
      path: releaseValues.path,
      releaseId: releaseValues.releaseId,
      sourceCommit: releaseValues.sourceCommit,
      sourceCommitAt: releaseValues.sourceCommitAt,
      sourceBranch: releaseValues.sourceBranch,
      repositoryUrl: releaseValues.repositoryUrl
    },
    renderValuesAudit: {
      status: audit.status,
      readyForStrictRender: audit.readyForStrictRender,
      auditPath: audit.auditPath,
      markdownPath: audit.markdownPath,
      evidencePacketPath: audit.evidencePacketPath,
      evidencePacketMarkdownPath: audit.evidencePacketMarkdownPath,
      missingStrictKeys: audit.missingStrictKeys,
      placeholderKeys: audit.placeholderKeys,
      valueConsistencyBlockers: audit.valueConsistencyBlockers,
      intakeSummary: audit.renderValueIntakeSummary
    },
    evidencePacketVerification: {
      overallStatus: evidenceVerification.overallStatus,
      verificationPath: evidenceVerification.verificationPath,
      summary: evidenceVerification.summary,
      blockers: evidenceVerification.blockers
    },
    blockers,
    nextActions: buildNextActions({ audit, evidenceVerification }),
    stopConditions: [
      "Do not commit or screenshot the filled render-values file.",
      "Do not run strict render, Cloud Run dry-run, or deployment while required non-secret values are missing.",
      "Do not put raw API keys, OAuth secrets, refresh tokens, service-account keys, judge credentials, customer findings, invoices, or raw Workspace content in this values file.",
      "Do not set public XPRIZE proof flags from this handoff; hosted, business, judge-access, and human-attestation proof still require private evidence."
    ],
    proofBoundary:
      "This handoff writes local private render-value starter artifacts and verifies the owner packet. It does not deploy Cloud Run, run gcloud, call Gemini, prove hosted availability, prove Workspace sync, prove revenue, or guarantee judging outcome."
  };

  await mkdir(outputDirectory, { recursive: true });
  await writeJson(handoffPath, handoff);
  await writeFile(handoffMarkdownPath, renderMarkdown(handoff), "utf8");

  if (options.strict && handoff.overallStatus === "blocked") {
    const error = new Error(`Cloud Run render handoff is blocked; see ${handoffPath}.`);
    error.handoff = handoff;
    throw error;
  }

  return handoff;
}

function buildBlockers({ audit, evidenceVerification, releaseValues }) {
  return [
    ...(audit.releaseIdConsistency?.blocking
      ? [`release-id: ${audit.releaseIdConsistency.fix}`]
      : []),
    ...(releaseValues.releaseId === audit.releaseId
      ? []
      : [`release-values: generated release ${releaseValues.releaseId} does not match audit release ${audit.releaseId}.`]),
    ...(evidenceVerification.overallStatus === "verified"
      ? []
      : evidenceVerification.blockers.map((blocker) => `render-evidence-verifier: ${blocker}`))
  ];
}

function buildNextActions({ audit, evidenceVerification }) {
  const actions = [
    ...(audit.readyForStrictRender
      ? [
          "Run strict render with the same values file.",
          "Prepare and verify the Cloud Run dry-run preflight packet before any private gcloud dry-run."
        ]
      : [
          "Fill the remaining non-secret production values in the private render-values file.",
          "Keep every XPRIZE evidence/public-claim flag false until the matching private proof exists.",
          "Rerun npm run audit:cloudrun-values with --strict after the private values are filled."
        ]),
    "Rerun npm run verify:cloudrun-render-evidence before rendering or dry-run.",
    "Preserve cloudrun-render-handoff.json, the audit JSON/Markdown, evidence packet, and verifier JSON in the private evidence store."
  ];

  if (evidenceVerification.overallStatus !== "verified") {
    actions.unshift("Fix render-evidence verifier blockers before handing this packet to the operator.");
  }

  return actions;
}

function renderMarkdown(handoff) {
  return [
    "# Cloud Run Render Handoff",
    "",
    `Generated: ${handoff.generatedAt}`,
    `Status: ${handoff.overallStatus}`,
    `Release: ${handoff.releaseId}`,
    `Phase: ${handoff.phaseId}`,
    "",
    "## Private Artifacts",
    `- Values starter: ${handoff.valuesPath}`,
    `- Audit JSON: ${handoff.renderValuesAudit.auditPath}`,
    `- Evidence packet: ${handoff.renderValuesAudit.evidencePacketPath}`,
    `- Evidence verifier: ${handoff.evidencePacketVerification.verificationPath}`,
    "",
    "## Audit Summary",
    `- Audit status: ${handoff.renderValuesAudit.status}`,
    `- Ready for strict render: ${handoff.renderValuesAudit.readyForStrictRender ? "yes" : "no"}`,
    `- Missing strict keys: ${handoff.renderValuesAudit.missingStrictKeys.length}`,
    `- Placeholder keys: ${handoff.renderValuesAudit.placeholderKeys.length}`,
    `- Value consistency blockers: ${handoff.renderValuesAudit.valueConsistencyBlockers.length}`,
    `- Evidence packet verifier: ${handoff.evidencePacketVerification.overallStatus}`,
    "",
    "## Next Actions",
    ...handoff.nextActions.map((item) => `- ${item}`),
    "",
    "## Blockers",
    ...(handoff.blockers.length ? handoff.blockers.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Stop Conditions",
    ...handoff.stopConditions.map((item) => `- ${item}`),
    "",
    "## Proof Boundary",
    handoff.proofBoundary,
    ""
  ].join("\n");
}

function isRawSecretArg(value) {
  return [
    /(^|-)token($|=)/iu,
    /(^|-)password($|=)/iu,
    /(^|-)secret($|=)/iu,
    /gemini-api-key/iu,
    /oauth-client-secret/iu,
    /drive-channel-token/iu,
    /judge-(credential|password)/iu
  ].some((pattern) => pattern.test(String(value)));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const handoff = await prepareCloudRunRenderHandoff(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(handoff, null, 2));
  } catch (error) {
    if (error?.handoff) {
      console.log(JSON.stringify(error.handoff, null, 2));
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
