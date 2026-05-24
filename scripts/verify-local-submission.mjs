#!/usr/bin/env node
/* global console, process */

import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const officialRuleSources = ["https://xprize.devpost.com/rules", "https://www.geminixprize.com/rules"];
const prohibitedCliPatterns = [
  /(^|-)token($|=)/iu,
  /(^|-)password($|=)/iu,
  /(^|-)secret($|=)/iu,
  /api[_-]?key=/iu,
  /authorization=/iu
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
  }
];

function parseArgs(argv) {
  const args = {
    strict: false,
    outPath: ""
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

  return {
    generatedAt: new Date().toISOString(),
    overallStatus,
    summary,
    gates: gateReports,
    remainingBlockers,
    nextActions,
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
    evidence: `${report.commitCount ?? 0} commit(s), ${report.trackedFileCount ?? 0} tracked file(s), ${report.untrackedFileCount ?? 0} untracked path(s), ${report.secretFindings?.length ?? 0} secret finding(s), ${report.claimFindings?.length ?? 0} unsafe claim finding(s).`,
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

function normalizeStatus(status) {
  if (status === "passed" || status === "published") {
    return "passed";
  }

  if (status === "warning" || status === "ready-to-commit" || status === "template-needs-values" || status === "ready-to-dry-run") {
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

try {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport();

  if (args.outPath) {
    writeJson(args.outPath, report);
  }

  console.log(JSON.stringify(report, null, 2));

  if (args.strict && report.overallStatus !== "passed") {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
