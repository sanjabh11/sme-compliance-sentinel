import { NextResponse } from "next/server";
import { collectCloudRunDeploymentEvidence } from "@/lib/cloudrun-deployment";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(collectCloudRunDeploymentEvidence());
}
