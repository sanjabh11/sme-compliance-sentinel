import { NextResponse } from "next/server";
import { authorizeAdminAction } from "@/lib/admin-action-auth";
import { runWorkspaceSyncReconciliation } from "@/lib/store";

export async function POST(request: Request) {
  const authorization = authorizeAdminAction(request, "Workspace sync reconciliation");
  if (!authorization.ok) {
    return NextResponse.json({ ok: false, error: authorization.error }, { status: authorization.status });
  }

  const { result, snapshot } = runWorkspaceSyncReconciliation();
  return NextResponse.json({ result, snapshot });
}
