import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type LocalSubmissionReport = {
  overallStatus: "passed" | "warning" | "blocked";
  summary: {
    passed: number;
    warning: number;
    blocked: number;
    externalRequired: number;
  };
  gates: Array<{
    id: string;
    rawStatus: string;
    status: "passed" | "warning" | "blocked";
    externalRequired: boolean;
    evidence: string;
    blockers: string[];
    nextActions: string[];
  }>;
  remainingBlockers: string[];
  nextActions: string[];
  stopConditions: string[];
  sourceUrls: string[];
  disclaimer: string;
};

const localSubmissionEnv = {
  ...process.env,
  XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED: "false",
  XPRIZE_THIRD_PARTY_REVIEW_APPROVED: "false",
  XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED: "false",
  XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED: "false"
};

describe("local XPRIZE submission verifier", () => {
  it("aggregates local source, provenance, license, and deployment gates without claiming external proof", () => {
    const report = runVerifier();
    const gatesById = Object.fromEntries(report.gates.map((gate) => [gate.id, gate]));

    expect(report.overallStatus).toBe("blocked");
    expect(report.summary.blocked).toBeGreaterThanOrEqual(1);
    expect(report.summary.warning).toBeGreaterThanOrEqual(2);
    expect(report.summary.externalRequired).toBeGreaterThanOrEqual(3);
    expect(Object.keys(gatesById)).toEqual(
      expect.arrayContaining(["source-release", "project-provenance", "license-ip-review", "cloudrun-deployment-template"])
    );
    expect(["published", "ready-to-commit"]).toContain(gatesById["source-release"].rawStatus);
    expect(["passed", "warning"]).toContain(gatesById["source-release"].status);
    expect(gatesById["source-release"].externalRequired).toBe(false);
    expect(gatesById["project-provenance"]).toMatchObject({
      rawStatus: "blocked",
      status: "blocked",
      externalRequired: true
    });
    expect(gatesById["project-provenance"].evidence).toContain("project-created-after-start attestation false");
    expect(gatesById["license-ip-review"]).toMatchObject({
      rawStatus: "warning",
      status: "warning",
      externalRequired: true
    });
    expect(gatesById["cloudrun-deployment-template"]).toMatchObject({
      rawStatus: "template-needs-values",
      status: "warning",
      externalRequired: true
    });
    expect(report.remainingBlockers.join(" ")).toContain("human-attestation");
    expect(report.nextActions.join(" ")).toContain("XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED");
    expect(report.stopConditions.join(" ")).toContain("does not deploy Cloud Run");
    expect(report.stopConditions.join(" ")).toContain("does not prove live Gemini API usage");
    expect(report.disclaimer).toContain("not legal advice");
    expect(report.sourceUrls).toEqual(
      expect.arrayContaining(["https://xprize.devpost.com/rules", "https://www.geminixprize.com/rules"])
    );
  });

  it("writes a private JSON packet and fails strict mode while blockers remain", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-local-submission-"));
    const outPath = join(tempDir, "local-submission-readiness.json");

    try {
      const report = runVerifier(["--out", outPath]);

      expect(readFileSync(outPath, "utf8")).toContain('"overallStatus": "blocked"');
      expect(report.gates.map((gate) => gate.id)).toContain("license-ip-review");
      expect(() => runVerifier(["--strict"])).toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects raw secret-shaped CLI arguments", () => {
    expect(() => runVerifier(["--api-key=raw-secret"])).toThrow();
  });
});

function runVerifier(args: string[] = []) {
  const output = execFileSync(process.execPath, ["scripts/verify-local-submission.mjs", ...args], {
    cwd: process.cwd(),
    env: localSubmissionEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  return JSON.parse(output) as LocalSubmissionReport;
}
