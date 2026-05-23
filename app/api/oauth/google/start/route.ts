import { NextResponse } from "next/server";
import { buildWorkspaceOAuthPlan } from "@/lib/workspace-oauth";
import { makeId } from "@/lib/config";
import { findVerifiedPilotConsentArtifact, getDashboardSnapshot, recordWorkspaceOAuthLaunchSession } from "@/lib/store";
import { buildPersistenceReadiness, persistWorkspaceOAuthLaunchSession } from "@/lib/persistence";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") !== "false";
  const snapshot = getDashboardSnapshot();
  const signedConsentArtifact = findVerifiedPilotConsentArtifact();
  const oauthState = makeId("oauth_state");
  const plan = buildWorkspaceOAuthPlan({ enforceSignedConsent: true, signedConsentReady: Boolean(signedConsentArtifact), state: oauthState });

  if (!plan.launchAllowed || dryRun) {
    return NextResponse.json(plan, { status: plan.launchAllowed ? 200 : 409 });
  }

  const session = recordWorkspaceOAuthLaunchSession({
    state: oauthState,
    requestedScopes: plan.requestedScopes.map((scope) => scope.scope),
    consentArtifactId: signedConsentArtifact?.id,
    targetProspectId: snapshot.pilotProspects[0]?.id
  });
  const persistence = buildPersistenceReadiness();

  if (persistence.configured) {
    try {
      await persistWorkspaceOAuthLaunchSession(session);
    } catch (error) {
      return NextResponse.json(
        {
          ...plan,
          launchAllowed: false,
          authorizationUrl: undefined,
          launchBlockers: [
            ...plan.launchBlockers,
            `Durable OAuth state persistence failed before redirect: ${
              error instanceof Error ? error.message : "unknown persistence error"
            }`
          ]
        },
        { status: 502 }
      );
    }
  }

  return NextResponse.redirect(plan.authorizationUrl ?? plan.authEndpoint);
}
