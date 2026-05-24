#!/usr/bin/env node
/* global console, process */

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { verifyCloudRunRenderEvidencePacket, writeCloudRunRenderValuesAudit } from "./audit-cloudrun-render-values.mjs";
import { writeReleaseCandidateValues } from "./render-cloudrun-manifest.mjs";

const defaultValuesPath = "/secure/local/cloudrun-render-values.json";
const defaultOutDir = "artifacts/deployment";
const handoffFileName = "cloudrun-render-handoff.json";
const handoffMarkdownFileName = "cloudrun-render-handoff.md";
const handoffVerifierFileName = "cloudrun-render-handoff-verifier.json";
const prohibitedPacketContentPatterns = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/u,
  /password\s*[:=]\s*\S+/iu,
  /api[_-]?key\s*[:=]\s*\S+/iu,
  /authorization\s*[:=]\s*\S+/iu,
  /client[_-]?secret\s*[:=]\s*\S+/iu,
  /refresh[_-]?token\s*[:=]\s*\S+/iu,
  /\bAIza[0-9A-Za-z_-]{20,}/u,
  /\bGOCSPX-[0-9A-Za-z_-]{20,}/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u
];

export function parseArgs(argv) {
  const args = {
    valuesPath: process.env.SENTINEL_CLOUD_RUN_VALUES_PATH ?? defaultValuesPath,
    outDir: process.env.SENTINEL_CLOUD_RUN_RENDER_OUT_DIR ?? defaultOutDir,
    releaseId: process.env.SENTINEL_RELEASE_ID ?? "",
    verifyHandoffPath: "",
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

    if (arg === "--verify-handoff") {
      args.verifyHandoffPath = argv[index + 1] ?? "";
      if (!args.verifyHandoffPath) {
        throw new Error("--verify-handoff requires a Cloud Run render handoff JSON path.");
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--verify-handoff=")) {
      args.verifyHandoffPath = arg.slice("--verify-handoff=".length);
      continue;
    }

    if (!arg.startsWith("-") && args.valuesPath === defaultValuesPath) {
      args.valuesPath = arg;
    }
  }

  if (!args.verifyHandoffPath && !args.valuesPath) {
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
    privateValueChecklist: buildPrivateValueChecklist({ audit }),
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

export async function verifyCloudRunRenderHandoff(path) {
  const handoffPath = resolve(path);
  const outputDirectory = dirname(handoffPath);
  const verificationPath = join(outputDirectory, handoffVerifierFileName);
  const checks = [];
  const handoffResult = await readJsonForVerification(handoffPath, "handoff");
  const handoff = handoffResult.value;
  let evidenceVerification;

  checks.push(
    verificationCheck(
      "handoff-json",
      handoffResult.ok ? "passed" : "blocked",
      handoffResult.ok ? `Handoff parsed from ${handoffPath}.` : handoffResult.error
    )
  );

  if (handoff) {
    checks.push(
      verificationCheck(
        "handoff-path-match",
        resolve(handoff.handoffPath ?? "") === handoffPath ? "passed" : "blocked",
        `handoffPath=${handoffPath}; recorded=${String(handoff.handoffPath ?? "missing")}.`
      )
    );
    checks.push(
      verificationCheck(
        "handoff-shape",
        handoff.generatedFrom === "prepare-cloudrun-render-handoff" &&
          handoff.phaseId === "cloudrun-render-dry-run" &&
          handoff.bucket === "code-controllable"
          ? "passed"
          : "blocked",
        `generatedFrom=${String(handoff.generatedFrom ?? "missing")}; phase=${String(handoff.phaseId ?? "missing")}; bucket=${String(handoff.bucket ?? "missing")}.`
      )
    );
    checks.push(
      verificationCheck(
        "handoff-proof-boundary",
        proofBoundaryIsExplicit(handoff) ? "passed" : "blocked",
        "Handoff must state it does not deploy Cloud Run, run gcloud, call Gemini, prove hosted availability, prove revenue, or guarantee judging outcome."
      )
    );
    checks.push(
      verificationCheck(
        "handoff-stop-conditions",
        Array.isArray(handoff.stopConditions) &&
          handoff.stopConditions.join(" ").includes("Do not run strict render") &&
          handoff.stopConditions.join(" ").includes("Do not set public XPRIZE proof flags")
          ? "passed"
          : "blocked",
        "Handoff must preserve render/deploy and public-claim stop conditions."
      )
    );

    const evidencePacketPath = handoff.renderValuesAudit?.evidencePacketPath;
    let evidencePacket;
    if (typeof evidencePacketPath === "string" && evidencePacketPath) {
      const evidencePacketResult = await readJsonForVerification(evidencePacketPath, "render evidence packet");
      evidencePacket = evidencePacketResult.value;
      checks.push(
        verificationCheck(
          "render-evidence-packet-json",
          evidencePacketResult.ok ? "passed" : "blocked",
          evidencePacketResult.ok ? `Render evidence packet parsed from ${evidencePacketPath}.` : evidencePacketResult.error
        )
      );
      evidenceVerification = await verifyCloudRunRenderEvidencePacket(evidencePacketPath);
      checks.push(
        verificationCheck(
          "render-evidence-verifier",
          evidenceVerification.overallStatus === "verified" ? "passed" : "blocked",
          `renderEvidenceVerifier=${evidenceVerification.overallStatus}; path=${evidenceVerification.verificationPath}.`
        )
      );
      checks.push(
        verificationCheck(
          "render-evidence-verifier-path-match",
          evidenceVerification.verificationPath === handoff.evidencePacketVerification?.verificationPath ? "passed" : "blocked",
          `recorded=${String(handoff.evidencePacketVerification?.verificationPath ?? "missing")}; actual=${String(evidenceVerification.verificationPath ?? "missing")}.`
        )
      );
    } else {
      checks.push(verificationCheck("render-evidence-verifier", "blocked", "renderValuesAudit.evidencePacketPath is missing."));
    }

    const privateChecklistChecks = verifyPrivateValueChecklist({ handoff, evidencePacket });
    checks.push(...privateChecklistChecks);
    const privateChecklistReady = privateChecklistChecks.every((check) => check.status === "passed");

    checks.push(
      privateChecklistReady
        ? await verifyRenderedTextMatch({
            id: "handoff-markdown-regenerated",
            path: handoff.handoffMarkdownPath,
            expectedContent: renderMarkdown(handoff)
          })
        : verificationCheck(
            "handoff-markdown-regenerated",
            "blocked",
            "Skipped Markdown regeneration because privateValueChecklist is missing, malformed, or out of sync with the render evidence packet."
          )
    );
    checks.push(
      ...(await verifyPacketFile({
        id: "handoff-json",
        path: handoffPath,
        requiredText: ["prepare-cloudrun-render-handoff", "cloudrun-render-dry-run", "privateValueChecklist", "proofBoundary"]
      }))
    );
    checks.push(
      ...(await verifyPacketFile({
        id: "handoff-markdown",
        path: handoff.handoffMarkdownPath,
        requiredText: ["# Cloud Run Render Handoff", "## Private Value Fill Checklist", "## Stop Conditions", "## Proof Boundary"]
      }))
    );
  }

  const blockers = checks.filter((check) => check.status === "blocked");
  const report = {
    generatedAt: new Date().toISOString(),
    generatedFrom: "prepare-cloudrun-render-handoff --verify-handoff",
    overallStatus: blockers.length ? "blocked" : "verified",
    handoffPath,
    verificationPath,
    releaseId: handoff?.releaseId ?? "unknown",
    handoffStatus: handoff?.overallStatus ?? "unknown",
    renderEvidenceVerifierStatus: evidenceVerification?.overallStatus ?? "unknown",
    summary: {
      passed: checks.filter((check) => check.status === "passed").length,
      blocked: blockers.length,
      fileCount: handoff ? 2 : 0
    },
    checks,
    blockers: blockers.map((check) => `${check.id}: ${check.evidence}`),
    proofBoundary:
      "This verifies private Cloud Run render handoff artifact integrity only. It does not deploy Cloud Run, run gcloud, call Gemini, prove hosted availability, prove Workspace sync, prove revenue, approve public XPRIZE flags, or guarantee judging outcome.",
    stopConditions: [
      "Do not run Cloud Run dry-run from this verifier alone; dry-run still requires filled production values, strict render, preflight packet, and digest verification.",
      "Do not set public XPRIZE proof flags from this verifier; public-claim rows require private proof and owner approval.",
      "Regenerate the handoff and rerun this verifier after any handoff, audit, evidence packet, or Markdown edit."
    ]
  };

  await writeJson(verificationPath, report);

  return report;
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

function buildPrivateValueChecklist({ audit }) {
  const evidencePacket = audit.evidencePacket ?? {};
  const requiredBeforeDryRun = Array.isArray(evidencePacket.requiredBeforeDryRun) ? evidencePacket.requiredBeforeDryRun : [];
  const publicClaimEvidenceQueue = Array.isArray(evidencePacket.publicClaimEvidenceQueue) ? evidencePacket.publicClaimEvidenceQueue : [];
  const consistencyBlockers = Array.isArray(audit.valueConsistencyBlockers) ? audit.valueConsistencyBlockers : [];
  const status = audit.readyForStrictRender
    ? publicClaimEvidenceQueue.length
      ? "ready-for-render-claim-review-pending"
      : "ready-for-render"
    : "needs-private-values";

  return {
    status,
    requiredBeforeDryRunCount: requiredBeforeDryRun.length,
    publicClaimEvidenceCount: publicClaimEvidenceQueue.length,
    consistencyBlockerCount: consistencyBlockers.length,
    process: [
      "Open the private render-values file in the private operator environment only.",
      "Fill required-before-dry-run rows first using non-secret production values or Secret Manager resource/version references; never paste secret values.",
      "Resolve value consistency blockers before strict audit, manifest render, or dry-run preflight.",
      "Leave public XPRIZE, revenue, user, Gemini, Workspace, judge-access, demo, and AI-operation evidence flags false until matching private proof exists.",
      "Rerun the handoff verifier, render-values audit, render-evidence verifier, manifest render, dry-run preflight, and dry-run packet verifier before any gcloud dry-run."
    ],
    requiredBeforeDryRun: requiredBeforeDryRun.map(checklistRow),
    publicClaimEvidenceQueue: publicClaimEvidenceQueue.map(checklistRow),
    consistencyBlockers: consistencyBlockers.map((blocker) => ({
      id: blocker.id,
      key: blocker.key,
      status: blocker.status,
      fix: blocker.fix
    }))
  };
}

function checklistRow(item) {
  return {
    key: item.key,
    category: item.category,
    owner: item.owner,
    status: item.status,
    requiredBeforeDryRun: item.requiredBeforeDryRun,
    requiredBeforePublicClaim: item.requiredBeforePublicClaim,
    acceptedProof: item.acceptedProof,
    privateHandling: item.privateHandling,
    fix: item.fix
  };
}

function verifyPrivateValueChecklist({ handoff, evidencePacket }) {
  const checklist = handoff.privateValueChecklist;
  const requiredBeforeDryRun = Array.isArray(evidencePacket?.requiredBeforeDryRun) ? evidencePacket.requiredBeforeDryRun.map(checklistRow) : [];
  const publicClaimEvidenceQueue = Array.isArray(evidencePacket?.publicClaimEvidenceQueue) ? evidencePacket.publicClaimEvidenceQueue.map(checklistRow) : [];
  const consistencyBlockers = Array.isArray(handoff.renderValuesAudit?.valueConsistencyBlockers)
    ? handoff.renderValuesAudit.valueConsistencyBlockers.map(consistencyBlockerRow)
    : [];
  const shapeOk =
    checklist &&
    typeof checklist === "object" &&
    Array.isArray(checklist.process) &&
    Array.isArray(checklist.requiredBeforeDryRun) &&
    Array.isArray(checklist.publicClaimEvidenceQueue) &&
    Array.isArray(checklist.consistencyBlockers);

  if (!shapeOk) {
    return [
      verificationCheck(
        "handoff-private-value-checklist-shape",
        "blocked",
        "privateValueChecklist must include process, requiredBeforeDryRun, publicClaimEvidenceQueue, and consistencyBlockers arrays."
      )
    ];
  }

  const expectedStatus = handoff.renderValuesAudit?.readyForStrictRender
    ? publicClaimEvidenceQueue.length
      ? "ready-for-render-claim-review-pending"
      : "ready-for-render"
    : "needs-private-values";
  const countsOk =
    checklist.requiredBeforeDryRunCount === checklist.requiredBeforeDryRun.length &&
    checklist.publicClaimEvidenceCount === checklist.publicClaimEvidenceQueue.length &&
    checklist.consistencyBlockerCount === checklist.consistencyBlockers.length &&
    checklist.requiredBeforeDryRunCount === requiredBeforeDryRun.length &&
    checklist.publicClaimEvidenceCount === publicClaimEvidenceQueue.length &&
    checklist.consistencyBlockerCount === consistencyBlockers.length;
  const processText = checklist.process.join(" ");
  const processOk =
    processText.includes("never paste secret values") &&
    processText.includes("before any gcloud dry-run") &&
    processText.includes("Leave public XPRIZE") &&
    processText.includes("matching private proof exists");
  const rowsOk =
    stableJson(checklist.requiredBeforeDryRun.map(checklistRow)) === stableJson(requiredBeforeDryRun) &&
    stableJson(checklist.publicClaimEvidenceQueue.map(checklistRow)) === stableJson(publicClaimEvidenceQueue) &&
    stableJson(checklist.consistencyBlockers.map(consistencyBlockerRow)) === stableJson(consistencyBlockers);

  return [
    verificationCheck(
      "handoff-private-value-checklist-shape",
      "passed",
      "privateValueChecklist includes the expected checklist arrays."
    ),
    verificationCheck(
      "handoff-private-value-checklist-status",
      checklist.status === expectedStatus ? "passed" : "blocked",
      `expected=${expectedStatus}; actual=${String(checklist.status ?? "missing")}.`
    ),
    verificationCheck(
      "handoff-private-value-checklist-counts",
      countsOk ? "passed" : "blocked",
      `requiredBeforeDryRun=${checklist.requiredBeforeDryRunCount}/${requiredBeforeDryRun.length}; publicClaimEvidence=${checklist.publicClaimEvidenceCount}/${publicClaimEvidenceQueue.length}; consistencyBlockers=${checklist.consistencyBlockerCount}/${consistencyBlockers.length}.`
    ),
    verificationCheck(
      "handoff-private-value-checklist-process",
      processOk ? "passed" : "blocked",
      "Checklist process must preserve secret-handling, public-claim, private-proof, and pre-gcloud stop conditions."
    ),
    verificationCheck(
      "handoff-private-value-checklist-evidence-alignment",
      rowsOk ? "passed" : "blocked",
      "Checklist rows must match the render evidence packet and render-values consistency blockers."
    )
  ];
}

function consistencyBlockerRow(blocker) {
  return {
    id: blocker.id,
    key: blocker.key,
    status: blocker.status,
    fix: blocker.fix
  };
}

function proofBoundaryIsExplicit(handoff) {
  const text = [
    handoff.proofBoundary,
    ...(Array.isArray(handoff.stopConditions) ? handoff.stopConditions : [])
  ].join(" ");

  return (
    text.includes("does not deploy Cloud Run") &&
    text.includes("run gcloud") &&
    text.includes("call Gemini") &&
    text.includes("prove hosted availability") &&
    text.includes("prove revenue") &&
    text.includes("guarantee judging outcome")
  );
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
    "## Private Value Fill Checklist",
    `- Status: ${handoff.privateValueChecklist.status}`,
    `- Required before Cloud Run dry-run: ${handoff.privateValueChecklist.requiredBeforeDryRunCount}`,
    `- Public-claim evidence rows: ${handoff.privateValueChecklist.publicClaimEvidenceCount}`,
    `- Value consistency blockers: ${handoff.privateValueChecklist.consistencyBlockerCount}`,
    "",
    "### Process",
    ...handoff.privateValueChecklist.process.map((item) => `- ${item}`),
    "",
    "### Required Before Cloud Run Dry-Run",
    ...(handoff.privateValueChecklist.requiredBeforeDryRun.length
      ? [
          markdownTable(
            ["Key", "Owner", "Status", "Fix"],
            handoff.privateValueChecklist.requiredBeforeDryRun.map((item) => [item.key, item.owner, item.status, item.fix])
          )
        ]
      : ["- none"]),
    "",
    "### Public Claim Evidence Queue",
    ...(handoff.privateValueChecklist.publicClaimEvidenceQueue.length
      ? [
          markdownTable(
            ["Key", "Owner", "Status", "Accepted Proof"],
            handoff.privateValueChecklist.publicClaimEvidenceQueue.map((item) => [
              item.key,
              item.owner,
              item.status,
              item.acceptedProof
            ])
          )
        ]
      : ["- none"]),
    "",
    "### Value Consistency Blockers",
    ...(handoff.privateValueChecklist.consistencyBlockers.length
      ? handoff.privateValueChecklist.consistencyBlockers.map((item) => `- ${item.key} [${item.status}]: ${item.fix}`)
      : ["- none"]),
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

function markdownTable(headers, rows) {
  return [
    `| ${headers.map(escapeTable).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeTable).join(" | ")} |`)
  ].join("\n");
}

function escapeTable(value) {
  return String(value ?? "")
    .replace(/\|/gu, "\\|")
    .replace(/\n/gu, " ");
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

async function verifyPacketFile({ id, path, requiredText }) {
  const checks = [];
  const resolvedPath = typeof path === "string" && path ? resolve(path) : "";

  checks.push(
    verificationCheck(
      `${id}-metadata`,
      resolvedPath ? "passed" : "blocked",
      `path=${resolvedPath || "missing"}.`
    )
  );

  if (!resolvedPath) {
    return checks;
  }

  let content = "";
  let fileStat;
  const fileResult = await readRegularTextFileForVerification(resolvedPath, id);

  checks.push(
    verificationCheck(
      `${id}-regular-file`,
      fileResult.ok ? "passed" : "blocked",
      fileResult.ok ? `${resolvedPath} is a regular file.` : fileResult.error
    )
  );

  if (!fileResult.ok) {
    return checks;
  }

  content = fileResult.content;
  fileStat = fileResult.stat;
  checks.push(verificationCheck(`${id}-readable`, "passed", `${resolvedPath} is readable.`));

  checks.push(
    verificationCheck(
      `${id}-bytes`,
      fileStat.size > 0 && fileStat.size === Buffer.byteLength(content, "utf8") ? "passed" : "blocked",
      `bytes=${fileStat.size}.`
    )
  );
  checks.push(
    verificationCheck(
      `${id}-sha256`,
      /^[a-f0-9]{64}$/u.test(sha256Hex(content)) ? "passed" : "blocked",
      `sha256=${sha256Hex(content)}.`
    )
  );
  checks.push(
    verificationCheck(
      `${id}-required-text`,
      requiredText.every((text) => content.includes(String(text))) ? "passed" : "blocked",
      `required=${requiredText.join(", ")}.`
    )
  );
  checks.push(
    verificationCheck(
      `${id}-secret-shape`,
      prohibitedPacketContentPatterns.some((pattern) => pattern.test(content)) ? "blocked" : "passed",
      `${resolvedPath} ${prohibitedPacketContentPatterns.some((pattern) => pattern.test(content)) ? "contains" : "does not contain"} obvious secret-shaped packet text.`
    )
  );

  return checks;
}

async function verifyRenderedTextMatch({ id, path, expectedContent }) {
  const resolvedPath = typeof path === "string" && path ? resolve(path) : "";

  if (!resolvedPath) {
    return verificationCheck(id, "blocked", "Expected rendered text path is missing.");
  }

  try {
    const fileResult = await readRegularTextFileForVerification(resolvedPath, id);

    if (!fileResult.ok) {
      return verificationCheck(id, "blocked", fileResult.error);
    }

    const actualContent = fileResult.content;

    return verificationCheck(
      id,
      actualContent === expectedContent ? "passed" : "blocked",
      actualContent === expectedContent
        ? `${resolvedPath} matches regenerated Markdown.`
        : `${resolvedPath} differs from regenerated Markdown; rerun prepare:cloudrun-render-handoff before dry-run.`
    );
  } catch (error) {
    return verificationCheck(id, "blocked", `${resolvedPath} is not readable: ${error instanceof Error ? error.message : String(error)}.`);
  }
}

async function readJsonForVerification(path, label) {
  try {
    const fileResult = await readRegularTextFileForVerification(path, label);

    if (!fileResult.ok) {
      return { ok: false, error: fileResult.error };
    }

    return { ok: true, value: JSON.parse(fileResult.content) };
  } catch (error) {
    return {
      ok: false,
      error: `${label} could not be parsed from ${path}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function readRegularTextFileForVerification(path, label) {
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
        error: `${label} at ${resolvedPath} is a symbolic link; regenerate the packet into a regular private file before verification.`
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
      content: await readFile(resolvedPath, "utf8"),
      stat: fileStat
    };
  } catch (error) {
    return {
      ok: false,
      error: `${label} at ${resolvedPath} is not readable: ${error instanceof Error ? error.message : String(error)}.`
    };
  }
}

function verificationCheck(id, status, evidence) {
  return { id, status, evidence };
}

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, sortJson(nested)]));
  }

  return value;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = options.verifyHandoffPath
      ? await verifyCloudRunRenderHandoff(options.verifyHandoffPath)
      : await prepareCloudRunRenderHandoff(options);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (error?.handoff) {
      console.log(JSON.stringify(error.handoff, null, 2));
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
