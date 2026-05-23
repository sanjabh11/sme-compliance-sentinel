import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyRiskWithGemini } from "@/lib/gemini";
import { makeLowRiskThumbnailEvent, makePublicSecretDriveEvent } from "@/lib/mock-events";
import { scanResourceEvent } from "@/lib/scanner";

vi.mock("@/lib/gemini", () => ({
  estimateRiskClassificationCost: vi.fn(() => ({
    inputTokensEstimated: 120,
    outputTokensEstimated: 300,
    estimatedCostUsd: 0.0001
  })),
  classifyRiskWithGemini: vi.fn(async () => ({
    severity: "critical",
    confidence: 0.94,
    rationale: "Mock Gemini identified a public credential exposure.",
    soc2ReadinessMapping: ["CC6.1 logical access controls"],
    suggestedAction: "disable_public_sharing",
    blastRadius: "Anyone with the link can access the file.",
    summary: "Stage remediation for admin approval.",
    model: "gemini-3.5-flash",
    provider: "mock-gemini",
    inputTokensEstimated: 100,
    outputTokensEstimated: 30,
    estimatedCostUsd: 0.00002,
    fallbackReason: "api-key-missing"
  }))
}));

describe("hybrid scanner", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("skips low-risk metadata events before Gemini", async () => {
    vi.mocked(classifyRiskWithGemini).mockClear();
    const result = await scanResourceEvent(makeLowRiskThumbnailEvent());

    expect(result.decision.skipped).toBe(true);
    expect(result.decision.shouldRunGemini).toBe(false);
    expect(result.classification).toBeUndefined();
    expect(result.decision.counters.bytesRoutedToGemini).toBe(0);
    expect(classifyRiskWithGemini).not.toHaveBeenCalled();
  });

  it("routes public sensitive documents to Gemini and creates a recommendation draft", async () => {
    vi.mocked(classifyRiskWithGemini).mockClear();
    const result = await scanResourceEvent(makePublicSecretDriveEvent());

    expect(result.decision.skipped).toBe(false);
    expect(result.decision.shouldRunGemini).toBe(true);
    expect(result.decision.geminiGuardrail?.status).toBe("allowed");
    expect(result.decision.tiersRun).toContain("tier1_deterministic");
    expect(result.decision.tiersRun).not.toContain("tier1_sdp");
    expect(result.decision.deterministicFindings.length).toBeGreaterThan(0);
    expect(result.decision.deterministicFindings.every((finding) => finding.tier === "tier1_deterministic")).toBe(true);
    expect(result.findingDraft?.recommendation.humanApprovalRequired).toBe(true);
    expect(result.findingDraft?.recommendation.action).toBe("disable_public_sharing");
    expect(result.decision.counters.bytesRoutedToGemini).toBeGreaterThan(0);
    expect(result.classification?.fallbackReason).toBe("api-key-missing");
    expect(classifyRiskWithGemini).toHaveBeenCalledOnce();
  });

  it("labels Google Sensitive Data Protection findings only when the cloud adapter is actually attempted", async () => {
    vi.stubEnv("SENSITIVE_DATA_PROTECTION_ENABLED", "true");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "project_123");
    vi.stubEnv("GOOGLE_CLOUD_ACCESS_TOKEN", "access_token_123");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          result: {
            findings: [
              {
                infoType: { name: "EMAIL_ADDRESS" },
                quote: "owner@example.com",
                likelihood: "LIKELY",
                location: { byteRange: { start: "12" } }
              }
            ]
          }
        })
      )
    );
    vi.mocked(classifyRiskWithGemini).mockClear();

    const result = await scanResourceEvent(makePublicSecretDriveEvent());

    expect(result.decision.tiersRun).toContain("tier1_sdp");
    expect(result.decision.deterministicFindings.some((finding) => finding.tier === "tier1_sdp")).toBe(true);
    expect(result.decision.deterministicFindings.some((finding) => finding.quote === "[redacted-email]")).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("dlp.googleapis.com"), expect.objectContaining({ method: "POST" }));
  });

  it("blocks Gemini when the tenant budget is exhausted but still stages a deterministic finding", async () => {
    vi.mocked(classifyRiskWithGemini).mockClear();
    const result = await scanResourceEvent(makePublicSecretDriveEvent(), { currentGeminiSpendUsd: 50 });

    expect(result.decision.skipped).toBe(false);
    expect(result.decision.shouldRunGemini).toBe(false);
    expect(result.decision.geminiGuardrail?.status).toBe("blocked");
    expect(result.decision.geminiGuardrail?.reasons.join(" ")).toContain("exceeds monthly budget");
    expect(result.decision.tiersRun).not.toContain("tier2_gemini");
    expect(result.decision.counters.bytesRoutedToGemini).toBe(0);
    expect(result.classification?.provider).toBe("deterministic");
    expect(result.classification?.fallbackReason).toBe("guardrail-blocked");
    expect(result.findingDraft?.recommendation.humanApprovalRequired).toBe(true);
    expect(classifyRiskWithGemini).not.toHaveBeenCalled();
  });
});
