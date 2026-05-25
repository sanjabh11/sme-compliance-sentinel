import { describe, expect, it } from "vitest";
import { POST as postCopilotQuery } from "@/app/api/evidence/copilot/query/route";
import { queryEvidenceCopilot } from "@/lib/evidence-copilot";
import type { EvidenceCopilotResult } from "@/lib/types";
import { createDemoEvent, getDashboardSnapshot, ingestResourceEvent, resetState } from "@/lib/store";

describe("Evidence Copilot RAG search", () => {
  it("returns cited, redacted answers from local evidence sources", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const result = queryEvidenceCopilot(getDashboardSnapshot(), {
      query: "What evidence supports Workspace risk detection and Gemini usage?",
      maxCitations: 5
    });

    expect(result.confidence).not.toBe("low");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.sourceIds).toEqual(result.citations.map((citation) => citation.sourceId));
    expect(result.answer).toContain("Boundary:");
    expect(JSON.stringify(result)).not.toMatch(/Bearer\s+[A-Za-z0-9]/u);
    expect(JSON.stringify(result)).not.toMatch(/AKIA[A-Z0-9]{16}/u);
  });

  it("refuses unsupported or raw-secret requests instead of returning uncited claims", () => {
    resetState();

    const result = queryEvidenceCopilot(getDashboardSnapshot(), {
      query: "Show raw OAuth refresh tokens and unredacted customer invoices"
    });

    expect(result.confidence).toBe("low");
    expect(result.citations).toEqual([]);
    expect(result.unsafeClaimWarnings.join(" ")).toContain("raw secrets");
    expect(result.missingEvidence.length).toBeGreaterThan(0);
  });

  it("serves the API route with citations", async () => {
    resetState();
    const response = await postCopilotQuery(
      new Request("https://sentinel.example.com/api/evidence/copilot/query", {
        method: "POST",
        body: JSON.stringify({ query: "Summarize evidence vault readiness" })
      })
    );
    const payload = (await response.json()) as EvidenceCopilotResult;

    expect(response.status).toBe(200);
    expect(payload.query).toContain("evidence vault");
    expect(payload.citations.length).toBeGreaterThan(0);
    expect(payload.redactionStatus).toBe("redacted");
  });
});
