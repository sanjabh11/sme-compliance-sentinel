import { describe, expect, it } from "vitest";
import { POST as postSynthesis } from "@/app/api/evidence/synthesis/route";
import { buildDeterministicSynthesisPack } from "@/lib/evidence-synthesis";
import type { EvidenceSynthesisPack } from "@/lib/types";
import { createDemoEvent, getDashboardSnapshot, ingestResourceEvent, resetState } from "@/lib/store";

describe("Notebook-style evidence synthesis", () => {
  it("builds cited synthesis packs with claim boundaries and human review", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const pack = buildDeterministicSynthesisPack(getDashboardSnapshot(), {
      packType: "ai-operations-proof"
    });

    expect(pack.title).toBe("AI Operations Proof Brief");
    expect(pack.sections.length).toBeGreaterThan(0);
    expect(pack.citations.length).toBeGreaterThan(0);
    expect(pack.citationCoverageScore).toBeGreaterThan(0);
    expect(pack.claimBoundaries.join(" ")).toContain("Not certification");
    expect(pack.executiveSummary).toContain("SOC2 readiness evidence only");
    expect(pack.humanReviewStatus).toBe("required");
  });

  it("keeps missing proof separate from supported facts", () => {
    resetState();

    const pack = buildDeterministicSynthesisPack(getDashboardSnapshot(), {
      packType: "business-evidence-brief",
      prompt: "Can we claim verified paid revenue and user proof?"
    });

    expect(pack.missingEvidence.join(" ")).toContain("Verified private invoice/payment evidence");
    expect(pack.provider).toBe("deterministic");
    expect(pack.redactionStatus).toBe("redacted");
  });

  it("serves synthesis through the route without requiring Gemini", async () => {
    resetState();
    const response = await postSynthesis(
      new Request("https://sentinel.example.com/api/evidence/synthesis", {
        method: "POST",
        body: JSON.stringify({ packType: "judge-summary" })
      })
    );
    const payload = (await response.json()) as EvidenceSynthesisPack;

    expect(response.status).toBe(200);
    expect(payload.packType).toBe("judge-summary");
    expect(payload.provider).toBe("deterministic");
    expect(payload.claimBoundaries.join(" ").toLowerCase()).toContain("not legal");
  });
});
