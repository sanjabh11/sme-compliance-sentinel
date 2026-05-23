import { NextResponse } from "next/server";
import { buildApprovalOps } from "@/lib/approval-ops";
import { getDashboardSnapshot } from "@/lib/store";

export async function GET() {
  return NextResponse.json(buildApprovalOps(getDashboardSnapshot()));
}
