import { NextResponse } from "next/server";
import { remediateFinding } from "@/lib/store";
import type { RecommendationAction } from "@/lib/types";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { action?: RecommendationAction };

  try {
    return NextResponse.json(remediateFinding(id, body.action));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Remediation failed." },
      { status: 409 }
    );
  }
}
