import { describe, expect, it } from "vitest";
import { buildProductionLaunchCommandCenter } from "@/lib/production-launch";
import { createDemoEvent, getDashboardSnapshot, ingestResourceEvent, resetState } from "@/lib/store";

const launchEvidenceEnvNames = [
  "XPRIZE_SOURCE_CODE_COMPLETE_CONFIRMED",
  "XPRIZE_WORKING_PROJECT_ACCESS_CONFIGURED",
  "XPRIZE_TESTING_INSTRUCTIONS_CONFIGURED",
  "XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED",
  "XPRIZE_CATEGORY_IMPACT_EVIDENCE_CONFIGURED",
  "XPRIZE_AI_NATIVE_OPERATIONS_EVIDENCE_CONFIGURED",
  "XPRIZE_THIRD_PARTY_REVIEW_APPROVED",
  "XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED",
  "XPRIZE_EVIDENCE_RESPONSE_READY",
  "XPRIZE_EVIDENCE_RESPONSE_PRIVATE_CONTACT_CONFIGURED"
];

describe("Production launch XPRIZE evidence flags", () => {
  it("surfaces business, category, AI-native, IP, and evidence-response flags in the launch matrix", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const center = buildProductionLaunchCommandCenter(getDashboardSnapshot());
    const envByName = Object.fromEntries(center.envMatrix.map((item) => [item.name, item]));

    for (const name of launchEvidenceEnvNames) {
      expect(envByName[name]).toMatchObject({
        name,
        status: "missing",
        secret: false,
        currentValue: "missing"
      });
      expect(envByName[name].nextAction).toContain("before setting");
    }
  });

  it("keeps submission proof artifacts external-required until private evidence is attested", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const center = buildProductionLaunchCommandCenter(getDashboardSnapshot());
    const proofArtifactsById = Object.fromEntries(center.proofArtifacts.map((artifact) => [artifact.id, artifact]));

    expect(proofArtifactsById["business-model-proof"]).toMatchObject({ status: "external-required" });
    expect(proofArtifactsById["category-impact-proof"]).toMatchObject({ status: "external-required" });
    expect(proofArtifactsById["ai-native-operations-proof"]).toMatchObject({ status: "external-required" });
    expect(proofArtifactsById["evidence-response-readiness"]).toMatchObject({ status: "external-required" });
    expect(proofArtifactsById["working-product-access"]).toMatchObject({ status: "external-required" });
    expect(proofArtifactsById["license-ip-review"]).toMatchObject({ status: "external-required" });
    expect(proofArtifactsById["license-ip-review"].nextAction).toContain("IP ownership");
  });
});
