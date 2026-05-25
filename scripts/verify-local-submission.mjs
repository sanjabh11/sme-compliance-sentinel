#!/usr/bin/env node
/* global console, process */

import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

const officialRuleSources = ["https://xprize.devpost.com/rules", "https://www.geminixprize.com/rules"];
const defaultPrivateRoot = "/secure/local";
const prohibitedCliPatterns = [
  /(^|-)token($|=)/iu,
  /(^|-)password($|=)/iu,
  /(^|-)secret($|=)/iu,
  /api[_-]?key=/iu,
  /authorization=/iu
];
const prohibitedPacketContentPatterns = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/u,
  /password\s*[:=]\s*\S+/iu,
  /api[_-]?key\s*[:=]\s*\S+/iu,
  /authorization\s*[:=]\s*\S+/iu,
  /client[_-]?secret\s*[:=]\s*\S+/iu,
  /refresh[_-]?token\s*[:=]\s*\S+/iu
];

const gates = [
  {
    id: "source-release",
    label: "Source release guard",
    command: "npm run verify:source-release",
    script: "scripts/verify-source-release.mjs",
    priority: 5,
    summarize: summarizeSourceRelease
  },
  {
    id: "project-provenance",
    label: "Project provenance and human attestation",
    command: "npm run verify:provenance",
    script: "scripts/verify-project-provenance.mjs",
    priority: 5,
    summarize: summarizeProjectProvenance
  },
  {
    id: "license-ip-review",
    label: "License, API terms, and IP review",
    command: "npm run verify:license-manifest",
    script: "scripts/verify-license-manifest.mjs",
    priority: 4,
    summarize: summarizeLicenseManifest
  },
  {
    id: "gemini-model-readiness",
    label: "Gemini SDK and model readiness",
    command: "npm run verify:gemini-model",
    script: "scripts/verify-gemini-model-readiness.mjs",
    priority: 5,
    summarize: summarizeGeminiModelReadiness
  },
  {
    id: "cloudrun-deployment-template",
    label: "Cloud Run deployment evidence template",
    command: "npm run verify:cloudrun-deployment",
    script: "scripts/verify-cloudrun-deployment.mjs",
    priority: 5,
    summarize: summarizeCloudRunDeployment
  },
  {
    id: "judge-access-readiness",
    label: "Judge access and testing packet",
    command: "npm run verify:judge-access",
    script: "scripts/verify-judge-access-pack.mjs",
    priority: 5,
    summarize: summarizeJudgeAccess
  },
  {
    id: "business-evidence-readiness",
    label: "Business viability evidence packet",
    command: "npm run verify:business-evidence",
    script: "scripts/verify-business-evidence.mjs",
    priority: 5,
    summarize: summarizeBusinessEvidence
  }
];

