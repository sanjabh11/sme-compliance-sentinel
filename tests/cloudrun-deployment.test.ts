import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
    expect(evidence.envChecks.find((check) => check.name === "XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED")?.status).toBe(
      "manual-review"
    );
    expect(evidence.blockers).toEqual([]);
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
      expect.arrayContaining(["XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED", "XPRIZE_THIRD_PARTY_REVIEW_APPROVED"])
    );
    expect(evidence.dryRunCommand).toContain("--dry-run");
    expect(evidence.deployCommand).toContain("gcloud run services replace cloudrun.service.yaml");
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

  it("emits a CLI JSON report without leaking secret values", () => {
    const output = execFileSync("node", ["scripts/verify-cloudrun-deployment.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    const report = JSON.parse(output) as {
      overallStatus: string;
      secretRefs: Array<{ envName: string; secretName: string; version: string }>;
      blockers: string[];
    };

    expect(report.overallStatus).toBe("template-needs-values");
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
    .replace("REGION-docker.pkg.dev/PROJECT_ID/sentinel/web:latest", "us-central1-docker.pkg.dev/sentinel-prod/sentinel/web:latest")
    .replace("sentinel-runtime@PROJECT_ID.iam.gserviceaccount.com", "sentinel-runtime@sentinel-prod.iam.gserviceaccount.com")
    .replaceAll("https://YOUR-SERVICE-URL", "https://sme-workspace-sentinel-abc-uc.a.run.app")
    .replace("https://youtu.be/YOUR_VIDEO", "https://youtu.be/sentinel-demo")
    .replace('name: SENTINEL_RELEASE_ID\n              value: "RELEASE_ID"', 'name: SENTINEL_RELEASE_ID\n              value: "release-20260523-001"')
    .replace(
      'name: SENTINEL_PRIVATE_EVIDENCE_BUCKET\n              value: "gs://PROJECT_ID-sentinel-private-evidence"',
      'name: SENTINEL_PRIVATE_EVIDENCE_BUCKET\n              value: "gs://sentinel-prod-sentinel-private-evidence"'
    )
    .replace('name: GOOGLE_CLOUD_PROJECT\n              value: "PROJECT_ID"', 'name: GOOGLE_CLOUD_PROJECT\n              value: "sentinel-prod"')
    .replace(
      'name: GOOGLE_CLOUD_PROJECT_NUMBER\n              value: "PROJECT_NUMBER"',
      'name: GOOGLE_CLOUD_PROJECT_NUMBER\n              value: "123456789012"'
    )
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
