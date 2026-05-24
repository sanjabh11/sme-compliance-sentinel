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
  phasePlan: {
    objective: string;
    confidenceBoundary: string;
    sourceGateStatus: string;
    recommendedNextPhaseId: string;
    phases: Array<{
      id: string;
      label: string;
      priority: number;
      owner: string;
      status: string;
      currentPhaseRemainingPercent: number;
      relatedGateIds: string[];
      commands: string[];
      evidenceNeeded: string[];
      stopConditions: string[];
    }>;
  };
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
    expect(report.summary.externalRequired).toBeGreaterThanOrEqual(5);
    expect(Object.keys(gatesById)).toEqual(
      expect.arrayContaining([
        "source-release",
        "project-provenance",
        "license-ip-review",
        "cloudrun-deployment-template",
        "judge-access-readiness",
        "business-evidence-readiness"
      ])
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
    expect(gatesById["judge-access-readiness"]).toMatchObject({
      rawStatus: "blocked",
      status: "blocked",
      externalRequired: true
    });
    expect(gatesById["judge-access-readiness"].evidence).toContain("Product URL");
    expect(gatesById["business-evidence-readiness"]).toMatchObject({
      rawStatus: "blocked",
      status: "blocked",
      externalRequired: true
    });
    expect(gatesById["business-evidence-readiness"].evidence).toContain("Revenue");
    expect(report.remainingBlockers.join(" ")).toContain("human-attestation");
    expect(report.nextActions.join(" ")).toContain("XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED");
    expect(report.phasePlan.recommendedNextPhaseId).toBe("human-attestation-review");
    expect(report.phasePlan.confidenceBoundary).toContain("not a win-probability estimate");
    expect(report.phasePlan.sourceGateStatus).toMatch(/passed|warning/);
    expect(report.phasePlan.phases.map((phase) => phase.id)).toEqual([
      "human-attestation-review",
      "cloudrun-render-dry-run",
      "hosted-proof-capture",
      "business-traction-proof"
    ]);
    expect(report.phasePlan.phases.every((phase) => phase.priority >= 1 && phase.priority <= 5)).toBe(true);
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

  it("emits a stop-gated execution plan for external evidence without overclaiming proof", () => {
    const report = runVerifier();
    const phasesById = Object.fromEntries(report.phasePlan.phases.map((phase) => [phase.id, phase]));

    expect(phasesById["human-attestation-review"].commands.join(" ")).toContain("prepare:xprize-attestation");
    expect(phasesById["human-attestation-review"].stopConditions.join(" ")).toContain(
      "Do not set XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED=true"
    );
    expect(phasesById["cloudrun-render-dry-run"].commands.join(" ")).toContain("audit:cloudrun-values");
    expect(phasesById["cloudrun-render-dry-run"].commands.join(" ")).toContain("verify:cloudrun-dry-run-packet");
    expect(phasesById["cloudrun-render-dry-run"].stopConditions.join(" ")).toContain("Do not run gcloud dry-run");
    expect(phasesById["hosted-proof-capture"]).toMatchObject({
      status: "external-required",
      currentPhaseRemainingPercent: 100
    });
    expect(phasesById["hosted-proof-capture"].commands.join(" ")).toContain("verify:judge-access");
    expect(phasesById["hosted-proof-capture"].commands.join(" ")).toContain("verify:business-evidence");
    expect(phasesById["hosted-proof-capture"].relatedGateIds).toContain("judge-access-readiness");
    expect(phasesById["hosted-proof-capture"].evidenceNeeded.join(" ")).toContain("provider=gemini-api");
    expect(phasesById["hosted-proof-capture"].evidenceNeeded.join(" ")).toContain("business-evidence readiness packet");
    expect(phasesById["hosted-proof-capture"].evidenceNeeded.join(" ")).toContain("judge-access readiness packet");
    expect(phasesById["business-traction-proof"]).toMatchObject({
      status: "external-required",
      owner: "founder/sales"
    });
    expect(phasesById["business-traction-proof"].commands.join(" ")).toContain("verify:business-evidence");
    expect(phasesById["business-traction-proof"].relatedGateIds).toContain("business-evidence-readiness");
    expect(phasesById["business-traction-proof"].stopConditions.join(" ")).toContain("Do not count mock pilots");
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
