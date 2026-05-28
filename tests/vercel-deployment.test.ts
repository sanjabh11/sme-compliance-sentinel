import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type VercelDeploymentReport = {
  overallStatus: "blocked" | "verified";
  expectedCommit: string;
  productUrl: string;
  latestProductionDeployment: {
    status: "missing" | "found";
    githubCommitSha?: string;
    state?: string;
    target?: string;
  };
  checks: Array<{
    id: string;
    status: "missing" | "blocked" | "ready";
    evidence: string;
  }>;
  blockers: string[];
  proofBoundary: string;
  stopConditions: string[];
};

describe("Vercel deployment lineage verifier", () => {
  it("blocks when no Vercel deployment export is supplied", () => {
    const report = runVerifier(["--expected-commit", currentCommit, "--url", "https://sme-workspace-sentinel.vercel.app"]);

    expect(report.overallStatus).toBe("blocked");
    expect(report.blockers.join(" ")).toContain("Vercel deployment export");
    expect(report.proofBoundary).toContain("not Cloud Run proof");
  });

  it("blocks stale production deployments that do not match the expected commit", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-vercel-stale-"));
    const deploymentsPath = join(tempDir, "vercel-deployments.json");

    try {
      writeFileSync(deploymentsPath, JSON.stringify(buildDeploymentExport({ sha: staleCommit }), null, 2));
      const report = runVerifier([
        "--deployments-json",
        deploymentsPath,
        "--expected-commit",
        currentCommit,
        "--url",
        "https://sme-workspace-sentinel.vercel.app"
      ]);
      const checksById = Object.fromEntries(report.checks.map((check) => [check.id, check]));

      expect(report.overallStatus).toBe("blocked");
      expect(report.latestProductionDeployment.githubCommitSha).toBe(staleCommit);
      expect(checksById["production-source-lineage"].status).toBe("blocked");
      expect(report.nextActions?.join(" ")).toContain("stale");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("verifies ready production deployment lineage when commit metadata matches", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-vercel-current-"));
    const deploymentsPath = join(tempDir, "vercel-deployments.json");
    const outPath = join(tempDir, "vercel-deployment-readiness.json");

    try {
      writeFileSync(deploymentsPath, JSON.stringify(buildDeploymentExport({ sha: currentCommit }), null, 2));
      const report = runVerifier([
        "--deployments-json",
        deploymentsPath,
        "--expected-commit",
        currentCommit,
        "--url",
        "https://sme-workspace-sentinel.vercel.app",
        "--out",
        outPath,
        "--strict"
      ]);
      const written = JSON.parse(readFileSync(outPath, "utf8")) as VercelDeploymentReport;

      expect(report.overallStatus).toBe("verified");
      expect(written.overallStatus).toBe("verified");
      expect(report.latestProductionDeployment).toMatchObject({
        githubCommitSha: currentCommit,
        state: "READY",
        target: "production"
      });
      expect(report.stopConditions.join(" ")).toContain("Vercel customer-demo deployment");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("selects the latest ready production deployment instead of preview deployments", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-vercel-preview-"));
    const deploymentsPath = join(tempDir, "vercel-deployments.json");
    const exportJson = buildDeploymentExport({ sha: currentCommit });

    exportJson.deployments.deployments.unshift({
      ...exportJson.deployments.deployments[0],
      id: "dpl_preview",
      target: "preview",
      created: 9999999999999,
      meta: {
        ...exportJson.deployments.deployments[0].meta,
        githubCommitSha: staleCommit
      }
    });

    try {
      writeFileSync(deploymentsPath, JSON.stringify(exportJson, null, 2));
      const report = runVerifier([
        "--deployments-json",
        deploymentsPath,
        "--expected-commit",
        currentCommit,
        "--url",
        "https://sme-workspace-sentinel.vercel.app",
        "--strict"
      ]);

      expect(report.overallStatus).toBe("verified");
      expect(report.latestProductionDeployment.githubCommitSha).toBe(currentCommit);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects raw secret-shaped CLI arguments and symlinked deployment exports", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-vercel-symlink-"));
    const realPath = join(tempDir, "real.json");
    const symlinkPath = join(tempDir, "linked.json");

    try {
      writeFileSync(realPath, JSON.stringify(buildDeploymentExport({ sha: currentCommit }), null, 2));
      symlinkSync(realPath, symlinkPath);

      expect(() => runVerifier(["--api-key=raw-secret"])).toThrow();
      expect(() => runVerifier(["--deployments-json", symlinkPath, "--expected-commit", currentCommit])).toThrow(/symbolic link/u);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

const currentCommit = "ff8535e0c2914d9c42c95a02c4f66cc4175ce7e3";
const staleCommit = "9c00e969bfe1c8fdab95ea3213e19bf402d8fa43";

function buildDeploymentExport({ sha }: { sha: string }) {
  return {
    deployments: {
      deployments: [
        {
          id: "dpl_current",
          name: "sme-workspace-sentinel",
          url: "sme-workspace-sentinel.vercel.app",
          created: 1779950615088,
          state: "READY",
          target: "production",
          meta: {
            githubCommitSha: sha,
            githubCommitRef: "main",
            githubCommitMessage: "test deployment"
          },
          inspectorUrl: "https://vercel.example.test/deployment"
        }
      ]
    }
  };
}

function runVerifier(args: string[] = []) {
  const output = execFileSync(process.execPath, ["scripts/verify-vercel-deployment.mjs", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VERCEL_PROJECT_ID: "prj_test",
      VERCEL_ORG_ID: "team_test"
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  return JSON.parse(output) as VercelDeploymentReport & { nextActions?: string[] };
}
