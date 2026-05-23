import { NextResponse } from "next/server";
import { recordPilotEvidence } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json(recordPilotEvidence(body));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to record pilot evidence." },
      { status: 400 }
    );
  }
}
