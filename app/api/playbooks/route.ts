import { NextResponse } from "next/server";
import { getDashboardSnapshot, upsertRemediationPlaybook } from "@/lib/store";
import type { ApproverRole, RecommendationAction, RemediationPlaybook } from "@/lib/types";

export async function GET() {
  const snapshot = getDashboardSnapshot();
  return NextResponse.json({
    playbooks: snapshot.playbooks,
    summary: snapshot.readiness.playbooks
  });
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      id?: string;
      name?: string;
      trigger?: string;
      stagedActions?: RecommendationAction[];
      autoAllowed?: boolean;
      approvalSlaHours?: number;
      ownerRole?: ApproverRole;
      escalationTarget?: string;
      status?: RemediationPlaybook["status"];
    };
    const result = upsertRemediationPlaybook(payload);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to save remediation playbook." },
      { status: 400 }
    );
  }
}
