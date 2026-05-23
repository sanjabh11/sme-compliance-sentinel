import { NextResponse } from "next/server";
import { buildEvidencePacket } from "@/lib/evidence";
import type { EvidencePacketFormat } from "@/lib/types";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redacted = url.searchParams.get("redacted") !== "false";
  const requestedFormat = url.searchParams.get("format") as EvidencePacketFormat | null;
  const format = requestedFormat === "markdown" || requestedFormat === "csv" ? requestedFormat : "json";
  const packet = buildEvidencePacket({ redacted, format });

  return new NextResponse(packet.body, {
    headers: {
      "content-type": packet.contentType,
      "content-disposition": `attachment; filename="${packet.filename}"`
    }
  });
}
