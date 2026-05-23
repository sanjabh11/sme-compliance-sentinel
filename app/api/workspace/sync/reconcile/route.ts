import { NextResponse } from "next/server";
import { runWorkspaceSyncReconciliation } from "@/lib/store";

export async function POST() {
  const { result, snapshot } = runWorkspaceSyncReconciliation();
  return NextResponse.json({ result, snapshot });
}
