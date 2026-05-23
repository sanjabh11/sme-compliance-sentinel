import { NextResponse } from "next/server";
import { buildEligibilityDisclosurePacket } from "@/lib/eligibility-disclosure";
import { collectGitSignals } from "@/lib/git-signals";
import { buildProjectProvenanceReport } from "@/lib/project-provenance";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    buildEligibilityDisclosurePacket({
      projectProvenance: buildProjectProvenanceReport(collectGitSignals())
    })
  );
}
