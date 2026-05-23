import { NextResponse } from "next/server";
import { makeSyntheticGeminiSmokeEvent } from "@/lib/mock-events";
import { buildProductionGeminiProofStatus, buildProductionGeminiSmokeResult } from "@/lib/production-gemini";
import { getDashboardSnapshot, ingestResourceEvent } from "@/lib/store";

export async function GET() {
  return NextResponse.json(buildProductionGeminiProofStatus(getDashboardSnapshot()));
}

export async function POST() {
  const event = makeSyntheticGeminiSmokeEvent();
  const result = await ingestResourceEvent(event);

  return NextResponse.json(buildProductionGeminiSmokeResult(event, result));
}
