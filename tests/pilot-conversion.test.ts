import { describe, expect, it } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import { buildPilotConversionKit } from "@/lib/pilot-conversion";
import { createDemoEvent, getDashboardSnapshot, ingestResourceEvent, resetState } from "@/lib/store";

describe("paid pilot conversion kit", () => {
  it("builds a close-ready workflow without treating local proof as revenue evidence", () => {
    resetState();

    const kit = buildPilotConversionKit(getDashboardSnapshot());
    const copy = [
      ...kit.closeNarrative,
      ...kit.closeAssets.map((asset) => [asset.copy, asset.claimBoundary].join("\n")),
      kit.disclaimer
    ].join("\n");

    expect(kit.offer).toContain("$199 one-day Google Workspace risk scan");
    expect(kit.status).toBe("blocked");
    expect(kit.targetProspect?.fitScore).toBeGreaterThanOrEqual(80);
    expect(kit.conversionSteps.map((step) => step.id)).toEqual(
      expect.arrayContaining(["invoice-payment", "workspace-install", "run-scan", "package-evidence"])
    );
    expect(kit.closeAssets.map((asset) => asset.id)).toEqual(
      expect.arrayContaining(["founder-email", "pilot-proposal", "consent-clause", "invoice-checklist"])
    );
    expect(kit.evidenceChecklist.map((item) => item.id)).toEqual(
      expect.arrayContaining(["pilot-invoice", "payment-export", "pilot-consent", "workspace-oauth-log", "gemini-usage-log"])
    );
    expect(kit.blockers.join(" ")).toContain("SENTINEL_EVIDENCE_MODE");
    expect(kit.disclaimer).toContain("does not create revenue");
    expect(scanClaimText({ artifact: "pilot-conversion-kit", text: copy })).toEqual([]);
  });

  it("reflects scan proof once a high-risk event creates an agent run and finding", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const kit = buildPilotConversionKit(getDashboardSnapshot());
    const scanStep = kit.conversionSteps.find((step) => step.id === "run-scan");

    expect(scanStep?.status).toBe("ready");
    expect(scanStep?.proofSurface).toBe("/api/agent-runs");
    expect(kit.conversionScore).toBeGreaterThan(0);
  });
});
