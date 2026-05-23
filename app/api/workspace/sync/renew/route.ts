import { NextResponse } from "next/server";
import { authorizeAdminAction } from "@/lib/admin-action-auth";
import { runWorkspaceWatchRenewal } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authorization = authorizeAdminAction(request, "Workspace watch renewal");
  if (!authorization.ok) {
    return NextResponse.json({ ok: false, error: authorization.error }, { status: authorization.status });
  }

  const { result, snapshot } = await runWorkspaceWatchRenewal();
  return NextResponse.json({ result, snapshot });
}
