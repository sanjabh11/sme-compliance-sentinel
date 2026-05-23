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
    const deploymentSignals = collectDeploymentSourceSignals();

    if (deploymentSignals) {
      return deploymentSignals;
    }

    return {
      gitAvailable: false,
      sourceEvidenceMode: "missing",
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
  let headCommit;
  let remoteUrl;
  let upstreamBranch;
  let remoteHeadCommit;
  let firstCommitAt;
  let headCommitAt;
  let error;

  try {
    commitCount = Number(runGit(["rev-list", "--count", "HEAD"])) || 0;
    headCommit = runGit(["rev-parse", "HEAD"]) || undefined;
    remoteUrl = runGit(["remote", "get-url", "origin"]) || undefined;
    upstreamBranch = runOptionalGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]) || undefined;
    remoteHeadCommit = upstreamBranch ? runOptionalGit(["rev-parse", upstreamBranch]) || undefined : undefined;
    firstCommitAt = runGit(["log", "--reverse", "--format=%cI", "--max-count=1"]) || undefined;
    headCommitAt = runGit(["log", "-1", "--format=%cI"]) || undefined;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "No commits are available.";
  }

  return {
    gitAvailable: true,
    sourceEvidenceMode: "git",
    commitCount,
    headCommit,
    remoteUrl,
    upstreamBranch,
    remoteHeadCommit,
    firstCommitAt,
    headCommitAt,
    trackedFileCount,
    untrackedPaths,
    error
  };
}

function collectDeploymentSourceSignals() {
  const sourceCommit = cleanEnv("SENTINEL_SOURCE_COMMIT");

  if (!sourceCommit) {
    return undefined;
  }

  const sourceCommitAt = cleanEnv("SENTINEL_SOURCE_COMMIT_AT");
  const sourceBranch = cleanEnv("SENTINEL_SOURCE_BRANCH") || "deployment-source";

  return {
    gitAvailable: false,
    sourceEvidenceMode: "deployment-env",
    commitCount: 0,
    headCommit: sourceCommit,
    remoteUrl: cleanEnv("XPRIZE_REPOSITORY_URL") || undefined,
    upstreamBranch: sourceBranch,
    remoteHeadCommit: cleanEnv("SENTINEL_SOURCE_REMOTE_COMMIT") || sourceCommit,
    headCommitAt: sourceCommitAt || undefined,
    trackedFileCount: 0,
    untrackedPaths: [],
    error: "Git history is unavailable in this runtime; using non-secret deployment source metadata."
  };
}

function cleanEnv(name) {
  const value = process.env[name]?.trim();
  if (!value || /^SOURCE_/u.test(value) || value === "RELEASE_ID") {
    return "";
  }

  return value;
}

function runOptionalGit(args) {
  try {
    return runGit(args);
  } catch {
    return "";
  }
}

function buildReport() {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const git = collectGitSignals();
  const firstCommitMs = git.firstCommitAt ? Date.parse(git.firstCommitAt) : Number.NaN;
  const firstCommitAfterStart = Number.isFinite(firstCommitMs) && firstCommitMs >= Date.parse(hackathonStartAt);
  const deploymentSourceMetadata = git.sourceEvidenceMode === "deployment-env" && Boolean(git.headCommit);
  const repositoryUrl = normalizeRepositoryUrl(process.env.XPRIZE_REPOSITORY_URL ?? git.remoteUrl ?? "");
  const checks = [
    check(
      "git-history-present",
      git.gitAvailable && git.commitCount > 0,
      git.gitAvailable
        ? `${git.commitCount} commit(s) found.`
        : deploymentSourceMetadata
          ? `Runtime Git is unavailable, but deployed source commit metadata is present: ${git.headCommit}.`
          : "Git history is unavailable.",
      deploymentSourceMetadata ? "warning" : undefined
    ),
    check(
      "first-commit-after-start",
      firstCommitAfterStart,
      git.firstCommitAt ?? (deploymentSourceMetadata ? `Hosted runtime declares source commit ${git.headCommit}; first-commit timing still requires local repository provenance.` : "No first commit timestamp."),
      deploymentSourceMetadata ? "warning" : undefined
    ),
    check(
      "source-tracked",
      git.trackedFileCount > 0 && git.untrackedPaths.length === 0,
      deploymentSourceMetadata
        ? `Hosted runtime cannot inspect tracked source files; deployed commit metadata is ${git.headCommit}.`
        : `${git.trackedFileCount} tracked file(s); ${git.untrackedPaths.length} untracked path(s).`,
      deploymentSourceMetadata ? "warning" : undefined
    ),
    check("repository-url", Boolean(repositoryUrl), repositoryUrl || "XPRIZE_REPOSITORY_URL and git origin remote are missing."),
    check(
      "repository-pushed",
      Boolean(git.headCommit && git.remoteHeadCommit === git.headCommit),
      git.headCommit
        ? `HEAD ${git.headCommit}; upstream ${git.upstreamBranch ?? "missing"} ${git.remoteHeadCommit ?? "missing"}.`
        : "No local HEAD commit."
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
    repositoryUrl,
    repositoryUrlSource: process.env.XPRIZE_REPOSITORY_URL ? "env" : repositoryUrl ? "git-remote" : "missing",
    git,
    packageSummary: {
      runtimeDependencies: Object.keys(packageJson.dependencies ?? {}).sort(),
      devDependencies: Object.keys(packageJson.devDependencies ?? {}).sort()
    },
    checks,
    nextActions: [
      ...(git.commitCount === 0 && !deploymentSourceMetadata ? ["Create the first commit before relying on repository-history proof."] : []),
      ...(git.untrackedPaths.length && !deploymentSourceMetadata ? ["Add intended source files to Git and keep secrets/private evidence excluded."] : []),
      ...(deploymentSourceMetadata ? ["Keep local npm run verify:provenance output with the same source commit in the private judge packet."] : []),
      ...(git.headCommit && git.remoteHeadCommit === git.headCommit ? [] : ["Push or share the repository for judges."]),
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

function normalizeRepositoryUrl(url) {
  if (!url) {
    return "";
  }

  if (url.startsWith("git@github.com:")) {
    return `https://github.com/${url.slice("git@github.com:".length).replace(/\.git$/u, "")}`;
  }

  return url.replace(/\.git$/u, "");
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
