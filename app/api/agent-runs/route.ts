import { NextResponse } from "next/server";
import { createDemoEvent, ingestResourceEvent } from "@/lib/store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { demo?: "public-secret" | "gmail-pii" };
  const event = createDemoEvent(body.demo ?? "public-secret");
  const result = await ingestResourceEvent({ ...event, id: `${event.id}_${Date.now()}` });

  return NextResponse.json({
    ok: true,
    message: "Agent run completed through the mock Workspace event pipeline.",
    decision: result.decision,
    finding: result.finding
  });
}
