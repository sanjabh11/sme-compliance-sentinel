import { NextResponse } from "next/server";
import { approveFinding } from "@/lib/store";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    return NextResponse.json(approveFinding(id));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Approval failed." }, { status: 404 });
  }
}
