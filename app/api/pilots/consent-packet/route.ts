import { NextResponse } from "next/server";
import { buildPilotConsentPacket } from "@/lib/pilot-consent";
import { getDashboardSnapshot } from "@/lib/store";

export async function GET() {
  return NextResponse.json(buildPilotConsentPacket(getDashboardSnapshot()));
}
