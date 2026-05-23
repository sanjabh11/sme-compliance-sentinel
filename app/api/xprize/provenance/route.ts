import { execFileSync } from "node:child_process";
import { NextResponse } from "next/server";
import { buildProjectProvenanceReport } from "@/lib/project-provenance";
import type { ProjectProvenanceGitSignals } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(buildProjectProvenanceReport(collectGitSignals()));
}

function collectGitSignals(): ProjectProvenanceGitSignals {
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
  let firstCommitAt: string | undefined;
  let headCommitAt: string | undefined;
  let error: string | undefined;

  try {
    commitCount = Number(runGit(["rev-list", "--count", "HEAD"])) || 0;
    firstCommitAt = runGit(["log", "--reverse", "--format=%cI", "--max-count=1"]).trim() || undefined;
    headCommitAt = runGit(["log", "-1", "--format=%cI"]).trim() || undefined;
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

function runGit(args: string[]) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}
