import { describe, expect, it } from "vitest";
import {
  approveFinding,
  captureRiskScoreSnapshot,
  createDemoEvent,
  getDashboardSnapshot,
  ingestResourceEvent,
  markFindingFalsePositive,
  remediateFinding,
  resetState
} from "@/lib/store";
import { buildRiskScoreTrend } from "@/lib/risk-score";

describe("risk score history", () => {
  it("captures score movement across scan, approval, and remediation", async () => {
    resetState();
    const baseline = getDashboardSnapshot().scoreHistory[0];

    await ingestResourceEvent(createDemoEvent("public-secret"));
    let snapshot = getDashboardSnapshot();
    const finding = snapshot.findings[0];
    const afterFinding = snapshot.scoreHistory[0];

    expect(afterFinding.reason).toBe("finding_created");
    expect(afterFinding.workspaceRiskScore).toBeGreaterThan(baseline.workspaceRiskScore);

    approveFinding(finding.id);
    snapshot = remediateFinding(finding.id);
    const afterRemediation = snapshot.scoreHistory[0];

    expect(afterRemediation.reason).toBe("remediation_completed");
    expect(afterRemediation.workspaceRiskScore).toBeLessThan(afterFinding.workspaceRiskScore);
    expect(afterRemediation.evidenceMaturity).toBeGreaterThan(afterFinding.evidenceMaturity);
    expect(snapshot.readiness.riskTrend.history.length).toBeGreaterThanOrEqual(3);
    expect(snapshot.readiness.riskTrend.narrative).toContain("Workspace risk");
  });

  it("excludes false positives from active risk score", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));
    const finding = getDashboardSnapshot().findings[0];
    const before = getDashboardSnapshot().scoreHistory[0];

    const after = markFindingFalsePositive(finding.id).scoreHistory[0];

    expect(after.reason).toBe("finding_false_positive");
    expect(after.activeFindings).toBe(0);
    expect(after.workspaceRiskScore).toBeLessThan(before.workspaceRiskScore);
  });

  it("supports manual snapshots and trend classification", () => {
    resetState();
    const result = captureRiskScoreSnapshot("manual_snapshot");
    const trend = buildRiskScoreTrend(result.snapshot.scoreHistory);

    expect(result.scoreSnapshot.reason).toBe("manual_snapshot");
    expect(result.snapshot.auditEvents.some((event) => event.type === "risk_score_snapshot_created")).toBe(true);
    expect(trend.history.length).toBeGreaterThanOrEqual(2);
    expect(["mixed", "improving", "regressing", "insufficient_data"]).toContain(trend.direction);
  });
});
