import { NextResponse } from "next/server";
import { authorizeAdminAction } from "@/lib/admin-action-auth";
import { makeSyntheticGeminiSmokeEvent } from "@/lib/mock-events";
import { buildProductionGeminiProofStatus, buildProductionGeminiSmokeResult } from "@/lib/production-gemini";
import { getDashboardSnapshot, ingestResourceEvent } from "@/lib/store";

export async function GET() {
  return NextResponse.json(buildProductionGeminiProofStatus(getDashboardSnapshot()));
}

export async function POST(request: Request) {
  const authorization = authorizeAdminAction(request, "Gemini proof smoke");
  if (!authorization.ok) {
    return NextResponse.json({ ok: false, error: authorization.error }, { status: authorization.status });
  }

  const event = makeSyntheticGeminiSmokeEvent();
  const result = await ingestResourceEvent(event);

  return NextResponse.json(buildProductionGeminiSmokeResult(event, result));
}
