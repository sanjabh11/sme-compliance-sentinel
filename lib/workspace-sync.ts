import { makeId, sentinelConfig } from "@/lib/config";
import {
  accessWorkspaceOAuthTokenPayload,
  buildPersistenceReadiness,
  persistWorkspaceOAuthInstallMetadata
} from "@/lib/persistence";
import type {
  EvidenceCounters,
  SyncReliability,
  WorkspaceApiRequestPlan,
  WorkspaceConnection,
  WorkspaceReconciliationResult,
  WorkspaceSyncProviderStatus,
  WorkspaceSyncState
} from "@/lib/types";

const DRIVE_CHANGES_URL = "https://www.googleapis.com/drive/v3/changes";
const DRIVE_START_TOKEN_URL = "https://www.googleapis.com/drive/v3/changes/startPageToken";
const GMAIL_HISTORY_URL = "https://gmail.googleapis.com/gmail/v1/users/me/history";
const GMAIL_WATCH_URL = "https://gmail.googleapis.com/gmail/v1/users/me/watch";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export function buildInitialWorkspaceSyncState(
  tenantId = sentinelConfig.tenantId,
  now = new Date()
): WorkspaceSyncState {
  const mockMode = sentinelConfig.mockMode;
  const driveExpiration = addHours(now, 24 * 6);
  const gmailExpiration = addHours(now, 24 * 6);

  return {
    tenantId,
    mode: mockMode ? "mock" : "oauth",
    reconciliationCadenceHours: 6,
    deadLetterCount: 0,
    lastReconciliationAt: mockMode ? now.toISOString() : undefined,
    drive: {
      status: mockMode ? "mock" : "not_configured",
      startPageToken: mockMode ? "mock_drive_start_page_token" : undefined,
      pageToken: mockMode ? "mock_drive_page_token" : undefined,
      channelId: mockMode ? "mock_drive_changes_channel" : undefined,
      channelResourceId: mockMode ? "mock_drive_changes_resource" : undefined,
      channelExpirationAt: mockMode ? driveExpiration.toISOString() : undefined,
      renewalDueAt: mockMode ? addHours(driveExpiration, -24).toISOString() : undefined,
      lastReconciledAt: mockMode ? now.toISOString() : undefined,
      blocker: mockMode ? undefined : "Drive startPageToken and changes.watch channel are not initialized."
    },
    gmail: {
      status: mockMode ? "mock" : "not_configured",
      historyId: mockMode ? "1234567890" : undefined,
      topicName: sentinelConfig.gmailPubSubTopic
        ? sentinelConfig.gmailPubSubTopic
        : sentinelConfig.googleCloudProject
        ? `projects/${sentinelConfig.googleCloudProject}/topics/workspace-gmail-updates`
        : mockMode
          ? "projects/mock-project/topics/workspace-gmail-updates"
          : undefined,
      watchExpirationAt: mockMode ? gmailExpiration.toISOString() : undefined,
      renewalDueAt: mockMode ? addHours(gmailExpiration, -24).toISOString() : undefined,
      lastReconciledAt: mockMode ? now.toISOString() : undefined,
      blocker: mockMode ? undefined : "Gmail watch historyId is not initialized."
    }
  };
}

export function buildDriveStartPageTokenRequest(): WorkspaceApiRequestPlan {
  const url = new URL(DRIVE_START_TOKEN_URL);
  url.searchParams.set("supportsAllDrives", "true");

  return {
    method: "GET",
    url: url.toString(),
    requiredScope: "https://www.googleapis.com/auth/drive.metadata.readonly",
    purpose: "Initialize a durable Drive changes cursor before registering a watch channel."
  };
}

export function buildDriveChangesListRequest(pageToken: string, pageSize = 100): WorkspaceApiRequestPlan {
  const url = new URL(DRIVE_CHANGES_URL);
  url.searchParams.set("pageToken", pageToken);
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set(
    "fields",
    "nextPageToken,newStartPageToken,changes(fileId,removed,time,file(id,name,mimeType,owners,emailAddress,permissions))"
  );

  return {
    method: "GET",
    url: url.toString(),
    requiredScope: "https://www.googleapis.com/auth/drive.metadata.readonly",
    purpose: "Reconcile Drive notifications by replaying durable changes from the stored page token."
  };
}

