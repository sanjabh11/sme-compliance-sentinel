import { NextResponse } from "next/server";
import { verifyAnswerLibraryItem } from "@/lib/store";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(verifyAnswerLibraryItem(id));
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to verify answer library item."
      },
      { status: 404 }
    );
  }
}
