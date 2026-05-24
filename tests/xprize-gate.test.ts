import { describe, expect, it } from "vitest";
import { buildXPrizeSubmissionGate } from "@/lib/xprize-gate";
import { createDemoEvent, getDashboardSnapshot, ingestResourceEvent, resetState } from "@/lib/store";

describe("XPRIZE submission gate", () => {
  it("blocks submission readiness when proof is still local or mock-only", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const gate = buildXPrizeSubmissionGate(getDashboardSnapshot());
    const checksById = Object.fromEntries(gate.checks.map((check) => [check.id, check]));

    expect(gate.overallStatus).toBe("blocked");
    expect(gate.factualWinConfidence).toBeLessThan(100);
    expect(gate.checks.length).toBeGreaterThanOrEqual(10);
    expect(checksById["category-small-business"].status).toBe("passed");
    expect(checksById["new-project-provenance"].status).toBe("blocked");
    expect(checksById["entrant-identity"].status).toBe("blocked");
    expect(checksById["entrant-identity"].fix).toContain("XPRIZE_ENTRANT_TYPE");
    expect(checksById["general-eligibility"].status).toBe("blocked");
    expect(checksById["general-eligibility"].fix).toContain("eligibility review");
    expect(checksById["claim-guard"].status).toBe("passed");
    expect(checksById["human-approval"].status).toBe("passed");
    expect(checksById["related-party-separation"].status).toBe("passed");
    expect(checksById["google-cloud-product"].status).toBe("blocked");
    expect(checksById["google-cloud-product"].fix).toContain("XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED");
    expect(checksById["gemini-api-production"].status).toBe("warning");
    expect(checksById["gemini-api-production"].fix).toContain("XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED");
    expect(checksById["ai-business-operations"].status).toBe("warning");
    expect(checksById["ai-business-operations"].fix).toContain("BigQuery agent-run");
    expect(checksById["workspace-production-sync"].status).toBe("blocked");
    expect(checksById["revenue-arms-length"].status).toBe("blocked");
    expect(checksById["cloud-cost-controls"].status).toBe("blocked");
    expect(checksById["cloud-cost-controls"].fix).toContain("Cloud Billing budget");
    expect(checksById["product-url"].status).toBe("blocked");
    expect(checksById["product-url"].fix).toContain("XPRIZE_WORKING_PROJECT_ACCESS_CONFIGURED");
    expect(checksById["repository-url"].status).toBe("blocked");
    expect(checksById["repository-url"].fix).toContain("XPRIZE_REPOSITORY_ACCESS_CONFIGURED");
    expect(checksById["repository-url"].fix).toContain("XPRIZE_SOURCE_CODE_COMPLETE_CONFIRMED");
    expect(checksById["demo-video"].status).toBe("blocked");
    expect(checksById["demo-video"].fix).toContain("demo-video clearance flags");
    expect(gate.blockingSummary.join(" ")).toContain("Deploy");
  });
});
