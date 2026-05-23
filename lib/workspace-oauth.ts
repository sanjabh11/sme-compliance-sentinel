import { sentinelConfig } from "@/lib/config";
import { makeId } from "@/lib/config";
import { storeWorkspaceOAuthTokenPayload } from "@/lib/persistence";
import type { WorkspaceOAuthCallbackResult, WorkspaceOAuthPlan } from "@/lib/types";

const authEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const tokenEndpoint = "https://oauth2.googleapis.com/token";

export const pilotWorkspaceScopes = [
  {
    scope: "https://www.googleapis.com/auth/drive.metadata.readonly",
    reason: "Detect changed Drive files and risky sharing metadata without downloading content by default.",
    sensitivity: "sensitive" as const
  },
  {
    scope: "https://www.googleapis.com/auth/gmail.metadata",
    reason: "Track Gmail history changes and message labels while minimizing message content access.",
    sensitivity: "sensitive" as const
  }
];

export const deferredWorkspaceScopes = [
  {
    scope: "https://www.googleapis.com/auth/drive",
    reason: "Disable public sharing only after explicit admin approval; deferred until paid pilots prove need.",
    sensitivity: "restricted" as const
  }
];

export function buildWorkspaceOAuthPlan(
  options: { state?: string; enforceSignedConsent?: boolean; signedConsentReady?: boolean } = {}
): WorkspaceOAuthPlan {
  const missingEnv = getMissingOauthEnv();
  const configured = missingEnv.length === 0;
  const consentGate = buildConsentGate(options.enforceSignedConsent ?? false, options.signedConsentReady ?? false);
  const launchBlockers = [
    ...missingEnv.map((env) => `Missing OAuth environment variable: ${env}.`),
    ...(consentGate.status === "blocked" ? [consentGate.detail] : [])
  ];
  const launchAllowed = configured && launchBlockers.length === 0;

  return {
    configured,
    launchAllowed,
    missingEnv,
    launchBlockers,
    authEndpoint,
    tokenEndpoint,
    redirectUri: sentinelConfig.oauthRedirectUri || "not-configured",
    launchMode: configured ? "pilot-test-users" : "verification-required",
    requestedScopes: pilotWorkspaceScopes,
    deferredScopes: deferredWorkspaceScopes,
    consentGate,
    authorizationUrl: launchAllowed ? buildWorkspaceAuthorizationUrl({ state: options.state ?? makeId("oauth_state") }) : undefined,
    verificationWarnings: [
      "Start with allowlisted pilot test users before Marketplace launch.",
      "Do not redirect to Google OAuth until a signed pilot-consent artifact is registered for the target pilot.",
      "Request restricted Drive mutation scope only after the admin explicitly enables remediation.",
      "Every requested scope must be visible in the working app and documented in the OAuth consent screen.",
      "OAuth refresh tokens must be stored only in Secret Manager, not Firestore, BigQuery, logs, or exports."
    ]
  };
}

function buildConsentGate(required: boolean, signedConsentReady: boolean): WorkspaceOAuthPlan["consentGate"] {
  if (!required) {
    return {
      required,
      status: "not-checked",
      requiredArtifactKind: "pilot-consent",
      detail: "Signed pilot consent is not enforced for this plan-only check."
    };
  }

  if (signedConsentReady) {
    return {
      required,
      status: "passed",
      requiredArtifactKind: "pilot-consent",
      detail: "Signed redacted pilot-consent artifact is registered before OAuth launch."
    };
  }

  return {
    required,
    status: "blocked",
    requiredArtifactKind: "pilot-consent",
    detail: "Signed redacted pilot-consent artifact is required before redirecting a pilot to Google OAuth."
  };
}

export function buildWorkspaceAuthorizationUrl(options: { state: string; scopes?: string[] }) {
  assertOauthConfigured();
  const scopes = options.scopes ?? pilotWorkspaceScopes.map((scope) => scope.scope);
  const url = new URL(authEndpoint);

  url.searchParams.set("client_id", sentinelConfig.oauthClientId);
  url.searchParams.set("redirect_uri", sentinelConfig.oauthRedirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", options.state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");

  return url.toString();
}

