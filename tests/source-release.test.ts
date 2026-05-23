import { describe, expect, it } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import { buildSourceReleaseGuard } from "@/lib/source-release";
import type { ProjectProvenanceGitSignals, SourceReleaseFilePlan, SourceReleaseSecretFinding } from "@/lib/types";

const cleanGit: ProjectProvenanceGitSignals = {
  gitAvailable: true,
  commitCount: 0,
  trackedFileCount: 0,
  untrackedPaths: ["app/page.tsx", "lib/store.ts", "tests/source-release.test.ts"]
};

const releaseFiles: SourceReleaseFilePlan[] = [
  file("package.json", "package-manifest"),
  file("package-lock.json", "package-manifest"),
  file("README.md", "docs"),
  file("XPRIZE_CHECKLIST.md", "docs"),
  file("WINNING_STRATEGY.md", "docs"),
  file(".env.example", "config"),
  file(".gitignore", "config"),
  file("cloudrun.service.yaml", "config"),
  file("app/page.tsx", "app-source"),
  file("app/dashboard-client.tsx", "app-source"),
  file("app/api/xprize/source-release/route.ts", "api-route"),
  file("lib/store.ts", "library-source"),
  file("lib/scanner.ts", "library-source"),
  file("lib/gemini.ts", "library-source"),
  file("lib/readiness.ts", "library-source"),
  file("tests/scanner.test.ts", "test"),
  file("tests/readiness.test.ts", "test"),
  file("tests/source-release.test.ts", "test")
];

const gitignoreText = [
  "node_modules/",
  ".next/",
  "coverage/",
  "*.tsbuildinfo",
  ".env",
  ".env.local",
  ".env.*.local",
  "!.env.example"
].join("\n");

describe("source release guard", () => {
  it("allows a clean first source-release plan while keeping commit provenance as the next step", () => {
    const guard = buildSourceReleaseGuard({
      git: cleanGit,
      files: releaseFiles,
      gitignoreText,
      secretFindings: []
    });

    expect(guard.overallStatus).toBe("ready-to-commit");
    expect(guard.releasableFileCount).toBe(releaseFiles.length);
    expect(guard.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "required-source-present",
        "core-categories-present",
        "gitignore-protects-private-files",
        "secret-scan-clean",
        "source-ready-for-first-commit"
      ])
    );
    expect(guard.checks.find((check) => check.id === "secret-scan-clean")?.status).toBe("passed");
    expect(guard.checks.find((check) => check.id === "source-ready-for-first-commit")?.status).toBe("warning");
    expect(guard.recommendedCommands).toContain("git add .");
  });

  it("blocks publishing when secret findings or ignore gaps are present", () => {
    const secretFinding: SourceReleaseSecretFinding = {
      path: "lib/config.ts",
      line: 12,
      detector: "google-api-key",
      severity: "critical",
      evidence: "Google API key-shaped value detected.",
      fix: "Remove the value from source, rotate it if it was real, and replace it with an environment variable or placeholder."
    };
    const guard = buildSourceReleaseGuard({
      git: cleanGit,
      files: releaseFiles,
      gitignoreText: "node_modules/",
      secretFindings: [secretFinding]
    });

    expect(guard.overallStatus).toBe("blocked");
    expect(guard.blockers.join(" ")).toContain("secret");
    expect(guard.blockers.join(" ")).toContain("Git ignore");
  });

  it("keeps release guidance inside claim guard boundaries", () => {
    const guard = buildSourceReleaseGuard({
      git: cleanGit,
      files: releaseFiles,
      gitignoreText,
      secretFindings: []
    });
    const violations = scanClaimText({
      artifact: "source-release",
      text: JSON.stringify(guard, null, 2)
    });

    expect(violations).toEqual([]);
  });
});

function file(path: string, category: SourceReleaseFilePlan["category"]): SourceReleaseFilePlan {
  return {
    path,
    category,
    gitStatus: "untracked",
    releaseAction: "stage",
    requiredForSubmission: true,
    reason: "Required for judge source review."
  };
}
