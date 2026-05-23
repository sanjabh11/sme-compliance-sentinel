import { describe, expect, it } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import { buildSubmissionComplianceCenter } from "@/lib/submission-compliance";
import { getDashboardSnapshot, resetState } from "@/lib/store";

describe("submission compliance gate", () => {
  it("blocks Devpost logistics and evidence-response gaps without overstating local readiness", () => {
    resetState();

    const center = buildSubmissionComplianceCenter(getDashboardSnapshot());
    const checksById = Object.fromEntries(center.checks.map((check) => [check.id, check]));

    expect(center.overallStatus).toBe("blocked");
    expect(center.summary.blocked).toBeGreaterThan(0);
    expect(checksById["new-project-provenance"].status).toBe("blocked");
    expect(checksById["general-eligibility"].status).toBe("blocked");
    expect(checksById["general-eligibility"].fix).toContain("XPRIZE_GENERAL_ELIGIBILITY_CONFIRMED");
    expect(checksById["organization-corporate-id"].status).toBe("blocked");
    expect(checksById["organization-corporate-id"].fix).toContain("XPRIZE_ENTRANT_TYPE");
    expect(checksById["repository-access"].status).toBe("blocked");
    expect(checksById["product-access"].status).toBe("blocked");
    expect(checksById["product-access"].evidence).toContain("free judging-period access missing");
    expect(checksById["demo-video-clearance"].status).toBe("blocked");
    expect(checksById["demo-video-clearance"].fix).toContain("demo-video clearance env flags");
    expect(checksById["third-party-license-manifest"].status).toBe(center.thirdPartyManifestSummary.status);
    expect(center.thirdPartyManifestSummary.totalPackages).toBeGreaterThan(10);
    expect(center.thirdPartyManifestSummary.directRuntimeDependencies).toBeGreaterThanOrEqual(5);
    expect(center.demoAssetChecklist).toHaveLength(5);
    expect(center.repositoryDisclosure.join(" ")).toContain("pre-existing frameworks");
    expect(center.nextActions[0]).toContain("May 19, 2026");
  });

  it("keeps compliance copy inside the claim guard boundary", () => {
    const center = buildSubmissionComplianceCenter(getDashboardSnapshot());
    const violations = scanClaimText({
      artifact: "submission-compliance",
      text: JSON.stringify(center, null, 2)
    });

    expect(violations).toEqual([]);
  });
});
