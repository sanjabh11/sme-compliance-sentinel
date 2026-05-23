import { NextResponse } from "next/server";
import { authorizeAdminAction } from "@/lib/admin-action-auth";
import { buildCloudCostControlCenter, verifyCloudCostControls } from "@/lib/cloud-cost-controls";
import { getDashboardSnapshot } from "@/lib/store";

export async function GET() {
  const snapshot = getDashboardSnapshot();
  return NextResponse.json(buildCloudCostControlCenter({ agentRuns: snapshot.agentRuns }));
}

export async function POST(request: Request) {
  const authorization = authorizeAdminAction(request, "cost-control verification");
  if (!authorization.ok) {
    return NextResponse.json({ ok: false, error: authorization.error }, { status: authorization.status });
  }

  const result = await verifyCloudCostControls();

  return NextResponse.json(result, {
    status: result.status === "passed" ? 200 : result.status === "blocked" ? 409 : 502
  });
}