export function buildDriveChangesWatchRequest(input: {
  pageToken: string;
  callbackUrl: string;
  channelId: string;
  channelToken: string;
  expirationAt: Date;
}): WorkspaceApiRequestPlan {
  const url = new URL(`${DRIVE_CHANGES_URL}/watch`);
  url.searchParams.set("pageToken", input.pageToken);
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("supportsAllDrives", "true");

  return {
    method: "POST",
    url: url.toString(),
    requiredScope: "https://www.googleapis.com/auth/drive.metadata.readonly",
    purpose: "Create or renew the Drive changes webhook channel before expiration.",
    body: {
      id: input.channelId,
      type: "web_hook",
      address: input.callbackUrl,
      token: input.channelToken,
      expiration: String(input.expirationAt.getTime())
    }
  };
}

export function buildGmailWatchRequest(topicName: string, labelIds: string[] = ["INBOX"]): WorkspaceApiRequestPlan {
  return {
    method: "POST",
    url: GMAIL_WATCH_URL,
    requiredScope: "https://www.googleapis.com/auth/gmail.metadata",
    purpose: "Start or renew the Gmail mailbox watch and capture the returned historyId/expiration.",
    body: {
      topicName,
      labelIds,
      labelFilterBehavior: "INCLUDE"
    }
  };
}

export function buildGmailHistoryListRequest(startHistoryId: string, pageToken?: string): WorkspaceApiRequestPlan {
  const url = new URL(GMAIL_HISTORY_URL);
  url.searchParams.set("startHistoryId", startHistoryId);
  url.searchParams.set("maxResults", "500");
  url.searchParams.append("historyTypes", "messageAdded");
  url.searchParams.append("historyTypes", "labelAdded");

  if (pageToken) {
    url.searchParams.set("pageToken", pageToken);
  }

  return {
    method: "GET",
    url: url.toString(),
    requiredScope: "https://www.googleapis.com/auth/gmail.metadata",
    purpose: "Reconcile Gmail push notifications from the durable mailbox historyId."
  };
}

export function buildSyncReliability(
  syncState: WorkspaceSyncState,
  aggregateCounters: EvidenceCounters,
  now = new Date()
): SyncReliability {
  const driveStatus = deriveProviderStatus(syncState.drive.status, syncState.drive.channelExpirationAt, now);
  const gmailStatus = deriveProviderStatus(syncState.gmail.status, syncState.gmail.watchExpirationAt, now);
  const renewalWarnings = [
    renewalWarning("Drive changes channel", syncState.drive.renewalDueAt, syncState.drive.channelExpirationAt, now),
    renewalWarning("Gmail mailbox watch", syncState.gmail.renewalDueAt, syncState.gmail.watchExpirationAt, now)
  ].filter(Boolean) as string[];
  const blockers = [syncState.drive.blocker, syncState.gmail.blocker].filter(Boolean) as string[];

  return {
    driveChannelStatus: driveStatus,
    gmailWatchStatus: gmailStatus,
    reconciliationCadenceHours: syncState.reconciliationCadenceHours,
    deadLetterCount: syncState.deadLetterCount,
    lastReconciliationAt: syncState.lastReconciliationAt,
    driveCursor: syncState.drive.pageToken ?? syncState.drive.startPageToken,
    gmailCursor: syncState.gmail.historyId,
    renewalWarnings,
    blockers,
    reliabilityNotes: [
      "Drive changes use getStartPageToken/list/watch cursors; push notifications are treated as hints, not proof of complete coverage.",
      "Gmail watches return a historyId and expiration; reconciliation must use users.history.list and trigger full sync on stale historyId errors.",
      `${aggregateCounters.filesInspected} resource(s) are represented in the current demo counters.`
    ]
  };
}

export function hasLiveWorkspaceSyncEvidence(syncState: WorkspaceSyncState) {
  const driveReady =
    (syncState.drive.status === "healthy" || syncState.drive.status === "renewal_due") &&
    Boolean(syncState.drive.pageToken ?? syncState.drive.startPageToken);
  const gmailReady =
    (syncState.gmail.status === "healthy" || syncState.gmail.status === "renewal_due") &&
    Boolean(syncState.gmail.historyId);

  return syncState.mode !== "mock" && driveReady && gmailReady;
}

