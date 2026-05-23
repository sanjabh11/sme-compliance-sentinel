import { describe, expect, it } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import { buildProductionLaunchCommandCenter } from "@/lib/production-launch";
import { createDemoEvent, getDashboardSnapshot, ingestResourceEvent, resetState } from "@/lib/store";

describe("Production launch command center", () => {
  it("unifies production proof blockers without treating local mock state as ready", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const center = buildProductionLaunchCommandCenter(getDashboardSnapshot());
    const workstreamsById = Object.fromEntries(center.workstreams.map((workstream) => [workstream.id, workstream]));
    const envByName = Object.fromEntries(center.envMatrix.map((item) => [item.name, item]));

    expect(center.overallStatus).toBe("blocked");
    expect(center.launchMode).toBe("local-mock");
    expect(center.readinessScore).toBeGreaterThan(0);
    expect(center.readinessScore).toBeLessThan(100);
    expect(workstreamsById["gcp-deploy-persistence"].status).toBe("blocked");
    expect(workstreamsById["gcp-deploy-persistence"].requiredProof.join(" ")).toContain("agent-run row");
    expect(workstreamsById["live-gemini-operation"].status).toBe("needs-review");
    expect(workstreamsById["live-gemini-operation"].requiredProof.join(" ")).toContain("provider=gemini-api");
    expect(workstreamsById["workspace-pilot-sync"].status).toBe("external-required");
    expect(workstreamsById["paid-pilot-evidence"].status).toBe("blocked");
    expect(workstreamsById["judge-access-media"].status).toBe("external-required");
    expect(envByName["GEMINI_API_KEY"].secret).toBe(true);
    expect(envByName["BIGQUERY_AGENT_RUNS_TABLE"].currentValue).toBe("agent_runs");
    expect(envByName["WORKSPACE_GMAIL_SUBSCRIPTION"].status).toBe("missing");
    expect(envByName["SENTINEL_WORKSPACE_WEBHOOK_AUTH_MODE"].status).toBe("missing");
    expect(envByName["WORKSPACE_DRIVE_CHANNEL_TOKEN"].secret).toBe(true);
    expect(envByName["SENTINEL_BUDGET_PUBSUB_TOPIC"].status).toBe("missing");
    expect(envByName["SENSITIVE_DATA_PROTECTION_ENABLED"].status).toBe("missing");
    expect(envByName["XPRIZE_DEMO_VIDEO_UNDER_3_MIN_CONFIRMED"].status).toBe("missing");
    expect(envByName["XPRIZE_DEMO_VIDEO_PUBLICLY_ACCESSIBLE_CONFIRMED"].status).toBe("missing");
    expect(envByName["XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED"].status).toBe("missing");
    expect(envByName["XPRIZE_DEMO_VIDEO_CUSTOMER_DATA_REDACTED_CONFIRMED"].status).toBe("missing");
    expect(envByName["XPRIZE_DEMO_VIDEO_ENGLISH_OR_SUBTITLED_CONFIRMED"].status).toBe("missing");
    expect(envByName["XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED"].status).toBe("missing");
    expect(envByName["XPRIZE_ENTRANT_TYPE"].status).toBe("missing");
    expect(envByName["XPRIZE_GENERAL_ELIGIBILITY_CONFIRMED"].status).toBe("missing");
    expect(envByName["XPRIZE_REPRESENTATIVE_AUTHORIZED"].status).toBe("missing");
    expect(envByName["XPRIZE_ORGANIZATION_UNDER_25_CONFIRMED"].status).toBe("missing");
    expect(envByName["XPRIZE_CORPORATE_ID_CONFIGURED"].status).toBe("missing");
    expect(envByName["XPRIZE_NO_PROMOTION_ENTITY_CONFLICT_CONFIRMED"].status).toBe("missing");
    expect(envByName["XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED"].status).toBe("missing");
    expect(["configured", "secret-required"]).toContain(envByName["GEMINI_API_KEY"].status);
    expect(center.blockers.join(" ")).toContain("Cloud Run");
    expect(center.blockers.join(" ")).toContain("GOOGLE_CLOUD_PROJECT");
  });

  it("provides operator commands, proof artifacts, and claim-safe language", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const center = buildProductionLaunchCommandCenter(getDashboardSnapshot());

    expect(center.verificationCommands.map((command) => command.id)).toEqual(
      expect.arrayContaining([
        "local-quality-gates",
        "cloudrun-manifest-review",
        "hosted-production-smoke",
        "production-gemini-smoke",
        "persistence-write-through",
        "workspace-reconciliation",
        "final-submission-binder"
      ])
    );
    const proofArtifactsById = Object.fromEntries(center.proofArtifacts.map((artifact) => [artifact.id, artifact]));

    expect(center.proofArtifacts.map((artifact) => artifact.id)).toEqual(
      expect.arrayContaining([
        "cloud-run-url",
        "bigquery-agent-run",
        "live-gemini-log",
        "financial-records",
        "demo-video",
        "license-ip-review"
      ])
    );
    expect(proofArtifactsById["bigquery-agent-run"].privateHandling).toContain("provider/model/fallback/cost");
    expect(proofArtifactsById["demo-video"].nextAction).toContain("human-review");
    expect(proofArtifactsById["license-ip-review"].status).toBe("external-required");
    expect(center.claimBoundaries.join(" ")).toContain("Local mock data");

    const violations = scanClaimText({
      artifact: "production-launch",
      text: JSON.stringify(center, null, 2)
    });

    expect(violations).toEqual([]);
  });
});
