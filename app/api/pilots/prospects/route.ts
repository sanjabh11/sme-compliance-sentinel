import { NextResponse } from "next/server";
import { getDashboardSnapshot, recordPilotProspect } from "@/lib/store";

export async function GET() {
  return NextResponse.json(getDashboardSnapshot().readiness.pilotProspectPipeline);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json(recordPilotProspect(body));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to record pilot prospect." },
      { status: 400 }
    );
  }
}
