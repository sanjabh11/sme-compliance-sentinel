import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/store";

export async function GET() {
  const snapshot = getDashboardSnapshot();
  return NextResponse.json({
    answerLibrary: snapshot.answerLibrary,
    summary: snapshot.readiness.answerLibrary
  });
}
