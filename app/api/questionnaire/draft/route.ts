import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/store";
import { buildQuestionnaireDraft } from "@/lib/questionnaire";

export async function POST() {
  return NextResponse.json(buildQuestionnaireDraft(getDashboardSnapshot()));
}
