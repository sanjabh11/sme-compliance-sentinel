import { NextResponse } from "next/server";
import { markFindingFalsePositive } from "@/lib/store";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    return NextResponse.json(markFindingFalsePositive(id));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "False-positive update failed." },
      { status: 404 }
    );
  }
}
