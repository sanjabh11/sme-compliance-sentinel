import { NextResponse } from "next/server";
import { buildEvidenceIntakeQueue } from "@/lib/evidence-intake";
import { registerEvidenceVaultArtifact, getDashboardSnapshot } from "@/lib/store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const snapshot = getDashboardSnapshot();

  if (url.searchParams.get("view") === "intake") {
    return NextResponse.json(buildEvidenceIntakeQueue(snapshot));
  }

  return NextResponse.json(snapshot.readiness.evidenceVault);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json(registerEvidenceVaultArtifact(body));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to register evidence artifact." },
      { status: 400 }
    );
  }
}
