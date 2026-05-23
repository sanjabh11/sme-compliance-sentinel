import { afterEach, describe, expect, it, vi } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import { buildXPrizeSubmissionBinder } from "@/lib/submission-binder";
import { createDemoEvent, getDashboardSnapshot, ingestResourceEvent, resetState } from "@/lib/store";

describe("XPRIZE submission binder", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds a private artifact manifest without treating mock evidence as ready", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const binder = buildXPrizeSubmissionBinder(getDashboardSnapshot());
    const artifactsById = Object.fromEntries(binder.artifactManifest.map((artifact) => [artifact.id, artifact]));

    expect(binder.overallStatus).toBe("blocked");
    expect(binder.judgeResponseSlaHours).toBe(48);
    expect(binder.artifactSummary.missing).toBeGreaterThan(0);
    expect(binder.testingInstructions.find((item) => item.label === "Working product URL")?.status).toBe("missing");
    expect(binder.testingInstructions.find((item) => item.label === "Judge access instructions")?.status).toBe("missing");
    expect(artifactsById["gate_gemini-api-production"].status).toBe("mock-only");
    expect(artifactsById["gate_google-cloud-product"].status).toBe("missing");
    expect(artifactsById["gate_cloud-cost-controls"].source).toBe("/api/production/cost-controls");
    expect(artifactsById["supplemental_devpost_submission_pack"].source).toBe("/api/xprize/devpost-pack");
    expect(artifactsById["supplemental_devpost_submission_pack"].status).toBe("missing");
    expect(artifactsById["supplemental_license_manifest"].source).toBe("/api/xprize/license-manifest");
    expect(artifactsById["supplemental_submission_compliance"].source).toBe("/api/xprize/submission-compliance");
    expect(artifactsById["supplemental_submission_compliance"].status).toBe("missing");
    expect(binder.privateEvidenceRequestQueue.find((item) => item.id === "financial-documentation")?.status).toBe("missing");
    expect(binder.privateEvidenceRequestQueue.find((item) => item.id === "cloud-cost-control-proof")?.status).toBe("missing");
    expect(binder.privateEvidenceRequestQueue.find((item) => item.id === "production-ai-logs")?.status).toBe("mock-only");
  });

  it("keeps binder language inside the claim guard boundary", async () => {
    resetState();

    const binder = buildXPrizeSubmissionBinder(getDashboardSnapshot());
    const violations = scanClaimText({
      artifact: "submission-binder",
      text: JSON.stringify(binder, null, 2)
    });

    expect(violations).toEqual([]);
    expect(binder.claimBoundary.join(" ")).toContain("SOC2 readiness evidence");
    expect(binder.claimBoundary.join(" ")).toContain("not an app requirement");
  });

  it("keeps URL-only product and demo entries missing until access and video clearance are confirmed", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRODUCT_URL", "https://sentinel.example.com");
    vi.stubEnv("XPRIZE_REPOSITORY_URL", "https://github.com/example/sentinel");
    vi.stubEnv("XPRIZE_DEMO_VIDEO_URL", "https://youtu.be/sentinel-demo");
    vi.resetModules();

    const { buildXPrizeSubmissionBinder } = await import("@/lib/submission-binder");
    const { getDashboardSnapshot, resetState } = await import("@/lib/store");

    resetState();
    const binder = buildXPrizeSubmissionBinder(getDashboardSnapshot());
    const instructionsByLabel = Object.fromEntries(binder.testingInstructions.map((item) => [item.label, item]));
    const artifactsById = Object.fromEntries(binder.artifactManifest.map((artifact) => [artifact.id, artifact]));

    expect(instructionsByLabel["Working product URL"].status).toBe("missing");
    expect(instructionsByLabel["Working product URL"].value).toContain("judge access missing");
    expect(instructionsByLabel["Repository URL"].status).toBe("ready");
    expect(instructionsByLabel["Public demo video"].status).toBe("missing");
    expect(instructionsByLabel["Public demo video"].value).toContain("asset clearance missing");
    expect(artifactsById["gate_demo-video"].status).toBe("missing");
  });
});
