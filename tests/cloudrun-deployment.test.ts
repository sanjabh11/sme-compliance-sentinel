import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCloudRunDeploymentEvidence, collectCloudRunDeploymentEvidence } from "@/lib/cloudrun-deployment";
import { scanClaimText } from "@/lib/claim-guard";

const manifest = readFileSync(join(process.cwd(), "cloudrun.service.yaml"), "utf8");

describe("Cloud Run deployment evidence verifier", () => {
  it("flags the checked-in Cloud Run manifest as a template that still needs production values", () => {
    const evidence = collectCloudRunDeploymentEvidence();

    expect(evidence.overallStatus).toBe("template-needs-values");
    expect(evidence.manifestPath).toBe("cloudrun.service.yaml");
    expect(evidence.image).toContain("REGION-docker.pkg.dev/PROJECT_ID");
    expect(evidence.replacementFindings.map((finding) => finding.target)).toEqual(
      expect.arrayContaining([
        "container image",
        "runtime service account",
        "SENTINEL_RELEASE_ID",
        "SENTINEL_SOURCE_COMMIT",
        "SENTINEL_SOURCE_COMMIT_AT",
        "SENTINEL_PRIVATE_EVIDENCE_BUCKET",
        "NEXT_PUBLIC_PRODUCT_URL",
        "GOOGLE_CLOUD_PROJECT"
      ])
    );
    expect(evidence.secretRefs).toEqual(
      expect.arrayContaining([
        { envName: "SENTINEL_ADMIN_ACTION_TOKEN", secretName: "sentinel-admin-action-token", version: "1" },
        { envName: "GEMINI_API_KEY", secretName: "gemini-api-key", version: "1" },
        { envName: "GOOGLE_OAUTH_CLIENT_SECRET", secretName: "google-oauth-client-secret", version: "1" }
      ])
    );
    expect(evidence.envChecks.find((check) => check.name === "GEMINI_API_KEY")?.currentValue).toBe("gemini-api-key:version-set");
    expect(evidence.envChecks.find((check) => check.name === "GEMINI_API_KEY_SECRET_ANNOTATION")).toMatchObject({
      status: "needs-value",
      currentValue: "projects/PROJECT_NUMBER/secrets/gemini-api-key"
    });
    expect(evidence.envChecks.find((check) => check.name === "XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED")?.status).toBe(
      "manual-review"
    );
    expect(evidence.envChecks.find((check) => check.name === "XPRIZE_CATEGORY")).toMatchObject({
      status: "passed",
      currentValue: "Small Business Services"
    });
    expect(evidence.envChecks.find((check) => check.name === "XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED")?.status).toBe(
      "manual-review"
    );
    expect(evidence.envChecks.find((check) => check.name === "XPRIZE_AGENT_EXECUTION_LOGS_CONFIGURED")?.status).toBe(
      "manual-review"
    );
    expect(evidence.blockers).toEqual([]);
    expect(evidence.dryRunCommand).toContain("artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun.service.rendered.yaml");
    expect(evidence.nextActions[0]).toContain("Replace all template placeholders");
  });

  it("treats a rendered manifest as ready for dry-run while keeping attestations in manual review", () => {
    const evidence = buildCloudRunDeploymentEvidence(renderProductionCandidateManifest(), {
      manifestPath: "cloudrun.service.yaml",
      generatedAt: "2026-05-23T12:00:00.000Z"
    });

    expect(evidence.overallStatus).toBe("ready-to-dry-run");
    expect(evidence.replacementFindings).toEqual([]);
    expect(evidence.blockers).toEqual([]);
    expect(evidence.manualReviewFlags).toEqual(
      expect.arrayContaining([
        "XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED",
        "XPRIZE_THIRD_PARTY_REVIEW_APPROVED",
        "XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED",
        "XPRIZE_AGENT_EXECUTION_LOGS_CONFIGURED"
      ])
    );
    expect(evidence.envChecks.find((check) => check.name === "GEMINI_API_KEY_SECRET_ANNOTATION")).toMatchObject({
      status: "passed",
      currentValue: "projects/123456789012/secrets/gemini-api-key"
    });
    expect(evidence.dryRunCommand).toContain("--dry-run");
    expect(evidence.deployCommand).toContain(
      "gcloud run services replace artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun.service.rendered.yaml"
    );
  });

  it("blocks rendered manifests when Cloud Run secret lookup annotations are missing", () => {
    const evidence = buildCloudRunDeploymentEvidence(
      renderProductionCandidateManifest().replace(/\n\s+run\.googleapis\.com\/secrets: "[^"]+"/u, "")
    );

    expect(evidence.overallStatus).toBe("blocked");
    expect(evidence.envChecks.find((check) => check.name === "GEMINI_API_KEY_SECRET_ANNOTATION")).toMatchObject({
      status: "blocked",
      currentValue: "missing"
    });
    expect(evidence.blockers.join(" ")).toContain("Cloud Run secrets annotation");
  });

  it("blocks raw credential and judge-access env vars even when the rest of the manifest is rendered", () => {
    const evidence = buildCloudRunDeploymentEvidence(addEnv(renderProductionCandidateManifest(), [
      ["GOOGLE_CLOUD_ACCESS_TOKEN", "ya29.should-not-be-in-cloud-run"],
      ["XPRIZE_JUDGE_PASSWORD", "do-not-commit"]
    ]));

    expect(evidence.overallStatus).toBe("blocked");
    expect(evidence.envChecks.find((check) => check.name === "GOOGLE_CLOUD_ACCESS_TOKEN")).toMatchObject({
      status: "blocked",
      secret: true,
      currentValue: "raw-value"
    });
    expect(evidence.envChecks.find((check) => check.name === "XPRIZE_JUDGE_PASSWORD")).toMatchObject({
      status: "blocked",
      secret: true,
      currentValue: "raw-value"
    });
    expect(evidence.blockers.join(" ")).toContain("Cloud Run service account");
    expect(JSON.stringify(evidence)).not.toContain("ya29.should-not-be-in-cloud-run");
    expect(JSON.stringify(evidence)).not.toContain("do-not-commit");
  });

  it("blocks duplicate env names and raw secret-shaped values in any non-secret env field", () => {
    const evidence = buildCloudRunDeploymentEvidence(addEnv(renderProductionCandidateManifest(), [
      ["NEXT_PUBLIC_PRODUCT_URL", "https://duplicate.example.com"],
      ["XPRIZE_TESTING_INSTRUCTIONS", "password=do-not-commit"]
    ]));

    expect(evidence.overallStatus).toBe("blocked");
    expect(evidence.envChecks.find((check) => check.name === "DUPLICATE_ENV_NEXT_PUBLIC_PRODUCT_URL")).toMatchObject({
      status: "blocked",
      currentValue: "count:2"
    });
    expect(evidence.envChecks.find((check) => check.name === "UNSAFE_RAW_VALUE_XPRIZE_TESTING_INSTRUCTIONS")).toMatchObject({
      status: "blocked",
      secret: true,
      currentValue: "raw-value"
    });
    expect(evidence.blockers.join(" ")).toContain("Keep exactly one NEXT_PUBLIC_PRODUCT_URL");
    expect(evidence.blockers.join(" ")).toContain("Move any secret material for XPRIZE_TESTING_INSTRUCTIONS");
    expect(JSON.stringify(evidence)).not.toContain("do-not-commit");
  });

  it("blocks rendered manifests with unsafe production-mode, callback, model, or secret-version drift", () => {
    const driftedManifest = renderProductionCandidateManifest()
      .replace('name: SENTINEL_MOCK_MODE\n              value: "false"', 'name: SENTINEL_MOCK_MODE\n              value: "true"')
      .replace("https://youtu.be/sentinel-demo", "https://example.com/sentinel-demo")
      .replace('name: XPRIZE_ENTRANT_TYPE\n              value: "team"', 'name: XPRIZE_ENTRANT_TYPE\n              value: "vendor"')
      .replace("123456789012-abcdef.apps.googleusercontent.com", "client-id")
      .replace('name: SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS\n              value: "34.10.10.10"', 'name: SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS\n              value: "0.0.0.0/0"')
      .replace('name: SENTINEL_GEMINI_MONTHLY_BUDGET_USD\n              value: "50"', 'name: SENTINEL_GEMINI_MONTHLY_BUDGET_USD\n              value: "0"')
      .replace(
        'name: GOOGLE_OAUTH_REDIRECT_URI\n              value: "https://sme-workspace-sentinel-abc-uc.a.run.app/api/oauth/google/callback"',
        'name: GOOGLE_OAUTH_REDIRECT_URI\n              value: "https://sme-workspace-sentinel-abc-uc.a.run.app/wrong/oauth/callback"'
      )
      .replace(
        'name: WORKSPACE_PUBSUB_PUSH_AUDIENCE\n              value: "https://sme-workspace-sentinel-abc-uc.a.run.app/api/webhooks/pubsub/gmail"',
        'name: WORKSPACE_PUBSUB_PUSH_AUDIENCE\n              value: "https://sme-workspace-sentinel-abc-uc.a.run.app/api/webhooks/pubsub/drive"'
      )
      .replace(
        "us-central1-docker.pkg.dev/sentinel-prod/sentinel/web:release-20260523-001",
        "us-central1-docker.pkg.dev/sentinel-prod/sentinel/web:latest"
      )
      .replace('name: SENTINEL_SOURCE_COMMIT\n              value: "0123456789abcdef0123456789abcdef01234567"', 'name: SENTINEL_SOURCE_COMMIT\n              value: "short-sha"')
      .replace('name: SENTINEL_SOURCE_COMMIT_AT\n              value: "2026-05-23T17:24:17.894Z"', 'name: SENTINEL_SOURCE_COMMIT_AT\n              value: "not-a-date"')
      .replace('name: SENTINEL_GEMINI_MODEL_ALLOWLIST\n              value: "gemini-3.5-flash,gemini-2.5-flash,gemini-2.5-pro"', 'name: SENTINEL_GEMINI_MODEL_ALLOWLIST\n              value: "gemini-2.5-flash"')
      .replace('name: XPRIZE_CATEGORY\n              value: "Small Business Services"', 'name: XPRIZE_CATEGORY\n              value: "Professional Services Access"')
      .replace('name: sentinel-admin-action-token\n                  key: "1"', 'name: sentinel-admin-action-token\n                  key: "latest"');
    const evidence = buildCloudRunDeploymentEvidence(driftedManifest);
    const checksByName = Object.fromEntries(evidence.envChecks.map((check) => [check.name, check]));

    expect(evidence.overallStatus).toBe("blocked");
    expect(checksByName.INVALID_VALUE_SENTINEL_MOCK_MODE).toMatchObject({ status: "blocked" });
    expect(checksByName.MISMATCHED_GOOGLE_OAUTH_REDIRECT_URI).toMatchObject({ status: "blocked" });
    expect(checksByName.MISMATCHED_WORKSPACE_PUBSUB_PUSH_AUDIENCE).toMatchObject({ status: "blocked" });
    expect(checksByName.INVALID_XPRIZE_DEMO_VIDEO_URL_HOST).toMatchObject({ status: "blocked" });
    expect(checksByName.INVALID_XPRIZE_ENTRANT_TYPE).toMatchObject({ status: "blocked" });
    expect(checksByName.INVALID_GOOGLE_OAUTH_CLIENT_ID).toMatchObject({ status: "blocked" });
    expect(checksByName.INVALID_SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS).toMatchObject({ status: "blocked" });
    expect(checksByName.INVALID_NUMBER_SENTINEL_GEMINI_MONTHLY_BUDGET_USD).toMatchObject({ status: "blocked" });
    expect(checksByName.INVALID_CLOUD_RUN_IMAGE_TAG).toMatchObject({ status: "blocked" });
    expect(checksByName.INVALID_SENTINEL_SOURCE_COMMIT).toMatchObject({ status: "blocked" });
    expect(checksByName.INVALID_SENTINEL_SOURCE_COMMIT_AT).toMatchObject({ status: "blocked" });
    expect(checksByName.INVALID_GEMINI_MODEL_ALLOWLIST).toMatchObject({ status: "blocked" });
    expect(checksByName.INVALID_VALUE_XPRIZE_CATEGORY).toMatchObject({ status: "blocked" });
    expect(checksByName.SENTINEL_ADMIN_ACTION_TOKEN).toMatchObject({ status: "blocked" });
    expect(JSON.stringify(evidence)).not.toContain("private-admin-token");
  });

  it("emits a CLI JSON report without leaking secret values", () => {
    const output = execFileSync("node", ["scripts/verify-cloudrun-deployment.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    const report = JSON.parse(output) as {
      overallStatus: string;
      secretRefs: Array<{ envName: string; secretName: string; version: string }>;
      replacementFindings: Array<{ target: string }>;
      blockers: string[];
    };

    expect(report.overallStatus).toBe("template-needs-values");
    expect(report.replacementFindings.map((finding) => finding.target)).toEqual(
      expect.arrayContaining(["SENTINEL_SOURCE_COMMIT", "SENTINEL_SOURCE_COMMIT_AT"])
    );
    expect(report.secretRefs).toEqual(
      expect.arrayContaining([
        { envName: "SENTINEL_ADMIN_ACTION_TOKEN", secretName: "sentinel-admin-action-token", version: "1" },
        { envName: "WORKSPACE_DRIVE_CHANNEL_TOKEN", secretName: "workspace-drive-channel-token", version: "1" }
      ])
    );
    expect(output).not.toContain("GOOGLE_CLOUD_ACCESS_TOKEN");
    expect(output).not.toContain("SENTINEL_ADMIN_ACTION_TOKEN=");
    expect(output).not.toContain("AIza");
    expect(report.blockers).toEqual([]);
  });

  it("applies the same production contract checks through the CLI verifier", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-cloudrun-"));
    const manifestPath = join(tempDir, "cloudrun.bad.yaml");
    writeFileSync(
      manifestPath,
      renderProductionCandidateManifest().replace(
        'name: SENTINEL_WORKSPACE_WEBHOOK_AUTH_MODE\n              value: "oidc"',
        'name: SENTINEL_WORKSPACE_WEBHOOK_AUTH_MODE\n              value: "demo"'
      ).replace(
        'name: XPRIZE_ENTRANT_TYPE\n              value: "team"',
        'name: XPRIZE_ENTRANT_TYPE\n              value: "contractor"'
      ).replace(
        'name: SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS\n              value: "34.10.10.10"',
        'name: SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS\n              value: "anywhere"'
      ).replace(
        "us-central1-docker.pkg.dev/sentinel-prod/sentinel/web:release-20260523-001",
        "us-central1-docker.pkg.dev/sentinel-prod/sentinel/web:latest"
      ),
      "utf8"
    );

    try {
      const output = execFileSync("node", ["scripts/verify-cloudrun-deployment.mjs", `--manifest=${manifestPath}`], {
        cwd: process.cwd(),
        encoding: "utf8"
      });
      const report = JSON.parse(output) as { overallStatus: string; blockers: string[] };

      expect(report.overallStatus).toBe("blocked");
      expect(report.blockers.join(" ")).toContain("INVALID_VALUE_SENTINEL_WORKSPACE_WEBHOOK_AUTH_MODE");
      expect(report.blockers.join(" ")).toContain("INVALID_XPRIZE_ENTRANT_TYPE");
      expect(report.blockers.join(" ")).toContain("INVALID_SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS");
      expect(report.blockers.join(" ")).toContain("INVALID_CLOUD_RUN_IMAGE_TAG");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps deployment evidence language inside the claim guard boundary", () => {
    const evidence = collectCloudRunDeploymentEvidence();
    const violations = scanClaimText({
      artifact: "cloudrun-deployment",
      text: JSON.stringify(evidence, null, 2)
    });

    expect(violations).toEqual([]);
  });
});

function addEnv(source: string, entries: Array<[string, string]>) {
  const rendered = entries
    .map(([name, value]) => `            - name: ${name}\n              value: "${value}"`)
    .join("\n");

  return source.replace("          env:\n", `          env:\n${rendered}\n`);
}

function renderProductionCandidateManifest() {
  return manifest
    .replace("REGION-docker.pkg.dev/PROJECT_ID/sentinel/web:latest", "us-central1-docker.pkg.dev/sentinel-prod/sentinel/web:release-20260523-001")
    .replace("sentinel-runtime@PROJECT_ID.iam.gserviceaccount.com", "sentinel-runtime@sentinel-prod.iam.gserviceaccount.com")
    .replaceAll("https://YOUR-SERVICE-URL", "https://sme-workspace-sentinel-abc-uc.a.run.app")
    .replace("https://youtu.be/YOUR_VIDEO", "https://youtu.be/sentinel-demo")
    .replace('name: SENTINEL_RELEASE_ID\n              value: "RELEASE_ID"', 'name: SENTINEL_RELEASE_ID\n              value: "release-20260523-001"')
    .replace(
      'name: SENTINEL_SOURCE_COMMIT\n              value: "SOURCE_COMMIT"',
      'name: SENTINEL_SOURCE_COMMIT\n              value: "0123456789abcdef0123456789abcdef01234567"'
    )
    .replace(
      'name: SENTINEL_SOURCE_COMMIT_AT\n              value: "SOURCE_COMMIT_AT"',
      'name: SENTINEL_SOURCE_COMMIT_AT\n              value: "2026-05-23T17:24:17.894Z"'
    )
    .replace(
      'name: SENTINEL_PRIVATE_EVIDENCE_BUCKET\n              value: "gs://PROJECT_ID-sentinel-private-evidence"',
      'name: SENTINEL_PRIVATE_EVIDENCE_BUCKET\n              value: "gs://sentinel-prod-sentinel-private-evidence"'
    )
    .replace('name: GOOGLE_CLOUD_PROJECT\n              value: "PROJECT_ID"', 'name: GOOGLE_CLOUD_PROJECT\n              value: "sentinel-prod"')
    .replace(
      'name: GOOGLE_CLOUD_PROJECT_NUMBER\n              value: "PROJECT_NUMBER"',
      'name: GOOGLE_CLOUD_PROJECT_NUMBER\n              value: "123456789012"'
    )
    .replaceAll("projects/PROJECT_NUMBER/secrets/", "projects/123456789012/secrets/")
    .replace(
      'name: GOOGLE_CLOUD_BILLING_ACCOUNT_ID\n              value: "BILLING_ACCOUNT_ID"',
      'name: GOOGLE_CLOUD_BILLING_ACCOUNT_ID\n              value: "000000-111111-222222"'
    )
    .replace(
      'name: SENTINEL_GCP_BUDGET_ID\n              value: "billingAccounts/BILLING_ACCOUNT_ID/budgets/BUDGET_ID"',
      'name: SENTINEL_GCP_BUDGET_ID\n              value: "billingAccounts/000000-111111-222222/budgets/budget-123"'
    )
    .replaceAll("projects/PROJECT_ID/", "projects/sentinel-prod/")
    .replace("workspace-push@PROJECT_ID.iam.gserviceaccount.com", "workspace-push@sentinel-prod.iam.gserviceaccount.com")
    .replace(
      "YOUR_OAUTH_CLIENT_ID.apps.googleusercontent.com",
      "123456789012-abcdef.apps.googleusercontent.com"
    )
    .replace(
      "projects/PROJECT_NUMBER/locations/global/keys/GEMINI_API_KEY_ID",
      "projects/123456789012/locations/global/keys/gemini-key-123"
    )
    .replace('name: XPRIZE_ENTRANT_TYPE\n              value: ""', 'name: XPRIZE_ENTRANT_TYPE\n              value: "team"')
    .replace(
      'name: SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS\n              value: ""',
      'name: SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS\n              value: "34.10.10.10"'
    );
}
