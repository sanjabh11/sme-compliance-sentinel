import { NextResponse } from "next/server";
import { rescanFinding } from "@/lib/store";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    return NextResponse.json(await rescanFinding(id));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Re-scan failed." }, { status: 404 });
  }
}