export function reconcileWorkspaceSyncState(input: {
  syncState: WorkspaceSyncState;
  connections: WorkspaceConnection[];
  now?: Date;
  mockMode?: boolean;
}): WorkspaceReconciliationResult {
  const now = input.now ?? new Date();
  const mockMode = input.mockMode ?? sentinelConfig.mockMode;
  const hasOauthConnection = input.connections.some((connection) => connection.mode === "oauth" || connection.mode === "domain-wide-delegation");

  if (mockMode) {
    const timestamp = now.toISOString();
    input.syncState.lastReconciliationAt = timestamp;
    input.syncState.drive.lastReconciledAt = timestamp;
    input.syncState.gmail.lastReconciledAt = timestamp;
    input.syncState.drive.status = "mock";
    input.syncState.gmail.status = "mock";
    input.syncState.drive.pageToken = `mock_drive_page_token_${now.getTime()}`;
    input.syncState.gmail.historyId = String(Number(input.syncState.gmail.historyId ?? "1234567890") + 1);

    return {
      generatedAt: timestamp,
      status: "simulated",
      attemptedLiveApi: false,
      processedChanges: 2,
      cursors: {
        drivePageToken: input.syncState.drive.pageToken,
        gmailHistoryId: input.syncState.gmail.historyId
      },
      checks: [
        {
          target: "drive-changes",
          status: "simulated",
          detail: "Mock reconciliation advanced the Drive page token without calling Google APIs.",
          url: buildDriveChangesListRequest(input.syncState.drive.startPageToken ?? "mock_drive_start_page_token").url
        },
        {
          target: "gmail-history",
          status: "simulated",
          detail: "Mock reconciliation advanced the Gmail historyId without calling Google APIs.",
          url: buildGmailHistoryListRequest(input.syncState.gmail.historyId).url
        }
      ]
    };
  }

  const checks: WorkspaceReconciliationResult["checks"] = [];

  if (!hasOauthConnection) {
    checks.push({
      target: "configuration",
      status: "blocked",
      detail: "No OAuth or domain-wide-delegation Workspace connection is available for live reconciliation."
    });
  }

  if (!input.syncState.drive.startPageToken && !input.syncState.drive.pageToken) {
    checks.push({
      target: "drive-start-token",
      status: "blocked",
      detail: "Drive reconciliation needs a stored startPageToken from changes.getStartPageToken."
    });
  }

  if (!input.syncState.gmail.historyId) {
    checks.push({
      target: "gmail-watch",
      status: "blocked",
      detail: "Gmail reconciliation needs a stored historyId from users.watch."
    });
  }

  input.syncState.drive.status = checks.some((check) => check.target === "drive-start-token") ? "blocked" : input.syncState.drive.status;
  input.syncState.gmail.status = checks.some((check) => check.target === "gmail-watch") ? "blocked" : input.syncState.gmail.status;
  input.syncState.drive.blocker = checks.find((check) => check.target === "drive-start-token")?.detail;
  input.syncState.gmail.blocker = checks.find((check) => check.target === "gmail-watch")?.detail;

  return {
    generatedAt: now.toISOString(),
    status: checks.length ? "blocked" : "failed",
    attemptedLiveApi: false,
    processedChanges: 0,
    cursors: {
      drivePageToken: input.syncState.drive.pageToken ?? input.syncState.drive.startPageToken,
      gmailHistoryId: input.syncState.gmail.historyId
    },
    checks: checks.length
      ? checks
      : [
          {
            target: "configuration",
            status: "failed",
            detail: "Live reconciliation execution is not enabled in this local build; deploy the worker after OAuth token retrieval is wired."
          }
        ]
  };
}

