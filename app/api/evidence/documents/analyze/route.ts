import { NextResponse } from "next/server";
import { analyzeEvidenceDocument } from "@/lib/evidence-document-scanner";
import type { EvidenceDocumentAnalysisRequest, EvidenceDocumentInputKind } from "@/lib/types";

const inputKinds: EvidenceDocumentInputKind[] = [
  "pdf-text",
  "csv",
  "tsv",
  "spreadsheet-text",
  "image-metadata",
  "security-questionnaire",
  "contract",
  "invoice",
  "soc2-readiness",
  "gcp-proof",
  "plain-text"
];

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<EvidenceDocumentAnalysisRequest>;
    const inputKind = inputKinds.includes(body.inputKind as EvidenceDocumentInputKind)
      ? (body.inputKind as EvidenceDocumentInputKind)
      : "plain-text";
    const result = analyzeEvidenceDocument({
      documentName: String(body.documentName ?? "Untitled evidence document"),
      inputKind,
      text: typeof body.text === "string" ? body.text : undefined,
      metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : undefined,
      checksumSha256: typeof body.checksumSha256 === "string" ? body.checksumSha256 : undefined
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Evidence document analysis failed." },
      { status: 400 }
    );
  }
}
