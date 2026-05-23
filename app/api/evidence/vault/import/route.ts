import { NextResponse } from "next/server";
import { authorizeAdminAction } from "@/lib/admin-action-auth";
import { importEvidenceVaultArtifacts } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const authorization = authorizeAdminAction(request);
    if (!authorization.ok) {
      return NextResponse.json({ ok: false, error: authorization.error }, { status: authorization.status });
    }

    const body = await request.json();
    return NextResponse.json(importEvidenceVaultArtifacts(body));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to import evidence artifacts." },
      { status: 400 }
    );
  }
}
