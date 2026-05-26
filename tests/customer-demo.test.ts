import { describe, expect, it } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import { buildCustomerDemoCopyBundle, customerDemoFeatures } from "@/lib/customer-demo";

describe("customer demo mode", () => {
  it("defines a complete 20-feature customer showcase sequence", () => {
    expect(customerDemoFeatures).toHaveLength(20);
    expect(customerDemoFeatures.map((feature) => feature.rank)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(customerDemoFeatures[0].feature).toBe("One-day Workspace Risk Scan");
    expect(customerDemoFeatures[19].feature).toBe("Paid Pilot Conversion Kit");
  });

  it("keeps customer-facing copy inside claim and privacy boundaries", () => {
    const bundle = buildCustomerDemoCopyBundle();
    const text = JSON.stringify(bundle, null, 2);
    const forbiddenCustomerDemoTerms = [
      "XPRIZE",
      "Devpost",
      "Judge",
      "Cloud Run",
      "source-release",
      "license/IP",
      "MRR",
      "$1,194",
      "/secure/local"
    ];

    expect(scanClaimText({ artifact: "customer-demo", text })).toEqual([]);
    for (const term of forbiddenCustomerDemoTerms) {
      expect(text).not.toContain(term);
    }
    expect(text).toContain("Sample data only");
    expect(text).toContain("SOC2 readiness evidence");
    expect(text).toContain("Consent-first scan setup");
    expect(text).toContain("Will AI read every file?");
    expect(text).toContain("Sample risk movement after approval");
  });
});
