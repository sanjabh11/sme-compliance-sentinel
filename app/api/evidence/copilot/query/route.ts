import { NextResponse } from "next/server";
import { queryEvidenceCopilot } from "@/lib/evidence-copilot";
import { getDashboardSnapshot } from "@/lib/store";
import type { EvidenceCopilotQuery } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<EvidenceCopilotQuery>;
    const result = queryEvidenceCopilot(getDashboardSnapshot(), {
      query: String(body.query ?? ""),
      mode: body.mode === "admin" ? "admin" : "judge",
      maxCitations: typeof body.maxCitations === "number" ? body.maxCitations : undefined
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Evidence Copilot query failed." },
      { status: 400 }
    );
  }
}