function parseArgs(argv) {
  const args = {
    strict: false,
    outPath: "",
    manualPacketsDir: "",
    verifyManifestPath: "",
    verifyBundlePath: "",
    markdownOutPath: "",
    bundleDir: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (prohibitedCliPatterns.some((pattern) => pattern.test(arg))) {
      throw new Error("Raw secret CLI args are not supported. This verifier only accepts non-secret output paths.");
    }

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

    if (arg === "--markdown-out") {
      args.markdownOutPath = argv[index + 1] ?? "";
      if (!args.markdownOutPath) {
        throw new Error("--markdown-out requires a non-secret output path.");
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--markdown-out=")) {
      args.markdownOutPath = arg.slice("--markdown-out=".length);
      continue;
    }

    if (arg === "--bundle-dir") {
      args.bundleDir = argv[index + 1] ?? "";
      if (!args.bundleDir) {
        throw new Error("--bundle-dir requires a non-secret output directory.");
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--bundle-dir=")) {
      args.bundleDir = arg.slice("--bundle-dir=".length);
      continue;
    }

    if (arg === "--manual-packets-dir") {
      args.manualPacketsDir = argv[index + 1] ?? "";
      if (!args.manualPacketsDir) {
        throw new Error("--manual-packets-dir requires a non-secret output directory.");
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--manual-packets-dir=")) {
      args.manualPacketsDir = arg.slice("--manual-packets-dir=".length);
      continue;
    }

    if (arg === "--verify-manifest") {
      args.verifyManifestPath = argv[index + 1] ?? "";
      if (!args.verifyManifestPath) {
        throw new Error("--verify-manifest requires a non-secret manifest path.");
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--verify-manifest=")) {
      args.verifyManifestPath = arg.slice("--verify-manifest=".length);
      continue;
    }

    if (arg === "--verify-bundle") {
      args.verifyBundlePath = argv[index + 1] ?? "";
      if (!args.verifyBundlePath) {
        throw new Error("--verify-bundle requires a non-secret bundle manifest path.");
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--verify-bundle=")) {
      args.verifyBundlePath = arg.slice("--verify-bundle=".length);
      continue;
    }

    throw new Error(`Unsupported argument: ${arg}`);
  }

  return args;
}

function buildReport() {
  const gateReports = gates.map(runGate);
  const summary = gateReports.reduce(
    (totals, gate) => {
      totals[gate.status] += 1;
      if (gate.externalRequired) {
        totals.externalRequired += 1;
      }
      return totals;
    },
    { passed: 0, warning: 0, blocked: 0, externalRequired: 0 }
  );
  const overallStatus = summary.blocked > 0 ? "blocked" : summary.warning > 0 ? "warning" : "passed";
  const remainingBlockers = gateReports.flatMap((gate) =>
    gate.status === "blocked" ? gate.blockers.map((blocker) => `${gate.label}: ${blocker}`) : []
  );
  const nextActions = [
    ...unique(gateReports.flatMap((gate) => gate.nextActions)),
    ...(overallStatus === "passed" ? ["Run hosted production verification and attach live evidence before final Devpost submission."] : [])
  ];
  const phasePlan = buildPhasePlan(gateReports);
  const phaseProgressChart = buildPhaseProgressChart(phasePlan, gateReports);
  const manualInterventionPlan = buildManualInterventionPlan({ phasePlan, phaseProgressChart, gateReports });

  return {
    generatedAt: new Date().toISOString(),
    privateRoot: privateRoot(),
    overallStatus,
    summary,
    gates: gateReports,
    remainingBlockers,
    nextActions,
    phasePlan,
    phaseProgressChart,
    manualInterventionPlan,
    stopConditions: [
      "This local verifier does not deploy Cloud Run or prove hosted availability.",
      "This local verifier does not prove live Gemini API usage, GCP persistence, Workspace OAuth sync, paid pilots, revenue, or active users.",
      "Do not set XPRIZE attestation flags to true until a human owner verifies the matching private evidence."
    ],
    sourceUrls: officialRuleSources,
    disclaimer:
      "This is an engineering readiness aggregator for the local repository. It is not legal advice, audit assurance, certification evidence, or a guarantee of judging outcome."
  };
}

function buildManualInterventionPlan({ phasePlan, phaseProgressChart, gateReports }) {
  const gatesById = new Map(gateReports.map((gate) => [gate.id, gate]));
  const progressByPhaseId = new Map(phaseProgressChart.rows.map((row) => [row.phaseId, row]));
  const actionRows = phasePlan.phases.flatMap((phase) => {
    const phaseProgress = progressByPhaseId.get(phase.id);
    const gateRows = phase.relatedGateIds
      .map((gateId) => gatesById.get(gateId))
      .filter(Boolean)
      .flatMap((gate) => manualRowsForGate({ phase, phaseProgress, gate }));
    const evidenceRows = phase.evidenceNeeded
      .filter(() => phase.status !== "passed")
      .map((evidence, index) =>
        manualInterventionRow({
          id: `${phase.id}-evidence-${index + 1}`,
          phase,
          phaseProgress,
          source: "required-evidence",
          status: manualStatusForPhaseEvidence(phase, evidence),
          action: evidence,
          evidenceNeeded: evidence,
          commands: phase.commands,
          stopCondition: phase.stopConditions[0] ?? "Stop until the required evidence exists.",
          privateArtifactPaths: privateArtifactPathsForPhase(phase.id)
        })
      );
    const phaseProgressRows = manualRowsForPhaseProgress({ phase, phaseProgress });

    return [...phaseProgressRows, ...gateRows, ...evidenceRows];
  });
  const dedupedActionRows = dedupeManualRows(actionRows);
  const ownerPackets = buildOwnerPackets(dedupedActionRows);

  return {
    generatedFrom: "verify-local-submission",
    status: dedupedActionRows.length ? "manual-intervention-required" : "no-open-interventions",
    confidenceBoundary:
      "Manual intervention rows are execution instructions, not proof. They do not change any XPRIZE, revenue, hosted, Gemini, Cloud Run, judge-access, or attestation flags.",
    summary: {
      total: dedupedActionRows.length,
      byBucket: countBy(dedupedActionRows.map((row) => row.bucket)),
      byOwner: countBy(dedupedActionRows.map((row) => row.owner)),
      byStatus: countBy(dedupedActionRows.map((row) => row.status)),
      highestPriority: dedupedActionRows.reduce((highest, row) => Math.max(highest, row.priority), 0)
    },
    nextOwner: ownerPackets.find((packet) => packet.openActionCount > 0)?.owner ?? "none",
    ownerPackets,
    actionRows: dedupedActionRows,
    stopConditions: [
      "Do not set manual XPRIZE or business proof flags while the related action row is still pending, blocked, external-required, or needs-review.",
      "Do not treat generated local packets, templates, seeded data, or mock output as hosted Cloud Run, live Gemini, Workspace, revenue, active-user, or judge-access proof.",
      "Do not put private render values, invoices, payment exports, judge credentials, OAuth secrets, API keys, customer findings, or raw Workspace content in Git."
    ],
    privateHandling: [
      "Store generated private packets under /secure/local or ignored artifacts paths.",
      "Share only redacted summaries, status counts, checksums, and public-safe Devpost copy.",
      "Keep owner signoff notes and source evidence private until a human reviewer approves a redacted judge packet."
    ]
  };
}

function manualRowsForPhaseProgress({ phase, phaseProgress }) {
  if (phase.status === "passed" || !phaseProgress || phase.id !== "cloudrun-render-dry-run") {
    return [];
  }

  const cloudRunArtifactState = readCloudRunRenderArtifactState();

  return phaseProgress.pending
    .filter((action) => isActionableCloudRunProgressBlocker(action))
    .map((action, index) =>
      manualInterventionRow({
        id: `${phase.id}-0-progress-${index + 1}`,
        phase,
        phaseProgress,
        source: "phase-progress",
        status: "private-values-required",
        action,
        actionDetails: cloudRunActionDetailsForBlocker({ action, state: cloudRunArtifactState }),
        evidenceNeeded: phaseProgress.evidence,
        commands: phase.commands,
        stopCondition: phase.stopConditions[0] ?? "Stop until the private render-values audit is ready-to-render.",
        privateArtifactPaths: privateArtifactPathsForPhase(phase.id)
      })
  );
}

function cloudRunActionDetailsForBlocker({ action, state }) {
  if (!state) {
    return [];
  }

  const text = String(action);

  if (/required non-secret Cloud Run render value/iu.test(text)) {
    return cloudRunValueDetailsForKeys({
      keys: state.missingStrictKeys,
      state,
      fallbackStatus: "missing"
    });
  }

  if (/placeholder render value/iu.test(text)) {
    return cloudRunValueDetailsForKeys({
      keys: state.placeholderKeys,
      state,
      fallbackStatus: "placeholder"
    });
  }

  if (/render-value consistency blocker/iu.test(text)) {
    return state.valueConsistencyBlockers.map((blocker) => {
      const key = String(blocker?.key || "");
      const intake = cloudRunIntakeByKey(state).get(key);

      return cloudRunValueDetail({
        key,
        intake,
        status: "blocked",
        fix: String(blocker?.fix || blocker?.id || intake?.fix || "Review the render-values audit packet.")
      });
    });
  }

  return [];
}

function cloudRunValueDetailsForKeys({ keys, state, fallbackStatus }) {
  const intakeByKey = cloudRunIntakeByKey(state);

  return keys.map((key) =>
    cloudRunValueDetail({
      key,
      intake: intakeByKey.get(key),
      status: fallbackStatus,
      fix: intakeByKey.get(key)?.fix
    })
  );
}

function cloudRunIntakeByKey(state) {
  return new Map(
    (state.renderValueIntake ?? [])
      .filter((item) => item?.key)
      .map((item) => [String(item.key), item])
  );
}

function cloudRunValueDetail({ key, intake, status, fix }) {
  return {
    key,
    owner: String(intake?.owner || "engineering"),
    status: String(intake?.status || status || "pending"),
    source: String(intake?.source || "render-values-audit"),
    fix: String(fix || `Fill ${key} in the private render-values file with a reviewed non-secret production value.`),
    acceptedProof: String(intake?.acceptedProof || "Reviewed non-secret deployment value and private operator evidence.")
  };
}

function isActionableCloudRunProgressBlocker(action) {
  return /required non-secret Cloud Run render value|placeholder render value|render-value consistency blocker|render-values audit is ready-to-render/iu.test(
    String(action)
  );
}

function manualRowsForGate({ phase, phaseProgress, gate }) {
  if (gate.status === "passed") {
    return [];
  }

  const blockerRows = gate.blockers.map((blocker, index) =>
    manualInterventionRow({
      id: `${phase.id}-${gate.id}-blocker-${index + 1}`,
      phase,
      phaseProgress,
      source: `gate:${gate.id}`,
      status: gate.status === "blocked" ? "blocked" : "needs-review",
      action: blocker,
      evidenceNeeded: gate.evidence,
      commands: [gate.command],
      stopCondition: stopConditionForGate(gate),
      privateArtifactPaths: privateArtifactPathsForGate(gate.id)
    })
  );
  const nextActionRows = gate.nextActions
    .filter((action) => !gate.blockers.some((blocker) => blocker.includes(action) || action.includes(blocker)))
    .map((action, index) =>
      manualInterventionRow({
        id: `${phase.id}-${gate.id}-next-${index + 1}`,
        phase,
        phaseProgress,
        source: `gate:${gate.id}`,
        status: gate.externalRequired ? "external-required" : "needs-review",
        action,
        evidenceNeeded: gate.evidence,
        commands: [gate.command],
        stopCondition: stopConditionForGate(gate),
        privateArtifactPaths: privateArtifactPathsForGate(gate.id)
      })
    );

  return blockerRows.length ? [...blockerRows, ...nextActionRows] : nextActionRows;
}

function manualInterventionRow(input) {
  const owner = ownerForManualRow(input.phase, input.action);

  return {
    id: input.id,
    phaseId: input.phase.id,
    phaseLabel: input.phase.label,
    bucket: input.phase.bucket ?? bucketForPhase(input.phase),
    owner,
    priority: input.phase.priority,
    phaseRatingOutOf5: input.phaseProgress?.ratingOutOf5 ?? 1,
    currentPhaseRemainingPercent: input.phase.currentPhaseRemainingPercent,
    overallGoalRemainingPercent: input.phaseProgress?.overallGoalRemainingPercent ?? 0,
    source: input.source,
    status: input.status,
    action: input.action,
    actionDetails: input.actionDetails ?? [],
    evidenceNeeded: input.evidenceNeeded,
    commands: input.commands,
    privateArtifactPaths: input.privateArtifactPaths,
    checklist: checklistForManualRow(input.phase, input.action),
    stopCondition: input.stopCondition,
    proofBoundary: proofBoundaryForBucket(input.phase.bucket ?? bucketForPhase(input.phase))
  };
}

function manualStatusForPhaseEvidence(phase, evidence) {
  if (phase.bucket === "external-proof") {
    return "external-required";
  }

  if (phase.id === "cloudrun-render-dry-run" && /render-values|private values|handoff|dry-run preflight/iu.test(evidence)) {
    return "private-values-required";
  }

  return "pending";
}

function checklistForManualRow(phase, action) {
  if (phase.id !== "cloudrun-render-dry-run") {
    return [];
  }

  const text = String(action).toLowerCase();
  const common = [
    "Create or refresh `/secure/local/cloudrun-render-values.json` from the tracked template or `npm run prepare:cloudrun-render-handoff`; do not commit, screenshot, or paste the filled file.",
    "Fill only non-secret production values: GCP project id/number, HTTPS Cloud Run URL, OAuth client id, billing budget id, Gemini key resource id or short id, static egress IPs, entrant/category timestamps, and positive Secret Manager versions.",
    "Keep XPRIZE, revenue, user, Gemini, Workspace, judge-access, demo, and AI-operation evidence flags false until matching private proof exists and the owner has reviewed it.",
    "Run the handoff verifier, render-values audit, render-evidence verifier, manifest render, dry-run preflight, and dry-run packet verifier in order; stop on the first blocker before any gcloud dry-run."
  ];

  if (text.includes("dry-run preflight") || text.includes("digest verifier")) {
    return [
      ...common,
      "Preserve the preflight packet and digest verifier beside the rendered manifest bundle, then collect gcloud dry-run/deploy/describe transcripts only from a private operator shell."
    ];
  }

  return common;
}

function ownerForManualRow(phase, action) {
  if (phase.id === "cloudrun-render-dry-run") {
    return "engineering";
  }

  const text = action.toLowerCase();

  if (text.includes("invoice") || text.includes("revenue") || text.includes("payment") || text.includes("paid pilot") || text.includes("customer") || text.includes("testimonial") || text.includes("cac")) {
    return "founder/sales";
  }

  if (text.includes("license") || text.includes("ip") || text.includes("eligibility") || text.includes("representative") || text.includes("attestation") || text.includes("testing instruction") || text.includes("judge") || text.includes("demo") || text.includes("evidence response")) {
    return "founder/legal";
  }

  if (text.includes("cloud run") || text.includes("gemini") || text.includes("workspace") || text.includes("oauth") || text.includes("repository") || text.includes("source") || text.includes("secret") || text.includes("gcloud") || text.includes("render")) {
    return "engineering";
  }

  return phase.owner;
}

function privateArtifactPathsForGate(gateId) {
  const pathsByGate = {
    "project-provenance": ["/secure/local/xprize-attestation/xprize-human-attestation-packet.json"],
    "license-ip-review": ["/secure/local/xprize-attestation/xprize-human-attestation-packet.json"],
    "cloudrun-deployment-template": [
      "/secure/local/cloudrun-render-values.json",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-handoff.json",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-handoff.md",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-handoff-verifier.json",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-values-audit.json",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-evidence-packet.json",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-evidence-packet-verifier.json",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-summary.json",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-dry-run-preflight-packet.json",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-dry-run-packet-verifier.json"
    ],
    "gemini-model-readiness": ["/secure/local/gemini-model-readiness.json"],
    "judge-access-readiness": ["/secure/local/judge-access-readiness.json", "artifacts/hosted-proof/$SENTINEL_RELEASE_ID/judge-access-pack.json"],
    "business-evidence-readiness": ["/secure/local/business-evidence-template.json", "/secure/local/business-evidence.json"]
  };

  return pathsByGate[gateId] ?? ["/secure/local/local-submission-readiness.json"];
}

function privateArtifactPathsForPhase(phaseId) {
  const pathsByPhase = {
    "human-attestation-review": ["/secure/local/xprize-attestation/xprize-human-attestation-packet.json"],
    "cloudrun-render-dry-run": [
      "/secure/local/cloudrun-render-values.json",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-handoff.json",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-handoff.md",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-handoff-verifier.json",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-values-audit.json",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-evidence-packet.json",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-evidence-packet-verifier.json",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-summary.json",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-dry-run-preflight-packet.json",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-dry-run-packet-verifier.json"
    ],
    "hosted-proof-capture": [
      "/secure/local/cloudrun/$SENTINEL_RELEASE_ID/cloudrun-dry-run.log",
      "/secure/local/cloudrun/$SENTINEL_RELEASE_ID/cloudrun-deploy.log",
      "/secure/local/cloudrun/$SENTINEL_RELEASE_ID/cloudrun-describe.json",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-deployment-transcript-packet.json",
      "/secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-readonly.json",
      "/secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-write.json",
      "artifacts/hosted-proof/$SENTINEL_RELEASE_ID/manifest.json",
      "artifacts/hosted-proof/$SENTINEL_RELEASE_ID/release-evidence-manifest.json"
    ],
    "business-traction-proof": ["/secure/local/business-evidence-template.json", "/secure/local/business-evidence.json"]
  };

  return pathsByPhase[phaseId] ?? ["/secure/local/local-submission-readiness.json"];
}

function stopConditionForGate(gate) {
  if (gate.id === "project-provenance") {
    return "Stop before setting project-newness or source-completeness flags until a human owner reviews the provenance packet.";
  }

  if (gate.id === "license-ip-review") {
    return "Stop before publishing final Devpost/demo copy until license, Google API, OAuth, IP, demo, and screenshot review is complete.";
  }

  if (gate.id === "cloudrun-deployment-template") {
    return "Stop before Cloud Run dry-run while placeholders, missing values, Secret Manager mapping gaps, or digest drift remain.";
  }

  if (gate.id === "gemini-model-readiness") {
    return "Stop before deployed Gemini proof if the SDK, model allowlist, or official-doc review is stale or blocked.";
  }

  if (gate.id === "judge-access-readiness") {
    return "Stop before final submission until hosted product URL, judge access, private testing instructions, demo, repository access, and evidence-response owner are verified.";
  }

  if (gate.id === "business-evidence-readiness") {
    return "Stop before business model or category-impact claims until private revenue, user, cost, CAC, related-party, and consent artifacts exist.";
  }

  return "Stop until this gate is passed or explicitly classified as external proof.";
}

function proofBoundaryForBucket(bucket) {
  if (bucket === "external-proof") {
    return "Requires private external artifact evidence; local code, templates, mock data, or seeded output do not prove this item.";
  }

  if (bucket === "human-attestation") {
    return "Requires human review and owner signoff; this verifier can prepare packets but cannot approve flags.";
  }

  return "Code-controllable preparation only; any private values or cloud execution remain operator evidence until collected.";
}

function buildOwnerPackets(rows) {
  const owners = unique(rows.map((row) => row.owner)).sort();

  return owners.map((owner) => {
    const ownerRows = rows
      .filter((row) => row.owner === owner)
      .sort((left, right) => right.priority - left.priority || left.phaseId.localeCompare(right.phaseId) || left.id.localeCompare(right.id));

    return {
      owner,
      openActionCount: ownerRows.length,
      buckets: countBy(ownerRows.map((row) => row.bucket)),
      highestPriority: ownerRows.reduce((highest, row) => Math.max(highest, row.priority), 0),
      nextAction: ownerRows[0]?.action ?? "No action.",
      privateArtifactPaths: unique(ownerRows.flatMap((row) => row.privateArtifactPaths)),
      rows: ownerRows
    };
  });
}

function dedupeManualRows(rows) {
  const seen = new Set();
  const deduped = [];

  for (const row of rows) {
    const key = `${row.phaseId}:${row.owner}:${row.action}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(row);
    }
  }

  return deduped;
}

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function buildPhaseProgressChart(phasePlan, gateReports) {
  const gatesById = new Map(gateReports.map((gate) => [gate.id, gate]));
  const rows = phasePlan.phases.map((phase) => {
    const checkpoints = buildPhaseCheckpoints(phase, gatesById);
    const checkpointCounts = countCheckpoints(checkpoints);
    const currentPhaseRemainingPercent = remainingPercentFromCounts(checkpointCounts);
    const bucket = phase.bucket ?? bucketForPhase(phase);

    return {
      phaseId: phase.id,
      label: phase.label,
      bucket,
      owner: phase.owner,
      priority: phase.priority,
      status: phase.status,
      ratingOutOf5: ratingForCheckpointCounts(checkpointCounts, bucket),
      currentPhaseRemainingPercent,
      overallGoalRemainingPercent: 0,
      done: checkpoints
        .filter((checkpoint) => checkpoint.status === "done" || checkpoint.status === "partial")
        .map((checkpoint) =>
          checkpoint.status === "done" ? `${checkpoint.label}: passed` : `${checkpoint.label}: partial/scaffolded`
        ),
      pending: unique(
        checkpoints.flatMap((checkpoint) => {
          if (checkpoint.status === "done") {
            return [];
          }

          if (checkpoint.status === "partial" && checkpoint.blockers.length === 0) {
            return [];
          }

          return checkpoint.blockers.length > 0 ? checkpoint.blockers : [checkpoint.label];
        })
      ).slice(0, 8),
      successCheckpoints: phase.commands,
      stopConditions: phase.stopConditions,
      checkpointCounts,
      progressBasis:
        "Derived from phase-specific gate and evidence checkpoints. Warning gates count as partial scaffold evidence, not completion. This is not a win-probability estimate.",
      evidence: checkpoints.map((checkpoint) => `${checkpoint.source}=${checkpoint.status}`).join("; ")
    };
  });
  const overallGoalRemainingPercent = Math.round(
    rows.reduce((total, row) => total + row.currentPhaseRemainingPercent, 0) / rows.length
  );

  return {
    generatedFrom: "verify-local-submission",
    scale: "Evidence-gate checklist: 1=blocked/no required evidence, 3=partial local evidence, 5=all phase checkpoints verified; not win probability.",
    overallGoalRemainingPercent,
    overallGoalRemainingBasis: "Average of phase-specific evidence-gate remaining percentages.",
    rows: rows.map((row) => ({ ...row, overallGoalRemainingPercent }))
  };
}

function buildPhaseCheckpoints(phase, gatesById) {
  const bucket = phase.bucket ?? bucketForPhase(phase);
  const cloudRunArtifactState = phase.id === "cloudrun-render-dry-run" ? readCloudRunRenderArtifactState() : null;
  const gateCheckpoints = phase.relatedGateIds
    .map((id) => gatesById.get(id))
    .filter(Boolean)
    .map((gate) => ({
      label: gate.label,
      source: `gate:${gate.id}`,
      bucket,
      status: gate.status === "passed" ? "done" : gate.status === "warning" ? "partial" : "blocked",
      blockers: gate.status === "passed" ? [] : gate.blockers,
      evidence: gate.evidence
    }));
  const evidenceCheckpoints = phase.evidenceNeeded.map((item) =>
    buildEvidenceCheckpoint({ phase, item, bucket, cloudRunArtifactState })
  );
  const cloudRunRenderValueCheckpoints =
    phase.id === "cloudrun-render-dry-run" && cloudRunArtifactState
      ? buildCloudRunRenderValueCheckpoints({ bucket, state: cloudRunArtifactState })
      : [];

  return [...cloudRunRenderValueCheckpoints, ...evidenceCheckpoints, ...gateCheckpoints];
}

function buildEvidenceCheckpoint({ phase, item, bucket, cloudRunArtifactState }) {
  if (phase.id === "cloudrun-render-dry-run" && cloudRunArtifactState) {
    return buildCloudRunEvidenceCheckpoint({ item, bucket, state: cloudRunArtifactState });
  }

  return {
    label: item,
    source: "required-evidence",
    bucket,
    status: phase.status === "passed" ? "done" : bucket === "external-proof" ? "external-required" : "pending",
    blockers: phase.status === "passed" ? [] : [item],
    evidence: item
  };
}

function buildCloudRunEvidenceCheckpoint({ item, bucket, state }) {
  const base = {
    label: item,
    source: "private-artifact",
    bucket,
    evidence: state.releaseId ? `release=${state.releaseId}` : "release=missing"
  };

  if (item.startsWith("cloudrun-render-handoff JSON/Markdown")) {
    if (state.handoffJsonExists && state.handoffMarkdownExists && state.evidencePacketVerified) {
      return { ...base, status: "done", blockers: [] };
    }

    if (state.handoffJsonExists || state.handoffMarkdownExists || state.evidencePacketExists) {
      return {
        ...base,
        status: "partial",
        blockers: ["Verify cloudrun-render-handoff JSON/Markdown and owner packet before private values are filled."]
      };
    }
  }

  if (item.startsWith("cloudrun-render-handoff-verifier JSON")) {
    if (state.handoffVerifierVerified) {
      return { ...base, status: "done", blockers: [] };
    }

    if (state.handoffVerifierExists) {
      return { ...base, status: "partial", blockers: ["Rerun verify:cloudrun-render-handoff until the verifier is verified."] };
    }
  }

  if (item.startsWith("release-prefilled private render-values file")) {
    if (state.valuesFileReleasePrefilled) {
      return { ...base, status: "done", blockers: [] };
    }

    if (state.valuesFileExists) {
      return {
        ...base,
        status: "partial",
        blockers: ["Refresh the private render-values file with current release id, source commit, source timestamp, branch, and repository URL."]
      };
    }
  }

  if (item.startsWith("render-values audit JSON/Markdown")) {
    if (state.auditJsonExists && state.auditMarkdownExists && state.evidencePacketExists && state.evidencePacketMarkdownExists && state.evidencePacketVerified) {
      return { ...base, status: "done", blockers: [] };
    }

    if (state.auditJsonExists || state.auditMarkdownExists || state.evidencePacketExists || state.evidencePacketMarkdownExists) {
      return {
        ...base,
        status: "partial",
        blockers: ["Rerun audit:cloudrun-values and verify:cloudrun-render-evidence for the current release."]
      };
    }
  }

  if (item.startsWith("dry-run preflight packet")) {
    if (state.dryRunPreflightExists && state.dryRunVerifierVerified) {
      return { ...base, status: "done", blockers: [] };
    }

    if (state.dryRunPreflightExists || state.dryRunVerifierExists) {
      return {
        ...base,
        status: "partial",
        blockers: ["Rerun prepare:cloudrun-dry-run and verify:cloudrun-dry-run-packet before any gcloud dry-run."]
      };
    }

    if (state.auditJsonExists && !state.renderValuesReady) {
      return {
        ...base,
        status: "pending",
        blockers: ["Generate the dry-run preflight packet only after the render-values audit is ready-to-render."]
      };
    }
  }

  return { ...base, status: "pending", blockers: [item] };
}

function buildCloudRunRenderValueCheckpoints({ bucket, state }) {
  if (!state.auditJsonExists) {
    return [];
  }

  const blockers = cloudRunRenderValueBlockers(state);

  return [
    {
      label: "private render-values ready for strict render",
      source: "private-artifact:render-values-audit",
      bucket,
      evidence: [
        state.releaseId ? `release=${state.releaseId}` : "release=missing",
        `audit-status=${state.auditStatus || "missing"}`,
        `missing-strict-values=${state.missingStrictKeys.length}`,
        `placeholder-values=${state.placeholderKeys.length}`,
        `value-consistency-blockers=${state.valueConsistencyBlockers.length}`
      ].join("; "),
      status: state.renderValuesReady ? "done" : state.valueConsistencyBlockers.length > 0 ? "blocked" : "pending",
      blockers: state.renderValuesReady ? [] : blockers
    }
  ];
}

function cloudRunRenderValueBlockers(state) {
  const blockers = [];

  if (state.missingStrictKeys.length > 0) {
    blockers.push(
      `Fill ${state.missingStrictKeys.length} required non-secret Cloud Run render value(s): ${summarizeList(state.missingStrictKeys)}.`
    );
  }

  if (state.placeholderKeys.length > 0) {
    blockers.push(`Replace ${state.placeholderKeys.length} placeholder render value(s): ${summarizeList(state.placeholderKeys)}.`);
  }

  for (const blocker of state.valueConsistencyBlockers.slice(0, 3)) {
    const key = blocker?.key ? `${blocker.key}: ` : "";
    blockers.push(`Resolve render-value consistency blocker ${key}${blocker?.fix || blocker?.id || "review the audit packet"}.`);
  }

  if (blockers.length === 0) {
    blockers.push("Rerun audit:cloudrun-values until the private render-values audit is ready-to-render.");
  }

  return blockers;
}

function summarizeList(values) {
  return values.join(", ");
}

function readCloudRunRenderArtifactState() {
  const valuesPath = resolve(process.env.SENTINEL_CLOUD_RUN_VALUES_PATH || privateLocalPath("cloudrun-render-values.json"));
  const values = readPrivateJsonIfRegular(valuesPath);
  const releaseId = safePathSegment(
    process.env.SENTINEL_RELEASE_ID || values?.SENTINEL_RELEASE_ID || ""
  );
  const outDir = resolve(process.env.SENTINEL_CLOUD_RUN_RENDER_OUT_DIR || "artifacts/deployment", releaseId || "missing-release");
  const handoff = readPrivateJsonIfRegular(join(outDir, "cloudrun-render-handoff.json"));
  const handoffVerifier = readPrivateJsonIfRegular(join(outDir, "cloudrun-render-handoff-verifier.json"));
  const audit = readPrivateJsonIfRegular(join(outDir, "cloudrun-render-values-audit.json"));
  const evidenceVerifier = readPrivateJsonIfRegular(join(outDir, "cloudrun-render-evidence-packet-verifier.json"));
  const dryRunVerifier = readPrivateJsonIfRegular(join(outDir, "cloudrun-dry-run-packet-verifier.json"));

  return {
    releaseId,
    valuesFileExists: Boolean(values),
    valuesFileReleasePrefilled: Boolean(
      values?.SENTINEL_RELEASE_ID &&
        values?.SENTINEL_SOURCE_COMMIT &&
        values?.SENTINEL_SOURCE_COMMIT_AT &&
        values?.SENTINEL_SOURCE_BRANCH &&
        values?.XPRIZE_REPOSITORY_URL
    ),
    handoffJsonExists: Boolean(handoff),
    handoffMarkdownExists: isRegularFile(join(outDir, "cloudrun-render-handoff.md")),
    handoffVerifierExists: Boolean(handoffVerifier),
    handoffVerifierVerified: handoffVerifier?.overallStatus === "verified" && handoffVerifier?.releaseId === releaseId,
    auditJsonExists: Boolean(audit),
    auditStatus: String(audit?.status ?? ""),
    renderValuesReady: audit?.readyForStrictRender === true || audit?.status === "ready-to-render",
    missingStrictKeys: Array.isArray(audit?.missingStrictKeys) ? audit.missingStrictKeys.map(String) : [],
    placeholderKeys: Array.isArray(audit?.placeholderKeys) ? audit.placeholderKeys.map(String) : [],
    valueConsistencyBlockers: Array.isArray(audit?.valueConsistencyBlockers) ? audit.valueConsistencyBlockers : [],
    renderValueIntake: Array.isArray(audit?.renderValueIntake) ? audit.renderValueIntake : [],
    auditMarkdownExists: isRegularFile(join(outDir, "cloudrun-render-values-audit.md")),
    evidencePacketExists: isRegularFile(join(outDir, "cloudrun-render-evidence-packet.json")),
    evidencePacketMarkdownExists: isRegularFile(join(outDir, "cloudrun-render-evidence-packet.md")),
    evidencePacketVerified: evidenceVerifier?.overallStatus === "verified" && evidenceVerifier?.releaseId === releaseId,
    dryRunPreflightExists: isRegularFile(join(outDir, "cloudrun-dry-run-preflight-packet.json")),
    dryRunVerifierExists: Boolean(dryRunVerifier),
    dryRunVerifierVerified: dryRunVerifier?.overallStatus === "verified" && dryRunVerifier?.releaseId === releaseId
  };
}

function readPrivateJsonIfRegular(path) {
  if (!isRegularFile(path)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function isRegularFile(path) {
  try {
    const fileStat = lstatSync(path);
    return fileStat.isFile() && !fileStat.isSymbolicLink();
  } catch {
    return false;
  }
}

function safePathSegment(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9._-]/gu, "-")
    .replace(/-+/gu, "-")
    .slice(0, 120);
}

function privateLocalPath(...segments) {
  return join(privateRoot(), ...segments);
}

function privateRoot() {
  const configuredRoot = String(process.env.SENTINEL_PRIVATE_ROOT ?? defaultPrivateRoot).trim();
  const root = configuredRoot || defaultPrivateRoot;

  return root.replace(/\/+$/u, "") || defaultPrivateRoot;
}

function applyPrivateRoot(value) {
  const root = privateRoot();

  if (root === defaultPrivateRoot) {
    return value;
  }

  if (typeof value === "string") {
    return value.replaceAll(defaultPrivateRoot, root);
  }

  if (Array.isArray(value)) {
    return value.map(applyPrivateRoot);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, applyPrivateRoot(entry)]));
  }

  return value;
}

function countCheckpoints(checkpoints) {
  return checkpoints.reduce(
    (counts, checkpoint) => {
      counts.total += 1;
      counts[checkpoint.status] += 1;
      return counts;
    },
    { total: 0, done: 0, partial: 0, pending: 0, blocked: 0, "external-required": 0 }
  );
}

function remainingPercentFromCounts(counts) {
  if (counts.total === 0) {
    return 0;
  }

  const completedPoints = counts.done + counts.partial * 0.5;
  return Math.round(((counts.total - completedPoints) / counts.total) * 100);
}

function bucketForPhase(phase) {
  if (phase.id === "human-attestation-review") {
    return "human-attestation";
  }

  if (phase.status === "external-required" || phase.id === "hosted-proof-capture" || phase.id === "business-traction-proof") {
    return "external-proof";
  }

  return "code-controllable";
}

function ratingForCheckpointCounts(counts, bucket) {
  if (counts.total === 0 || counts.done === counts.total) {
    return 5;
  }

  if (bucket === "human-attestation" && counts.blocked > 0) {
    return 1;
  }

  if (bucket === "external-proof" && counts.done === 0) {
    return 1;
  }

  const completedPoints = counts.done + counts.partial * 0.5;
  return Math.max(1, Math.min(5, Math.round((completedPoints / counts.total) * 4) + 1));
}

function buildPhasePlan(gateReports) {
  const gatesById = new Map(gateReports.map((gate) => [gate.id, gate]));
  const sourceGate = gatesById.get("source-release");
  const provenanceGate = gatesById.get("project-provenance");
  const licenseGate = gatesById.get("license-ip-review");
  const cloudRunGate = gatesById.get("cloudrun-deployment-template");
  const geminiGate = gatesById.get("gemini-model-readiness");
  const humanReviewPassed = provenanceGate?.status === "passed" && licenseGate?.status === "passed";
  const geminiModelReady = geminiGate?.status === "passed";
  const cloudRunReady = cloudRunGate?.rawStatus === "ready-to-dry-run" && geminiModelReady;

  const phases = [
    {
      id: "human-attestation-review",
      label: "Human attestation and disclosure review",
      bucket: "human-attestation",
      priority: 5,
      owner: "founder/legal",
      status: humanReviewPassed ? "passed" : "needs-review",
      relatedGateIds: ["source-release", "project-provenance", "license-ip-review"],
      commands: [
        "npm run verify:local-submission -- --out /secure/local/local-submission-readiness.json",
        "npm run prepare:xprize-attestation -- --out-dir /secure/local/xprize-attestation"
      ],
      evidenceNeeded: [
        "project-created-after-start decision and pre-existing-work disclosure",
        "entrant eligibility and representative authority confirmation",
        "third-party package, Google API, demo asset, and IP ownership review"
      ],
      stopConditions: [
        "Do not set XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED=true until the private attestation packet is reviewed.",
        "Do not claim license, API, demo, or IP clearance from dependency metadata alone."
      ]
    },
    {
      id: "cloudrun-render-dry-run",
      label: "Cloud Run render and dry-run preflight",
      bucket: "code-controllable",
      priority: 5,
      owner: "engineering",
      status: cloudRunGate?.status === "blocked" || geminiGate?.status === "blocked" ? "blocked" : cloudRunReady ? "ready-to-dry-run" : "needs-values",
      relatedGateIds: ["cloudrun-deployment-template", "gemini-model-readiness"],
      commands: [
        "npm run verify:gemini-model -- --out /secure/local/gemini-model-readiness.json --strict",
        "npm run prepare:cloudrun-render-handoff -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --strict",
        "npm run verify:cloudrun-render-handoff -- artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-handoff.json --strict",
        "npm run audit:cloudrun-values -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --release-id $SENTINEL_RELEASE_ID --strict",
        "npm run verify:cloudrun-render-evidence -- artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-evidence-packet.json --strict",
        "npm run render:cloudrun-manifest -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --release-id $SENTINEL_RELEASE_ID --strict",
        "npm run prepare:cloudrun-dry-run -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --release-id $SENTINEL_RELEASE_ID --strict",
        "npm run verify:cloudrun-dry-run-packet -- artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-dry-run-preflight-packet.json --strict"
      ],
      evidenceNeeded: [
        "cloudrun-render-handoff JSON/Markdown with release-prefilled values and a verified owner packet before private values are filled",
        "cloudrun-render-handoff-verifier JSON after handoff transfer or owner edits",
        "release-prefilled private render-values file with source metadata and no raw secrets",
        "render-values audit JSON/Markdown plus verified owner-routed render evidence packet",
        "dry-run preflight packet and digest verifier"
      ],
      stopConditions: [
        "Do not run gcloud dry-run while placeholders, verifier blockers, or changed bundle digests remain.",
        "Do not put API keys, OAuth secrets, refresh tokens, service-account key paths, judge credentials, or customer evidence into source."
      ]
    },
    {
      id: "hosted-proof-capture",
      label: "Hosted Cloud Run and Gemini proof capture",
      bucket: "external-proof",
      priority: 5,
      owner: "engineering",
      status: "external-required",
      relatedGateIds: ["cloudrun-deployment-template", "judge-access-readiness"],
      commands: [
        "gcloud run services replace artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun.service.rendered.yaml --region $SENTINEL_CLOUD_RUN_REGION --dry-run",
        "gcloud run services replace artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun.service.rendered.yaml --region $SENTINEL_CLOUD_RUN_REGION",
        "gcloud run services describe $SENTINEL_CLOUD_RUN_SERVICE_NAME --region $SENTINEL_CLOUD_RUN_REGION --format=json",
        "npm run collect:cloudrun-deployment -- --release-id $SENTINEL_RELEASE_ID --dry-run-log /secure/local/cloudrun/$SENTINEL_RELEASE_ID/cloudrun-dry-run.log --deploy-log /secure/local/cloudrun/$SENTINEL_RELEASE_ID/cloudrun-deploy.log --describe-json /secure/local/cloudrun/$SENTINEL_RELEASE_ID/cloudrun-describe.json --out-dir artifacts/deployment --strict",
        "npm run verify:production -- --url $NEXT_PUBLIC_PRODUCT_URL --release-id $SENTINEL_RELEASE_ID --strict --out /secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-readonly.json",
        "npm run verify:production -- --url $NEXT_PUBLIC_PRODUCT_URL --release-id $SENTINEL_RELEASE_ID --strict --include-write-checks --out /secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-write.json",
        "npm run verify:business-evidence -- --write-template /secure/local/business-evidence-template.json --out /secure/local/business-evidence-readiness.json",
        "npm run verify:judge-access -- --out /secure/local/judge-access-readiness.json --strict",
        "npm run collect:hosted-proof -- --url $NEXT_PUBLIC_PRODUCT_URL --release-id $SENTINEL_RELEASE_ID --include-write-checks --strict",
        "npm run import:hosted-proof -- --bundle-dir artifacts/hosted-proof/$SENTINEL_RELEASE_ID --url $NEXT_PUBLIC_PRODUCT_URL --dry-run"
      ],
      evidenceNeeded: [
        "Cloud Run service URL, revision, release id, service account, and redacted deployment transcript",
        "hosted live Gemini API call evidence with provider=gemini-api",
        "hosted GCP persistence and Workspace OAuth/sync proof",
        "business-evidence readiness packet for revenue, users, costs, CAC, consent, and related-party review",
        "judge-access readiness packet with private testing instructions withheld"
      ],
      stopConditions: [
        "Do not set Google Cloud, Gemini, repository, product-running, or AI-native proof flags until hosted artifacts exist.",
        "Do not import hosted proof into the Evidence Vault until dry-run import and redaction review pass."
      ]
    },
    {
      id: "business-traction-proof",
      label: "Paid pilot, user, revenue, and judge-access proof",
      bucket: "external-proof",
      priority: 5,
      owner: "founder/sales",
      status: "external-required",
      relatedGateIds: ["judge-access-readiness", "business-evidence-readiness"],
      commands: [
        "npm run verify:business-evidence -- --write-template /secure/local/business-evidence-template.json --out /secure/local/business-evidence-readiness.json",
        "npm run verify:business-evidence -- --evidence /secure/local/business-evidence.json --out /secure/local/business-evidence-readiness.json --strict",
        "GET /api/pilots/consent-packet",
        "GET /api/pilots/conversion-kit",
        "GET /api/evidence/vault?view=intake",
        "GET /api/xprize/submission-binder"
      ],
      evidenceNeeded: [
        "active pilot install or signed consent packet",
        "invoice/payment, MRR, CAC, cost, and active-user evidence",
        "private business-evidence readiness packet with redacted checksummed artifacts",
        "judge access, testing instructions, demo video clearance, and consented testimonials"
      ],
      stopConditions: [
        "Do not count mock pilots, related-party usage, unpaid interest, or internal demos as paid customer traction without explicit disclosure.",
        "Do not expose customer security findings, invoices, or testimonials publicly without consent."
      ]
    }
  ];
  const phasesWithProgress = phases.map((phase) => ({
    ...phase,
    currentPhaseRemainingPercent: remainingPercentFromCounts(countCheckpoints(buildPhaseCheckpoints(phase, gatesById)))
  }));
  const nextPhase = phasesWithProgress.find((phase) => phase.status !== "passed") ?? phasesWithProgress.at(-1);
  const recommendedNextCodeControllableAction = buildRecommendedNextCodeControllableAction(phasesWithProgress);

  return {
    objective:
      "Convert local readiness into private XPRIZE submission evidence through stop-gated human review, Cloud Run deployment, hosted proof, and business traction capture.",
    confidenceBoundary:
      "This phase plan improves evidence readiness only. It is not a win-probability estimate, legal opinion, audit assurance, certification, or judging guarantee.",
    sourceGateStatus: sourceGate?.status ?? "unknown",
    recommendedNextPhaseId: nextPhase?.id ?? "",
    recommendedNextCodeControllablePhaseId: recommendedNextCodeControllableAction.phaseId,
    recommendedNextCodeControllableAction,
    phases: phasesWithProgress
  };
}

function buildRecommendedNextCodeControllableAction(phases) {
  const phase = phases.find((candidate) => (candidate.bucket ?? bucketForPhase(candidate)) === "code-controllable" && candidate.status !== "passed");

  if (!phase) {
    return {
      phaseId: "",
      label: "No open code-controllable readiness slice",
      bucket: "code-controllable",
      owner: "engineering",
      priority: 0,
      status: "not-needed",
      action:
        "No local engineering readiness slice is open in this report. Continue with external proof collection, human review, or private evidence capture.",
      commands: [],
      privateArtifactPaths: [],
      stopCondition: "Do not invent code work when the remaining proof gap is external or human-owned.",
      proofBoundary: proofBoundaryForBucket("code-controllable")
    };
  }

  return {
    phaseId: phase.id,
    label: phase.label,
    bucket: phase.bucket ?? bucketForPhase(phase),
    owner: phase.owner,
    priority: phase.priority,
    status: phase.status,
    action: codeControllableActionForPhase(phase),
    commands: phase.commands,
    privateArtifactPaths: privateArtifactPathsForPhase(phase.id),
    stopCondition: phase.stopConditions[0] ?? "Stop until the selected code-controllable gate has command evidence.",
    proofBoundary: proofBoundaryForBucket("code-controllable")
  };
}

function codeControllableActionForPhase(phase) {
  if (phase.id === "cloudrun-render-dry-run") {
    const state = readCloudRunRenderArtifactState();
    const firstRenderValueBlocker = state.auditJsonExists
      ? cloudRunRenderValueBlockers(state).find((blocker) => isActionableCloudRunProgressBlocker(blocker))
      : "";

    if (firstRenderValueBlocker) {
      return firstRenderValueBlocker;
    }

    return "Prepare and verify the Cloud Run render handoff to generate the release-prefilled private Cloud Run render-values file and verified owner packet, fill the remaining non-secret production values privately, run the render-values audit, verify the render-evidence owner packet, render the ignored manifest, produce and verify the dry-run preflight packet, and review its operator handoff. Stop before gcloud dry-run/deploy until private production values and owner approvals exist.";
  }

  return `Advance ${phase.label} with local code or generated private handoff artifacts only; stop before claiming hosted, revenue, user, legal, or human-attestation proof.`;
}

function runGate(definition) {
  const child = runChild(definition.script);

  if (!child.report) {
    return {
      id: definition.id,
      label: definition.label,
      command: definition.command,
      priority: definition.priority,
      rawStatus: "unreadable",
      status: "blocked",
      externalRequired: false,
      evidence: child.stderr || child.stdout || "Verifier did not emit parseable JSON.",
      blockers: ["Verifier output could not be parsed."],
      nextActions: [`Run ${definition.command} directly and fix the emitted error before relying on this aggregate report.`],
      childExitCode: child.exitCode
    };
  }

  return {
    id: definition.id,
    label: definition.label,
    command: definition.command,
    priority: definition.priority,
    ...definition.summarize(child.report),
    childExitCode: child.exitCode
  };
}

function runChild(script) {
  try {
    const stdout = execFileSync(process.execPath, [script], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    return {
      stdout,
      stderr: "",
      exitCode: 0,
      report: parseJson(stdout)
    };
  } catch (error) {
    const stdout = toText(error?.stdout);
    const stderr = toText(error?.stderr);

    return {
      stdout,
      stderr,
      exitCode: typeof error?.status === "number" ? error.status : 1,
      report: parseJson(stdout)
    };
  }
}

function summarizeSourceRelease(report) {
  const status = report.overallStatus === "published" ? "passed" : report.overallStatus === "ready-to-commit" ? "warning" : "blocked";
  const blockers = report.checks?.filter((check) => check.status === "blocked").map((check) => `${check.id}: ${check.fix}`) ?? [];

  return {
    rawStatus: report.overallStatus ?? "unknown",
    status,
    externalRequired: false,
    evidence: `${report.commitCount ?? 0} commit(s), ${report.trackedFileCount ?? 0} tracked file(s), ${report.untrackedFileCount ?? 0} untracked path(s), ${report.unpublishedChangeCount ?? report.modifiedFileCount ?? 0} unpublished tracked change(s), ${report.secretFindings?.length ?? 0} secret finding(s), ${report.claimFindings?.length ?? 0} unsafe claim finding(s).`,
    blockers,
    nextActions:
      status === "passed"
        ? ["Keep the repository clean and pushed before final submission."]
        : report.nextActions ?? ["Resolve source-release guard findings."]
  };
}

function summarizeProjectProvenance(report) {
  const status = normalizeStatus(report.overallStatus);
  const blockers = report.checks?.filter((check) => check.status === "blocked").map((check) => `${check.id}: ${check.evidence}`) ?? [];
  const firstCommitAt = report.git?.firstCommitAt ?? "missing";

  return {
    rawStatus: report.overallStatus ?? "unknown",
    status,
    externalRequired: status !== "passed",
    evidence: `Repository ${report.repositoryUrl || "missing"}; first commit ${firstCommitAt}; project-created-after-start attestation ${report.projectCreatedAfterStartConfirmed ? "true" : "false"}.`,
    blockers,
    nextActions:
      report.nextActions?.length > 0
        ? report.nextActions
        : ["Human-review project provenance and pre-existing work disclosure before final submission."]
  };
}

function summarizeLicenseManifest(report) {
  const status = normalizeStatus(report.overallStatus);
  const summary = report.summary ?? {};
  const blockers = report.blockers ?? [];

  return {
    rawStatus: report.overallStatus ?? "unknown",
    status,
    externalRequired: status !== "passed",
    evidence: `${summary.totalPackages ?? 0} package(s), ${summary.restrictedLicenseReviewCount ?? 0} restricted-review package(s), ${summary.unknownLicenseCount ?? 0} unknown-license package(s), ${summary.obligationReviewCount ?? 0} obligation-review package(s), ${summary.integrationsNeedingReview ?? 0} Google integration(s) needing review.`,
    blockers,
    nextActions:
      report.nextActions?.length > 0
        ? report.nextActions
        : ["Review dependency licenses, Google API terms, demo assets, screenshots, and IP ownership before setting approval flags."]
  };
}

function summarizeGeminiModelReadiness(report) {
  const status = normalizeStatus(report.overallStatus);

  return {
    rawStatus: report.overallStatus ?? "unknown",
    status,
    externalRequired: false,
    evidence: `SDK ${report.sdkPackage ?? "missing"}; model ${report.selectedModel ?? "missing"}; allowlist ${(report.allowlistModels ?? []).join(", ") || "missing"}; official review ${report.officialSourceReview?.reviewedAt ?? "missing"}.`,
    blockers: report.blockers ?? [],
    nextActions:
      report.nextActions?.length > 0
        ? report.nextActions
        : ["Review current Gemini model/library/deprecation docs and rerun this verifier before final submission."]
  };
}

function summarizeCloudRunDeployment(report) {
  const rawStatus = report.overallStatus ?? "unknown";
  const status = rawStatus === "blocked" ? "blocked" : rawStatus === "ready-to-dry-run" ? "warning" : "warning";
  const replacements = report.replacementFindings?.length ?? 0;
  const secretRefs = report.secretRefs?.length ?? 0;

  return {
    rawStatus,
    status,
    externalRequired: true,
    evidence: `${replacements} deployment placeholder(s) or replacement finding(s), ${secretRefs} Secret Manager reference(s), ${report.manualReviewFlags?.length ?? 0} manual-review flag(s).`,
    blockers: report.blockers ?? [],
    nextActions:
      rawStatus === "ready-to-dry-run"
        ? ["Run Cloud Run dry-run/deploy/describe in the real Google Cloud project, then collect hosted proof."]
        : report.nextActions ?? ["Render production values into an ignored manifest, keep secrets in Secret Manager, and rerun deployment verification."]
  };
}

function summarizeJudgeAccess(report) {
  const status = normalizeStatus(report.overallStatus);
  const blockers = report.blockers ?? [];
  const missingChecks = report.accessChecks?.filter((check) => check.status === "missing" || check.status === "blocked").length ?? 0;

  return {
    rawStatus: report.overallStatus ?? "unknown",
    status,
    externalRequired: true,
    evidence: `Product URL ${report.productUrl ?? "missing"}; repository ${report.repositoryUrl ?? "missing"}; demo ${report.demoVideoUrl ?? "missing"}; ${missingChecks} missing or blocked access check(s).`,
    blockers,
    nextActions:
      report.nextActions?.length > 0
        ? report.nextActions
        : ["Run hosted judge-access smoke checks, store private proof, and keep credentials outside source."]
  };
}

function summarizeBusinessEvidence(report) {
  const status = normalizeStatus(report.overallStatus);
  const blockers = report.blockers ?? [];
  const summary = report.summary ?? {};

  return {
    rawStatus: report.overallStatus ?? "unknown",
    status,
    externalRequired: true,
    evidence: `Revenue $${summary.totalRevenueUsd ?? 0}; active users ${summary.activeUsers ?? 0}; paid pilots ${summary.paidPilotCount ?? 0}; artifact buckets ready ${summary.artifactBucketsReady ?? 0}.`,
    blockers,
    nextActions:
      report.nextActions?.length > 0
        ? report.nextActions
        : ["Collect redacted invoices, payment proof, active-user logs, cost/CAC proof, related-party review, and testimonial consent."]
  };
}

function normalizeStatus(status) {
  if (status === "passed" || status === "published" || status === "ready") {
    return "passed";
  }

  if (
    status === "warning" ||
    status === "needs-review" ||
    status === "ready-to-commit" ||
    status === "template-needs-values" ||
    status === "ready-to-dry-run"
  ) {
    return "warning";
  }

  return "blocked";
}

function parseJson(output) {
  const trimmed = output.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function toText(value) {
  if (!value) {
    return "";
  }

  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
}

function writeJson(path, value, label = "Local submission JSON output file") {
  const absolutePath = resolve(path);
  const parentDirectory = dirname(absolutePath);
  assertDirectoryPathSafe(parentDirectory, `${label} parent directory`);
  mkdirSync(parentDirectory, { recursive: true });
  assertDirectoryExistsSafe(parentDirectory, `${label} parent directory`);
  writeTextFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, label);
}

function writeMarkdown(path, value, label = "Local submission Markdown output file") {
  const absolutePath = resolve(path);
  const parentDirectory = dirname(absolutePath);
  assertDirectoryPathSafe(parentDirectory, `${label} parent directory`);
  mkdirSync(parentDirectory, { recursive: true });
  assertDirectoryExistsSafe(parentDirectory, `${label} parent directory`);
  writeTextFile(absolutePath, value, label);
  return absolutePath;
}

function writeManualInterventionPackets(path, report) {
  const absoluteDir = resolve(path);
  assertDirectoryPathSafe(absoluteDir, "Manual intervention packet output directory");
  mkdirSync(absoluteDir, { recursive: true });
  assertDirectoryExistsSafe(absoluteDir, "Manual intervention packet output directory");
  const packetFiles = report.manualInterventionPlan.ownerPackets.map((packet) => {
    const fileName = `${slugForOwner(packet.owner)}.md`;
    const filePath = join(absoluteDir, fileName);
    const markdown = renderOwnerPacketMarkdown(packet, report);
    writeTextFile(filePath, markdown, "Manual intervention owner packet");

    return {
      owner: packet.owner,
      path: filePath,
      relativePath: relative(absoluteDir, filePath),
      actionCount: packet.openActionCount,
      sha256: sha256Hex(markdown),
      bytes: Buffer.byteLength(markdown, "utf8")
    };
  });
  const indexPath = join(absoluteDir, "manual-intervention-index.md");
  const indexMarkdown = renderManualInterventionIndexMarkdown(report, packetFiles);
  writeTextFile(indexPath, indexMarkdown, "Manual intervention index packet");
  const indexFile = {
    owner: "index",
    path: indexPath,
    relativePath: relative(absoluteDir, indexPath),
    actionCount: report.manualInterventionPlan.summary.total,
    sha256: sha256Hex(indexMarkdown),
    bytes: Buffer.byteLength(indexMarkdown, "utf8")
  };
  const manifest = buildManualInterventionManifest({ report, indexFile, packetFiles });
  const manifestPath = join(absoluteDir, "manual-intervention-manifest.json");
  writeTextFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "Manual intervention manifest");

  return {
    indexPath,
    manifestPath,
    digestAlgorithm: "sha256",
    packetFileCount: packetFiles.length + 1,
    ownerPacketPaths: packetFiles,
    proofBoundary:
      "Generated Markdown packets are private execution aids only. They are not hosted proof, revenue proof, human signoff, legal review, or judging evidence until matching artifacts are collected and reviewed."
  };
}

function writeLocalSubmissionBundle(path, report) {
  const absoluteDir = resolve(path);
  assertDirectoryPathSafe(absoluteDir, "Local submission bundle output directory");
  mkdirSync(absoluteDir, { recursive: true });
  assertDirectoryExistsSafe(absoluteDir, "Local submission bundle output directory");
  const reportPath = join(absoluteDir, "local-submission-readiness.json");
  const markdownSummaryPath = join(absoluteDir, "local-submission-summary.md");
  const manualPacketsDir = join(absoluteDir, "manual-intervention-packets");
  const manifestVerificationPath = join(absoluteDir, "manual-intervention-manifest-verification.json");
  const bundleManifestPath = join(absoluteDir, "local-submission-bundle-manifest.json");
  const packetFiles = writeManualInterventionPackets(manualPacketsDir, report);

  report.manualInterventionPlan.packetFiles = packetFiles;
  writeJson(reportPath, report, "Local submission bundle readiness report");
  writeMarkdown(markdownSummaryPath, renderLocalSubmissionMarkdown(report), "Local submission bundle Markdown summary");

  const manifestVerification = verifyManualInterventionManifest(packetFiles.manifestPath);
  writeJson(manifestVerificationPath, manifestVerification, "Local submission bundle manual manifest verification");

  const files = [
    bundleFileRecord("local-submission-readiness", reportPath, absoluteDir),
    bundleFileRecord("local-submission-summary", markdownSummaryPath, absoluteDir),
    bundleFileRecord("manual-intervention-index", packetFiles.indexPath, absoluteDir),
    ...packetFiles.ownerPacketPaths.map((file) => bundleFileRecord(`manual-packet:${file.owner}`, file.path, absoluteDir)),
    bundleFileRecord("manual-intervention-manifest", packetFiles.manifestPath, absoluteDir),
    bundleFileRecord("manual-intervention-manifest-verification", manifestVerificationPath, absoluteDir)
  ];
  const bundleManifest = {
    generatedAt: report.generatedAt,
    generatedFrom: "verify-local-submission --bundle-dir",
    status: manifestVerification.overallStatus === "verified" ? "ready-for-private-owner-review" : "blocked",
    localSubmissionStatus: report.overallStatus,
    digestAlgorithm: "sha256",
    fileCount: files.length,
    files,
    phaseProgress: {
      overallGoalRemainingPercent: report.phaseProgressChart.overallGoalRemainingPercent,
      recommendedNextPhaseId: report.phasePlan.recommendedNextPhaseId,
      recommendedNextCodeControllablePhaseId: report.phasePlan.recommendedNextCodeControllablePhaseId,
      recommendedNextCodeControllableAction: report.phasePlan.recommendedNextCodeControllableAction,
      rows: report.phaseProgressChart.rows.map((row) => ({
        phaseId: row.phaseId,
        bucket: row.bucket,
        owner: row.owner,
        ratingOutOf5: row.ratingOutOf5,
        currentPhaseRemainingPercent: row.currentPhaseRemainingPercent,
        overallGoalRemainingPercent: row.overallGoalRemainingPercent
      }))
    },
    manualInterventionSummary: report.manualInterventionPlan.summary,
    proofBoundary:
      "This bundle records private local readiness artifacts and packet integrity only. It is not hosted Cloud Run proof, live Gemini proof, Workspace proof, revenue proof, active-user proof, legal/IP review, human attestation, organizer approval, or judging evidence.",
    stopConditions: [
      ...report.stopConditions,
      ...report.manualInterventionPlan.stopConditions,
      "Do not upload raw bundle files publicly unless a human owner redacts private evidence paths and confirms every referenced artifact is share-safe."
    ],
    privateHandling: report.manualInterventionPlan.privateHandling
  };
  writeJson(bundleManifestPath, bundleManifest, "Local submission bundle manifest");

  return {
    directory: absoluteDir,
    status: bundleManifest.status,
    reportPath,
    markdownSummaryPath,
    manualPacketsDir,
    manifestPath: packetFiles.manifestPath,
    manifestVerificationPath,
    bundleManifestPath,
    digestAlgorithm: "sha256",
    fileCount: files.length,
    proofBoundary: bundleManifest.proofBoundary
  };
}

function writeTextFile(path, content, label) {
  const absolutePath = resolve(path);
  const parentDirectory = dirname(absolutePath);
  const tempPath = join(parentDirectory, `.${basename(absolutePath)}.${randomUUID()}.tmp`);
  const parentIdentity = assertWritableTextFilePath(absolutePath, label);

  try {
    writeFileSync(tempPath, content, { encoding: "utf8", flag: "wx" });
    assertSameDirectoryIdentity(parentDirectory, parentIdentity, `${label} parent directory`);
    renameSync(tempPath, absolutePath);
    assertSameDirectoryIdentity(parentDirectory, parentIdentity, `${label} parent directory`);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function assertDirectoryPathSafe(path, label) {
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
      fileStat = lstatSync(directory);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    if (fileStat.isSymbolicLink()) {
      if (isAllowedSystemDirectorySymlink(directory)) {
        continue;
      }

      throw new Error(`${label} ${directory} is a symbolic link; use a regular private directory before local submission packet generation.`);
    }

    if (!fileStat.isDirectory()) {
      throw new Error(`${label} ${directory} is not a directory; use a regular private directory before local submission packet generation.`);
    }
  }
}

function assertDirectoryExistsSafe(path, label) {
  const absolutePath = resolve(path);
  const fileStat = readDirectoryStat(absolutePath, label);

  if (!fileStat.isDirectory()) {
    throw new Error(`${label} ${absolutePath} is not a directory; use a regular private directory before local submission packet generation.`);
  }
}

function assertWritableTextFilePath(path, label) {
  const absolutePath = resolve(path);
  const parentDirectory = dirname(absolutePath);

  assertDirectoryPathSafe(parentDirectory, `${label} parent directory`);
  assertRegularFileIfExists(absolutePath, label);

  return readDirectoryIdentity(parentDirectory, `${label} parent directory`);
}

function assertSameDirectoryIdentity(path, expected, label) {
  const actual = readDirectoryIdentity(path, label);

  if (actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new Error(`${label} ${resolve(path)} changed while writing; regenerate the private local submission packet in a stable private directory.`);
  }
}

function readDirectoryIdentity(path, label) {
  const fileStat = readDirectoryStat(resolve(path), label);

  return {
    dev: fileStat.dev,
    ino: fileStat.ino
  };
}

function readDirectoryStat(path, label) {
  const absolutePath = resolve(path);
  const fileStat = lstatSync(absolutePath);

  if (fileStat.isSymbolicLink()) {
    if (isAllowedSystemDirectorySymlink(absolutePath)) {
      return statSync(absolutePath);
    }

    throw new Error(`${label} ${absolutePath} is a symbolic link; use a regular private directory before local submission packet generation.`);
  }

  return fileStat;
}

function assertRegularFileIfExists(path, label) {
  let fileStat;

  try {
    fileStat = lstatSync(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  if (fileStat.isSymbolicLink()) {
    throw new Error(`${label} ${path} is a symbolic link; regenerate the packet into regular private files before review.`);
  }

  if (!fileStat.isFile()) {
    throw new Error(`${label} ${path} is not a regular file; regenerate the packet into regular private files before review.`);
  }
}

function isAllowedSystemDirectorySymlink(path) {
  if (process.platform !== "darwin") {
    return false;
  }

  const absolutePath = resolve(path);
  const allowedAliases = {
    "/etc": "/private/etc",
    "/tmp": "/private/tmp",
    "/var": "/private/var"
  };
  const expectedTarget = allowedAliases[absolutePath];

  if (!expectedTarget) {
    return false;
  }

  const target = readlinkSync(absolutePath);
  return resolve(dirname(absolutePath), target) === expectedTarget;
}

function bundleFileRecord(id, path, baseDir) {
  const content = readFileSync(path, "utf8");
  const stat = statSync(path);

  return {
    id,
    path,
    relativePath: baseDir ? relative(baseDir, path) : undefined,
    sha256: sha256Hex(content),
    bytes: stat.size
  };
}

function buildManualInterventionManifest({ report, indexFile, packetFiles }) {
  return {
    generatedAt: report.generatedAt,
    generatedFrom: "verify-local-submission",
    status: report.manualInterventionPlan.status,
    digestAlgorithm: "sha256",
    overallGoalRemainingPercent: report.phaseProgressChart.overallGoalRemainingPercent,
    nextOwner: report.manualInterventionPlan.nextOwner,
    proofBoundary:
      "This manifest records private packet integrity only. It is not hosted proof, revenue proof, human signoff, legal review, or judging evidence.",
    summary: report.manualInterventionPlan.summary,
    files: [indexFile, ...packetFiles],
    stopConditions: report.manualInterventionPlan.stopConditions,
    privateHandling: report.manualInterventionPlan.privateHandling
  };
}

function verifyManualInterventionManifest(path) {
  const manifestPath = resolve(path);
  const checks = [];
  let manifest;

  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    checks.push(verificationCheck("manifest-json", "passed", `Manifest parsed from ${manifestPath}.`));
  } catch (error) {
    checks.push(
      verificationCheck(
        "manifest-json",
        "blocked",
        `Manifest could not be parsed from ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  }

  if (manifest) {
    checks.push(
      verificationCheck(
        "digest-algorithm",
        manifest.digestAlgorithm === "sha256" ? "passed" : "blocked",
        `digestAlgorithm=${String(manifest.digestAlgorithm ?? "missing")}.`
      )
    );
    checks.push(
      verificationCheck(
        "proof-boundary",
        String(manifest.proofBoundary ?? "").includes("not hosted proof") &&
          String(manifest.proofBoundary ?? "").includes("not") &&
          String(manifest.proofBoundary ?? "").includes("evidence")
          ? "passed"
          : "blocked",
        "Manifest must state that packet integrity is not hosted/revenue/legal/judging proof."
      )
    );

    const files = Array.isArray(manifest.files) ? manifest.files : [];
    checks.push(
      verificationCheck(
        "file-register",
        files.length >= 2 ? "passed" : "blocked",
        `${files.length} file entry/entries found; expected index plus owner packet entries.`
      )
    );

    for (const [index, file] of files.entries()) {
      checks.push(...verifyManifestFileEntry(file, index, dirname(manifestPath)));
    }
  }

  const blockers = checks.filter((check) => check.status === "blocked");

  return {
    generatedAt: new Date().toISOString(),
    generatedFrom: "verify-local-submission --verify-manifest",
    overallStatus: blockers.length ? "blocked" : "verified",
    manifestPath,
    digestAlgorithm: manifest?.digestAlgorithm ?? "unknown",
    summary: {
      passed: checks.filter((check) => check.status === "passed").length,
      blocked: blockers.length,
      fileCount: Array.isArray(manifest?.files) ? manifest.files.length : 0
    },
    checks,
    blockers: blockers.map((check) => `${check.id}: ${check.evidence}`),
    proofBoundary:
      "This verifies private manual-intervention packet integrity only. It does not prove hosted Cloud Run, live Gemini, Workspace OAuth, revenue, active users, judge access, legal review, or human attestation.",
    stopConditions: [
      "Do not set XPRIZE, hosted, revenue, judge-access, Gemini, Cloud Run, Workspace, or human-attestation flags from this manifest alone.",
      "Regenerate packets and rerun this verifier after any owner packet edit.",
      "Keep packet files and manifest under private or ignored paths."
    ]
  };
}

function verifyLocalSubmissionBundleManifest(path) {
  const manifestPath = resolve(path);
  const manifestDir = dirname(manifestPath);
  const requiredIds = [
    "local-submission-readiness",
    "local-submission-summary",
    "manual-intervention-index",
    "manual-intervention-manifest",
    "manual-intervention-manifest-verification"
  ];
  const checks = [];
  let manifest;

  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    checks.push(verificationCheck("bundle-manifest-json", "passed", `Bundle manifest parsed from ${manifestPath}.`));
  } catch (error) {
    checks.push(
      verificationCheck(
        "bundle-manifest-json",
        "blocked",
        `Bundle manifest could not be parsed from ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  }

  if (manifest) {
    checks.push(
      verificationCheck(
        "bundle-digest-algorithm",
        manifest.digestAlgorithm === "sha256" ? "passed" : "blocked",
        `digestAlgorithm=${String(manifest.digestAlgorithm ?? "missing")}.`
      )
    );
    checks.push(
      verificationCheck(
        "bundle-status",
        manifest.status === "ready-for-private-owner-review" || manifest.status === "blocked" ? "passed" : "blocked",
        `status=${String(manifest.status ?? "missing")}.`
      )
    );
    checks.push(
      verificationCheck(
        "bundle-proof-boundary",
        bundleProofBoundaryIsExplicit(manifest.proofBoundary) ? "passed" : "blocked",
        "Bundle manifest must state that local artifacts are not hosted Cloud Run, live Gemini, Workspace, revenue, human-attestation, organizer, or judging proof."
      )
    );
    checks.push(
      verificationCheck(
        "bundle-stop-conditions",
        Array.isArray(manifest.stopConditions) &&
          manifest.stopConditions.join(" ").includes("Do not set XPRIZE") &&
          manifest.stopConditions.join(" ").includes("Do not upload raw bundle files publicly")
          ? "passed"
          : "blocked",
        "Bundle stop conditions must block proof-flag changes and public raw-bundle sharing."
      )
    );
    checks.push(
      verificationCheck(
        "bundle-private-handling",
        Array.isArray(manifest.privateHandling) && manifest.privateHandling.join(" ").includes("/secure/local") ? "passed" : "blocked",
        "Bundle private-handling guidance must keep generated artifacts under private or ignored paths."
      )
    );

    const files = Array.isArray(manifest.files) ? manifest.files : [];
    const fileIds = files.map((file) => String(file?.id ?? ""));
    checks.push(
      verificationCheck(
        "bundle-file-register",
        files.length >= requiredIds.length && manifest.fileCount === files.length ? "passed" : "blocked",
        `${files.length} file entry/entries found; manifest fileCount=${String(manifest.fileCount ?? "missing")}; expected at least ${requiredIds.length}.`
      )
    );

    for (const requiredId of requiredIds) {
      checks.push(
        verificationCheck(
          `bundle-required-${requiredId}`,
          fileIds.includes(requiredId) ? "passed" : "blocked",
          fileIds.includes(requiredId) ? `${requiredId} is present.` : `${requiredId} is missing from bundle manifest.`
        )
      );
    }

    for (const [index, file] of files.entries()) {
      checks.push(...verifyBundleFileEntry(file, index, manifestDir));
    }

    const readinessEntry = files.find((file) => file?.id === "local-submission-readiness");
    const readiness = readBundleJsonEntry(readinessEntry, manifestDir);
    checks.push(
      verificationCheck(
        "bundle-readiness-json",
        readiness.ok ? "passed" : "blocked",
        readiness.ok ? "Readiness JSON parsed from bundle." : readiness.error
      )
    );

    if (readiness.value) {
      checks.push(
        verificationCheck(
          "bundle-readiness-status-match",
          readiness.value.overallStatus === manifest.localSubmissionStatus ? "passed" : "blocked",
          `readiness overallStatus=${String(readiness.value.overallStatus ?? "missing")}; bundle localSubmissionStatus=${String(manifest.localSubmissionStatus ?? "missing")}.`
        )
      );
      checks.push(
        verificationCheck(
          "bundle-readiness-proof-boundary",
          Array.isArray(readiness.value.stopConditions) &&
            readiness.value.stopConditions.join(" ").includes("does not deploy Cloud Run") &&
            readiness.value.stopConditions.join(" ").includes("does not prove live Gemini API usage") &&
            String(readiness.value.disclaimer ?? "").includes("not legal advice")
            ? "passed"
            : "blocked",
          "Readiness report must preserve local-only, no-legal-advice, no-hosted-proof boundaries."
        )
      );
    }

    const manualManifestEntry = files.find((file) => file?.id === "manual-intervention-manifest");
    const manualManifestPath = resolveBundleEntryPath(manualManifestEntry, manifestDir).path;
    const manualManifestVerification = manualManifestPath ? verifyManualInterventionManifest(manualManifestPath) : undefined;
    checks.push(
      verificationCheck(
        "bundle-manual-manifest-verifies",
        manualManifestVerification?.overallStatus === "verified" ? "passed" : "blocked",
        manualManifestVerification
          ? `manual-intervention manifest status=${manualManifestVerification.overallStatus}.`
          : "manual-intervention manifest path is missing."
      )
    );

    const storedManualVerificationEntry = files.find((file) => file?.id === "manual-intervention-manifest-verification");
    const storedManualVerification = readBundleJsonEntry(storedManualVerificationEntry, manifestDir);
    checks.push(
      verificationCheck(
        "bundle-stored-manual-verification-json",
        storedManualVerification.ok ? "passed" : "blocked",
        storedManualVerification.ok ? "Stored manual-intervention verification JSON parsed from bundle." : storedManualVerification.error
      )
    );

    if (storedManualVerification.value) {
      checks.push(
        verificationCheck(
          "bundle-stored-manual-verification-status",
          storedManualVerification.value.overallStatus === "verified" ? "passed" : "blocked",
          `stored manual-intervention verification status=${String(storedManualVerification.value.overallStatus ?? "missing")}.`
        )
      );
    }
  }

  const blockers = checks.filter((check) => check.status === "blocked");

  return {
    generatedAt: new Date().toISOString(),
    generatedFrom: "verify-local-submission --verify-bundle",
    overallStatus: blockers.length ? "blocked" : "verified",
    manifestPath,
    digestAlgorithm: manifest?.digestAlgorithm ?? "unknown",
    summary: {
      passed: checks.filter((check) => check.status === "passed").length,
      blocked: blockers.length,
      fileCount: Array.isArray(manifest?.files) ? manifest.files.length : 0
    },
    checks,
    blockers: blockers.map((check) => `${check.id}: ${check.evidence}`),
    proofBoundary:
      "This verifies private local-submission bundle integrity only. It does not prove hosted Cloud Run, live Gemini, Workspace OAuth, revenue, active users, judge access, legal/IP review, organizer approval, or human attestation.",
    stopConditions: [
      "Do not set XPRIZE, hosted, revenue, judge-access, Gemini, Cloud Run, Workspace, or human-attestation flags from this bundle alone.",
      "Regenerate the local-submission bundle and rerun this verifier after any owner packet, summary, readiness, or manifest edit.",
      "Keep bundle files private or ignored until a human owner completes redaction review."
    ]
  };
}

function bundleProofBoundaryIsExplicit(value) {
  const text = String(value ?? "");

  return (
    text.includes("not hosted Cloud Run proof") &&
    text.includes("live Gemini proof") &&
    text.includes("Workspace proof") &&
    text.includes("revenue proof") &&
    text.includes("human attestation") &&
    text.includes("organizer approval") &&
    text.includes("judging evidence")
  );
}

function verifyBundleFileEntry(file, index, bundleDir) {
  const idPrefix = `bundle-file-${index + 1}`;
  const checks = [];
  const id = typeof file?.id === "string" ? file.id : "";
  const expectedSha256 = typeof file?.sha256 === "string" ? file.sha256 : "";
  const expectedBytes = Number(file?.bytes ?? 0);
  const resolved = resolveBundleEntryPath(file, bundleDir);

  checks.push(
    verificationCheck(
      `${idPrefix}-metadata`,
      id && resolved.path && /^[a-f0-9]{64}$/u.test(expectedSha256) && Number.isInteger(expectedBytes) && expectedBytes > 0
        ? "passed"
        : "blocked",
      `id=${id || "missing"}; path=${resolved.evidence}; sha256=${expectedSha256 || "missing"}; bytes=${expectedBytes || "missing"}.`
    )
  );

  if (resolved.status === "blocked") {
    checks.push(verificationCheck(`${idPrefix}-path-boundary`, "blocked", resolved.evidence));
    return checks;
  }

  let content = "";
  let stat;

  try {
    const fileBoundary = verifyPacketFileBoundary(resolved.path, bundleDir, "bundle file");
    if (fileBoundary.status === "blocked") {
      checks.push(verificationCheck(`${idPrefix}-realpath-boundary`, "blocked", fileBoundary.evidence));
      return checks;
    }

    content = readFileSync(resolved.path, "utf8");
    stat = fileBoundary.stat ?? statSync(resolved.path);
    checks.push(verificationCheck(`${idPrefix}-exists`, "passed", `${resolved.path} is readable.`));
  } catch (error) {
    checks.push(
      verificationCheck(`${idPrefix}-exists`, "blocked", `${resolved.path} is not readable: ${error instanceof Error ? error.message : String(error)}.`)
    );
    return checks;
  }

  const actualSha256 = sha256Hex(content);
  checks.push(
    verificationCheck(
      `${idPrefix}-sha256`,
      actualSha256 === expectedSha256 ? "passed" : "blocked",
      `id=${id}; expected=${expectedSha256}; actual=${actualSha256}.`
    )
  );
  checks.push(
    verificationCheck(
      `${idPrefix}-bytes`,
      stat.size === expectedBytes ? "passed" : "blocked",
      `id=${id}; expected=${expectedBytes}; actual=${stat.size}.`
    )
  );
  checks.push(
    verificationCheck(
      `${idPrefix}-secret-shape`,
      prohibitedPacketContentPatterns.some((pattern) => pattern.test(content)) ? "blocked" : "passed",
      `${resolved.path} ${prohibitedPacketContentPatterns.some((pattern) => pattern.test(content)) ? "contains" : "does not contain"} obvious secret-shaped bundle text.`
    )
  );

  return checks;
}

function readBundleJsonEntry(file, bundleDir) {
  const resolved = resolveBundleEntryPath(file, bundleDir);

  if (!resolved.path || resolved.status === "blocked") {
    return { ok: false, error: resolved.evidence };
  }

  try {
    const fileBoundary = verifyPacketFileBoundary(resolved.path, bundleDir, "bundle JSON entry");
    if (fileBoundary.status === "blocked") {
      return { ok: false, error: fileBoundary.evidence };
    }

    return { ok: true, value: JSON.parse(readFileSync(resolved.path, "utf8")) };
  } catch (error) {
    return {
      ok: false,
      error: `${resolved.path} could not be parsed as JSON: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function resolveBundleEntryPath(file, bundleDir) {
  const relativePath = typeof file?.relativePath === "string" ? file.relativePath : "";

  if (relativePath) {
    const candidate = resolve(bundleDir, relativePath);

    if (!pathIsInside(bundleDir, candidate)) {
      return {
        status: "blocked",
        path: candidate,
        evidence: `relativePath=${relativePath} escapes bundle directory ${bundleDir}.`
      };
    }

    return {
      status: "passed",
      path: candidate,
      evidence: `relativePath=${relativePath}`
    };
  }

  const rawPath = typeof file?.path === "string" ? file.path : "";

  if (!rawPath) {
    return { status: "blocked", path: "", evidence: "missing path and relativePath" };
  }

  const candidate = isAbsolute(rawPath) ? rawPath : resolve(bundleDir, rawPath);

  if (!pathIsInside(bundleDir, candidate)) {
    return {
      status: "blocked",
      path: candidate,
      evidence: `path=${rawPath} escapes bundle directory ${bundleDir}.`
    };
  }

  return {
    status: "passed",
    path: candidate,
    evidence: rawPath
  };
}

function pathIsInside(baseDir, candidate) {
  const relativePath = relative(baseDir, candidate);

  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function verifyManifestFileEntry(file, index, manifestDir = "") {
  const idPrefix = `file-${index + 1}`;
  const checks = [];
  const rawPath = typeof file?.path === "string" ? file.path : "";
  const relativePath = typeof file?.relativePath === "string" ? file.relativePath : "";
  const path = relativePath && manifestDir ? resolve(manifestDir, relativePath) : rawPath
    ? isAbsolute(rawPath)
      ? rawPath
      : resolve(manifestDir, rawPath)
    : "";
  const expectedSha256 = typeof file?.sha256 === "string" ? file.sha256 : "";
  const expectedBytes = Number(file?.bytes ?? 0);

  checks.push(
    verificationCheck(
      `${idPrefix}-metadata`,
      path && /^[a-f0-9]{64}$/u.test(expectedSha256) && Number.isInteger(expectedBytes) && expectedBytes > 0 ? "passed" : "blocked",
      `owner=${String(file?.owner ?? "missing")}; path=${path || "missing"}; sha256=${expectedSha256 || "missing"}; bytes=${expectedBytes || "missing"}.`
    )
  );

  if (!path) {
    return checks;
  }

  if (relativePath && manifestDir && !pathIsInside(manifestDir, path)) {
    checks.push(verificationCheck(`${idPrefix}-path-boundary`, "blocked", `relativePath=${relativePath} escapes manifest directory ${manifestDir}.`));
    return checks;
  }

  if (manifestDir && !relativePath && !pathIsInside(manifestDir, path)) {
    checks.push(verificationCheck(`${idPrefix}-path-boundary`, "blocked", `path=${rawPath} escapes manifest directory ${manifestDir}.`));
    return checks;
  }

  if (relativePath && rawPath) {
    const rawResolved = isAbsolute(rawPath) ? rawPath : resolve(manifestDir, rawPath);
    checks.push(
      verificationCheck(
        `${idPrefix}-path-consistency`,
        rawResolved === path ? "passed" : "blocked",
        `path=${rawPath}; relativePath=${relativePath}.`
      )
    );

    if (rawResolved !== path) {
      return checks;
    }
  }

  let content = "";
  let stat;

  try {
    const fileBoundary = verifyPacketFileBoundary(path, manifestDir, "manual-intervention file");
    if (fileBoundary.status === "blocked") {
      checks.push(verificationCheck(`${idPrefix}-realpath-boundary`, "blocked", fileBoundary.evidence));
      return checks;
    }

    content = readFileSync(path, "utf8");
    stat = fileBoundary.stat ?? statSync(path);
    checks.push(verificationCheck(`${idPrefix}-exists`, "passed", `${path} is readable.`));
  } catch (error) {
    checks.push(
      verificationCheck(`${idPrefix}-exists`, "blocked", `${path} is not readable: ${error instanceof Error ? error.message : String(error)}.`)
    );
    return checks;
  }

  const actualSha256 = sha256Hex(content);
  checks.push(
    verificationCheck(
      `${idPrefix}-sha256`,
      actualSha256 === expectedSha256 ? "passed" : "blocked",
      `expected=${expectedSha256}; actual=${actualSha256}.`
    )
  );
  checks.push(
    verificationCheck(
      `${idPrefix}-bytes`,
      stat.size === expectedBytes ? "passed" : "blocked",
      `expected=${expectedBytes}; actual=${stat.size}.`
    )
  );
  checks.push(
    verificationCheck(
      `${idPrefix}-secret-shape`,
      prohibitedPacketContentPatterns.some((pattern) => pattern.test(content)) ? "blocked" : "passed",
      `${path} ${prohibitedPacketContentPatterns.some((pattern) => pattern.test(content)) ? "contains" : "does not contain"} obvious secret-shaped packet text.`
    )
  );

  return checks;
}

function verifyPacketFileBoundary(path, baseDir, label) {
  try {
    const linkStat = lstatSync(path);
    if (linkStat.isSymbolicLink()) {
      return {
        status: "blocked",
        evidence: `${label} ${path} is a symbolic link; regenerate the private packet and keep every referenced file as a regular file inside ${baseDir}.`
      };
    }

    if (!linkStat.isFile()) {
      return {
        status: "blocked",
        evidence: `${label} ${path} is not a regular file.`
      };
    }

    const realBaseDir = realpathSync(baseDir);
    const realPath = realpathSync(path);

    if (!pathIsInside(realBaseDir, realPath)) {
      return {
        status: "blocked",
        evidence: `${label} real path ${realPath} escapes ${realBaseDir}.`
      };
    }

    return {
      status: "passed",
      evidence: `${label} ${realPath} is a regular file inside ${realBaseDir}.`,
      stat: linkStat
    };
  } catch (error) {
    return {
      status: "blocked",
      evidence: `${label} ${path} is not readable for boundary verification: ${error instanceof Error ? error.message : String(error)}.`
    };
  }
}

function verificationCheck(id, status, evidence) {
  return { id, status, evidence };
}

function renderManualInterventionIndexMarkdown(report, packetFiles) {
  const rows = report.manualInterventionPlan.ownerPackets.map((packet) => {
    const packetFile = packetFiles.find((file) => file.owner === packet.owner);

    return [
      packet.owner,
      String(packet.highestPriority),
      String(packet.openActionCount),
      Object.entries(packet.buckets)
        .map(([bucket, count]) => `${bucket}: ${count}`)
        .join(", "),
      packetFile ? packetFile.path : "missing",
      packet.nextAction
    ];
  });

  return [
    "# Manual Intervention Plan",
    "",
    report.manualInterventionPlan.confidenceBoundary,
    "",
    `Status: ${report.manualInterventionPlan.status}`,
    `Generated from: ${report.manualInterventionPlan.generatedFrom}`,
    `Overall remaining: ${report.phaseProgressChart.overallGoalRemainingPercent}%`,
    `Next owner: ${report.manualInterventionPlan.nextOwner}`,
    "",
    markdownTable(["Owner", "Priority", "Open actions", "Buckets", "Private packet", "Next action"], rows),
    "",
    "## Stop Conditions",
    "",
    markdownList(report.manualInterventionPlan.stopConditions),
    "",
    "## Private Handling",
    "",
    markdownList(report.manualInterventionPlan.privateHandling),
    "",
    "## Proof Boundary",
    "",
    "These packets are step-by-step instructions only. Do not set XPRIZE, hosted, revenue, user, judge-access, Cloud Run, Workspace, Gemini, or human-attestation flags from this Markdown alone.",
    ""
  ].join("\n");
}

function renderOwnerPacketMarkdown(packet, report) {
  return [
    `# Manual Intervention Packet: ${packet.owner}`,
    "",
    report.manualInterventionPlan.confidenceBoundary,
    "",
    `Open actions: ${packet.openActionCount}`,
    `Highest priority: ${packet.highestPriority}`,
    `Next action: ${packet.nextAction}`,
    "",
    "## Private Artifact Paths",
    "",
    markdownList(packet.privateArtifactPaths),
    "",
    "## Step-by-step Actions",
    "",
    ...packet.rows.flatMap((row, index) => [
      `### ${index + 1}. ${row.phaseLabel}`,
      "",
      `- Bucket: ${row.bucket}`,
      `- Priority: ${row.priority}/5`,
      `- Status: ${row.status}`,
      `- Current phase remaining: ${row.currentPhaseRemainingPercent}%`,
      `- Overall remaining: ${row.overallGoalRemainingPercent}%`,
      `- Action: ${row.action}`,
      `- Evidence needed: ${row.evidenceNeeded}`,
      `- Proof boundary: ${row.proofBoundary}`,
      `- Stop condition: ${row.stopCondition}`,
      ...(row.checklist?.length
        ? [
            "",
            "Checklist:",
            "",
            markdownList(row.checklist)
          ]
        : []),
      ...(row.actionDetails?.length
        ? [
            "",
            "Action details:",
            "",
            markdownTable(
              ["Key", "Status", "Source", "Owner", "Fix", "Private proof to keep"],
              row.actionDetails.map((detail) => [
                detail.key,
                detail.status,
                detail.source,
                detail.owner,
                detail.fix,
                detail.acceptedProof
              ])
            )
          ]
        : []),
      "",
      "Commands:",
      "",
      markdownList(row.commands.map((command) => `\`${command}\``)),
      "",
      "Private artifacts:",
      "",
      markdownList(row.privateArtifactPaths),
      ""
    ]),
    "## Owner Checklist",
    "",
    markdownList([
      "Collect the private evidence listed above before changing any attestation or proof flag.",
      "Keep secrets, credentials, invoices, customer findings, and raw Workspace content out of Git.",
      "Rerun `npm run verify:local-submission` after completing the owner actions.",
      "Share only redacted summaries, checksums, and public-safe copy in the judge packet."
    ]),
    ""
  ].join("\n");
}

function renderLocalSubmissionMarkdown(report) {
  const nextCodeAction = report.phasePlan.recommendedNextCodeControllableAction;
  const gateRows = report.gates.map((gate) => [
    gate.label,
    gate.status,
    gate.externalRequired ? "yes" : "no",
    `${gate.priority}/5`,
    gate.evidence,
    gate.blockers[0] ?? gate.nextActions[0] ?? "No local blocker."
  ]);
  const phaseRows = report.phaseProgressChart.rows.map((row) => [
    row.label,
    row.bucket,
    row.owner,
    `${row.ratingOutOf5}/5`,
    `${row.currentPhaseRemainingPercent}%`,
    `${row.overallGoalRemainingPercent}%`,
    row.done.length ? row.done.join("<br>") : "None",
    row.pending.length ? row.pending.join("<br>") : "None",
    row.stopConditions[0] ?? "Stop until evidence exists."
  ]);
  const ownerRows = report.manualInterventionPlan.ownerPackets.map((packet) => [
    packet.owner,
    `${packet.highestPriority}/5`,
    String(packet.openActionCount),
    Object.entries(packet.buckets)
      .map(([bucket, count]) => `${bucket}: ${count}`)
      .join(", "),
    packet.nextAction,
    packet.privateArtifactPaths.join("<br>")
  ]);

  return [
    "# Local Submission Readiness Summary",
    "",
    `Generated: ${report.generatedAt}`,
    `Overall status: ${report.overallStatus}`,
    `Overall goal remaining: ${report.phaseProgressChart.overallGoalRemainingPercent}%`,
    "",
    "## Proof Boundary",
    "",
    report.disclaimer,
    "",
    report.phasePlan.confidenceBoundary,
    "",
    "This summary is a private execution aid only. It does not prove hosted Cloud Run, live Gemini API usage, Workspace OAuth, revenue, active users, judge access, legal review, or human attestation. Do not use it to set proof flags without matching private artifacts.",
    "",
    "## Rule Sources",
    "",
    markdownList(report.sourceUrls),
    "",
    "## Gate Summary",
    "",
    markdownTable(["Gate", "Status", "External", "Priority", "Evidence", "Next blocker/action"], gateRows),
    "",
    "## Phase Progress Chart",
    "",
    markdownTable(["Phase", "Bucket", "Owner", "Rating", "Phase remaining", "Overall remaining", "Done", "Pending", "Stop condition"], phaseRows),
    "",
    "## Next Code-Controllable Action",
    "",
    `Phase: ${nextCodeAction.label || "None"}`,
    `Owner: ${nextCodeAction.owner || "none"}`,
    `Priority: ${nextCodeAction.priority}/5`,
    `Status: ${nextCodeAction.status}`,
    "",
    nextCodeAction.action,
    "",
    "Commands:",
    "",
    markdownList((nextCodeAction.commands ?? []).map((command) => `\`${command}\``)),
    "",
    "Private artifacts:",
    "",
    markdownList(nextCodeAction.privateArtifactPaths ?? []),
    "",
    `Stop condition: ${nextCodeAction.stopCondition}`,
    "",
    `Proof boundary: ${nextCodeAction.proofBoundary}`,
    "",
    "## Manual Intervention Owners",
    "",
    markdownTable(["Owner", "Priority", "Open actions", "Buckets", "Next action", "Private artifacts"], ownerRows),
    "",
    "## Remaining Blockers",
    "",
    markdownList(report.remainingBlockers),
    "",
    "## Required Next Commands",
    "",
    markdownList([
      "`npm run verify:local-submission -- --out /secure/local/local-submission-readiness.json`",
      "`npm run prepare:submission-summary -- /secure/local/local-submission-summary.md`",
      "`npm run prepare:manual-intervention -- /secure/local/manual-intervention-packets`",
      "`npm run verify:manual-intervention -- /secure/local/manual-intervention-packets/manual-intervention-manifest.json --strict`"
    ]),
    "",
    "## Stop Conditions",
    "",
    markdownList([...report.stopConditions, ...report.manualInterventionPlan.stopConditions]),
    "",
    "## Private Handling",
    "",
    markdownList(report.manualInterventionPlan.privateHandling),
    ""
  ].join("\n");
}

function markdownList(values) {
  if (!values || values.length === 0) {
    return "- None";
  }

  return values.map((value) => `- ${value}`).join("\n");
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.map(escapeMarkdownCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeMarkdownCell).join(" | ")} |`)
  ].join("\n");
}

function escapeMarkdownCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", "<br>");
}

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function slugForOwner(owner) {
  return owner.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "owner";
}

try {
  const args = parseArgs(process.argv.slice(2));

  if (args.verifyBundlePath) {
    const verificationReport = verifyLocalSubmissionBundleManifest(args.verifyBundlePath);
    console.log(JSON.stringify(verificationReport, null, 2));

    if (args.strict && verificationReport.overallStatus !== "verified") {
      process.exitCode = 1;
    }
  } else if (args.verifyManifestPath) {
    const verificationReport = verifyManualInterventionManifest(args.verifyManifestPath);
    console.log(JSON.stringify(verificationReport, null, 2));

    if (args.strict && verificationReport.overallStatus !== "verified") {
      process.exitCode = 1;
    }
  } else {
    const report = applyPrivateRoot(buildReport());

    if (args.manualPacketsDir) {
      report.manualInterventionPlan.packetFiles = writeManualInterventionPackets(args.manualPacketsDir, report);
    }

    if (args.markdownOutPath) {
      report.markdownSummaryPath = writeMarkdown(args.markdownOutPath, renderLocalSubmissionMarkdown(report));
    }

    if (args.bundleDir) {
      report.localSubmissionBundle = writeLocalSubmissionBundle(args.bundleDir, report);
    }

    if (args.outPath) {
      writeJson(args.outPath, report);
    }

    console.log(JSON.stringify(report, null, 2));

    if (args.strict && report.overallStatus !== "passed") {
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
