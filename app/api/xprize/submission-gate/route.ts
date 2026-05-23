import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/store";

export async function GET() {
  return NextResponse.json(getDashboardSnapshot().readiness.xprizeGate);
}
