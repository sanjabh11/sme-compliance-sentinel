import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPilotLaunchPlan } from "@/lib/pilot-launch";
import { createDemoEvent, getDashboardSnapshot, ingestResourceEvent, resetState } from "@/lib/store";

describe("one-day pilot launch plan", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps the paid pilot offer concrete while blocking external proof gaps", () => {
    resetState();

    const plan = buildPilotLaunchPlan(getDashboardSnapshot());

    expect(plan.offer).toContain("$199 one-day Google Workspace risk scan");
    expect(plan.targetSegment).toContain("Seed-stage");
    expect(plan.launchReadinessScore).toBeGreaterThan(0);
    expect(plan.status).toBe("blocked");
    expect(plan.checklist.map((item) => item.id)).toContain("workspace-oauth");
    expect(plan.checklist.map((item) => item.id)).toContain("vault-proof");
    expect(plan.blockers.join(" ")).toContain("Live Workspace OAuth install");
    expect(plan.buyerObjections.some((item) => item.response.includes("human approval"))).toBe(true);
    expect(plan.disclaimer).toContain("does not guarantee winning");
  });

  it("reflects scan and remediation progress without hiding production blockers", async () => {
    resetState();
    const scan = await ingestResourceEvent(createDemoEvent("public-secret"));
    if (scan.finding) {
      const { approveFinding, remediateFinding } = await import("@/lib/store");
      approveFinding(scan.finding.id);
      remediateFinding(scan.finding.id);
    }

    const plan = buildPilotLaunchPlan(getDashboardSnapshot());
    const scanItem = plan.checklist.find((item) => item.id === "hybrid-scan-proof");
    const remediationItem = plan.checklist.find((item) => item.id === "hitl-remediation");

    expect(scanItem?.status).toBe("ready");
    expect(remediationItem?.status).toBe("ready");
    expect(plan.blockers.join(" ")).toContain("Live Workspace OAuth install");
    expect(plan.nextActions).toContain("Configure Google OAuth and GCP persistence, then run one real scan from Cloud Run.");
  });

  it("does not mark submission assets ready when URLs exist without judge access and demo clearance", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRODUCT_URL", "https://sentinel.example.com");
    vi.stubEnv("XPRIZE_REPOSITORY_URL", "https://github.com/example/sentinel");
    vi.stubEnv("XPRIZE_DEMO_VIDEO_URL", "https://youtu.be/sentinel-demo");
    vi.resetModules();

    const { buildPilotLaunchPlan } = await import("@/lib/pilot-launch");
    const { getDashboardSnapshot, resetState } = await import("@/lib/store");

    resetState();
    const plan = buildPilotLaunchPlan(getDashboardSnapshot());
    const submissionAssets = plan.checklist.find((item) => item.id === "submission-assets");

    expect(submissionAssets?.status).toBe("external-required");
    expect(submissionAssets?.label).toContain("judge access");
    expect(submissionAssets?.evidence).toContain("judge access missing");
    expect(submissionAssets?.evidence).toContain("under 3 minutes missing");
  });
});
