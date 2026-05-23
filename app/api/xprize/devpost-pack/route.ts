import { NextResponse } from "next/server";
import { buildDevpostSubmissionPack } from "@/lib/devpost-submission";
import { getDashboardSnapshot } from "@/lib/store";

export async function GET() {
  return NextResponse.json(buildDevpostSubmissionPack(getDashboardSnapshot()));
}
