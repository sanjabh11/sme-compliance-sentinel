import { NextResponse } from "next/server";
import { buildProductionLaunchCommandCenter } from "@/lib/production-launch";
import { getDashboardSnapshot } from "@/lib/store";

export async function GET() {
  return NextResponse.json(buildProductionLaunchCommandCenter(getDashboardSnapshot()));
}
