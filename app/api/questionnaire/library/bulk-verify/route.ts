import { NextResponse } from "next/server";
import { bulkVerifyAnswerLibraryItems } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      segment?: string;
      ownerRole?: "security" | "legal" | "founder" | "sales" | "engineering";
      maxItems?: number;
    };

    return NextResponse.json(bulkVerifyAnswerLibraryItems(body));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Answer Library bulk verification failed." },
      { status: 400 }
    );
  }
}
