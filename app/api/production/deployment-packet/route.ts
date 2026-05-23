import { NextResponse } from "next/server";
import { buildDeploymentEvidencePacket } from "@/lib/deployment-evidence-packet";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(buildDeploymentEvidencePacket());
}
