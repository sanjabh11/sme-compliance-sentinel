import { describe, expect, it } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
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
});
