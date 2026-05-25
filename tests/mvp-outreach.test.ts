import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/mvp/outreach-plan/route";
import { scanClaimText } from "@/lib/claim-guard";
import { resolveProductUrlFromEnv } from "@/lib/config";
import { buildMvpOutreachPlan } from "@/lib/mvp-outreach";
import { createDemoEvent, getDashboardSnapshot, ingestResourceEvent, resetState } from "@/lib/store";

describe("MVP outreach plan", () => {
  it("packages the current MVP into a claim-safe outreach plan without creating external proof", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const plan = buildMvpOutreachPlan(getDashboardSnapshot());

    expect(plan.headline).toBe("One-day Google Workspace risk scan that turns security gaps into buyer-ready trust evidence.");
    expect(plan.leadFeatures.map((feature) => feature.feature)).toEqual(
      expect.arrayContaining(["One-day Workspace Risk Scan", "Trust Packet and Evidence Export", "Claim Guard"])
    );
    expect(plan.gapFixes.map((gap) => gap.bucket)).toEqual(
      expect.arrayContaining(["code-controllable", "external-proof", "human-attestation"])
    );
    expect(plan.manualInterventions.join(" ")).toContain("arms-length prospect");
    expect(plan.proofBoundary).toContain("does not create customer consent");
    expect(scanClaimText({ artifact: "mvp-outreach-plan", text: JSON.stringify(plan, null, 2) })).toEqual([]);
  });

  it("uses Vercel deployment environment URLs when NEXT_PUBLIC_PRODUCT_URL is not set", async () => {
    resetState();
    const hostedUrl = resolveProductUrlFromEnv({
      NEXT_PUBLIC_PRODUCT_URL: "",
      VERCEL_PROJECT_PRODUCTION_URL: "",
      VERCEL_URL: "sme-workspace-sentinel-demo.vercel.app"
    });
    const plan = buildMvpOutreachPlan(getDashboardSnapshot(), { productUrl: hostedUrl });

    expect(plan.hostedUrl).toBe("https://sme-workspace-sentinel-demo.vercel.app");
    expect(plan.hostedUrlStatus).toBe("configured");
    expect(plan.status).not.toBe("needs-deployment");
  });

  it("exposes a read-only API route for the dashboard", async () => {
    resetState();

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.headline).toContain("One-day Google Workspace risk scan");
    expect(payload.gapFixes.some((gap: { bucket: string }) => gap.bucket === "external-proof")).toBe(true);
  });
});
