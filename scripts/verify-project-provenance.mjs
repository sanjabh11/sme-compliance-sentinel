/* global console, process */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const hackathonStartAt = "2026-05-19T00:00:00.000Z";

function runGit(args) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function collectGitSignals() {
  try {
    runGit(["rev-parse", "--show-toplevel"]);
  } catch (error) {
    return {
      gitAvailable: false,
      commitCount: 0,
      trackedFileCount: 0,
      untrackedPaths: [],
      error: error instanceof Error ? error.message : "Git is unavailable."
    };
  }

  const untrackedPaths = runGit(["status", "--short", "--untracked-files=all"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3));
  const trackedFileCount = runGit(["ls-files"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;

  let commitCount = 0;
  let firstCommitAt;
  let headCommitAt;
  let error;

  try {
    commitCount = Number(runGit(["rev-list", "--count", "HEAD"])) || 0;
    firstCommitAt = runGit(["log", "--reverse", "--format=%cI", "--max-count=1"]) || undefined;
    headCommitAt = runGit(["log", "-1", "--format=%cI"]) || undefined;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "No commits are available.";
  }

  return {
    gitAvailable: true,
    commitCount,
    firstCommitAt,
    headCommitAt,
    trackedFileCount,
    untrackedPaths,
    error
  };
}

function buildReport() {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const git = collectGitSignals();
  const firstCommitMs = git.firstCommitAt ? Date.parse(git.firstCommitAt) : Number.NaN;
  const firstCommitAfterStart = Number.isFinite(firstCommitMs) && firstCommitMs >= Date.parse(hackathonStartAt);
  const checks = [
    check("git-history-present", git.gitAvailable && git.commitCount > 0, `${git.commitCount} commit(s) found.`),
    check("first-commit-after-start", firstCommitAfterStart, git.firstCommitAt ?? "No first commit timestamp."),
    check(
      "source-tracked",
      git.trackedFileCount > 0 && git.untrackedPaths.length === 0,
      `${git.trackedFileCount} tracked file(s); ${git.untrackedPaths.length} untracked path(s).`
    ),
    check(
      "pre-existing-work-disclosure",
      false,
      "Human review required for frameworks, dependencies, Google APIs, and generated/local boilerplate disclosure.",
      "warning"
    )
  ];
  const blocked = checks.filter((item) => item.status === "blocked");
  const warning = checks.filter((item) => item.status === "warning");

  return {
    generatedAt: new Date().toISOString(),
    overallStatus: blocked.length ? "blocked" : warning.length ? "warning" : "passed",
    hackathonStartAt,
    git,
    packageSummary: {
      runtimeDependencies: Object.keys(packageJson.dependencies ?? {}).sort(),
      devDependencies: Object.keys(packageJson.devDependencies ?? {}).sort()
    },
    checks,
    nextActions: [
      ...(git.commitCount === 0 ? ["Create the first commit before relying on repository-history proof."] : []),
      ...(git.untrackedPaths.length ? ["Add intended source files to Git and keep secrets/private evidence excluded."] : []),
      "Push or share the repository for judges.",
      "Human-review the Devpost disclosure before setting XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED=true."
    ],
    disclosureDraft: [
      "Verify first commit date against the official hackathon start before claiming new-project status.",
      `Runtime dependencies: ${Object.keys(packageJson.dependencies ?? {}).sort().join(", ")}.`,
      `Development dependencies: ${Object.keys(packageJson.devDependencies ?? {}).sort().join(", ")}.`,
      "Private customer evidence, secrets, judge credentials, invoices, and raw security findings are excluded from the source repository."
    ]
  };
}

function check(id, passed, evidence, forcedStatus) {
  return {
    id,
    status: forcedStatus ?? (passed ? "passed" : "blocked"),
    evidence
  };
}

const report = buildReport();
console.log(JSON.stringify(report, null, 2));

if (process.argv.includes("--strict") && report.overallStatus !== "passed") {
  process.exitCode = 1;
}
