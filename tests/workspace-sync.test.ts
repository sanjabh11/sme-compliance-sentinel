import { describe, expect, it } from "vitest";
import {
  buildDriveChangesListRequest,
  buildDriveChangesWatchRequest,
  buildDriveStartPageTokenRequest,
  buildGmailHistoryListRequest,
  buildGmailWatchRequest,
  buildInitialWorkspaceSyncState,
  buildSyncReliability,
  hasLiveWorkspaceSyncEvidence,
  reconcileWorkspaceSyncState
} from "@/lib/workspace-sync";
import type { EvidenceCounters, WorkspaceConnection } from "@/lib/types";

const counters: EvidenceCounters = {
  filesInspected: 3,
  bytesExtracted: 1200,
  bytesScannedByDlp: 900,
  bytesRoutedToGemini: 300
};

describe("Workspace sync reliability", () => {
  it("builds official Drive and Gmail cursor request shapes", () => {
    const startToken = buildDriveStartPageTokenRequest();
    expect(startToken.method).toBe("GET");
    expect(startToken.url).toContain("/drive/v3/changes/startPageToken");
    expect(new URL(startToken.url).searchParams.get("supportsAllDrives")).toBe("true");
    expect(startToken.requiredScope).toBe("https://www.googleapis.com/auth/drive.metadata.readonly");

    const driveChanges = buildDriveChangesListRequest("drive_token_123");
    const driveChangesUrl = new URL(driveChanges.url);
    expect(driveChanges.method).toBe("GET");
    expect(driveChangesUrl.pathname).toBe("/drive/v3/changes");
    expect(driveChangesUrl.searchParams.get("pageToken")).toBe("drive_token_123");
    expect(driveChangesUrl.searchParams.get("includeItemsFromAllDrives")).toBe("true");

    const driveWatch = buildDriveChangesWatchRequest({
      pageToken: "drive_token_123",
      callbackUrl: "https://sentinel.example.com/api/webhooks/pubsub/drive",
      channelId: "channel_123",
      channelToken: "opaque-token",
      expirationAt: new Date("2026-05-29T00:00:00.000Z")
    });
    expect(driveWatch.method).toBe("POST");
    expect(new URL(driveWatch.url).pathname).toBe("/drive/v3/changes/watch");
    expect(driveWatch.body).toMatchObject({
      id: "channel_123",
      type: "web_hook",
      address: "https://sentinel.example.com/api/webhooks/pubsub/drive",
      expiration: "1780012800000"
    });

    const gmailWatch = buildGmailWatchRequest("projects/project-123/topics/gmail");
    expect(gmailWatch.method).toBe("POST");
    expect(gmailWatch.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/watch");
    expect(gmailWatch.body).toMatchObject({
      topicName: "projects/project-123/topics/gmail",
      labelIds: ["INBOX"],
      labelFilterBehavior: "INCLUDE"
    });

    const gmailHistory = buildGmailHistoryListRequest("1234567890", "page_2");
    const gmailHistoryUrl = new URL(gmailHistory.url);
    expect(gmailHistory.method).toBe("GET");
    expect(gmailHistoryUrl.pathname).toBe("/gmail/v1/users/me/history");
    expect(gmailHistoryUrl.searchParams.get("startHistoryId")).toBe("1234567890");
    expect(gmailHistoryUrl.searchParams.get("pageToken")).toBe("page_2");
    expect(gmailHistoryUrl.searchParams.getAll("historyTypes")).toEqual(["messageAdded", "labelAdded"]);
  });

  it("simulates reconciliation in local mock mode without live API claims", () => {
    const now = new Date("2026-05-22T12:00:00.000Z");
    const syncState = buildInitialWorkspaceSyncState("tenant_123", now);
    const connection: WorkspaceConnection = {
      id: "conn_mock",
      tenantId: "tenant_123",
      provider: "google-workspace",
      mode: "mock",
      scopes: [],
      connectedAt: now.toISOString()
    };

    const result = reconcileWorkspaceSyncState({
      syncState,
      connections: [connection],
      now: new Date("2026-05-22T13:00:00.000Z"),
      mockMode: true
    });

    expect(result.status).toBe("simulated");
    expect(result.attemptedLiveApi).toBe(false);
    expect(result.processedChanges).toBe(2);
    expect(result.cursors.drivePageToken).toContain("mock_drive_page_token_");
    expect(result.cursors.gmailHistoryId).toBe("1234567891");
    expect(syncState.lastReconciliationAt).toBe("2026-05-22T13:00:00.000Z");
  });

  it("blocks live reconciliation until OAuth connection and cursors exist", () => {
    const syncState = buildInitialWorkspaceSyncState("tenant_123", new Date("2026-05-22T12:00:00.000Z"));
    syncState.mode = "oauth";
    syncState.drive = { status: "not_configured" };
    syncState.gmail = { status: "not_configured" };

    const result = reconcileWorkspaceSyncState({
      syncState,
      connections: [],
      now: new Date("2026-05-22T13:00:00.000Z"),
      mockMode: false
    });

    expect(result.status).toBe("blocked");
    expect(result.attemptedLiveApi).toBe(false);
    expect(result.checks.map((check) => check.target)).toEqual(["configuration", "drive-start-token", "gmail-watch"]);
    expect(syncState.drive.status).toBe("blocked");
    expect(syncState.gmail.status).toBe("blocked");
  });

  it("reports renewal warnings from sync state instead of static mock text", () => {
    const syncState = buildInitialWorkspaceSyncState("tenant_123", new Date("2026-05-22T12:00:00.000Z"));
    syncState.drive.status = "healthy";
    syncState.drive.channelExpirationAt = "2026-05-22T14:00:00.000Z";
    syncState.drive.renewalDueAt = "2026-05-22T13:00:00.000Z";

    const reliability = buildSyncReliability(syncState, counters, new Date("2026-05-22T13:30:00.000Z"));

    expect(reliability.driveChannelStatus).toBe("renewal_due");
    expect(reliability.driveCursor).toBeDefined();
    expect(reliability.renewalWarnings[0]).toContain("Drive changes channel is due for renewal");
    expect(reliability.reliabilityNotes.join(" ")).toContain("3 resource(s)");
  });

  it("requires initialized Drive and Gmail cursors before live sync can count as proof", () => {
    const syncState = buildInitialWorkspaceSyncState("tenant_123", new Date("2026-05-22T12:00:00.000Z"));
    syncState.mode = "oauth";
    syncState.drive = {
      status: "not_configured",
      blocker: "Drive cursor missing."
    };
    syncState.gmail = {
      status: "not_configured",
      blocker: "Gmail cursor missing."
    };

    expect(hasLiveWorkspaceSyncEvidence(syncState)).toBe(false);

    syncState.drive = {
      status: "healthy",
      startPageToken: "drive_start_token",
      pageToken: "drive_page_token",
      channelExpirationAt: "2026-05-29T00:00:00.000Z"
    };
    syncState.gmail = {
      status: "healthy",
      historyId: "1234567890",
      watchExpirationAt: "2026-05-29T00:00:00.000Z"
    };

    expect(hasLiveWorkspaceSyncEvidence(syncState)).toBe(true);
  });
});
