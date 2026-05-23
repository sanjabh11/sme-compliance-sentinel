import { NextResponse } from "next/server";
import { buildTrustCenterAnalytics } from "@/lib/trust-center";
import { getDashboardSnapshot } from "@/lib/store";

export async function GET() {
  return NextResponse.json(buildTrustCenterAnalytics(getDashboardSnapshot()));
}
