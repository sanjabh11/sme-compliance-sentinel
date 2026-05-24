#!/usr/bin/env node
/* global console, process */

import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const officialRuleSources = ["https://xprize.devpost.com/rules", "https://www.geminixprize.com/rules"];
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
    markdownOutPath: ""
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
          status: phase.bucket === "external-proof" ? "external-required" : "pending",
          action: evidence,
          evidenceNeeded: evidence,
          commands: phase.commands,
          stopCondition: phase.stopConditions[0] ?? "Stop until the required evidence exists.",
          privateArtifactPaths: privateArtifactPathsForPhase(phase.id)
        })
      );

    return [...gateRows, ...evidenceRows];
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
    evidenceNeeded: input.evidenceNeeded,
    commands: input.commands,
    privateArtifactPaths: input.privateArtifactPaths,
    stopCondition: input.stopCondition,
    proofBoundary: proofBoundaryForBucket(input.phase.bucket ?? bucketForPhase(input.phase))
  };
}

function ownerForManualRow(phase, action) {
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
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-evidence-packet.json",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-dry-run-preflight-packet.json"
    ],
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
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-evidence-packet.json",
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-dry-run-packet-verifier.json"
    ],
    "hosted-proof-capture": [
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-deployment-transcript-packet.json",
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
  const evidenceCheckpoints = phase.evidenceNeeded.map((item) => ({
    label: item,
    source: "required-evidence",
    bucket,
    status: phase.status === "passed" ? "done" : bucket === "external-proof" ? "external-required" : "pending",
    blockers: phase.status === "passed" ? [] : [item],
    evidence: item
  }));

  return [...evidenceCheckpoints, ...gateCheckpoints];
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
  const humanReviewPassed = provenanceGate?.status === "passed" && licenseGate?.status === "passed";
  const cloudRunReady = cloudRunGate?.rawStatus === "ready-to-dry-run";

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
      status: cloudRunGate?.status === "blocked" ? "blocked" : cloudRunReady ? "ready-to-dry-run" : "needs-values",
      relatedGateIds: ["cloudrun-deployment-template"],
      commands: [
        "npm run write:cloudrun-release-values -- /secure/local/cloudrun-render-values.json",
        "npm run audit:cloudrun-values -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --release-id $SENTINEL_RELEASE_ID --strict",
        "npm run render:cloudrun-manifest -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --release-id $SENTINEL_RELEASE_ID --strict",
        "npm run prepare:cloudrun-dry-run -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --release-id $SENTINEL_RELEASE_ID --strict",
        "npm run verify:cloudrun-dry-run-packet -- artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-dry-run-preflight-packet.json --strict"
      ],
      evidenceNeeded: [
        "filled private render-values file with no raw secrets",
        "render-values audit JSON/Markdown plus owner-routed render evidence packet",
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
        "npm run collect:cloudrun-deployment -- --release-id $SENTINEL_RELEASE_ID --dry-run-log /secure/local/cloudrun-dry-run.log --deploy-log /secure/local/cloudrun-deploy.log --describe-json /secure/local/cloudrun-describe.json --out-dir artifacts/deployment --strict",
        "npm run verify:production -- --url $NEXT_PUBLIC_PRODUCT_URL --strict --include-write-checks",
        "npm run verify:business-evidence -- --write-template /secure/local/business-evidence-template.json --out /secure/local/business-evidence-readiness.json",
        "npm run verify:judge-access -- --out /secure/local/judge-access-readiness.json --strict",
        "npm run collect:hosted-proof -- --url $NEXT_PUBLIC_PRODUCT_URL --release-id $SENTINEL_RELEASE_ID",
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

  return {
    objective:
      "Convert local readiness into private XPRIZE submission evidence through stop-gated human review, Cloud Run deployment, hosted proof, and business traction capture.",
    confidenceBoundary:
      "This phase plan improves evidence readiness only. It is not a win-probability estimate, legal opinion, audit assurance, certification, or judging guarantee.",
    sourceGateStatus: sourceGate?.status ?? "unknown",
    recommendedNextPhaseId: nextPhase?.id ?? "",
    phases: phasesWithProgress
  };
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

function writeJson(path, value) {
  const absolutePath = resolve(path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeMarkdown(path, value) {
  const absolutePath = resolve(path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, value, "utf8");
  return absolutePath;
}

function writeManualInterventionPackets(path, report) {
  const absoluteDir = resolve(path);
  mkdirSync(absoluteDir, { recursive: true });
  const packetFiles = report.manualInterventionPlan.ownerPackets.map((packet) => {
    const fileName = `${slugForOwner(packet.owner)}.md`;
    const filePath = join(absoluteDir, fileName);
    const markdown = renderOwnerPacketMarkdown(packet, report);
    writeFileSync(filePath, markdown, "utf8");

    return {
      owner: packet.owner,
      path: filePath,
      actionCount: packet.openActionCount,
      sha256: sha256Hex(markdown),
      bytes: Buffer.byteLength(markdown, "utf8")
    };
  });
  const indexPath = join(absoluteDir, "manual-intervention-index.md");
  const indexMarkdown = renderManualInterventionIndexMarkdown(report, packetFiles);
  writeFileSync(indexPath, indexMarkdown, "utf8");
  const indexFile = {
    owner: "index",
    path: indexPath,
    actionCount: report.manualInterventionPlan.summary.total,
    sha256: sha256Hex(indexMarkdown),
    bytes: Buffer.byteLength(indexMarkdown, "utf8")
  };
  const manifest = buildManualInterventionManifest({ report, indexFile, packetFiles });
  const manifestPath = join(absoluteDir, "manual-intervention-manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

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
      checks.push(...verifyManifestFileEntry(file, index));
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

function verifyManifestFileEntry(file, index) {
  const idPrefix = `file-${index + 1}`;
  const checks = [];
  const path = typeof file?.path === "string" ? file.path : "";
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

  let content = "";
  let stat;

  try {
    content = readFileSync(path, "utf8");
    stat = statSync(path);
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

  if (args.verifyManifestPath) {
    const verificationReport = verifyManualInterventionManifest(args.verifyManifestPath);
    console.log(JSON.stringify(verificationReport, null, 2));

    if (args.strict && verificationReport.overallStatus !== "verified") {
      process.exitCode = 1;
    }
  } else {
    const report = buildReport();

    if (args.manualPacketsDir) {
      report.manualInterventionPlan.packetFiles = writeManualInterventionPackets(args.manualPacketsDir, report);
    }

    if (args.markdownOutPath) {
      report.markdownSummaryPath = writeMarkdown(args.markdownOutPath, renderLocalSubmissionMarkdown(report));
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
