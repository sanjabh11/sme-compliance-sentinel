import { describe, expect, it } from "vitest";
import { POST as postDocumentAnalyze } from "@/app/api/evidence/documents/analyze/route";
import { analyzeEvidenceDocument, checksumDocumentText, normalizeDocumentText } from "@/lib/evidence-document-scanner";
import type { EvidenceDocumentAnalysisResult } from "@/lib/types";

describe("multimodal evidence document scanner", () => {
  it("normalizes PDF text and routes SOC2 readiness documents", () => {
    const text = "SOC2 readiness evidence\n\nCC6.1 access controls reviewed on 2026-05-24.\nContact security@example.com.";
    const result = analyzeEvidenceDocument({
      documentName: "soc2-readiness.pdf",
      inputKind: "pdf-text",
      text,
      checksumSha256: checksumDocumentText(text)
    });

    expect(result.documentKind).toBe("soc2-readiness");
    expect(result.detectedDates).toContain("2026-05-24");
    expect(result.evidenceVaultSuggestion.kind).toBe("trust-policy");
    expect(result.normalizedTextPreview).toContain("[redacted-email]");
    expect(result.checksumValid).toBe(true);
    expect(result.citations[0]?.page).toBe(1);
  });

  it("handles image-only placeholders without making text claims", () => {
    const result = analyzeEvidenceDocument({
      documentName: "cloud-run-screenshot.png",
      inputKind: "image-metadata",
      metadata: { width: 1440, height: 900 }
    });

    expect(result.documentKind).toBe("image-only");
    expect(result.blockers.join(" ")).toContain("OCR or Document AI");
    expect(result.normalizedTextPreview).toContain("Image-only evidence placeholder");
  });

  it("redacts PII and requires checksum validation for invoices", () => {
    const result = analyzeEvidenceDocument({
      documentName: "pilot-invoice.txt",
      inputKind: "invoice",
      text: "Invoice INV-12345 Bill To: Private Buyer customer@example.com Card 4111 1111 1111 1111"
    });

    expect(result.documentKind).toBe("invoice");
    expect(result.sensitiveMarkers).toEqual(expect.arrayContaining(["email-address", "payment-card-like-pattern"]));
    expect(result.normalizedTextPreview).toContain("[redacted-email]");
    expect(result.normalizedTextPreview).toContain("[redacted-card]");
    expect(result.checksumValid).toBe(false);
    expect(result.evidenceVaultSuggestion.kind).toBe("pilot-invoice");
  });

  it("normalizes spreadsheet text for Evidence Vault routing", () => {
    const normalized = normalizeDocumentText("Month,MRR,Users\nMay,199,2", "csv");
    const result = analyzeEvidenceDocument({
      documentName: "payments.csv",
      inputKind: "csv",
      text: normalized,
      checksumSha256: checksumDocumentText(normalized)
    });

    expect(normalized).toContain("Month | MRR | Users");
    expect(result.documentKind).toBe("spreadsheet");
    expect(result.evidenceVaultSuggestion.kind).toBe("payment-export");
    expect(result.checksumValid).toBe(true);
  });

  it("serves scanner results through the route", async () => {
    const response = await postDocumentAnalyze(
      new Request("https://sentinel.example.com/api/evidence/documents/analyze", {
        method: "POST",
        body: JSON.stringify({
          documentName: "security-questionnaire.txt",
          inputKind: "security-questionnaire",
          text: "How do you monitor Google Workspace for sensitive-data exposure?"
        })
      })
    );
    const payload = (await response.json()) as EvidenceDocumentAnalysisResult;

    expect(response.status).toBe(200);
    expect(payload.documentKind).toBe("security-questionnaire");
    expect(payload.citations.length).toBeGreaterThan(0);
  });
});
