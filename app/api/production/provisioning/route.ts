import { NextResponse } from "next/server";
import { buildProductionProvisioningPack } from "@/lib/production-provisioning";

export async function GET() {
  return NextResponse.json(buildProductionProvisioningPack());
}
