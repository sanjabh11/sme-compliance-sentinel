import { describe, expect, it } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import { buildMarketPositioningCommandCenter } from "@/lib/market-positioning";
import { createDemoEvent, getDashboardSnapshot, ingestResourceEvent, resetState } from "@/lib/store";

describe("market positioning command center", () => {
  it("compares Sentinel against incumbent trust platforms and keeps the narrow wedge explicit", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const positioning = buildMarketPositioningCommandCenter(getDashboardSnapshot());

    expect(positioning.overallStatus).toBe("needs-proof");
    expect(positioning.targetSegment).toContain("Seed-stage");
    expect(positioning.usp).toContain("one-day Google Workspace risk scan");
    expect(positioning.competitorComparisons.map((item) => item.name)).toEqual(["Vanta", "Drata", "Secureframe"]);
    expect(positioning.competitorComparisons.every((item) => item.wedgeScore > 0)).toBe(true);
    expect(positioning.topDifferentiators).toHaveLength(5);
    expect(positioning.parityGaps.map((gap) => gap.label)).toContain("Live customer traction");
    expect(positioning.buyerNarrative.join(" ")).toContain("not fight them head-on");
    expect(positioning.sources).toEqual(
      expect.arrayContaining(["https://www.vanta.com/", "https://drata.com/products", "https://secureframe.com/"])
    );
  });

  it("keeps battlecard language inside claim boundaries", async () => {
    resetState();

    const positioning = buildMarketPositioningCommandCenter(getDashboardSnapshot());
    const violations = scanClaimText({
      artifact: "market-positioning",
      text: JSON.stringify(positioning, null, 2)
    });

    expect(violations).toEqual([]);
    expect(positioning.marketRisks.join(" ")).toContain("Incumbents");
    expect(positioning.proofActions.join(" ")).toContain("Workspace risk scan");
  });
});
