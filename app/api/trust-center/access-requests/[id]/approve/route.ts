import { NextResponse } from "next/server";
import { approveTrustAccessRequest } from "@/lib/store";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { decisionReason?: string };
    return NextResponse.json(approveTrustAccessRequest(id, body.decisionReason));
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Trust access approval failed."
      },
      { status: 400 }
    );
  }
}
