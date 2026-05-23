import { NextResponse } from "next/server";
import { buildRiskScoreTrend } from "@/lib/risk-score";
import { captureRiskScoreSnapshot, getDashboardSnapshot } from "@/lib/store";
import type { RiskScoreSnapshotReason } from "@/lib/types";

export async function GET() {
  const snapshot = getDashboardSnapshot();
  return NextResponse.json({
    history: snapshot.scoreHistory,
    trend: buildRiskScoreTrend(snapshot.scoreHistory)
  });
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => ({}))) as {
      reason?: RiskScoreSnapshotReason;
      targetId?: string;
    };
    const result = captureRiskScoreSnapshot(payload.reason ?? "manual_snapshot", payload.targetId);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to capture risk score snapshot." },
      { status: 400 }
    );
  }
}
