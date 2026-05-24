#!/usr/bin/env node
/* global console, process */

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, stat, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { auditCloudRunRenderValues } from "./render-cloudrun-manifest.mjs";

const defaultOutDir = "artifacts/deployment";
const auditFileName = "cloudrun-render-values-audit.json";
const markdownFileName = "cloudrun-render-values-audit.md";
const evidencePacketFileName = "cloudrun-render-evidence-packet.json";
const evidencePacketMarkdownFileName = "cloudrun-render-evidence-packet.md";
const evidencePacketVerifierFileName = "cloudrun-render-evidence-packet-verifier.json";

const prohibitedCliPatterns = [
  /(^|-)token($|=)/iu,
  /(^|-)password($|=)/iu,
  /(^|-)secret($|=)/iu,
  /gemini-api-key/iu,
  /oauth-client-secret/iu,
  /drive-channel-token/iu,
  /judge-(credential|password)/iu
];
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
    valuesPath: "",
    outDir: process.env.SENTINEL_CLOUD_RUN_RENDER_OUT_DIR ?? defaultOutDir,
    releaseId: process.env.SENTINEL_RELEASE_ID ?? "",
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

    if (arg === "--strict") {
      args.strict = true;
      continue;
    }

    if (arg === "--verify-packet") {
      args.verifyPacketPath = argv[index + 1] ?? "";
      if (!args.verifyPacketPath) {
        throw new Error("--verify-packet requires a non-secret Cloud Run render evidence packet path.");
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--verify-packet=")) {
      args.verifyPacketPath = arg.slice("--verify-packet=".length);
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
  const evidencePacketPath = join(outputDirectory, evidencePacketFileName);
  const evidencePacketMarkdownPath = join(outputDirectory, evidencePacketMarkdownFileName);
  const evidencePacket = buildEvidencePacket({ audit, outputDirectory, evidencePacketPath, evidencePacketMarkdownPath });
  const packet = {
    ...audit,
    outputDirectory,
    auditPath: join(outputDirectory, auditFileName),
    markdownPath: join(outputDirectory, markdownFileName),
    evidencePacketPath,
    evidencePacketMarkdownPath,
    evidencePacket
  };

  await mkdir(outputDirectory, { recursive: true });
  await writeJson(packet.auditPath, packet);
  await writeFile(packet.markdownPath, renderMarkdown(packet), "utf8");
  await writeJson(packet.evidencePacketPath, evidencePacket);
  await writeFile(packet.evidencePacketMarkdownPath, renderEvidenceMarkdown(evidencePacket), "utf8");

  if (options.strict && packet.status !== "ready-to-render") {
    const error = new Error(`Cloud Run render-values audit is ${packet.status}; see ${packet.auditPath}.`);
    error.packet = packet;
    throw error;
  }

  return packet;
}

export async function verifyCloudRunRenderEvidencePacket(path) {
  const packetPath = resolve(path);
  const outputDirectory = resolve(packetPath, "..");
  const verificationPath = join(outputDirectory, evidencePacketVerifierFileName);
  const checks = [];
  const packetResult = await readJsonForVerification(packetPath, "evidence packet");
  let packet = packetResult.value;
  let audit;

  checks.push(
    verificationCheck(
      "evidence-packet-json",
      packetResult.ok ? "passed" : "blocked",
      packetResult.ok ? `Evidence packet parsed from ${packetPath}.` : packetResult.error
    )
  );

  if (packet) {
    checks.push(
      verificationCheck(
        "evidence-packet-path-match",
        resolve(packet.evidencePacketPath ?? "") === packetPath ? "passed" : "blocked",
        `packetPath=${packetPath}; evidencePacketPath=${String(packet.evidencePacketPath ?? "missing")}.`
      )
    );
    checks.push(
      verificationCheck(
        "evidence-proof-boundary",
        evidencePacketProofBoundaryIsExplicit(packet) ? "passed" : "blocked",
        "Evidence packet must state that it does not deploy Cloud Run, run gcloud, call Gemini, prove hosted availability, prove revenue, or guarantee judging outcome."
      )
    );
    checks.push(
      verificationCheck(
        "evidence-stop-conditions",
        Array.isArray(packet.stopConditions) &&
          packet.stopConditions.join(" ").includes("Do not set public XPRIZE proof flags") &&
          packet.stopConditions.join(" ").includes("Do not move to Cloud Run dry-run")
          ? "passed"
          : "blocked",
        "Evidence packet must preserve dry-run and public-claim stop conditions."
      )
    );
    checks.push(
      verificationCheck(
        "evidence-command-sequence",
        requiredCommandIds().every((id) => packet.commandSequence?.some((command) => command.id === id)) ? "passed" : "blocked",
        `commandIds=${(packet.commandSequence ?? []).map((command) => command.id).join(",") || "missing"}.`
      )
    );
    checks.push(
      verificationCheck(
        "evidence-phase-boundary",
        packet.phaseProgress?.phaseId === "cloudrun-render-dry-run" &&
          packet.bucket === "code-controllable" &&
          Number(packet.phaseProgress?.ratingOutOf5) >= 1 &&
          Number(packet.phaseProgress?.ratingOutOf5) <= 5
          ? "passed"
          : "blocked",
        `phase=${String(packet.phaseProgress?.phaseId ?? "missing")}; bucket=${String(packet.bucket ?? "missing")}; rating=${String(packet.phaseProgress?.ratingOutOf5 ?? "missing")}.`
      )
    );

    const auditPath = typeof packet.auditPath === "string" ? packet.auditPath : "";
    const auditResult = auditPath ? await readJsonForVerification(auditPath, "render-values audit") : { ok: false, error: "auditPath is missing." };
    audit = auditResult.value;
    checks.push(
      verificationCheck(
        "audit-json",
        auditResult.ok ? "passed" : "blocked",
        auditResult.ok ? `Render-values audit parsed from ${auditPath}.` : auditResult.error
      )
    );

    if (audit) {
      checks.push(
        verificationCheck(
          "audit-evidence-packet-match",
          stableJson(audit.evidencePacket) === stableJson(packet) ? "passed" : "blocked",
          "Evidence packet JSON must match the evidencePacket embedded in cloudrun-render-values-audit.json."
        )
      );
      checks.push(
        verificationCheck(
          "audit-status-alignment",
          evidenceStatusMatchesAudit(packet, audit) ? "passed" : "blocked",
          `auditStatus=${String(audit.status ?? "missing")}; evidenceStatus=${String(packet.status ?? "missing")}; readyForStrictRender=${String(audit.readyForStrictRender ?? "missing")}.`
        )
      );
      checks.push(
        verificationCheck(
          "audit-release-alignment",
          packet.releaseId === audit.releaseId ? "passed" : "blocked",
          `packet release=${String(packet.releaseId ?? "missing")}; audit release=${String(audit.releaseId ?? "missing")}.`
        )
      );
      checks.push(
        verificationCheck(
          "audit-readiness-counts",
          packet.readiness?.missingStrictKeyCount === audit.missingStrictKeys?.length &&
            packet.readiness?.placeholderKeyCount === audit.placeholderKeys?.length &&
            packet.readiness?.valueConsistencyBlockerCount === audit.valueConsistencyBlockers?.length &&
            packet.readiness?.claimFlagsPending === audit.renderValueIntakeSummary?.claimFlagsPending
            ? "passed"
            : "blocked",
          "Evidence readiness counts must match the render-values audit source."
        )
      );
      checks.push(
        await verifyRenderedTextMatch({
          id: "audit-markdown-regenerated",
          path: packet.markdownPath,
          expectedContent: renderMarkdown(audit)
        })
      );
    }

    checks.push(
      await verifyRenderedTextMatch({
        id: "evidence-markdown-regenerated",
        path: packet.evidencePacketMarkdownPath,
        expectedContent: renderEvidenceMarkdown(packet)
      })
    );
    checks.push(
      ...(await verifyPacketFile({
        id: "evidence-packet",
        path: packetPath,
        requiredText: ["Cloud Run", packet.status]
      }))
    );
    checks.push(
      ...(await verifyPacketFile({
        id: "evidence-markdown",
        path: packet.evidencePacketMarkdownPath,
        requiredText: ["# Cloud Run Render Evidence Packet", packet.status, "## Stop Conditions"]
      }))
    );
    checks.push(
      ...(await verifyPacketFile({
        id: "audit-json",
        path: packet.auditPath,
        requiredText: ["renderValueIntake", "evidencePacket"]
      }))
    );
    checks.push(
      ...(await verifyPacketFile({
        id: "audit-markdown",
        path: packet.markdownPath,
        requiredText: ["# Cloud Run Render-Values Audit", "## Cloud Run Evidence Packet", "## Stop Conditions"]
      }))
    );
  }

  const blockers = checks.filter((check) => check.status === "blocked");
  const report = {
    generatedAt: new Date().toISOString(),
    generatedFrom: "audit-cloudrun-render-values --verify-packet",
    overallStatus: blockers.length ? "blocked" : "verified",
    packetPath,
    verificationPath,
    releaseId: packet?.releaseId ?? "unknown",
    packetStatus: packet?.status ?? "unknown",
    auditStatus: audit?.status ?? "unknown",
    summary: {
      passed: checks.filter((check) => check.status === "passed").length,
      blocked: blockers.length,
      fileCount: packet ? 4 : 0
    },
    checks,
    blockers: blockers.map((check) => `${check.id}: ${check.evidence}`),
    proofBoundary:
      "This verifies private Cloud Run render-values audit packet integrity only. It does not deploy Cloud Run, run gcloud, call Gemini, prove hosted availability, prove Workspace sync, prove revenue, approve public XPRIZE flags, or guarantee judging outcome.",
    stopConditions: [
      "Do not run Cloud Run dry-run from this verifier alone; dry-run still requires ready render values, strict render, preflight packet, and digest verification.",
      "Do not set public XPRIZE proof flags from this verifier; public-claim rows require private proof and owner approval.",
      "Regenerate the render-values audit and rerun this verifier after any audit, evidence packet, or Markdown edit."
    ]
  };

  await writeJson(verificationPath, report);

  return report;
}

function evidencePacketProofBoundaryIsExplicit(packet) {
  const text = [
    packet.disclaimer,
    ...(Array.isArray(packet.stopConditions) ? packet.stopConditions : []),
    ...(Array.isArray(packet.redactionChecklist) ? packet.redactionChecklist : [])
  ].join(" ");

  return (
    text.includes("does not deploy Cloud Run") &&
    text.includes("run gcloud") &&
    text.includes("call Gemini") &&
    text.includes("prove hosted availability") &&
    text.includes("prove revenue") &&
    text.includes("guarantee XPRIZE judging outcome")
  );
}

function requiredCommandIds() {
  return ["fill-private-render-values", "audit-render-values", "render-cloudrun-manifest", "prepare-dry-run-preflight"];
}

function evidenceStatusMatchesAudit(packet, audit) {
  if (!audit?.evidencePacket) {
    return false;
  }

  return (
    packet.status === audit.evidencePacket.status &&
    packet.readiness?.auditStatus === audit.status &&
    packet.readiness?.readyForStrictRender === audit.readyForStrictRender
  );
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

  try {
    content = await readFile(resolvedPath, "utf8");
    fileStat = await stat(resolvedPath);
    checks.push(verificationCheck(`${id}-readable`, "passed", `${resolvedPath} is readable.`));
  } catch (error) {
    checks.push(
      verificationCheck(`${id}-readable`, "blocked", `${resolvedPath} is not readable: ${error instanceof Error ? error.message : String(error)}.`)
    );
    return checks;
  }

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
    const actualContent = await readFile(resolvedPath, "utf8");

    return verificationCheck(
      id,
      actualContent === expectedContent ? "passed" : "blocked",
      actualContent === expectedContent
        ? `${resolvedPath} matches regenerated Markdown.`
        : `${resolvedPath} differs from regenerated Markdown; rerun audit:cloudrun-values before dry-run.`
    );
  } catch (error) {
    return verificationCheck(id, "blocked", `${resolvedPath} is not readable: ${error instanceof Error ? error.message : String(error)}.`);
  }
}

