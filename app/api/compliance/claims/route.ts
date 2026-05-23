import { NextResponse } from "next/server";
import { scanRepositoryClaims } from "@/lib/claim-guard";

export async function GET() {
  const result = await scanRepositoryClaims();
  return NextResponse.json(result, { status: result.status === "failed" ? 422 : 200 });
}
