import { NextResponse } from "next/server";
import { buildThirdPartyManifest } from "@/lib/license-manifest";

export async function GET() {
  return NextResponse.json(buildThirdPartyManifest());
}
