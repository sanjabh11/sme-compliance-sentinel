import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import { collectGitSignals } from "@/lib/git-signals";
import { buildProjectProvenanceReport, xprizeHackathonStartAt } from "@/lib/project-provenance";
import type { ProjectProvenanceGitSignals } from "@/lib/types";

const cleanGitSignals: ProjectProvenanceGitSignals = {
  gitAvailable: true,
  commitCount: 12,
  headCommit: "abc123",
  remoteUrl: "https://github.com/example/sme-workspace-sentinel.git",
  upstreamBranch: "origin/main",
  remoteHeadCommit: "abc123",
  firstCommitAt: "2026-05-20T10:00:00.000Z",
  headCommitAt: "2026-05-23T09:00:00.000Z",
  trackedFileCount: 80,
  untrackedPaths: []
};

const hostedSourceMetadataSignals: ProjectProvenanceGitSignals = {
  gitAvailable: false,
  sourceEvidenceMode: "deployment-env",
  commitCount: 0,
  headCommit: "0123456789abcdef0123456789abcdef01234567",
  remoteUrl: "https://github.com/example/sme-workspace-sentinel",
  upstreamBranch: "origin/main",
  remoteHeadCommit: "0123456789abcdef0123456789abcdef01234567",
  headCommitAt: "2026-05-23T17:24:17.894Z",
  trackedFileCount: 0,
  untrackedPaths: [],
  error: "Git history is unavailable in this runtime; using non-secret deployment source metadata."
};

