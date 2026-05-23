import { NextResponse } from "next/server";
import { accessTrustPacket } from "@/lib/store";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const result = accessTrustPacket(token);

  if (result.status === "not_found") {
    return NextResponse.json(result, { status: 404 });
  }

  if (result.status === "expired") {
    return NextResponse.json(result, { status: 410 });
  }

  return NextResponse.json(result);
}
