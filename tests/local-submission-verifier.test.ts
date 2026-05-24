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
      bucket: "code-controllable" | "external-proof" | "human-attestation";
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
  phaseProgressChart: {
    generatedFrom: string;
    scale: string;
    overallGoalRemainingPercent: number;
    overallGoalRemainingBasis: string;
    rows: Array<{
      phaseId: string;
      label: string;
      bucket: "code-controllable" | "external-proof" | "human-attestation";
      owner: string;
      priority: number;
      status: string;
      ratingOutOf5: number;
      currentPhaseRemainingPercent: number;
      overallGoalRemainingPercent: number;
      done: string[];
      pending: string[];
      successCheckpoints: string[];
      stopConditions: string[];
      checkpointCounts: {
        total: number;
        done: number;
        partial: number;
        pending: number;
        blocked: number;
        "external-required": number;
      };
      progressBasis: string;
      evidence: string;
    }>;
  };
  manualInterventionPlan: {
    generatedFrom: string;
    status: "manual-intervention-required" | "no-open-interventions";
    confidenceBoundary: string;
    summary: {
      total: number;
      byBucket: Record<string, number>;
      byOwner: Record<string, number>;
      byStatus: Record<string, number>;
      highestPriority: number;
    };
    nextOwner: string;
    ownerPackets: Array<{
      owner: string;
      openActionCount: number;
      buckets: Record<string, number>;
      highestPriority: number;
      nextAction: string;
      privateArtifactPaths: string[];
      rows: Array<{
        id: string;
        phaseId: string;
        bucket: "code-controllable" | "external-proof" | "human-attestation";
        owner: string;
        action: string;
        privateArtifactPaths: string[];
        proofBoundary: string;
      }>;
    }>;
    actionRows: Array<{
      id: string;
      phaseId: string;
      phaseLabel: string;
      bucket: "code-controllable" | "external-proof" | "human-attestation";
      owner: string;
      priority: number;
      phaseRatingOutOf5: number;
      currentPhaseRemainingPercent: number;
      overallGoalRemainingPercent: number;
      source: string;
      status: string;
      action: string;
      evidenceNeeded: string;
      commands: string[];
      privateArtifactPaths: string[];
      stopCondition: string;
      proofBoundary: string;
    }>;
    packetFiles?: {
      indexPath: string;
      manifestPath: string;
      digestAlgorithm: string;
      packetFileCount: number;
      ownerPacketPaths: Array<{
        owner: string;
        path: string;
        actionCount: number;
        sha256: string;
        bytes: number;
      }>;
      proofBoundary: string;
    };
    stopConditions: string[];
    privateHandling: string[];
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
    expect(report.manualInterventionPlan.status).toBe("manual-intervention-required");
    expect(report.manualInterventionPlan.generatedFrom).toBe("verify-local-submission");
    expect(report.manualInterventionPlan.confidenceBoundary).toContain("not proof");
    expect(report.manualInterventionPlan.summary.total).toBeGreaterThan(0);
    expect(report.manualInterventionPlan.summary.byBucket["human-attestation"]).toBeGreaterThan(0);
    expect(report.manualInterventionPlan.summary.byBucket["external-proof"]).toBeGreaterThan(0);
    expect(report.manualInterventionPlan.summary.byOwner["founder/legal"]).toBeGreaterThan(0);
    expect(report.manualInterventionPlan.summary.highestPriority).toBe(5);
    expect(report.manualInterventionPlan.nextOwner).not.toBe("none");
    expect(report.phasePlan.phases.map((phase) => phase.id)).toEqual([
      "human-attestation-review",
      "cloudrun-render-dry-run",
      "hosted-proof-capture",
      "business-traction-proof"
    ]);
    expect(report.phasePlan.phases.every((phase) => phase.priority >= 1 && phase.priority <= 5)).toBe(true);
    expect(report.phaseProgressChart.generatedFrom).toBe("verify-local-submission");
    expect(report.phaseProgressChart.scale).toContain("1=blocked");
    expect(report.phaseProgressChart.overallGoalRemainingBasis).toContain("phase-specific evidence-gate");
    expect(report.phaseProgressChart.rows.map((row) => row.phaseId)).toEqual(report.phasePlan.phases.map((phase) => phase.id));
    expect(report.phaseProgressChart.rows.every((row) => row.ratingOutOf5 >= 1 && row.ratingOutOf5 <= 5)).toBe(true);
    expect(report.phaseProgressChart.rows.every((row) => row.overallGoalRemainingPercent === report.phaseProgressChart.overallGoalRemainingPercent)).toBe(true);
    expect(report.phaseProgressChart.rows.every((row) => row.progressBasis.includes("not a win-probability estimate"))).toBe(true);
    expect(report.phaseProgressChart.rows.find((row) => row.phaseId === "human-attestation-review")).toMatchObject({
      bucket: "human-attestation",
      ratingOutOf5: 1
    });
    expect(
      report.phaseProgressChart.rows.find((row) => row.phaseId === "human-attestation-review")?.currentPhaseRemainingPercent
    ).toBeGreaterThan(0);
    expect(report.phaseProgressChart.rows.find((row) => row.phaseId === "cloudrun-render-dry-run")).toMatchObject({
      bucket: "code-controllable",
      ratingOutOf5: 2
    });
    expect(
      report.phaseProgressChart.rows.find((row) => row.phaseId === "cloudrun-render-dry-run")?.currentPhaseRemainingPercent
    ).toBeGreaterThan(0);
    expect(report.phaseProgressChart.rows.find((row) => row.phaseId === "hosted-proof-capture")).toMatchObject({
      bucket: "external-proof",
      ratingOutOf5: 1
    });
    expect(report.manualInterventionPlan.stopConditions.join(" ")).toContain("Do not set manual XPRIZE");
    expect(report.manualInterventionPlan.privateHandling.join(" ")).toContain("/secure/local");
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

  it("writes private owner-routed Markdown manual intervention packets", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-manual-packets-"));

    try {
      const report = runVerifier(["--manual-packets-dir", tempDir]);
      const indexMarkdown = readFileSync(join(tempDir, "manual-intervention-index.md"), "utf8");
      const engineeringMarkdown = readFileSync(join(tempDir, "engineering.md"), "utf8");
      const founderLegalMarkdown = readFileSync(join(tempDir, "founder-legal.md"), "utf8");
      const founderSalesMarkdown = readFileSync(join(tempDir, "founder-sales.md"), "utf8");
      const manifest = JSON.parse(readFileSync(join(tempDir, "manual-intervention-manifest.json"), "utf8")) as {
        status: string;
        digestAlgorithm: string;
        proofBoundary: string;
        files: Array<{ owner: string; path: string; sha256: string; bytes: number; actionCount: number }>;
      };

      expect(report.manualInterventionPlan.packetFiles?.proofBoundary).toContain("private execution aids only");
      expect(report.manualInterventionPlan.packetFiles?.manifestPath).toBe(join(tempDir, "manual-intervention-manifest.json"));
      expect(report.manualInterventionPlan.packetFiles?.digestAlgorithm).toBe("sha256");
      expect(report.manualInterventionPlan.packetFiles?.packetFileCount).toBe(4);
      expect(report.manualInterventionPlan.packetFiles?.ownerPacketPaths.map((file) => file.owner)).toEqual(
        expect.arrayContaining(["engineering", "founder/legal", "founder/sales"])
      );
      expect(report.manualInterventionPlan.packetFiles?.ownerPacketPaths.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256))).toBe(true);
      expect(report.manualInterventionPlan.packetFiles?.ownerPacketPaths.every((file) => file.bytes > 0)).toBe(true);
      expect(manifest.status).toBe("manual-intervention-required");
      expect(manifest.digestAlgorithm).toBe("sha256");
      expect(manifest.proofBoundary).toContain("private packet integrity only");
      expect(manifest.files.map((file) => file.owner)).toEqual(expect.arrayContaining(["index", "engineering", "founder/legal", "founder/sales"]));
      expect(manifest.files.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256))).toBe(true);
      expect(manifest.files.every((file) => file.bytes > 0 && file.path.startsWith(tempDir))).toBe(true);
      expect(indexMarkdown).toContain("# Manual Intervention Plan");
      expect(indexMarkdown).toContain("These packets are step-by-step instructions only");
      expect(indexMarkdown).toContain("founder/legal");
      expect(engineeringMarkdown).toContain("# Manual Intervention Packet: engineering");
      expect(engineeringMarkdown).toContain("## Step-by-step Actions");
      expect(engineeringMarkdown).toContain("Cloud Run");
      expect(engineeringMarkdown).toContain("/secure/local/cloudrun-render-values.json");
      expect(founderLegalMarkdown).toContain("XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED");
      expect(founderLegalMarkdown).toContain("human review");
      expect(founderSalesMarkdown).toContain("invoice/payment");
      expect(founderSalesMarkdown).toContain("/secure/local/business-evidence.json");
      expect([indexMarkdown, engineeringMarkdown, founderLegalMarkdown, founderSalesMarkdown].join("\n")).not.toContain("Bearer ");
      expect([indexMarkdown, engineeringMarkdown, founderLegalMarkdown, founderSalesMarkdown].join("\n")).not.toContain("password:");
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
      bucket: "external-proof"
    });
    expect(phasesById["hosted-proof-capture"].currentPhaseRemainingPercent).toBeGreaterThan(0);
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

  it("emits owner-routed manual intervention rows with private artifacts and proof boundaries", () => {
    const report = runVerifier();
    const rowsByPhase = report.manualInterventionPlan.actionRows.reduce<Record<string, LocalSubmissionReport["manualInterventionPlan"]["actionRows"]>>(
      (groups, row) => {
        groups[row.phaseId] = [...(groups[row.phaseId] ?? []), row];
        return groups;
      },
      {}
    );
    const ownerPacketsByOwner = Object.fromEntries(report.manualInterventionPlan.ownerPackets.map((packet) => [packet.owner, packet]));
    const humanRows = rowsByPhase["human-attestation-review"] ?? [];
    const cloudRunRows = rowsByPhase["cloudrun-render-dry-run"] ?? [];
    const hostedRows = rowsByPhase["hosted-proof-capture"] ?? [];
    const businessRows = rowsByPhase["business-traction-proof"] ?? [];

    expect(humanRows.some((row) => row.action.includes("project-created-after-start"))).toBe(true);
    expect(humanRows.every((row) => row.proofBoundary.includes("human review"))).toBe(true);
    expect(cloudRunRows.some((row) => row.privateArtifactPaths.includes("/secure/local/cloudrun-render-values.json"))).toBe(true);
    expect(cloudRunRows.some((row) => row.commands.join(" ").includes("audit:cloudrun-values"))).toBe(true);
    expect(hostedRows.some((row) => row.action.includes("Cloud Run service URL"))).toBe(true);
    expect(hostedRows.every((row) => row.proofBoundary.includes("external artifact evidence"))).toBe(true);
    expect(businessRows.some((row) => row.action.includes("invoice/payment"))).toBe(true);
    expect(businessRows.some((row) => row.privateArtifactPaths.includes("/secure/local/business-evidence.json"))).toBe(true);
    expect(ownerPacketsByOwner.engineering.privateArtifactPaths).toEqual(
      expect.arrayContaining(["/secure/local/cloudrun-render-values.json"])
    );
    expect(ownerPacketsByOwner["founder/sales"].rows.some((row) => row.action.includes("invoice"))).toBe(true);
    expect(JSON.stringify(report.manualInterventionPlan)).not.toContain("Bearer ");
    expect(JSON.stringify(report.manualInterventionPlan)).not.toContain("password:");
  });

  it("emits a phase progress chart with done, pending, ratings, and remaining percentages", () => {
    const report = runVerifier();
    const rowsById = Object.fromEntries(report.phaseProgressChart.rows.map((row) => [row.phaseId, row]));

    expect(report.phaseProgressChart.overallGoalRemainingPercent).toBeGreaterThan(0);
    expect(report.phaseProgressChart.overallGoalRemainingPercent).toBeLessThanOrEqual(100);
    expect(rowsById["human-attestation-review"].done.join(" ")).toContain("Source release guard: passed");
    expect(rowsById["human-attestation-review"].pending.join(" ")).toContain("project-created-after-start");
    expect(rowsById["human-attestation-review"].successCheckpoints.join(" ")).toContain("prepare:xprize-attestation");
    expect(rowsById["cloudrun-render-dry-run"].done.join(" ")).toContain("Cloud Run deployment evidence template: partial/scaffolded");
    expect(rowsById["cloudrun-render-dry-run"].pending.join(" ")).toContain("filled private render-values file");
    expect(rowsById["cloudrun-render-dry-run"].evidence).not.toContain("judge-access-readiness");
    expect(rowsById["hosted-proof-capture"].pending.join(" ")).toContain("hosted live Gemini API call evidence");
    expect(rowsById["business-traction-proof"].pending.join(" ")).toContain("invoice/payment");
    expect(rowsById["business-traction-proof"].evidence).not.toContain("project-provenance");
    expect(rowsById["business-traction-proof"].evidence).not.toContain("license-ip-review");
    expect(rowsById["business-traction-proof"].pending.join(" ")).not.toContain("project-created-after-start");
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
