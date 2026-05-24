import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import contract from "../docs/deployment/cloudrun-deployment-contract.json";

const manifest = readFileSync(join(process.cwd(), "cloudrun.service.yaml"), "utf8");
const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");

const requiredDeploymentCapabilityGroups = [
  {
    id: "xprize-source-repository",
    env: [
      "XPRIZE_REPOSITORY_URL",
      "XPRIZE_REPOSITORY_ACCESS_CONFIGURED",
      "XPRIZE_REPOSITORY_ACCESS_MODE",
      "XPRIZE_REPOSITORY_JUDGE_ACCESS_EMAILS",
      "XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED"
    ]
  },
  {
    id: "xprize-business-evidence",
    env: [
      "XPRIZE_CATEGORY",
      "XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED",
      "XPRIZE_CATEGORY_IMPACT_EVIDENCE_CONFIGURED",
      "XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED",
      "XPRIZE_REVENUE_BY_MONTH_EVIDENCE_CONFIGURED",
      "XPRIZE_TOTAL_COSTS_EVIDENCE_CONFIGURED",
      "XPRIZE_CAC_SPEND_EVIDENCE_CONFIGURED",
      "XPRIZE_REAL_USER_EVIDENCE_CONFIGURED",
      "XPRIZE_RELATED_PARTY_REVENUE_REVIEWED"
    ]
  },
  {
    id: "xprize-demo-and-judge-access",
    env: [
      "XPRIZE_DEMO_VIDEO_URL",
      "XPRIZE_DEMO_VIDEO_UNDER_3_MIN_CONFIRMED",
      "XPRIZE_DEMO_VIDEO_PUBLICLY_ACCESSIBLE_CONFIRMED",
      "XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED",
      "XPRIZE_DEMO_VIDEO_CUSTOMER_DATA_REDACTED_CONFIRMED",
      "XPRIZE_DEMO_VIDEO_ENGLISH_OR_SUBTITLED_CONFIRMED",
      "XPRIZE_JUDGE_ACCESS_CONFIGURED",
      "XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED",
      "XPRIZE_JUDGING_PERIOD_END_AT",
      "XPRIZE_TESTING_INSTRUCTIONS"
    ]
  },
  {
    id: "google-cloud-runtime-and-persistence",
    env: [
      "GOOGLE_CLOUD_PROJECT",
      "GOOGLE_CLOUD_PROJECT_NUMBER",
      "SENTINEL_STORAGE_MODE",
      "SENTINEL_EVIDENCE_MODE",
      "SENTINEL_PRIVATE_EVIDENCE_BUCKET",
      "FIRESTORE_DATABASE",
      "BIGQUERY_DATASET",
      "BIGQUERY_AUDIT_TABLE",
      "BIGQUERY_AGENT_RUNS_TABLE"
    ]
  },
  {
    id: "workspace-oauth-and-sync",
    env: [
      "WORKSPACE_SECRET_PREFIX",
      "WORKSPACE_GMAIL_TOPIC",
      "WORKSPACE_GMAIL_SUBSCRIPTION",
      "SENTINEL_WORKSPACE_WEBHOOK_AUTH_MODE",
      "WORKSPACE_PUBSUB_PUSH_AUDIENCE",
      "WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL",
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_REDIRECT_URI",
      "GOOGLE_OAUTH_REQUESTED_SCOPES",
      "GOOGLE_OAUTH_DEFERRED_RESTRICTED_SCOPES",
      "GOOGLE_OAUTH_SCOPE_REVIEW_CONFIRMED",
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "WORKSPACE_DRIVE_CHANNEL_TOKEN"
    ]
  },
  {
    id: "gemini-api-and-cost-control",
    env: [
      "GEMINI_MODEL",
      "GEMINI_API_KEY",
      "SENTINEL_GEMINI_MODEL_ALLOWLIST",
      "SENTINEL_GEMINI_MONTHLY_BUDGET_USD",
      "SENTINEL_GEMINI_MAX_CONTENT_BYTES_PER_EVENT",
      "SENTINEL_GEMINI_API_KEY_ID",
      "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS",
      "SENTINEL_GEMINI_DAILY_REQUEST_QUOTA",
      "SENTINEL_GEMINI_DAILY_TOKEN_QUOTA",
      "SENTINEL_GEMINI_QUOTA_EVIDENCE_CONFIRMED",
      "GEMINI_INPUT_PER_1K_USD",
      "GEMINI_OUTPUT_PER_1K_USD"
    ]
  },
  {
    id: "cloud-billing-controls",
    env: [
      "SENTINEL_CLOUD_COST_CONTROLS_MODE",
      "GOOGLE_CLOUD_BILLING_ACCOUNT_ID",
      "SENTINEL_GCP_BUDGET_ID",
      "SENTINEL_BUDGET_PUBSUB_TOPIC"
    ]
  },
  {
    id: "secret-and-review-boundaries",
    env: [
      "SENTINEL_ADMIN_ACTION_TOKEN",
      "SENTINEL_EVIDENCE_SIGNING_SECRET",
      "XPRIZE_THIRD_PARTY_REVIEW_APPROVED",
      "XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED",
      "XPRIZE_EVIDENCE_RESPONSE_READY",
      "SENSITIVE_DATA_PROTECTION_ENABLED"
    ]
  }
];

