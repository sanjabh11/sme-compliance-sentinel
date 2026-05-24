#!/usr/bin/env node
/* global console, process */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { auditCloudRunRenderValues } from "./render-cloudrun-manifest.mjs";

const defaultOutDir = "artifacts/deployment";
const auditFileName = "cloudrun-render-values-audit.json";
const markdownFileName = "cloudrun-render-values-audit.md";
const evidencePacketFileName = "cloudrun-render-evidence-packet.json";
const evidencePacketMarkdownFileName = "cloudrun-render-evidence-packet.md";

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
