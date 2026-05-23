import { NextResponse } from "next/server";
import { sentinelConfig } from "@/lib/config";
import { reservePersistedWorkspaceWebhookNotification } from "@/lib/persistence";
import { parsePubSubOrDemoRequest, WebhookRequestError } from "@/lib/pubsub";
import {
  buildWorkspaceWebhookNotificationDedupeKey,
  getDashboardSnapshot,
  ingestResourceEvent,
  recordWorkspaceWebhookNotification
} from "@/lib/store";

export async function POST(request: Request) {
  try {
    const parsed = await parsePubSubOrDemoRequest(request, "gmail-pii", { source: "gmail" });

    if (parsed.kind === "notification") {
      const dedupeKey = buildWorkspaceWebhookNotificationDedupeKey(parsed);
      if (sentinelConfig.storageMode === "gcp-rest" && dedupeKey) {
        const reservation = await reservePersistedWorkspaceWebhookNotification({ ...parsed, dedupeKey });
        if (reservation.duplicate) {
          return NextResponse.json(
            {
              ok: true,
              source: "gmail",
              acceptedHint: true,
              duplicate: true,
              durableReplayGuard: true,
              reconciliationRequired: true,
              syncState: getDashboardSnapshot().syncState
            },
            { status: 202 }
          );
        }
      }

      const notification = recordWorkspaceWebhookNotification(parsed);
      return NextResponse.json(
        {
          ok: true,
          source: "gmail",
          acceptedHint: true,
          duplicate: notification.duplicate,
          durableReplayGuard: sentinelConfig.storageMode === "gcp-rest" && Boolean(dedupeKey),
          reconciliationRequired: notification.reconciliationRequired,
          syncState: notification.syncState
        },
        { status: 202 }
      );
    }

    const result = await ingestResourceEvent({ ...parsed.event, source: "gmail" });

    return NextResponse.json(
      {
        ok: true,
        source: "gmail",
        duplicate: Boolean(result.duplicate),
        decision: result.decision,
        finding: result.finding
      },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof WebhookRequestError) {
      return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status });
    }

    throw error;
  }
}
