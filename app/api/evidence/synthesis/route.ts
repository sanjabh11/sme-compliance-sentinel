import { NextResponse } from "next/server";
import { buildEvidenceSynthesisPack } from "@/lib/evidence-synthesis";
import { getDashboardSnapshot } from "@/lib/store";
import type { EvidenceSynthesisPackType, EvidenceSynthesisRequest } from "@/lib/types";

const packTypes: EvidenceSynthesisPackType[] = [
  "judge-summary",
  "customer-security-packet",
  "remediation-timeline",
  "business-evidence-brief",
  "ai-operations-proof"
];

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<EvidenceSynthesisRequest>;
    const packType = packTypes.includes(body.packType as EvidenceSynthesisPackType)
      ? (body.packType as EvidenceSynthesisPackType)
      : "judge-summary";
    const result = await buildEvidenceSynthesisPack(getDashboardSnapshot(), {
      packType,
      mode: body.mode === "admin" ? "admin" : "judge",
      prompt: typeof body.prompt === "string" ? body.prompt : undefined,
      useGemini: body.useGemini === true
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Evidence synthesis failed." },
      { status: 400 }
    );
  }
}