export async function completeWorkspaceOAuthCallback(
  input: { code?: string | null; state?: string | null },
  fetchImpl: typeof fetch = fetch
): Promise<WorkspaceOAuthCallbackResult> {
  const checks: WorkspaceOAuthCallbackResult["checks"] = [];
  const missingEnv = getMissingOauthEnv();

  if (missingEnv.length) {
    return {
      generatedAt: new Date().toISOString(),
      status: "blocked",
      state: input.state ?? undefined,
      checks: [
        {
          target: "configuration",
          status: "blocked",
          detail: `Google Workspace OAuth callback requires configured client credentials. Missing env: ${missingEnv.join(", ")}.`
        }
      ]
    };
  }

  if (!input.code) {
    return {
      generatedAt: new Date().toISOString(),
      status: "failed",
      state: input.state ?? undefined,
      checks: [
        {
          target: "token-exchange",
          status: "failed",
          detail: "OAuth callback did not include an authorization code."
        }
      ]
    };
  }

  try {
    const tokenResponse = await exchangeWorkspaceAuthorizationCode(input.code, fetchImpl);
    checks.push({
      target: "token-exchange",
      status: "passed",
      detail: "Authorization code exchanged for Google OAuth token response.",
      httpStatus: tokenResponse.httpStatus
    });

    if (!tokenResponse.refreshToken) {
      checks.push({
        target: "secret-manager",
        status: "failed",
        detail: "Google token response did not include a refresh token. Re-run consent with prompt=consent and access_type=offline."
      });

      return {
        generatedAt: new Date().toISOString(),
        status: "failed",
        state: input.state ?? undefined,
        checks
      };
    }

    const storage = await storeWorkspaceOAuthTokenPayload(
      sentinelConfig.tenantId,
      {
        refreshToken: tokenResponse.refreshToken,
        scope: tokenResponse.scope,
        tokenType: tokenResponse.tokenType,
        expiresInSeconds: tokenResponse.expiresInSeconds,
        storedAt: new Date().toISOString(),
        source: "google_oauth_authorization_code"
      },
      fetchImpl
    );
    checks.push({
      target: "secret-manager",
      status: "passed",
      detail: `Refresh token stored as a new Secret Manager version at ${storage.secretName}.`,
      httpStatus: storage.httpStatus
    });

    return {
      generatedAt: new Date().toISOString(),
      status: "stored",
      state: input.state ?? undefined,
      checks
    };
  } catch (error) {
    checks.push({
      target: checks.length ? "secret-manager" : "token-exchange",
      status: "failed",
      detail: error instanceof Error ? error.message : "Google Workspace OAuth callback failed."
    });

    return {
      generatedAt: new Date().toISOString(),
      status: "failed",
      state: input.state ?? undefined,
      checks
    };
  }
}

export async function exchangeWorkspaceAuthorizationCode(code: string, fetchImpl: typeof fetch = fetch) {
  assertOauthConfigured();
  const body = new URLSearchParams({
    code,
    client_id: sentinelConfig.oauthClientId,
    client_secret: sentinelConfig.oauthClientSecret,
    redirect_uri: sentinelConfig.oauthRedirectUri,
    grant_type: "authorization_code"
  });
  const response = await fetchImpl(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok) {
    throw new Error(`Google OAuth token exchange failed: ${response.status} ${payload.error_description ?? payload.error ?? ""}`.trim());
  }

  if (!payload.access_token) {
    throw new Error("Google OAuth token response did not include an access token.");
  }

  return {
    httpStatus: response.status,
    expiresInSeconds: payload.expires_in ?? null,
    refreshToken: payload.refresh_token,
    scope: payload.scope ?? "",
    tokenType: payload.token_type ?? "Bearer"
  };
}

function assertOauthConfigured() {
  const missing = getMissingOauthEnv();
  if (missing.length) {
    throw new Error(`Google Workspace OAuth is not configured. Missing env: ${missing.join(", ")}.`);
  }
}

function getMissingOauthEnv() {
  return [
    ["GOOGLE_OAUTH_CLIENT_ID", sentinelConfig.oauthClientId],
    ["GOOGLE_OAUTH_CLIENT_SECRET", sentinelConfig.oauthClientSecretConfigured ? "configured" : ""],
    ["GOOGLE_OAUTH_REDIRECT_URI", sentinelConfig.oauthRedirectUri]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
}