describe("project provenance disclosure report", () => {
  it("blocks submission when git history, tracked source, repository URL, or attestation are missing", () => {
    const report = buildProjectProvenanceReport({
      gitAvailable: true,
      commitCount: 0,
      trackedFileCount: 0,
      untrackedPaths: ["app/page.tsx", "lib/store.ts"],
      error: "No commits are available."
    });

    expect(report.hackathonStartAt).toBe(xprizeHackathonStartAt);
    expect(report.overallStatus).toBe("blocked");
    expect(report.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "git-history-present",
        "first-commit-after-start",
        "source-tracked",
        "repository-url",
        "repository-pushed",
        "human-attestation",
        "pre-existing-work-disclosure"
      ])
    );
    expect(report.blockers.join(" ")).toContain("Create the first commit");
    expect(report.draftDevpostDisclosure.join(" ")).toContain("Runtime dependencies");
  });

  it("keeps disclosure review warning even after objective git signals are clean", () => {
    const report = buildProjectProvenanceReport(cleanGitSignals, {
      projectCreatedAfterStartConfirmed: true,
      repositoryUrl: "https://github.com/example/sme-workspace-sentinel"
    });

    expect(report.overallStatus).toBe("warning");
    expect(report.checks.find((check) => check.id === "first-commit-after-start")?.status).toBe("passed");
    expect(report.checks.find((check) => check.id === "repository-pushed")?.status).toBe("passed");
    expect(report.checks.find((check) => check.id === "pre-existing-work-disclosure")?.status).toBe("warning");
    expect(report.nextActions[0]).toContain("Human-review");
  });

  it("uses the git remote as repository evidence when the deployment env is not configured", () => {
    const report = buildProjectProvenanceReport(cleanGitSignals, {
      projectCreatedAfterStartConfirmed: true
    });

    expect(report.repositoryUrl).toBe("https://github.com/example/sme-workspace-sentinel");
    expect(report.repositoryUrlSource).toBe("git-remote");
    expect(report.checks.find((check) => check.id === "repository-url")?.status).toBe("passed");
  });

  it("uses deployment source metadata when hosted runtime Git is unavailable", () => {
    const report = buildProjectProvenanceReport(hostedSourceMetadataSignals, {
      projectCreatedAfterStartConfirmed: true,
      repositoryUrl: "https://github.com/example/sme-workspace-sentinel"
    });
    const checksById = Object.fromEntries(report.checks.map((check) => [check.id, check]));

    expect(report.overallStatus).toBe("warning");
    expect(checksById["git-history-present"].status).toBe("warning");
    expect(checksById["first-commit-after-start"].status).toBe("warning");
    expect(checksById["source-tracked"].status).toBe("warning");
    expect(checksById["repository-pushed"].status).toBe("passed");
    expect(checksById["repository-pushed"].evidence).toContain("0123456789abcdef0123456789abcdef01234567");
  });

  it("keeps provenance language inside claim guard boundaries", () => {
    const report = buildProjectProvenanceReport(cleanGitSignals, {
      projectCreatedAfterStartConfirmed: true,
      repositoryUrl: "https://github.com/example/sme-workspace-sentinel"
    });
    const violations = scanClaimText({
      artifact: "project-provenance",
      text: JSON.stringify(report, null, 2)
    });

    expect(violations).toEqual([]);
  });

  it("collects the root commit timestamp instead of the newest commit when building git signals", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-provenance-git-"));

    try {
      runGit(tempDir, ["init"]);
      runGit(tempDir, ["config", "user.email", "sentinel@example.com"]);
      runGit(tempDir, ["config", "user.name", "SME Sentinel"]);
      runGit(tempDir, ["remote", "add", "origin", "https://github.com/example/sme-workspace-sentinel.git"]);
      writeFileSync(join(tempDir, "README.md"), "# Sentinel\n", "utf8");
      runGit(tempDir, ["add", "README.md"]);
      runGit(tempDir, ["commit", "-m", "initial"], {
        GIT_AUTHOR_DATE: "2026-05-20T10:00:00+00:00",
        GIT_COMMITTER_DATE: "2026-05-20T10:00:00+00:00"
      });
      writeFileSync(join(tempDir, "README.md"), "# Sentinel\n\nUpdated\n", "utf8");
      runGit(tempDir, ["add", "README.md"]);
      runGit(tempDir, ["commit", "-m", "second"], {
        GIT_AUTHOR_DATE: "2026-05-23T09:00:00+00:00",
        GIT_COMMITTER_DATE: "2026-05-23T09:00:00+00:00"
      });

      const signals = collectGitSignals(tempDir);

      expect(signals.commitCount).toBe(2);
      expect(signals.firstCommit).toMatch(/^[a-f0-9]{40}$/u);
      expect(signals.headCommit).toMatch(/^[a-f0-9]{40}$/u);
      expect(signals.firstCommit).not.toBe(signals.headCommit);
      expect(Date.parse(signals.firstCommitAt ?? "")).toBe(Date.parse("2026-05-20T10:00:00+00:00"));
      expect(Date.parse(signals.headCommitAt ?? "")).toBe(Date.parse("2026-05-23T09:00:00+00:00"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("CLI provenance verification blocks until the project-created-after-start attestation is reviewed", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-provenance-cli-"));
    const scriptPath = join(process.cwd(), "scripts", "verify-project-provenance.mjs");

    try {
      runGit(tempDir, ["init", "-b", "main"]);
      runGit(tempDir, ["config", "user.email", "sentinel@example.com"]);
      runGit(tempDir, ["config", "user.name", "SME Sentinel"]);
      runGit(tempDir, ["remote", "add", "origin", "https://github.com/example/sme-workspace-sentinel.git"]);
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({
          dependencies: { next: "16.2.6", react: "19.2.0" },
          devDependencies: { vitest: "2.1.8", typescript: "5.7.2" }
        }),
        "utf8"
      );
      writeFileSync(join(tempDir, "README.md"), "# Sentinel\n", "utf8");
      runGit(tempDir, ["add", "package.json", "README.md"]);
      runGit(tempDir, ["commit", "-m", "initial"], {
        GIT_AUTHOR_DATE: "2026-05-20T10:00:00+00:00",
        GIT_COMMITTER_DATE: "2026-05-20T10:00:00+00:00"
      });
      runGit(tempDir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
      runGit(tempDir, ["branch", "--set-upstream-to=origin/main", "main"]);

      const unreviewedReport = runProvenanceCli(scriptPath, tempDir, {
        XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED: "false"
      });
      const unreviewedChecks = Object.fromEntries(unreviewedReport.checks.map((check) => [check.id, check]));

      expect(unreviewedReport.overallStatus).toBe("blocked");
      expect(unreviewedReport.projectCreatedAfterStartConfirmed).toBe(false);
      expect(unreviewedChecks["human-attestation"]).toMatchObject({
        status: "blocked",
        evidence: "XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED is false."
      });

      const reviewedReport = runProvenanceCli(scriptPath, tempDir, {
        XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED: "true"
      });
      const reviewedChecks = Object.fromEntries(reviewedReport.checks.map((check) => [check.id, check]));

      expect(reviewedReport.projectCreatedAfterStartConfirmed).toBe(true);
      expect(reviewedChecks["human-attestation"]).toMatchObject({ status: "passed" });
      expect(reviewedReport.overallStatus).toBe("warning");
      expect(reviewedChecks["pre-existing-work-disclosure"]).toMatchObject({ status: "warning" });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function runGit(cwd: string, args: string[], env: Record<string, string> = {}) {
  return execFileSync("git", args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runProvenanceCli(scriptPath: string, cwd: string, env: Record<string, string>) {
  const output = execFileSync(process.execPath, [scriptPath], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  return JSON.parse(output) as {
    overallStatus: string;
    projectCreatedAfterStartConfirmed: boolean;
    checks: Array<{ id: string; status: string; evidence: string }>;
  };
}
