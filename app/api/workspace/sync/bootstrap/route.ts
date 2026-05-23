import { NextResponse } from "next/server";
import { runWorkspaceSyncBootstrap } from "@/lib/store";

export const runtime = "nodejs";

export async function POST() {
  const { result, snapshot } = await runWorkspaceSyncBootstrap();
  return NextResponse.json({ result, snapshot });
}
