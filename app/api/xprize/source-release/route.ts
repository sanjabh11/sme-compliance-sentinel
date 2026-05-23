import { NextResponse } from "next/server";
import { collectSourceReleaseGuard } from "@/lib/source-release";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(collectSourceReleaseGuard());
}
