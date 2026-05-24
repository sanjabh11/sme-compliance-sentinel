import { execFileSync } from "node:child_process";
import type { ProjectProvenanceGitSignals } from "@/lib/types";

export function collectGitSignals(cwd = process.cwd()): ProjectProvenanceGitSignals {
  try {
    runGit(["rev-parse", "--show-toplevel"], cwd);
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

  const untrackedPaths = runGit(["status", "--short", "--untracked-files=all"], cwd)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3));
  const trackedFileCount = runGit(["ls-files"], cwd)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;

  let commitCount = 0;
  let headCommit: string | undefined;
  let firstCommit: string | undefined;
  let remoteUrl: string | undefined;
  let upstreamBranch: string | undefined;
  let remoteHeadCommit: string | undefined;
  let firstCommitAt: string | undefined;
  let headCommitAt: string | undefined;
  let error: string | undefined;

  try {
    commitCount = Number(runGit(["rev-list", "--count", "HEAD"], cwd)) || 0;
    headCommit = runGit(["rev-parse", "HEAD"], cwd).trim() || undefined;
    const firstCommitSignals = collectFirstCommitSignals(cwd);
    firstCommit = firstCommitSignals?.commit;
    firstCommitAt = firstCommitSignals?.committedAt;
    remoteUrl = runGit(["remote", "get-url", "origin"], cwd).trim() || undefined;
    upstreamBranch = runOptionalGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd) || undefined;
    remoteHeadCommit = upstreamBranch ? runOptionalGit(["rev-parse", upstreamBranch], cwd) || undefined : undefined;
    headCommitAt = runGit(["log", "-1", "--format=%cI"], cwd).trim() || undefined;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "No commits are available.";
  }

  return {
    gitAvailable: true,
    sourceEvidenceMode: "git",
    commitCount,
    headCommit,
    firstCommit,
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

function collectDeploymentSourceSignals(): ProjectProvenanceGitSignals | undefined {
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

function cleanEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value || /^SOURCE_/u.test(value) || value === "RELEASE_ID") {
    return "";
  }

  return value;
}

function runGit(args: string[], cwd: string) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function runOptionalGit(args: string[], cwd: string) {
  try {
    return runGit(args, cwd);
  } catch {
    return "";
  }
}

function collectFirstCommitSignals(cwd: string) {
  const rootCommits = runGit(["rev-list", "--max-parents=0", "HEAD"], cwd)
    .split("\n")
    .map((commit) => commit.trim())
    .filter(Boolean);

  const roots = rootCommits
    .map((commit) => ({
      commit,
      committedAt: runGit(["show", "-s", "--format=%cI", commit], cwd).trim()
    }))
    .filter((root) => root.committedAt);

  return roots.sort((left, right) => Date.parse(left.committedAt) - Date.parse(right.committedAt))[0];
}
