import { describe, expect, it } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import { buildDevpostSubmissionPack } from "@/lib/devpost-submission";
import { createDemoEvent, getDashboardSnapshot, ingestResourceEvent, resetState } from "@/lib/store";

describe("Devpost submission pack", () => {
  it("generates claim-safe copy and keeps missing production proof blocked", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const pack = buildDevpostSubmissionPack(getDashboardSnapshot());

    expect(pack.overallStatus).toBe("blocked");
    expect(pack.title).toBe("SME Workspace Sentinel");
    expect(pack.category).toBe("Small Business Services");
    expect(pack.publicDescription.copy).toContain("Gemini");
    expect(pack.googleStack.status).toBe("blocked");
    expect(pack.tractionEvidence.status).toBe("blocked");
    expect(pack.blockers.join(" ")).toContain("Deploy");
    expect(pack.claimBoundaries.join(" ")).toContain("SOC2 readiness evidence");
    expect(pack.claimBoundaries.join(" ")).toContain("Antigravity");

    const violations = scanClaimText({
      artifact: "devpost-pack",
      text: JSON.stringify(pack, null, 2)
    });

    expect(violations).toEqual([]);
  });

  it("includes an under-three-minute demo plan and the critical screenshot targets", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const pack = buildDevpostSubmissionPack(getDashboardSnapshot());
    const screenshotIds = pack.screenshotChecklist.map((item) => item.id);
    const finalTimestamp = pack.demoVideoScript.at(-1)?.timestamp ?? "";

    expect(pack.demoVideoScript).toHaveLength(6);
    expect(finalTimestamp).toContain("2:55");
    expect(pack.demoVideoScript.map((scene) => scene.scene)).toEqual([
      "Problem and category",
      "Hybrid scanner",
      "Gemini semantic audit",
      "Human-approved remediation",
      "Business and trust evidence",
      "Submission gates"
    ]);
    expect(screenshotIds).toEqual(
      expect.arrayContaining(["submission-gate", "evidence-room", "prospect-pipeline", "license-manifest", "devpost-pack"])
    );
    expect(pack.screenshotChecklist.find((item) => item.id === "license-manifest")?.status).toBe("blocked");
    expect(pack.testingInstructionsDraft.join(" ")).toContain("Devpost testing instructions");
    expect(pack.testingInstructionsDraft.join(" ")).toContain("Product access clearance");
    expect(pack.testingInstructionsDraft.join(" ")).toContain("Demo video clearance");
    expect(pack.demoVideoScript.at(-1)?.proofShown).toContain("demo video clearance");
    expect(pack.privateEvidenceResponse.map((item) => item.id)).toEqual(
      expect.arrayContaining(["revenue-cost-cac", "ai-operation-proof", "license-and-ip-proof"])
    );
    expect(pack.privateEvidenceResponse.find((item) => item.id === "license-and-ip-proof")?.status).toBe("missing");
  });
});
