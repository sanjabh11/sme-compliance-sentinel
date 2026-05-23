import { afterEach, describe, expect, it, vi } from "vitest";
import { makeSyntheticGeminiSmokeEvent } from "@/lib/mock-events";
import { buildProductionGeminiProofStatus, buildProductionGeminiSmokeResult } from "@/lib/production-gemini";
import { getDashboardSnapshot, ingestResourceEvent, resetState } from "@/lib/store";

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      generateContent: vi.fn().mockResolvedValue({
        response: {
          text: () =>
            JSON.stringify({
              severity: "high",
              confidence: 0.91,
              rationale: "Synthetic fixture indicates a public token-like value and needs staged review.",
              soc2ReadinessMapping: ["CC6.1 logical access controls"],
              suggestedAction: "disable_public_sharing",
              blastRadius: "Synthetic public-link exposure used only for deployment proof.",
              summary: "Synthetic Gemini smoke completed with no customer data."
            })
        }
      })
    })
  }))
}));

describe("production Gemini proof smoke", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetState();
  });

  it("reports blocked status when no agent-run evidence exists", () => {
    resetState();

    const status = buildProductionGeminiProofStatus(getDashboardSnapshot());

    expect(status.status).toBe("blocked");
    expect(status.nextAction).toContain("GEMINI_API_KEY");
    expect(status.privateHandling.join(" ")).toContain("synthetic");
  });

  it("does not misreport missing API-key fallback as live Gemini proof", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    resetState();

    const event = makeSyntheticGeminiSmokeEvent();
    const result = buildProductionGeminiSmokeResult(event, await ingestResourceEvent(event));

    expect(result.status).toBe("mock-only");
    expect(result.provider).toBe("mock-gemini");
    expect(result.fallbackReason).toBe("api-key-missing");
    expect(result.proofSummary).toContain("must not be counted");
  });

  it("records provider=gemini-api proof when the deployed Gemini client succeeds", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only-key");
    resetState();

    const event = makeSyntheticGeminiSmokeEvent();
    const result = buildProductionGeminiSmokeResult(event, await ingestResourceEvent(event));
    const status = buildProductionGeminiProofStatus(getDashboardSnapshot());

    expect(result.status).toBe("passed");
    expect(result.provider).toBe("gemini-api");
    expect(result.agentRunId).toBeTruthy();
    expect(result.decisionSummary).toContain("Synthetic non-customer fixture");
    expect(status.status).toBe("passed");
    expect(status.provider).toBe("gemini-api");
    expect(getDashboardSnapshot().agentRuns[0].promptSummary).toContain("Synthetic Gemini smoke fixture");
  });
});
