import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeSyntheticGeminiSmokeEvent } from "@/lib/mock-events";
import { buildProductionGeminiProofStatus, buildProductionGeminiSmokeResult } from "@/lib/production-gemini";
import { getDashboardSnapshot, ingestResourceEvent, resetState } from "@/lib/store";

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function GoogleGenAIMock() {
    return {
    models: {
      generateContent: vi.fn(async function generateContentMock() {
        return {
        text: JSON.stringify({
          severity: "high",
          confidence: 0.91,
          rationale: "Synthetic fixture indicates a public token-like value and needs staged review.",
          soc2ReadinessMapping: ["CC6.1 logical access controls"],
          suggestedAction: "disable_public_sharing",
          blastRadius: "Synthetic public-link exposure used only for deployment proof.",
          summary: "Synthetic Gemini smoke completed with no customer data."
        })
        };
      })
    }
    };
  })
}));

describe("Gemini SDK selection", () => {
  it("uses the current Google GenAI SDK instead of the legacy Gemini package", () => {
    const source = readFileSync(join(process.cwd(), "lib/gemini.ts"), "utf8");

    expect(source).toContain("@google/genai");
    expect(source).not.toContain("@google/generative-ai");
  });
});

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

  it("uses durable BigQuery Gemini evidence when Cloud Run memory has reset", async () => {
    vi.resetModules();
    vi.stubEnv("SENTINEL_STORAGE_MODE", "gcp-rest");
    vi.stubEnv("SENTINEL_TENANT_ID", "tenant_fresh_cloudrun_proof");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "sme-sentinel-xp-06021149");
    vi.stubEnv("BIGQUERY_DATASET", "sentinel_evidence");
    vi.stubEnv("BIGQUERY_AGENT_RUNS_TABLE", "agent_runs");
    vi.stubEnv("GEMINI_MODEL", "gemini-2.5-flash");

    const { buildProductionGeminiProofStatusWithDurableEvidence } = await import("@/lib/production-gemini");
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);

      if (target.includes("metadata.google.internal")) {
        return new Response(JSON.stringify({ access_token: "test-access-token" }), { status: 200 });
      }

      if (target.includes("bigquery.googleapis.com")) {
        expect(String(init?.body)).toContain("provider = 'gemini-api'");
        return new Response(
          JSON.stringify({
            rows: [
              {
                f: [
                  { v: "agent_durable_1" },
                  { v: "evt_gemini_smoke_1" },
                  { v: "finding_1" },
                  { v: "semantic_risk_audit" },
                  { v: "gemini-2.5-flash" },
                  { v: "gemini-api" },
                  { v: "0.000151" },
                  { v: "2026-06-02T06:44:35.000Z" }
                ]
              }
            ]
          }),
          { status: 200 }
        );
      }

      return new Response("not found", { status: 404 });
    });

    const status = await buildProductionGeminiProofStatusWithDurableEvidence(
      { agentRuns: [], auditEvents: [], findings: [] },
      fetchImpl as unknown as typeof fetch
    );

    expect(status.status).toBe("passed");
    expect(status.provider).toBe("gemini-api");
    expect(status.agentRunId).toBe("agent_durable_1");
    expect(status.proofSummary).toContain("BigQuery agent_runs");
  });
});
