import { NextResponse } from "next/server";
import { captureCustomerLead } from "@/lib/customer-leads";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    const receipt = captureCustomerLead(body as Parameters<typeof captureCustomerLead>[0]);
    return NextResponse.json({ ok: true, receipt });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to capture pilot scope request." },
      { status: 400 }
    );
  }
}
