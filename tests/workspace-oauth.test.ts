import { afterEach, describe, expect, it, vi } from "vitest";

const workspaceOAuthTestTimeoutMs = 30000;

describe("Google Workspace OAuth launch path", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("blocks honestly when OAuth client credentials are missing", async () => {
    const { buildWorkspaceOAuthPlan } = await import("@/lib/workspace-oauth");

    const plan = buildWorkspaceOAuthPlan();

    expect(plan.configured).toBe(false);
    expect(plan.launchAllowed).toBe(false);
    expect(plan.missingEnv).toEqual(["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI"]);
    expect(plan.launchBlockers.join(" ")).toContain("GOOGLE_OAUTH_CLIENT_ID");
    expect(plan.consentGate.status).toBe("not-checked");
    expect(plan.deferredScopes.map((scope) => scope.scope)).toContain("https://www.googleapis.com/auth/drive");
    expect(plan.authorizationUrl).toBeUndefined();
  }, workspaceOAuthTestTimeoutMs);

  it("builds a minimal incremental consent URL for pilot installs", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client_123");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "secret_123");
    vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", "https://sentinel.example.com/api/oauth/google/callback");
    vi.resetModules();

    const { buildWorkspaceAuthorizationUrl } = await import("@/lib/workspace-oauth");
    const url = new URL(buildWorkspaceAuthorizationUrl({ state: "state_123" }));

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client_123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://sentinel.example.com/api/oauth/google/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state_123");
    const scopes = url.searchParams.get("scope")?.split(" ") ?? [];
    expect(scopes).toContain("https://www.googleapis.com/auth/drive.metadata.readonly");
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.metadata");
    expect(scopes).not.toContain("https://www.googleapis.com/auth/drive");
  }, workspaceOAuthTestTimeoutMs);

  it("blocks OAuth launch when signed pilot consent is enforced but missing", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client_123");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "secret_123");
    vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", "https://sentinel.example.com/api/oauth/google/callback");
    vi.resetModules();

    const { buildWorkspaceOAuthPlan } = await import("@/lib/workspace-oauth");
    const plan = buildWorkspaceOAuthPlan({ enforceSignedConsent: true, signedConsentReady: false });

    expect(plan.configured).toBe(true);
    expect(plan.launchAllowed).toBe(false);
    expect(plan.authorizationUrl).toBeUndefined();
    expect(plan.consentGate.status).toBe("blocked");
    expect(plan.launchBlockers.join(" ")).toContain("pilot-consent");
  }, workspaceOAuthTestTimeoutMs);

  it("allows OAuth launch only after signed pilot consent is ready", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client_123");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "secret_123");
    vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", "https://sentinel.example.com/api/oauth/google/callback");
    vi.resetModules();

    const { buildWorkspaceOAuthPlan } = await import("@/lib/workspace-oauth");
    const plan = buildWorkspaceOAuthPlan({ enforceSignedConsent: true, signedConsentReady: true, state: "state_123" });

    expect(plan.launchAllowed).toBe(true);
    expect(plan.consentGate.status).toBe("passed");
    expect(plan.authorizationUrl).toContain("state_123");
  }, workspaceOAuthTestTimeoutMs);

  it("blocks callback completion when OAuth client credentials are missing", async () => {
    const { completeWorkspaceOAuthCallback } = await import("@/lib/workspace-oauth");
    const fetchImpl = vi.fn();

    const result = await completeWorkspaceOAuthCallback({ code: "auth_code", state: "state_123" }, fetchImpl as unknown as typeof fetch);

    expect(result.status).toBe("blocked");
    expect(result.checks[0].detail).toContain("GOOGLE_OAUTH_CLIENT_ID");
    expect(fetchImpl).not.toHaveBeenCalled();
  }, workspaceOAuthTestTimeoutMs);

  it("exchanges code and stores only refresh-token payload in Secret Manager", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client_123");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "secret_123");
    vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", "https://sentinel.example.com/api/oauth/google/callback");
    vi.stubEnv("SENTINEL_STORAGE_MODE", "gcp-rest");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "project_123");
    vi.stubEnv("GOOGLE_CLOUD_ACCESS_TOKEN", "gcp_access_token");
    vi.resetModules();

    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://oauth2.googleapis.com/token") {
        expect(String(init?.body)).toContain("code=auth_code");
        return Response.json({
          access_token: "short_lived_access_token",
          refresh_token: "refresh_token_secret",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/gmail.metadata",
          token_type: "Bearer"
        });
      }

      if (url.includes("secretmanager.googleapis.com")) {
        const body = JSON.parse(String(init?.body)) as { payload: { data: string } };
        const decoded = Buffer.from(body.payload.data, "base64").toString("utf8");
        expect(decoded).toContain("refresh_token_secret");
        expect(decoded).not.toContain("short_lived_access_token");
        return Response.json({ name: "projects/project_123/secrets/sentinel-workspace-oauth-tenant_mainstreet_security/versions/1" });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const { completeWorkspaceOAuthCallback } = await import("@/lib/workspace-oauth");
    const result = await completeWorkspaceOAuthCallback({ code: "auth_code", state: "state_123" }, fetchImpl as unknown as typeof fetch);

    expect(result.status).toBe("stored");
    expect(result.state).toBe("state_123");
    expect(JSON.stringify(result)).not.toContain("refresh_token_secret");
    expect(JSON.stringify(result)).not.toContain("short_lived_access_token");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  }, workspaceOAuthTestTimeoutMs);

  it("records and consumes consent-gated OAuth launch states only once", async () => {
    vi.resetModules();
    const { consumeWorkspaceOAuthLaunchSession, recordWorkspaceOAuthLaunchSession, registerEvidenceVaultArtifact, resetState } = await import(
      "@/lib/store"
    );
    resetState();
    const { artifact } = registerEvidenceVaultArtifact({
      id: "consent_artifact_1",
      kind: "pilot-consent",
      label: "Signed consent packet",
      status: "verified",
      redacted: true,
      sourceDescription: "Signed scope packet from the pilot sponsor."
    });

    const session = recordWorkspaceOAuthLaunchSession({
      state: "state_once",
      requestedScopes: ["https://www.googleapis.com/auth/drive.metadata.readonly"],
      consentArtifactId: artifact.id,
      now: "2026-05-23T00:00:00.000Z"
    });
    const first = consumeWorkspaceOAuthLaunchSession({ state: "state_once", now: "2026-05-23T00:01:00.000Z" });
    const second = consumeWorkspaceOAuthLaunchSession({ state: "state_once", now: "2026-05-23T00:02:00.000Z" });

    expect(session.status).toBe("issued");
    expect(first.status).toBe("passed");
    expect(first.reason).toBe("validated");
    expect(second.status).toBe("blocked");
    expect(second.reason).toBe("used_state");
  }, workspaceOAuthTestTimeoutMs);

  it("expires OAuth launch states before callback token exchange", async () => {
    vi.resetModules();
    const { consumeWorkspaceOAuthLaunchSession, recordWorkspaceOAuthLaunchSession, registerEvidenceVaultArtifact, resetState } = await import(
      "@/lib/store"
    );
    resetState();
    const { artifact } = registerEvidenceVaultArtifact({
      id: "consent_artifact_expiring",
      kind: "pilot-consent",
      label: "Signed consent packet",
      status: "verified",
      redacted: true,
      sourceDescription: "Signed scope packet from the pilot sponsor."
    });

    recordWorkspaceOAuthLaunchSession({
      state: "state_expiring",
      requestedScopes: ["https://www.googleapis.com/auth/gmail.metadata"],
      consentArtifactId: artifact.id,
      now: "2026-05-23T00:00:00.000Z",
      ttlMs: 60_000
    });
    const result = consumeWorkspaceOAuthLaunchSession({ state: "state_expiring", now: "2026-05-23T00:01:01.000Z" });

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("expired_state");
  }, workspaceOAuthTestTimeoutMs);

  it("records OAuth installs without treating sync cursors as initialized", async () => {
    vi.resetModules();
    const { getDashboardSnapshot, recordWorkspaceOAuthInstall, resetState } = await import("@/lib/store");
    resetState();

    const { connection, syncState, artifact } = recordWorkspaceOAuthInstall({
      scopes: ["https://www.googleapis.com/auth/gmail.metadata", "https://www.googleapis.com/auth/drive.metadata.readonly"],
      state: "state_installed",
      connectedAt: "2026-05-23T00:00:00.000Z"
    });
    const snapshot = getDashboardSnapshot();

    expect(connection.mode).toBe("oauth");
    expect(snapshot.connections.map((candidate) => candidate.mode)).toContain("oauth");
    expect(snapshot.connections.map((candidate) => candidate.mode)).not.toContain("mock");
    expect(syncState.mode).toBe("oauth");
    expect(syncState.drive.status).toBe("not_configured");
    expect(syncState.gmail.status).toBe("not_configured");
    expect(artifact.kind).toBe("workspace-oauth-log");
    expect(artifact.status).toBe("uploaded");
    expect(snapshot.readiness.xprizeGate.checks.find((check) => check.id === "workspace-production-sync")?.status).toBe("blocked");
  }, workspaceOAuthTestTimeoutMs);

  it("blocks callback route without an issued state before any Google token exchange", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client_123");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "secret_123");
    vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", "https://sentinel.example.com/api/oauth/google/callback");
    vi.resetModules();
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const { GET } = await import("@/app/api/oauth/google/callback/route");
    const response = await GET(new Request("https://sentinel.example.com/api/oauth/google/callback?code=auth_code"));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.status).toBe("blocked");
    expect(payload.checks[0].target).toBe("state-validation");
    expect(payload.checks[0].detail).toContain("state");
    expect(fetchImpl).not.toHaveBeenCalled();
  }, workspaceOAuthTestTimeoutMs);
});
