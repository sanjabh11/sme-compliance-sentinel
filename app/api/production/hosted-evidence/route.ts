import { NextResponse } from "next/server";
import { buildHostedEvidenceCapturePacket } from "@/lib/hosted-evidence-capture";
import { getDashboardSnapshot } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(buildHostedEvidenceCapturePacket(getDashboardSnapshot()));
}
