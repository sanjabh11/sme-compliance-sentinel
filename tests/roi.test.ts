import { describe, expect, it } from "vitest";
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

describe("evidence-calibrated ROI", () => {
  it("surfaces calibration source, proof factors, and proof gaps", () => {
    resetState();

    const roi = getDashboardSnapshot().readiness.roiCalculator;

    expect(roi.calibrationSource).toBe("pilot-adjusted");
    expect(roi.qualifiedPilotCount).toBeGreaterThan(0);
    expect(roi.pilotMrrUsd).toBeGreaterThan(0);
    expect(roi.evidenceFactors.map((factor) => factor.label)).toContain("Qualified pilot MRR");
    expect(roi.proofGaps.join(" ")).toContain("SENTINEL_EVIDENCE_MODE=production");
    expect(roi.disclaimer).toContain("not a guaranteed savings");
  });

  it("increases value from remediation, questionnaire, trust-packet, and risk movement evidence", async () => {
    resetState();
    const initialValue = getDashboardSnapshot().readiness.roiCalculator.estimatedMonthlyValueUsd;

    await ingestResourceEvent(createDemoEvent("public-secret"));
    const finding = getDashboardSnapshot().findings[0];
    approveFinding(finding.id);
    remediateFinding(finding.id);

    createQuestionnaireResponsePack({
      customerAlias: "Redacted enterprise prospect",
      customerSegment: "B2B SaaS security review",
      questionnaireText: [
        "How do you monitor Google Workspace for public sharing?",
        "How do you minimize AI data exposure?",
        "What evidence can you provide for remediation approval?"
      ].join("\n")
    });
    createTrustPacket({ prospectAlias: "Redacted buyer" });

    const roi = getDashboardSnapshot().readiness.roiCalculator;

    expect(roi.estimatedMonthlyValueUsd).toBeGreaterThan(initialValue);
    expect(roi.remediationsApproved).toBe(1);
    expect(roi.questionnairePacksCompleted).toBe(1);
    expect(roi.trustPacketsCreated).toBe(1);
    expect(roi.riskReductionPoints).toBeGreaterThan(0);
    expect(roi.securityReviewHoursSaved).toBeGreaterThan(4);
  });
});
