import { NextResponse } from "next/server";
import { buildCustomerConsentPacket } from "@/lib/customer-consent";
import type { CustomerLeadRequest } from "@/lib/customer-leads";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as CustomerLeadRequest;
    const packet = buildCustomerConsentPacket(body);
    return NextResponse.json({ ok: true, packet });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to prepare consent packet." },
      { status: 400 }
    );
  }
}
