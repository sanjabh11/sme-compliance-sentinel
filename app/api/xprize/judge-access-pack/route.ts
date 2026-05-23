import { NextResponse } from "next/server";
import { buildJudgeAccessPack } from "@/lib/judge-access";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(buildJudgeAccessPack());
}
