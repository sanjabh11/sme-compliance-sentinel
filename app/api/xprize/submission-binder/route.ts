import { NextResponse } from "next/server";
import { buildXPrizeSubmissionBinder } from "@/lib/submission-binder";
import { getDashboardSnapshot } from "@/lib/store";

export async function GET() {
  return NextResponse.json(buildXPrizeSubmissionBinder(getDashboardSnapshot()));
}
