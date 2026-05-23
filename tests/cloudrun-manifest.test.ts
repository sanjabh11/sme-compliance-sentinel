import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = readFileSync(join(process.cwd(), "cloudrun.service.yaml"), "utf8");

describe("Cloud Run deployment manifest", () => {
  it("keeps production mode, XPRIZE, Google Cloud, Workspace, and Gemini env placeholders in one deployable manifest", () => {
    expect(manifest).toContain("run.googleapis.com/execution-environment: gen2");
    expect(manifest).toContain("serviceAccountName: sentinel-runtime@PROJECT_ID.iam.gserviceaccount.com");
    expect(manifest).toContain("containerConcurrency: 80");
    expect(manifest).toContain("timeoutSeconds: 60");

    [
      "SENTINEL_MOCK_MODE",
      "SENTINEL_STORAGE_MODE",
      "SENTINEL_EVIDENCE_MODE",
      "SENTINEL_CLOUD_COST_CONTROLS_MODE",
      "SENTINEL_CLOUD_RUN_SERVICE_NAME",
      "SENTINEL_CLOUD_RUN_REGION",
      "SENTINEL_RELEASE_ID",
      "SENTINEL_PRIVATE_EVIDENCE_BUCKET",
      "NEXT_PUBLIC_PRODUCT_URL",
      "XPRIZE_REPOSITORY_URL",
      "XPRIZE_DEMO_VIDEO_URL",
      "XPRIZE_DEMO_VIDEO_UNDER_3_MIN_CONFIRMED",
      "XPRIZE_DEMO_VIDEO_PUBLICLY_ACCESSIBLE_CONFIRMED",
      "XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED",
      "XPRIZE_DEMO_VIDEO_CUSTOMER_DATA_REDACTED_CONFIRMED",
      "XPRIZE_DEMO_VIDEO_ENGLISH_OR_SUBTITLED_CONFIRMED",
      "XPRIZE_JUDGE_ACCESS_CONFIGURED",
      "XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED",
      "XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED",
      "XPRIZE_ENTRANT_TYPE",
      "XPRIZE_GENERAL_ELIGIBILITY_CONFIRMED",
      "XPRIZE_REPRESENTATIVE_AUTHORIZED",
      "XPRIZE_ORGANIZATION_UNDER_25_CONFIRMED",
      "XPRIZE_CORPORATE_ID_CONFIGURED",
      "XPRIZE_NO_PROMOTION_ENTITY_CONFLICT_CONFIRMED",
      "XPRIZE_THIRD_PARTY_REVIEW_APPROVED",
      "XPRIZE_TESTING_INSTRUCTIONS",
      "GOOGLE_CLOUD_PROJECT",
      "GOOGLE_CLOUD_PROJECT_NUMBER",
      "GOOGLE_CLOUD_BILLING_ACCOUNT_ID",
      "SENTINEL_GCP_BUDGET_ID",
      "SENTINEL_BUDGET_PUBSUB_TOPIC",
      "FIRESTORE_DATABASE",
      "BIGQUERY_DATASET",
      "BIGQUERY_AUDIT_TABLE",
      "BIGQUERY_AGENT_RUNS_TABLE",
      "WORKSPACE_SECRET_PREFIX",
      "WORKSPACE_GMAIL_TOPIC",
      "WORKSPACE_GMAIL_SUBSCRIPTION",
      "SENTINEL_WORKSPACE_WEBHOOK_AUTH_MODE",
      "WORKSPACE_PUBSUB_PUSH_AUDIENCE",
      "WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL",
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_REDIRECT_URI",
      "GEMINI_MODEL",
      "SENTINEL_GEMINI_MODEL_ALLOWLIST",
      "SENTINEL_GEMINI_MONTHLY_BUDGET_USD",
      "SENTINEL_GEMINI_MAX_CONTENT_BYTES_PER_EVENT",
      "SENTINEL_GEMINI_API_KEY_ID",
      "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS",
      "SENTINEL_GEMINI_DAILY_REQUEST_QUOTA",
      "SENTINEL_GEMINI_DAILY_TOKEN_QUOTA",
      "SENSITIVE_DATA_PROTECTION_ENABLED"
    ].forEach(expectEnv);

    expectEnvValue("SENTINEL_MOCK_MODE", "false");
    expectEnvValue("SENTINEL_STORAGE_MODE", "gcp-rest");
    expectEnvValue("SENTINEL_EVIDENCE_MODE", "production");
    expectEnvValue("SENTINEL_CLOUD_COST_CONTROLS_MODE", "production");
    expectEnvValue("SENTINEL_CLOUD_RUN_SERVICE_NAME", "sme-workspace-sentinel");
    expectEnvValue("SENTINEL_CLOUD_RUN_REGION", "us-central1");
    expectEnvValue("SENTINEL_RELEASE_ID", "RELEASE_ID");
    expectEnvValue("SENTINEL_PRIVATE_EVIDENCE_BUCKET", "gs://PROJECT_ID-sentinel-private-evidence");
    expectEnvValue("XPRIZE_REPOSITORY_URL", "https://github.com/sanjabh11/sme-compliance-sentinel");
    expectEnvValue("SENTINEL_WORKSPACE_WEBHOOK_AUTH_MODE", "oidc");
    expectEnvValue("SENSITIVE_DATA_PROTECTION_ENABLED", "true");
  });

  it("uses Secret Manager references for credentials and does not commit access-token envs", () => {
    expectSecretEnv("SENTINEL_ADMIN_ACTION_TOKEN", "sentinel-admin-action-token", "1");
    expectSecretEnv("GEMINI_API_KEY", "gemini-api-key", "1");
    expectSecretEnv("GOOGLE_OAUTH_CLIENT_SECRET", "google-oauth-client-secret", "1");
    expectSecretEnv("SENTINEL_EVIDENCE_SIGNING_SECRET", "sentinel-evidence-signing-secret", "1");
    expectSecretEnv("WORKSPACE_DRIVE_CHANNEL_TOKEN", "workspace-drive-channel-token", "1");
    expect(manifest).not.toContain("key: latest");
    [
      "GOOGLE_CLOUD_ACCESS_TOKEN",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "GOOGLE_OAUTH_REFRESH_TOKEN",
      "WORKSPACE_REFRESH_TOKEN",
      "XPRIZE_JUDGE_CREDENTIALS",
      "XPRIZE_JUDGE_PASSWORD"
    ].forEach((name) => {
      expect(manifest).not.toContain(`- name: ${name}`);
    });
  });
});

function expectEnv(name: string) {
  expect(manifest).toMatch(new RegExp(`- name: ${escapeRegExp(name)}\\n`));
}

function expectEnvValue(name: string, value: string) {
  expect(manifest).toMatch(new RegExp(`- name: ${escapeRegExp(name)}\\n\\s+value: "${escapeRegExp(value)}"`));
}

function expectSecretEnv(name: string, secretName: string, version: string) {
  expect(manifest).toMatch(
    new RegExp(
      `- name: ${escapeRegExp(name)}\\n\\s+valueFrom:\\n\\s+secretKeyRef:\\n\\s+name: ${escapeRegExp(secretName)}\\n\\s+key: "${escapeRegExp(version)}"`
    )
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