describe("Cloud Run deployment manifest", () => {
  it("keeps production mode, XPRIZE, Google Cloud, Workspace, and Gemini env placeholders in one deployable manifest", () => {
    expect(manifest).toContain("run.googleapis.com/execution-environment: gen2");
    expect(manifest).toContain("run.googleapis.com/secrets:");
    expect(manifest).toContain("serviceAccountName: sentinel-runtime@PROJECT_ID.iam.gserviceaccount.com");
    expect(manifest).toContain("REGION-docker.pkg.dev/PROJECT_ID/sentinel/web:RELEASE_ID");
    expect(manifest).not.toContain("/web:latest");
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
      "SENTINEL_SOURCE_COMMIT",
      "SENTINEL_SOURCE_COMMIT_AT",
      "SENTINEL_SOURCE_BRANCH",
      "SENTINEL_PRIVATE_EVIDENCE_BUCKET",
      "NEXT_PUBLIC_PRODUCT_URL",
      "XPRIZE_REPOSITORY_URL",
      "XPRIZE_REPOSITORY_ACCESS_CONFIGURED",
      "XPRIZE_REPOSITORY_ACCESS_MODE",
      "XPRIZE_REPOSITORY_JUDGE_ACCESS_EMAILS",
      "XPRIZE_CATEGORY",
      "XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED",
      "XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED",
      "XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED",
      "XPRIZE_CATEGORY_IMPACT_EVIDENCE_CONFIGURED",
      "XPRIZE_AI_NATIVE_OPERATIONS_EVIDENCE_CONFIGURED",
      "XPRIZE_DEMO_VIDEO_URL",
      "XPRIZE_DEMO_VIDEO_UNDER_3_MIN_CONFIRMED",
      "XPRIZE_DEMO_VIDEO_PUBLICLY_ACCESSIBLE_CONFIRMED",
      "XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED",
      "XPRIZE_DEMO_VIDEO_CUSTOMER_DATA_REDACTED_CONFIRMED",
      "XPRIZE_DEMO_VIDEO_ENGLISH_OR_SUBTITLED_CONFIRMED",
      "XPRIZE_JUDGE_ACCESS_CONFIGURED",
      "XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED",
      "XPRIZE_JUDGING_PERIOD_END_AT",
      "XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED",
      "XPRIZE_ENTRANT_TYPE",
      "XPRIZE_GENERAL_ELIGIBILITY_CONFIRMED",
      "XPRIZE_REPRESENTATIVE_AUTHORIZED",
      "XPRIZE_ORGANIZATION_UNDER_25_CONFIRMED",
      "XPRIZE_CORPORATE_ID_CONFIGURED",
      "XPRIZE_NO_PROMOTION_ENTITY_CONFLICT_CONFIRMED",
      "XPRIZE_THIRD_PARTY_REVIEW_APPROVED",
      "XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED",
      "XPRIZE_EVIDENCE_RESPONSE_READY",
      "XPRIZE_TESTING_INSTRUCTIONS",
      "XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED",
      "XPRIZE_REVENUE_BY_MONTH_EVIDENCE_CONFIGURED",
      "XPRIZE_TOTAL_COSTS_EVIDENCE_CONFIGURED",
      "XPRIZE_CAC_SPEND_EVIDENCE_CONFIGURED",
      "XPRIZE_REAL_USER_EVIDENCE_CONFIGURED",
      "XPRIZE_TESTIMONIAL_CONSENT_CONFIRMED",
      "XPRIZE_RELATED_PARTY_REVENUE_REVIEWED",
      "XPRIZE_PRODUCT_RUNNING_EVIDENCE_CONFIGURED",
      "XPRIZE_AGENT_EXECUTION_LOGS_CONFIGURED",
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
      "GOOGLE_OAUTH_REQUESTED_SCOPES",
      "GOOGLE_OAUTH_DEFERRED_RESTRICTED_SCOPES",
      "GOOGLE_OAUTH_SCOPE_REVIEW_CONFIRMED",
      "GEMINI_MODEL",
      "SENTINEL_GEMINI_MODEL_ALLOWLIST",
      "SENTINEL_GEMINI_MONTHLY_BUDGET_USD",
      "SENTINEL_GEMINI_MAX_CONTENT_BYTES_PER_EVENT",
      "SENTINEL_GEMINI_API_KEY_ID",
      "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS",
      "SENTINEL_GEMINI_DAILY_REQUEST_QUOTA",
      "SENTINEL_GEMINI_DAILY_TOKEN_QUOTA",
      "SENTINEL_GEMINI_QUOTA_EVIDENCE_CONFIRMED",
      "GEMINI_INPUT_PER_1K_USD",
      "GEMINI_OUTPUT_PER_1K_USD",
      "SENSITIVE_DATA_PROTECTION_ENABLED"
    ].forEach(expectEnv);

    expectEnvValue("SENTINEL_MOCK_MODE", "false");
    expectEnvValue("SENTINEL_STORAGE_MODE", "gcp-rest");
    expectEnvValue("SENTINEL_EVIDENCE_MODE", "production");
    expectEnvValue("SENTINEL_CLOUD_COST_CONTROLS_MODE", "production");
    expectEnvValue("SENTINEL_CLOUD_RUN_SERVICE_NAME", "sme-workspace-sentinel");
    expectEnvValue("SENTINEL_CLOUD_RUN_REGION", "us-central1");
    expectEnvValue("SENTINEL_RELEASE_ID", "RELEASE_ID");
    expectEnvValue("SENTINEL_SOURCE_COMMIT", "SOURCE_COMMIT");
    expectEnvValue("SENTINEL_SOURCE_COMMIT_AT", "SOURCE_COMMIT_AT");
    expectEnvValue("SENTINEL_SOURCE_BRANCH", "origin/main");
    expectEnvValue("SENTINEL_PRIVATE_EVIDENCE_BUCKET", "gs://PROJECT_ID-sentinel-private-evidence");
    expectEnvValue("XPRIZE_REPOSITORY_URL", "https://github.com/sanjabh11/sme-compliance-sentinel");
    expectEnvValue("XPRIZE_REPOSITORY_ACCESS_CONFIGURED", "false");
    expectEnvValue("XPRIZE_REPOSITORY_ACCESS_MODE", "private-shared");
    expectEnvValue("XPRIZE_REPOSITORY_JUDGE_ACCESS_EMAILS", "testing@devpost.com,judging@hacker.fund");
    expectEnvValue("XPRIZE_CATEGORY", "Small Business Services");
    expectEnvValue("XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED", "false");
    expectEnvValue("XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED", "false");
    expectEnvValue("XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED", "false");
    expectEnvValue("XPRIZE_CATEGORY_IMPACT_EVIDENCE_CONFIGURED", "false");
    expectEnvValue("XPRIZE_AI_NATIVE_OPERATIONS_EVIDENCE_CONFIGURED", "false");
    expectEnvValue("XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED", "false");
    expectEnvValue("XPRIZE_REAL_USER_EVIDENCE_CONFIGURED", "false");
    expectEnvValue("XPRIZE_PRODUCT_RUNNING_EVIDENCE_CONFIGURED", "false");
    expectEnvValue("XPRIZE_AGENT_EXECUTION_LOGS_CONFIGURED", "false");
    expectEnvValue("XPRIZE_JUDGING_PERIOD_END_AT", "2026-09-15T17:00:00-07:00");
    expectEnvValue("XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED", "false");
    expectEnvValue("XPRIZE_EVIDENCE_RESPONSE_READY", "false");
    expectEnvValue("SENTINEL_WORKSPACE_WEBHOOK_AUTH_MODE", "oidc");
    expectEnvValue(
      "GOOGLE_OAUTH_REQUESTED_SCOPES",
      "https://www.googleapis.com/auth/drive.metadata.readonly,https://www.googleapis.com/auth/gmail.metadata"
    );
    expectEnvValue("GOOGLE_OAUTH_DEFERRED_RESTRICTED_SCOPES", "https://www.googleapis.com/auth/drive");
    expectEnvValue("GOOGLE_OAUTH_SCOPE_REVIEW_CONFIRMED", "false");
    expectEnvValue("GEMINI_INPUT_PER_1K_USD", "0.000075");
    expectEnvValue("GEMINI_OUTPUT_PER_1K_USD", "0.0003");
    expectEnvValue("SENSITIVE_DATA_PROTECTION_ENABLED", "true");
  });

  it("uses Secret Manager references for credentials and does not commit access-token envs", () => {
    expectSecretEnv("SENTINEL_ADMIN_ACTION_TOKEN", "sentinel-admin-action-token", "1");
    expectSecretEnv("GEMINI_API_KEY", "gemini-api-key", "1");
    expectSecretEnv("GOOGLE_OAUTH_CLIENT_SECRET", "google-oauth-client-secret", "1");
    expectSecretEnv("SENTINEL_EVIDENCE_SIGNING_SECRET", "sentinel-evidence-signing-secret", "1");
    expectSecretEnv("WORKSPACE_DRIVE_CHANNEL_TOKEN", "workspace-drive-channel-token", "1");
    [
      "sentinel-admin-action-token",
      "gemini-api-key",
      "google-oauth-client-secret",
      "sentinel-evidence-signing-secret",
      "workspace-drive-channel-token"
    ].forEach((secretName) => {
      expect(manifest).toContain(`${secretName}:projects/PROJECT_NUMBER/secrets/${secretName}`);
    });
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

  it("keeps independent deployment capability groups covered by the manifest and contract", () => {
    const contractEnvNames = new Set([
      ...contract.requiredNonSecretEnv,
      ...contract.requiredSecretEnv.map((entry) => entry.envName)
    ]);

    for (const group of requiredDeploymentCapabilityGroups) {
      expect(group.env.length, `${group.id} should protect more than one deployment switch`).toBeGreaterThan(1);
      for (const name of group.env) {
        expectEnv(name);
        expect(contractEnvNames.has(name), `${group.id} requires ${name} to stay in the Cloud Run contract`).toBe(true);
      }
    }
  });

  it("keeps the local env template aligned with every deployment contract key without committing credentials", () => {
    const envExampleValues = parseEnvExample(envExample);

    for (const name of contract.requiredNonSecretEnv) {
      expect(envExampleValues.has(name), `.env.example is missing non-secret ${name}`).toBe(true);
    }

    for (const secretRef of contract.requiredSecretEnv) {
      expect(envExampleValues.get(secretRef.envName), `.env.example should keep ${secretRef.envName} empty`).toBe("");
    }

    for (const name of contract.prohibitedCredentialEnv) {
      if (envExampleValues.has(name)) {
        expect(envExampleValues.get(name), `.env.example must keep local-only credential ${name} empty`).toBe("");
        expect(envExample, `${name} needs a local-only warning because Cloud Run must not use it`).toContain("Local REST smoke fallback only");
      }
    }
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

function parseEnvExample(source: string) {
  const entries = new Map<string, string>();

  for (const line of source.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)="(.*)"$/u);
    if (match) {
      entries.set(match[1], match[2]);
    }
  }

  return entries;
}
