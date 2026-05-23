import { NextResponse } from "next/server";
import { buildSignedEvidencePacket } from "@/lib/evidence";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redacted = url.searchParams.get("redacted") !== "false";
  const packet = buildSignedEvidencePacket({ redacted });

  return new NextResponse(packet.body, {
    headers: {
      "content-type": packet.contentType,
      "content-disposition": `attachment; filename="${packet.filename}"`,
      "x-sentinel-seal-status": packet.seal.status,
      "x-sentinel-sha256": packet.seal.canonicalDigest
    }
  });
}
