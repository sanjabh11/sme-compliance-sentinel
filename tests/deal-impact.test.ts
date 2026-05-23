import { describe, expect, it } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import { buildDealImpactReport } from "@/lib/deal-impact";
import {
  approveFinding,
  createDemoEvent,
  createQuestionnaireResponsePack,
  createTrustPacket,
  getDashboardSnapshot,
  ingestResourceEvent,
  remediateFinding,
  resetState
} from "@/lib/store";

describe("Deal Impact Report", () => {
  it("summarizes risk movement, ROI, and buyer proof points without exposing pilot identity", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));
    const finding = getDashboardSnapshot().findings[0];
    approveFinding(finding.id);
    remediateFinding(finding.id);
    createQuestionnaireResponsePack({
      customerAlias: "Acme Buyer",
      customerSegment: "Enterprise procurement",
      questionnaireText: "How do you monitor Workspace risk?\nDo you require human approval before remediation?"
    });
    createTrustPacket({ prospectAlias: "Acme Buyer", prospectDomain: "acme.example" });

    const report = buildDealImpactReport(getDashboardSnapshot(), { redacted: true });

    expect(report.targetAlias).toBe("Redacted prospect or pilot");
    expect(report.summaryMetrics.remediationsApproved).toBe(1);
    expect(report.summaryMetrics.questionnairePacks).toBe(1);
    expect(report.summaryMetrics.paybackMultiple).toBeGreaterThan(1);
    expect(report.milestones.some((milestone) => milestone.label === "Human-approved remediation")).toBe(true);
    expect(report.buyerProofPoints.join(" ")).toContain("human-approved remediation");
    expect(report.productionGaps.join(" ")).toContain("Firestore/BigQuery");
    expect(report.exportText).toContain("Deal Impact Report");
    expect(report.exportText).not.toContain("Acme Buyer");
    expect(scanClaimText({ artifact: "deal-impact-report", text: report.exportText })).toEqual([]);
  });

  it("keeps missing proof explicit before a full demo loop", () => {
    resetState();

    const report = buildDealImpactReport(getDashboardSnapshot(), { redacted: true });

    expect(report.milestones.filter((milestone) => milestone.status === "missing").length).toBeGreaterThan(0);
    expect(report.recommendedNextActions.join(" ")).toContain("human-approved remediation");
    expect(report.disclaimer).toContain("not a security certification");
  });
});
