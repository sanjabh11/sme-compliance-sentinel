import { NextResponse } from "next/server";
import { approveQuestionnaireAnswer } from "@/lib/store";

export async function POST(_request: Request, context: { params: Promise<{ id: string; answerId: string }> }) {
  const { id, answerId } = await context.params;

  try {
    return NextResponse.json(approveQuestionnaireAnswer(id, answerId));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Questionnaire answer approval failed." },
      { status: 404 }
    );
  }
}
