import { NextResponse } from "next/server";
import { createQuestionnaireResponsePack, getDashboardSnapshot } from "@/lib/store";

export async function GET() {
  return NextResponse.json({ packs: getDashboardSnapshot().questionnairePacks });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      customerAlias?: string;
      customerSegment?: string;
      questionnaireText?: string;
      source?: "uploaded-text" | "csv" | "tsv" | "spreadsheet-text" | "pdf-text";
      originalFileName?: string;
    };
    return NextResponse.json(createQuestionnaireResponsePack(body));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Questionnaire response pack failed." },
      { status: 400 }
    );
  }
}
