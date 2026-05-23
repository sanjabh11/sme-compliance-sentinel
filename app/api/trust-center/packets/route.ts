import { NextResponse } from "next/server";
import { createTrustPacket, getDashboardSnapshot } from "@/lib/store";

export async function GET() {
  return NextResponse.json({ packets: getDashboardSnapshot().trustPackets });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      prospectAlias?: string;
      prospectDomain?: string;
      expiresInDays?: number;
      accessRequestId?: string;
    };
    return NextResponse.json(createTrustPacket(body));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Trust Packet creation failed." },
      { status: 400 }
    );
  }
}
