import { NextResponse } from "next/server";
import { buildMarketPositioningCommandCenter } from "@/lib/market-positioning";
import { getDashboardSnapshot } from "@/lib/store";

export async function GET() {
  return NextResponse.json(buildMarketPositioningCommandCenter(getDashboardSnapshot()));
}
