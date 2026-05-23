import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceConnection } from "@/lib/types";

describe("Workspace live sync bootstrap", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("blocks before live API calls when production OAuth and GCP prerequisites are missing", async () => {
    const { bootstrapLiveWorkspaceSyncState, buildInitialWorkspaceSyncState } = await import("@/lib/workspace-sync");
    const syncState = buildInitialWorkspaceSyncState("tenant_123", new Date("2026-05-23T00:00:00.000Z"));
    const fetchImpl = vi.fn();

    const result = await bootstrapLiveWorkspaceSyncState(
      {
        syncState,
        connections: [],
        now: new Date("2026-05-23T00:01:00.000Z")
      },
      fetchImpl as unknown as typeof fetch
    );

    expect(result.status).toBe("blocked");
    expect(result.attemptedLiveApi).toBe(false);
    expect(result.checks[0].target).toBe("configuration");
    expect(result.checks[0].detail).toContain("SENTINEL_MOCK_MODE must be false");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("initializes Drive and Gmail watches from a consented OAuth install without leaking token values", async () => {
    vi.stubEnv("SENTINEL_MOCK_MODE", "false");
    vi.stubEnv("SENTINEL_STORAGE_MODE", "gcp-rest");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "project_123");
    vi.stubEnv("GOOGLE_CLOUD_ACCESS_TOKEN", "cloud_access_token_secret");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client_123");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "client_secret_value");
    vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", "https://sentinel.example.com/api/oauth/google/callback");
    vi.stubEnv("NEXT_PUBLIC_PRODUCT_URL", "https://sentinel.example.com");
    vi.stubEnv("WORKSPACE_DRIVE_CHANNEL_TOKEN", "drive_channel_token_secret");
    vi.stubEnv("WORKSPACE_GMAIL_TOPIC", "projects/project_123/topics/workspace-gmail-updates");
    vi.resetModules();

    const { bootstrapLiveWorkspaceSyncState, buildInitialWorkspaceSyncState } = await import("@/lib/workspace-sync");
    const syncState = buildInitialWorkspaceSyncState("tenant_mainstreet_security", new Date("2026-05-23T00:00:00.000Z"));
    const connection: WorkspaceConnection = {
      id: "conn_google_workspace_live",
      tenantId: "tenant_mainstreet_security",
      provider: "google-workspace",
      mode: "oauth",
      scopes: ["https://www.googleapis.com/auth/drive.metadata.readonly", "https://www.googleapis.com/auth/gmail.metadata"],
      connectedAt: "2026-05-23T00:00:00.000Z"
    };
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);

      if (requestUrl.includes("secretmanager.googleapis.com")) {
        expect(init?.headers).toMatchObject({ authorization: "Bearer cloud_access_token_secret" });
        return Response.json({
          payload: {
            data: Buffer.from(
              JSON.stringify({
                refreshToken: "workspace_refresh_token_secret",
                scope: "https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/gmail.metadata",
                tokenType: "Bearer",
                expiresInSeconds: 3600
              }),
              "utf8"
            ).toString("base64")
          }
        });
      }

      if (requestUrl === "https://oauth2.googleapis.com/token") {
        expect(String(init?.body)).toContain("grant_type=refresh_token");
        expect(String(init?.body)).toContain("refresh_token=workspace_refresh_token_secret");
        return Response.json({ access_token: "workspace_access_token_secret", expires_in: 3600, token_type: "Bearer" });
      }

      if (requestUrl.includes("/drive/v3/changes/startPageToken")) {
        expect(init?.headers).toMatchObject({ authorization: "Bearer workspace_access_token_secret" });
        return Response.json({ startPageToken: "drive_start_token_123" });
      }

      if (requestUrl.includes("/drive/v3/changes/watch")) {
        const body = JSON.parse(String(init?.body)) as { address: string; token: string };
        expect(body.address).toBe("https://sentinel.example.com/api/webhooks/pubsub/drive");
        expect(body.token).toBe("drive_channel_token_secret");
        return Response.json({
          id: "drive_channel_123",
          resourceId: "drive_resource_123",
          expiration: String(Date.parse("2026-05-29T00:00:00.000Z"))
        });
      }

      if (requestUrl === "https://gmail.googleapis.com/gmail/v1/users/me/watch") {
        const body = JSON.parse(String(init?.body)) as { topicName: string };
        expect(body.topicName).toBe("projects/project_123/topics/workspace-gmail-updates");
        return Response.json({ historyId: "gmail_history_123", expiration: String(Date.parse("2026-05-29T00:00:00.000Z")) });
      }

      if (requestUrl.includes("firestore.googleapis.com")) {
        expect(init?.headers).toMatchObject({ authorization: "Bearer cloud_access_token_secret" });
        return Response.json({ name: "firestore-write-ok" });
      }

      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const result = await bootstrapLiveWorkspaceSyncState(
      {
        syncState,
        connections: [connection],
        now: new Date("2026-05-23T00:05:00.000Z")
      },
      fetchImpl as unknown as typeof fetch
    );

    expect(result.status).toBe("passed");
    expect(result.attemptedLiveApi).toBe(true);
    expect(result.processedChanges).toBe(0);
    expect(result.cursors).toEqual({ drivePageToken: "drive_start_token_123", gmailHistoryId: "gmail_history_123" });
    expect(result.checks.map((check) => check.target)).toEqual([
      "access-token",
      "drive-start-token",
      "drive-watch",
      "gmail-watch",
      "sync-state-firestore"
    ]);
    expect(syncState.drive.status).toBe("healthy");
    expect(syncState.drive.channelResourceId).toBe("drive_resource_123");
    expect(syncState.gmail.status).toBe("healthy");
    expect(syncState.gmail.topicName).toBe("projects/project_123/topics/workspace-gmail-updates");
    expect(JSON.stringify(result)).not.toContain("workspace_refresh_token_secret");
    expect(JSON.stringify(result)).not.toContain("workspace_access_token_secret");
    expect(JSON.stringify(result)).not.toContain("drive_channel_token_secret");
  });
});