export async function bootstrapLiveWorkspaceSyncState(
  input: {
    syncState: WorkspaceSyncState;
    connections: WorkspaceConnection[];
    now?: Date;
  },
  fetchImpl: typeof fetch = fetch
): Promise<WorkspaceReconciliationResult> {
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
  const checks: WorkspaceReconciliationResult["checks"] = [];
  const oauthConnection = input.connections.find(
    (connection) => connection.mode === "oauth" || connection.mode === "domain-wide-delegation"
  );
  const persistence = buildPersistenceReadiness();
  const callbackBaseUrl = sentinelConfig.productUrl;
  const driveChannelTokenReady = sentinelConfig.workspaceDriveChannelTokenConfigured;
  const gmailTopic = sentinelConfig.gmailPubSubTopic || input.syncState.gmail.topicName;
  const missingConfiguration = [
    ...(sentinelConfig.mockMode ? ["SENTINEL_MOCK_MODE must be false for live Workspace sync bootstrap."] : []),
    ...(oauthConnection ? [] : ["A consent-gated OAuth or domain-wide-delegation Workspace connection is required."]),
    ...(persistence.configured
      ? []
      : [`SENTINEL_STORAGE_MODE=gcp-rest and Google Cloud persistence are required. Missing env: ${persistence.missingEnv.join(", ") || "none"}.`]),
    ...(callbackBaseUrl ? [] : ["NEXT_PUBLIC_PRODUCT_URL is required for the Drive webhook callback URL."]),
    ...(driveChannelTokenReady ? [] : ["WORKSPACE_DRIVE_CHANNEL_TOKEN must be configured before creating a Drive watch channel."]),
    ...(gmailTopic ? [] : ["WORKSPACE_GMAIL_TOPIC must be configured before creating a Gmail watch."]),
    ...(sentinelConfig.oauthClientId && sentinelConfig.oauthClientSecret
      ? []
      : ["GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are required to refresh the Workspace OAuth token."])
  ];

  if (missingConfiguration.length) {
    return {
      generatedAt,
      status: "blocked",
      attemptedLiveApi: false,
      processedChanges: 0,
      cursors: {
        drivePageToken: input.syncState.drive.pageToken ?? input.syncState.drive.startPageToken,
        gmailHistoryId: input.syncState.gmail.historyId
      },
      checks: [
        {
          target: "configuration",
          status: "blocked",
          detail: missingConfiguration.join(" ")
        }
      ]
    };
  }

  let activeTarget: WorkspaceReconciliationResult["checks"][number]["target"] = "access-token";

  try {
    if (!oauthConnection) {
      throw new Error("A consent-gated OAuth Workspace connection is required.");
    }

    const tokenPayload = await accessWorkspaceOAuthTokenPayload(sentinelConfig.tenantId, fetchImpl);
    const workspaceAccessToken = await exchangeWorkspaceRefreshTokenForAccessToken(tokenPayload.refreshToken, fetchImpl);
    checks.push({
      target: "access-token",
      status: "passed",
      detail: "Workspace OAuth refresh token was exchanged for a short-lived access token; token values were not logged."
    });

    const startTokenRequest = buildDriveStartPageTokenRequest();
    activeTarget = "drive-start-token";
    const startTokenResponse = await executeWorkspaceJsonRequest<{ startPageToken?: string }>(
      startTokenRequest,
      workspaceAccessToken,
      fetchImpl
    );
    const startPageToken = startTokenResponse.body.startPageToken;
    if (!startPageToken) {
      throw new Error("Drive startPageToken response did not include startPageToken.");
    }
    checks.push({
      target: "drive-start-token",
      status: "passed",
      detail: "Drive changes startPageToken initialized from Google Drive API.",
      url: startTokenRequest.url,
      httpStatus: startTokenResponse.httpStatus
    });

    const driveExpiration = addHours(now, 24 * 6);
    activeTarget = "drive-watch";
    const driveWatchRequest = buildDriveChangesWatchRequest({
      pageToken: startPageToken,
      callbackUrl: `${callbackBaseUrl.replace(/\/+$/u, "")}/api/webhooks/pubsub/drive`,
      channelId: makeId("drive_channel"),
      channelToken: sentinelConfig.workspaceDriveChannelToken,
      expirationAt: driveExpiration
    });
    const driveWatchResponse = await executeWorkspaceJsonRequest<{
      id?: string;
      resourceId?: string;
      expiration?: string;
    }>(driveWatchRequest, workspaceAccessToken, fetchImpl);
    checks.push({
      target: "drive-watch",
      status: "passed",
      detail: "Drive changes watch channel initialized; channel token was not returned in the result.",
      url: driveWatchRequest.url,
      httpStatus: driveWatchResponse.httpStatus
    });

    activeTarget = "gmail-watch";
    const gmailWatchRequest = buildGmailWatchRequest(gmailTopic ?? "");
    const gmailWatchResponse = await executeWorkspaceJsonRequest<{
      historyId?: string;
      expiration?: string;
    }>(gmailWatchRequest, workspaceAccessToken, fetchImpl);
    const gmailHistoryId = gmailWatchResponse.body.historyId;
    if (!gmailHistoryId) {
      throw new Error("Gmail watch response did not include historyId.");
    }
    checks.push({
      target: "gmail-watch",
      status: "passed",
      detail: "Gmail watch initialized and returned a mailbox historyId.",
      url: gmailWatchRequest.url,
      httpStatus: gmailWatchResponse.httpStatus
    });

    input.syncState.mode = oauthConnection.mode;
    input.syncState.lastReconciliationAt = generatedAt;
    input.syncState.drive = {
      status: "healthy",
      startPageToken,
      pageToken: startPageToken,
      channelId: driveWatchResponse.body.id,
      channelResourceId: driveWatchResponse.body.resourceId,
      channelExpirationAt: normalizeGoogleExpiration(driveWatchResponse.body.expiration, driveExpiration),
      renewalDueAt: addHours(normalizeGoogleExpirationDate(driveWatchResponse.body.expiration, driveExpiration), -24).toISOString(),
      lastReconciledAt: generatedAt
    };
    input.syncState.gmail = {
      status: "healthy",
      historyId: gmailHistoryId,
      topicName: gmailTopic,
      watchExpirationAt: normalizeGoogleExpiration(gmailWatchResponse.body.expiration, addHours(now, 24 * 6)),
      renewalDueAt: addHours(normalizeGoogleExpirationDate(gmailWatchResponse.body.expiration, addHours(now, 24 * 6)), -24).toISOString(),
      lastReconciledAt: generatedAt
    };

    activeTarget = "sync-state-firestore";
    const persisted = await persistWorkspaceOAuthInstallMetadata(
      {
        connection: oauthConnection,
        syncState: input.syncState
      },
      fetchImpl
    );
    checks.push({
      target: "sync-state-firestore",
      status: "passed",
      detail: `Workspace connection and initialized cursor state persisted to Firestore. Connection ${persisted.connection.httpStatus}, sync ${persisted.syncState.httpStatus}.`
    });

    return {
      generatedAt,
      status: "passed",
      attemptedLiveApi: true,
      processedChanges: 0,
      cursors: {
        drivePageToken: input.syncState.drive.pageToken,
        gmailHistoryId: input.syncState.gmail.historyId
      },
      checks
    };
  } catch (error) {
    checks.push({
      target: typeof activeTarget === "string" ? activeTarget : "configuration",
      status: "failed",
      detail: sanitizeWorkspaceSyncError(error)
    });

    return {
      generatedAt,
      status: "failed",
      attemptedLiveApi: true,
      processedChanges: 0,
      cursors: {
        drivePageToken: input.syncState.drive.pageToken ?? input.syncState.drive.startPageToken,
        gmailHistoryId: input.syncState.gmail.historyId
      },
      checks
    };
  }
}

