import { describe, expect, it } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import { buildDemoVideoCompliancePack } from "@/lib/demo-video";
import { createDemoEvent, getDashboardSnapshot, ingestResourceEvent, resetState } from "@/lib/store";

describe("Demo video compliance pack", () => {
  it("turns the Devpost script into strict rule and clearance gates", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const pack = buildDemoVideoCompliancePack(getDashboardSnapshot());
    const checksById = Object.fromEntries(pack.checks.map((check) => [check.id, check]));

    expect(pack.overallStatus).toBe("blocked");
    expect(pack.plannedDurationSeconds).toBe(175);
    expect(pack.maximumAllowedSeconds).toBe(180);
    expect(pack.bufferSeconds).toBe(5);
    expect(pack.allowedPlatforms).toEqual(["YouTube", "Vimeo", "Youku"]);
    expect(pack.sourceUrls).toContain("https://www.geminixprize.com/rules");
    expect(pack.scenes).toHaveLength(6);
    expect(pack.releaseProofChecklist).toHaveLength(7);
    expect(pack.scenes[0]).toMatchObject({
      startSecond: 0,
      endSecond: 20,
      durationSeconds: 20,
      assetRiskLevel: "low"
    });
    expect(pack.scenes.map((scene) => scene.ruleCoverage).flat()).toContain("gemini-api-proof");

    expect(checksById["planned-under-three-minutes"].status).toBe("passed");
    expect(checksById["public-video-url"].status).toBe("blocked");
    expect(checksById["accepted-video-platform"].status).toBe("blocked");
    expect(checksById["english-or-subtitled-confirmed"].status).toBe("blocked");
    expect(checksById["asset-clearance-confirmed"].status).toBe("blocked");
    expect(checksById["customer-data-redaction-confirmed"].status).toBe("blocked");
    expect(checksById["functioning-product-footage"].status).toBe("passed");
    expect(checksById["live-gemini-proof-scene"].status).toBe("blocked");
    expect(checksById["claim-safe-script"].status).toBe("passed");
    expect(pack.blockers.join(" ")).toContain("Public demo-video URL");
    expect(pack.blockers.join(" ")).toContain("Hosted product footage source");
    expect(pack.releaseProofChecklist.find((item) => item.id === "deployed-gemini-api-proof")).toMatchObject({
      status: "blocked",
      requiredBeforePublicUpload: true
    });
    expect(pack.releaseProofChecklist.find((item) => item.id === "business-evidence-boundary")).toMatchObject({
      status: "warning",
      requiredBeforePublicUpload: false
    });
    expect(pack.recordingChecklist.join(" ")).toContain("English narration");
    expect(pack.narrationGuardrails.join(" ")).toContain("do not imply certification");

    const violations = scanClaimText({
      artifact: "demo-video-pack",
      text: JSON.stringify(pack, null, 2)
    });

    expect(violations).toEqual([]);
  });
});
