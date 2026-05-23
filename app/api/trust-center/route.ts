import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/store";
import { buildTrustCenterProfile } from "@/lib/trust-center";

export async function GET() {
  return NextResponse.json(buildTrustCenterProfile(getDashboardSnapshot()));
}
