import { NextResponse } from "next/server";
import { buildSyncReliability } from "@/lib/workspace-sync";
import { getDashboardSnapshot } from "@/lib/store";

export async function GET() {
  const snapshot = getDashboardSnapshot();

  return NextResponse.json({
    syncState: snapshot.syncState,
    reliability: buildSyncReliability(snapshot.syncState, snapshot.aggregateCounters)
  });
}
