import { NextResponse } from "next/server";
import { completeWorkspaceOAuthCallback } from "@/lib/workspace-oauth";
import { consumeWorkspaceOAuthLaunchSession, recordWorkspaceOAuthInstall } from "@/lib/store";
import {
  buildPersistenceReadiness,
  consumePersistedWorkspaceOAuthLaunchSession,
  persistWorkspaceOAuthInstallMetadata
} from "@/lib/persistence";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const persistence = buildPersistenceReadiness();
  const stateValidation = persistence.configured
    ? await consumePersistedWorkspaceOAuthLaunchSession({ state })
    : consumeWorkspaceOAuthLaunchSession({ state });

  if (stateValidation.status !== "passed") {
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        status: "blocked",
        state: state ?? undefined,
        checks: [
          {
            target: "state-validation",
            status: "blocked",
            detail: stateValidation.detail
          }
        ]
      },
      { status: 409 }
    );
  }

  if (error) {
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        status: "failed",
        state: state ?? undefined,
        checks: [
          {
            target: "state-validation",
            status: "passed",
            detail: stateValidation.detail
          },
          {
            target: "token-exchange",
            status: "failed",
            detail: `Google OAuth returned error: ${error}.`
          }
        ]
      },
      { status: 400 }
    );
  }

  const result = await completeWorkspaceOAuthCallback({
    code: url.searchParams.get("code"),
    state
  });

  result.checks.unshift({
    target: "state-validation",
    status: "passed",
    detail: stateValidation.detail
  });

  if (result.status === "stored") {
    const install = recordWorkspaceOAuthInstall({
      scopes: stateValidation.session?.requestedScopes ?? [],
      state
    });

    if (persistence.configured) {
      try {
        const persisted = await persistWorkspaceOAuthInstallMetadata({
          connection: install.connection,
          syncState: install.syncState
        });
        result.checks.push({
          target: "workspace-install",
          status: "passed",
          detail: `Workspace OAuth install metadata persisted to Firestore; sync cursors remain pending until Drive/Gmail initialization. Connection ${persisted.connection.httpStatus}, sync ${persisted.syncState.httpStatus}.`
        });
      } catch (installError) {
        result.status = "failed";
        result.checks.push({
          target: "workspace-install",
          status: "failed",
          detail: installError instanceof Error ? installError.message : "Workspace OAuth install metadata persistence failed."
        });
      }
    } else {
      result.checks.push({
        target: "workspace-install",
        status: "passed",
        detail: "Workspace OAuth install recorded in local memory; production mode must persist connection and cursor state to Firestore."
      });
    }
  }

  return NextResponse.json(result, {
    status: result.status === "stored" ? 200 : result.status === "blocked" ? 409 : 502
  });
}