export async function exchangeWorkspaceRefreshTokenForAccessToken(refreshToken: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: sentinelConfig.oauthClientId,
      client_secret: sentinelConfig.oauthClientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    throw new Error(`Google Workspace refresh token exchange failed: ${response.status} ${payload.error_description ?? payload.error ?? ""}`.trim());
  }

  return payload.access_token;
}

async function executeWorkspaceJsonRequest<T>(
  request: WorkspaceApiRequestPlan,
  accessToken: string,
  fetchImpl: typeof fetch
): Promise<{ httpStatus: number; body: T }> {
  const response = await fetchImpl(request.url, {
    method: request.method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    ...(request.body ? { body: JSON.stringify(request.body) } : {})
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };

  if (!response.ok) {
    throw new Error(`Google Workspace API request failed: ${response.status} ${body.error?.message ?? ""}`.trim());
  }

  return { httpStatus: response.status, body };
}

function normalizeGoogleExpiration(value: string | undefined, fallback: Date) {
  return normalizeGoogleExpirationDate(value, fallback).toISOString();
}

function normalizeGoogleExpirationDate(value: string | undefined, fallback: Date) {
  if (!value) {
    return fallback;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric);
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : fallback;
}

function sanitizeWorkspaceSyncError(error: unknown) {
  const message = error instanceof Error ? error.message : "Live Workspace sync bootstrap failed.";
  return message
    .replace(/refresh_token=[^&\s]+/giu, "refresh_token=[redacted]")
    .replace(/access_token=[^&\s]+/giu, "access_token=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gu, "Bearer [redacted]");
}

function deriveProviderStatus(
  current: WorkspaceSyncProviderStatus,
  expirationAt: string | undefined,
  now: Date
): WorkspaceSyncProviderStatus {
  if (current === "mock" || current === "not_configured" || current === "blocked") {
    return current;
  }

  if (!expirationAt) {
    return "not_configured";
  }

  const millisUntilExpiration = Date.parse(expirationAt) - now.getTime();
  if (millisUntilExpiration <= 0) {
    return "expired";
  }

  if (millisUntilExpiration <= 24 * 60 * 60 * 1000) {
    return "renewal_due";
  }

  return "healthy";
}

function renewalWarning(label: string, renewalDueAt: string | undefined, expirationAt: string | undefined, now: Date) {
  if (!expirationAt) {
    return undefined;
  }

  const expiration = Date.parse(expirationAt);
  if (expiration <= now.getTime()) {
    return `${label} expired at ${expirationAt}.`;
  }

  if (renewalDueAt && Date.parse(renewalDueAt) <= now.getTime()) {
    return `${label} is due for renewal before ${expirationAt}.`;
  }

  return undefined;
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}
