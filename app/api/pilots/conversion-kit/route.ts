import { NextResponse } from "next/server";
import { buildPilotConversionKit } from "@/lib/pilot-conversion";
import { getDashboardSnapshot } from "@/lib/store";

export async function GET() {
  return NextResponse.json(buildPilotConversionKit(getDashboardSnapshot()));
}
