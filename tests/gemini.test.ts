import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyRiskWithGemini } from "@/lib/gemini";
import { makePublicSecretDriveEvent } from "@/lib/mock-events";

describe("Gemini classifier evidence metadata", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("labels mock Gemini fallback when the API key is missing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    const classification = await classifyRiskWithGemini(makePublicSecretDriveEvent(), [
      {
        type: "AWS_SECRET_ACCESS_KEY",
        quote: "AWS_SECRET_ACCESS_KEY = [redacted-secret]",
        likelihood: "likely",
        tier: "tier1_deterministic"
      }
    ]);

    expect(classification.provider).toBe("mock-gemini");
    expect(classification.fallbackReason).toBe("api-key-missing");
    expect(classification.errorClass).toBeUndefined();
    expect(classification.estimatedCostUsd).toBeGreaterThan(0);
  });
});