async function readJsonForVerification(path, label) {
  try {
    return { ok: true, value: JSON.parse(await readFile(path, "utf8")) };
  } catch (error) {
    return {
      ok: false,
      error: `${label} could not be parsed from ${path}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function verificationCheck(id, status, evidence) {
  return { id, status, evidence };
}

function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
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

function buildEvidencePacket({ audit, outputDirectory, evidencePacketPath, evidencePacketMarkdownPath }) {
  const requiredBeforeDryRun = audit.renderValueIntake.filter(
    (item) => item.requiredBeforeDryRun && !["ready", "attested"].includes(item.status)
  );
  const publicClaimEvidenceQueue = audit.renderValueIntake.filter(
    (item) => item.requiredBeforePublicClaim && item.status !== "attested"
  );
  const ownerQueues = buildOwnerQueues(audit.renderValueIntake);
  const artifactRequests = buildArtifactRequests(audit.renderValueIntake);
  const status = evidencePacketStatus({ audit, requiredBeforeDryRun, publicClaimEvidenceQueue });
  const phaseRating = evidencePhaseRating({ status, audit });

  return {
    generatedAt: audit.generatedAt,
    releaseId: audit.releaseId,
    status,
    bucket: "code-controllable",
    outputDirectory,
    evidencePacketPath,
    evidencePacketMarkdownPath,
    auditPath: join(outputDirectory, auditFileName),
    markdownPath: join(outputDirectory, markdownFileName),
    valuesPath: audit.valuesPath,
    readiness: {
      auditStatus: audit.status,
      readyForStrictRender: audit.readyForStrictRender,
      releaseIdConsistency: audit.releaseIdConsistency.status,
      missingStrictKeyCount: audit.missingStrictKeys.length,
      placeholderKeyCount: audit.placeholderKeys.length,
      valueConsistencyBlockerCount: audit.valueConsistencyBlockers.length,
      manualReviewFlagCount: audit.manualReviewFlags.length,
      claimFlagsPending: audit.renderValueIntakeSummary.claimFlagsPending,
      requiredBeforeDryRunPending: requiredBeforeDryRun.length
    },
    phaseProgress: {
      phaseId: "cloudrun-render-dry-run",
      label: "Cloud Run render-values evidence intake",
      ratingOutOf5: phaseRating,
      currentSliceRemainingPercent: evidenceSliceRemainingPercent({ audit, requiredBeforeDryRun, publicClaimEvidenceQueue }),
      overallGoalRemainingPercentSource: "Run npm run verify:local-submission for the aggregate goal percentage.",
      basis:
        "This packet measures the private render-values and evidence-intake slice only. It is not hosted Cloud Run, revenue, user, or judging proof."
    },
    commandSequence: [
      {
        id: "fill-private-render-values",
        owner: "engineering",
        command: "npm run write:cloudrun-release-values -- /secure/local/cloudrun-render-values.json",
        expectedArtifact: "/secure/local/cloudrun-render-values.json",
        stopCondition: "Do not commit or screenshot the filled private values file."
      },
      {
        id: "audit-render-values",
        owner: "engineering",
        command:
          "npm run audit:cloudrun-values -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --release-id $SENTINEL_RELEASE_ID --strict",
        expectedArtifact: evidencePacketPath,
        stopCondition: "Do not render the Cloud Run manifest unless status is ready-for-dry-run or ready-for-dry-run-claim-review-pending."
      },
      {
        id: "render-cloudrun-manifest",
        owner: "engineering",
        command:
          "npm run render:cloudrun-manifest -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --release-id $SENTINEL_RELEASE_ID --strict",
        expectedArtifact: join(outputDirectory, "cloudrun-render-summary.json"),
        stopCondition: "Do not run gcloud while rendered verifier status is blocked or template-needs-values."
      },
      {
        id: "prepare-dry-run-preflight",
        owner: "engineering",
        command:
          "npm run prepare:cloudrun-dry-run -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --release-id $SENTINEL_RELEASE_ID --strict",
        expectedArtifact: join(outputDirectory, "cloudrun-dry-run-preflight-packet.json"),
        stopCondition: "Do not run the Cloud Run dry-run unless the preflight packet and digest verifier both pass."
      }
    ],
    requiredBeforeDryRun: requiredBeforeDryRun.map(evidenceRow),
    publicClaimEvidenceQueue: publicClaimEvidenceQueue.map(evidenceRow),
    ownerQueues,
    artifactRequests,
    manualInterventions: buildManualInterventions({ requiredBeforeDryRun, publicClaimEvidenceQueue, ownerQueues }),
    stopConditions: [
      ...audit.stopConditions,
      "Do not set public XPRIZE proof flags from this packet alone; public-claim rows require the listed private proof and owner approval.",
      "Do not move to Cloud Run dry-run while any requiredBeforeDryRun row is missing, placeholder, or blocked.",
      "Do not store raw secrets, customer evidence, judge credentials, OAuth client secrets, refresh tokens, or Gemini API key values in the render-values file."
    ],
    redactionChecklist: [
      ...audit.redactionChecklist,
      "Before judge sharing, redact valuesPath, private local paths, project ids if sensitive, billing ids, internal bucket names, customer names, and operator notes.",
      "Share checksums, status counts, owner queues, and proof categories; keep original values files and raw evidence in the private evidence store."
    ],
    nextActions: buildEvidenceNextActions({ status, requiredBeforeDryRun, publicClaimEvidenceQueue }),
    disclaimer:
      "This packet guides private Cloud Run evidence intake. It does not deploy Cloud Run, run gcloud, call Gemini, prove hosted availability, prove revenue, or guarantee XPRIZE judging outcome."
  };
}

function buildOwnerQueues(items) {
  const relevantItems = items.filter((item) => item.status !== "ready" || item.requiredBeforePublicClaim);
  const owners = unique(relevantItems.map((item) => item.owner)).sort();

  return owners.map((owner) => {
    const rows = relevantItems
      .filter((item) => item.owner === owner)
      .sort((left, right) => evidencePriority(right) - evidencePriority(left) || left.key.localeCompare(right.key))
      .map(evidenceRow);

    return {
      owner,
      total: rows.length,
      requiredBeforeDryRun: rows.filter((row) => row.requiredBeforeDryRun && !["ready", "attested"].includes(row.status)).length,
      publicClaimEvidence: rows.filter((row) => row.requiredBeforePublicClaim).length,
      rows
    };
  });
}

function buildArtifactRequests(items) {
  const categories = unique(items.map((item) => item.category)).sort();

  return categories.map((category) => {
    const categoryItems = items.filter((item) => item.category === category);
    const first = categoryItems[0] ?? {};

    return {
      category,
      owner: first.owner ?? "engineering",
      keyCount: categoryItems.length,
      keys: categoryItems.map((item) => item.key).sort(),
      statusCounts: countBy(categoryItems.map((item) => item.status)),
      requiredBeforeDryRun: categoryItems
        .filter((item) => item.requiredBeforeDryRun && !["ready", "attested"].includes(item.status))
        .map((item) => item.key)
        .sort(),
      requiredBeforePublicClaim: categoryItems
        .filter((item) => item.requiredBeforePublicClaim)
        .map((item) => item.key)
        .sort(),
      acceptedProof: first.acceptedProof ?? "Reviewed private evidence.",
      privateHandling: first.privateHandling ?? "Keep evidence private until redacted."
    };
  });
}

function buildManualInterventions({ requiredBeforeDryRun, publicClaimEvidenceQueue, ownerQueues }) {
  const interventions = [
    ...requiredBeforeDryRun.map((item) => ({
      owner: item.owner,
      key: item.key,
      requiredBefore: "cloud-run-dry-run",
      action: item.fix,
      acceptedProof: item.acceptedProof,
      privateHandling: item.privateHandling
    })),
    ...publicClaimEvidenceQueue.map((item) => ({
      owner: item.owner,
      key: item.key,
      requiredBefore: "public-or-judge-claim",
      action: item.fix,
      acceptedProof: item.acceptedProof,
      privateHandling: item.privateHandling
    }))
  ];

  if (interventions.length) {
    return interventions;
  }

  return ownerQueues.flatMap((queue) =>
    queue.rows
      .filter((item) => item.requiredBeforePublicClaim)
      .map((item) => ({
        owner: queue.owner,
        key: item.key,
        requiredBefore: "public-or-judge-claim",
        action: item.fix,
        acceptedProof: item.acceptedProof,
        privateHandling: item.privateHandling
      }))
  );
}

function evidencePacketStatus({ audit, requiredBeforeDryRun, publicClaimEvidenceQueue }) {
  if (audit.status === "release-id-mismatch") {
    return "release-id-mismatch";
  }

  if (audit.missingStrictKeys.length > 0 || audit.placeholderKeys.length > 0) {
    return "needs-values";
  }

  if (audit.valueConsistencyBlockers.length > 0 || requiredBeforeDryRun.some((item) => item.status === "blocked")) {
    return "blocked";
  }

  if (requiredBeforeDryRun.length > 0) {
    return "needs-values";
  }

  if (audit.readyForStrictRender && publicClaimEvidenceQueue.length > 0) {
    return "ready-for-dry-run-claim-review-pending";
  }

  return audit.readyForStrictRender ? "ready-for-dry-run" : "needs-values";
}

function evidencePhaseRating({ status, audit }) {
  if (status === "ready-for-dry-run") {
    return 4;
  }

  if (status === "ready-for-dry-run-claim-review-pending") {
    return 3;
  }

  if (status === "needs-values" && audit.renderValueIntakeSummary.ready > 0) {
    return 2;
  }

  return 1;
}

function evidenceSliceRemainingPercent({ audit, requiredBeforeDryRun, publicClaimEvidenceQueue }) {
  const blockers = requiredBeforeDryRun.length + audit.valueConsistencyBlockers.length + (audit.releaseIdConsistency.blocking ? 1 : 0);
  const claimReviewWeight = Math.min(publicClaimEvidenceQueue.length, 10) * 0.25;
  const total = audit.renderValueIntake.length + 4;
  const ready = audit.renderValueIntakeSummary.ready + audit.renderValueIntakeSummary.attested;
  const remaining = Math.max(0, total - ready + blockers + claimReviewWeight);

  return Math.max(0, Math.min(100, Math.round((remaining / total) * 100)));
}

function buildEvidenceNextActions({ status, requiredBeforeDryRun, publicClaimEvidenceQueue }) {
  if (status === "release-id-mismatch") {
    return ["Use the same non-placeholder release id in --release-id and SENTINEL_RELEASE_ID, then rerun the audit."];
  }

  if (status === "blocked") {
    return ["Fix blocked consistency checks in the private render-values file, then rerun the audit before rendering."];
  }

  if (requiredBeforeDryRun.length > 0) {
    return unique(requiredBeforeDryRun.map((item) => `${item.owner}: ${item.fix}`)).slice(0, 12);
  }

  if (status === "ready-for-dry-run-claim-review-pending") {
    return [
      "Proceed to render and dry-run preflight only if Cloud Run values are ready, but keep public XPRIZE proof flags false until private proof is attached.",
      ...unique(publicClaimEvidenceQueue.map((item) => `${item.owner}: ${item.fix}`)).slice(0, 8)
    ];
  }

  return [
    "Render the private Cloud Run manifest, prepare the dry-run preflight packet, and verify packet digests immediately before gcloud dry-run."
  ];
}

function evidenceRow(item) {
  return {
    key: item.key,
    category: item.category,
    owner: item.owner,
    status: item.status,
    source: item.source,
    valuePreview: item.valuePreview,
    requiredBeforeDryRun: item.requiredBeforeDryRun,
    requiredBeforePublicClaim: item.requiredBeforePublicClaim,
    acceptedProof: item.acceptedProof,
    privateHandling: item.privateHandling,
    fix: item.fix
  };
}

function evidencePriority(item) {
  return (
    (item.requiredBeforeDryRun ? 100 : 0) +
    (item.status === "blocked" ? 50 : 0) +
    (item.status === "missing" || item.status === "placeholder" ? 25 : 0) +
    (item.requiredBeforePublicClaim ? 10 : 0)
  );
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
    `- Value consistency blockers: ${packet.valueConsistencyBlockers.length}`,
    `- Manual review flags: ${packet.manualReviewFlags.length}`,
    "",
    "## Render Value Intake",
    `- Total rows: ${packet.renderValueIntakeSummary.total}`,
    `- Ready rows: ${packet.renderValueIntakeSummary.ready}`,
    `- Missing rows: ${packet.renderValueIntakeSummary.missing}`,
    `- Placeholder rows: ${packet.renderValueIntakeSummary.placeholder}`,
    `- Blocked rows: ${packet.renderValueIntakeSummary.blocked}`,
    `- Manual-review claim flags: ${packet.renderValueIntakeSummary.manualReview}`,
    `- Claim flags pending: ${packet.renderValueIntakeSummary.claimFlagsPending}`,
    "",
    "## Cloud Run Evidence Packet",
    `- JSON: ${packet.evidencePacketPath}`,
    `- Markdown: ${packet.evidencePacketMarkdownPath}`,
    `- Status: ${packet.evidencePacket.status}`,
    `- Current slice remaining: ${packet.evidencePacket.phaseProgress.currentSliceRemainingPercent}%`,
    "",
    "## Intake Rows Requiring Action",
    ...(packet.renderValueIntake.filter((item) => !["ready", "attested"].includes(item.status)).length
      ? packet.renderValueIntake
          .filter((item) => !["ready", "attested"].includes(item.status))
          .slice(0, 40)
          .map((item) => `- ${item.key} [${item.status}/${item.category}/${item.owner}]: ${item.fix}`)
      : ["- none"]),
    "",
    "## Value Consistency",
    ...(packet.valueConsistencyChecks.length
      ? packet.valueConsistencyChecks.map((check) => `- ${check.key}: ${check.status}; ${check.fix}`)
      : ["- none"]),
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

function renderEvidenceMarkdown(packet) {
  return [
    "# Cloud Run Render Evidence Packet",
    "",
    `Generated: ${packet.generatedAt}`,
    `Release: ${packet.releaseId}`,
    `Status: ${packet.status}`,
    `Rating: ${packet.phaseProgress.ratingOutOf5}/5`,
    `Current slice remaining: ${packet.phaseProgress.currentSliceRemainingPercent}%`,
    "",
    "## Readiness",
    `- Audit status: ${packet.readiness.auditStatus}`,
    `- Ready for strict render: ${packet.readiness.readyForStrictRender ? "yes" : "no"}`,
    `- Required before dry-run pending: ${packet.readiness.requiredBeforeDryRunPending}`,
    `- Claim flags pending: ${packet.readiness.claimFlagsPending}`,
    `- Missing strict keys: ${packet.readiness.missingStrictKeyCount}`,
    `- Placeholder keys: ${packet.readiness.placeholderKeyCount}`,
    `- Value consistency blockers: ${packet.readiness.valueConsistencyBlockerCount}`,
    "",
    "## Commands",
    "| ID | Owner | Expected Artifact | Stop Condition |",
    "|---|---|---|---|",
    ...packet.commandSequence.map(
      (command) =>
        `| ${escapeTable(command.id)} | ${escapeTable(command.owner)} | ${escapeTable(command.expectedArtifact)} | ${escapeTable(command.stopCondition)} |`
    ),
    "",
    "## Required Before Cloud Run Dry-Run",
    ...(packet.requiredBeforeDryRun.length
      ? [
          "| Key | Owner | Status | Fix |",
          "|---|---|---|---|",
          ...packet.requiredBeforeDryRun.map(
            (item) => `| ${escapeTable(item.key)} | ${escapeTable(item.owner)} | ${escapeTable(item.status)} | ${escapeTable(item.fix)} |`
          )
        ]
      : ["- none"]),
    "",
    "## Public Claim Evidence Queue",
    ...(packet.publicClaimEvidenceQueue.length
      ? [
          "| Key | Owner | Status | Accepted Proof |",
          "|---|---|---|---|",
          ...packet.publicClaimEvidenceQueue.map(
            (item) =>
              `| ${escapeTable(item.key)} | ${escapeTable(item.owner)} | ${escapeTable(item.status)} | ${escapeTable(item.acceptedProof)} |`
          )
        ]
      : ["- none"]),
    "",
    "## Owner Queues",
    ...packet.ownerQueues.flatMap((queue) => [
      `### ${queue.owner}`,
      `- Total rows: ${queue.total}`,
      `- Required before dry-run: ${queue.requiredBeforeDryRun}`,
      `- Public claim evidence rows: ${queue.publicClaimEvidence}`,
      ...queue.rows.slice(0, 20).map((item) => `- ${item.key} [${item.status}/${item.category}]: ${item.fix}`),
      ""
    ]),
    "## Artifact Requests",
    "| Category | Owner | Keys | Required Before Dry-Run | Public Claim Flags | Accepted Proof |",
    "|---|---|---:|---:|---:|---|",
    ...packet.artifactRequests.map(
      (item) =>
        `| ${escapeTable(item.category)} | ${escapeTable(item.owner)} | ${item.keyCount} | ${item.requiredBeforeDryRun.length} | ${item.requiredBeforePublicClaim.length} | ${escapeTable(item.acceptedProof)} |`
    ),
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

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function escapeTable(value) {
  return String(value ?? "")
    .replace(/\|/gu, "\\|")
    .replace(/\n/gu, " ");
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
    const packet = options.verifyPacketPath
      ? await verifyCloudRunRenderEvidencePacket(options.verifyPacketPath)
      : await writeCloudRunRenderValuesAudit(options);
    console.log(JSON.stringify(packet, null, 2));

    if (options.strict && options.verifyPacketPath && packet.overallStatus !== "verified") {
      process.exitCode = 1;
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
