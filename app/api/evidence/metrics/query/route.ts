import { NextResponse } from "next/server";
import { queryEvidenceMetrics } from "@/lib/evidence-metrics";
import { getDashboardSnapshot } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { question?: string };
    const result = queryEvidenceMetrics(getDashboardSnapshot(), String(body.question ?? ""));
    return NextResponse.json(result, { status: result.blocked ? 400 : 200 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Evidence metrics query failed." },
      { status: 400 }
    );
  }
}
