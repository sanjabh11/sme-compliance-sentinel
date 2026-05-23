import { describe, expect, it } from "vitest";
import { buildQuestionnaireDraft } from "@/lib/questionnaire";
import { buildStrategySnapshot } from "@/lib/strategy";
import { buildTrustCenterProfile } from "@/lib/trust-center";
import {
  createDemoEvent,
  createQuestionnaireResponsePack,
  createTrustPacket,
  getDashboardSnapshot,
  ingestResourceEvent,
  resetState
} from "@/lib/store";

describe("market strategy surfaces", () => {
  it("lists 15 feature bets and admits win confidence is not 100%", () => {
    const strategy = buildStrategySnapshot({ findings: [], agentRuns: [], remediations: [], pilotRecords: [] });

    expect(strategy.topFeatures).toHaveLength(15);
    expect(strategy.topGaps).toHaveLength(10);
    expect(strategy.loopholes.length).toBeGreaterThanOrEqual(10);
    expect(strategy.confidence.winConfidence).toBeLessThan(100);
    expect(strategy.topFeatures.filter((feature) => feature.currentState === "implemented").length).toBeGreaterThanOrEqual(12);
    expect(strategy.topFeatures.every((feature) => feature.totalScore === feature.marketabilityScore + feature.winningLeverageScore + feature.sellabilityScore)).toBe(true);
    expect(strategy.topFeatures.every((feature) => feature.marketabilityScore >= 1 && feature.marketabilityScore <= 5)).toBe(true);
    expect(strategy.topFeatures.every((feature) => feature.winningLeverageScore >= 1 && feature.winningLeverageScore <= 5)).toBe(true);
    expect(strategy.topFeatures.every((feature) => feature.sellabilityScore >= 1 && feature.sellabilityScore <= 5)).toBe(true);
    expect(strategy.topFeatures[0].totalScore).toBe(15);
    expect(strategy.topFeatures[0].proofStatus).toBe("customer-proof-needed");
    expect(strategy.loopholes[0].fix).toContain("rule-compliance confidence");
    expect(strategy.topFeatures.some((feature) => feature.name.includes("Claim Guard"))).toBe(true);
  });

  it("builds Trust Center and questionnaire drafts from current evidence", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const snapshot = getDashboardSnapshot();
    const trustCenter = buildTrustCenterProfile(snapshot);
    const questionnaire = buildQuestionnaireDraft(snapshot);
    const { packet } = createTrustPacket({ prospectAlias: "Redacted prospect" });
    const { pack: responsePack } = createQuestionnaireResponsePack({
      customerAlias: "Redacted prospect",
      questionnaireText: "How do you prevent sensitive content from being sent to AI models?"
    });

    expect(trustCenter.restrictedClaims.join(" ")).toContain("Does not certify SOC2");
    expect(trustCenter.evidenceLinks.some((link) => link.label === "Agent runs")).toBe(true);
    expect(packet.accessUrl).toContain("/api/trust-center/packets/");
    expect(packet.disclaimer).toContain("excludes customer security findings");
    expect(questionnaire.questions).toHaveLength(5);
    expect(responsePack.answers[0].category).toBe("ai-data-minimization");
    expect(questionnaire.questions.every((question) => question.approvalRequired)).toBe(true);
  });
});
