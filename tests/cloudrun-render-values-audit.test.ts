import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

interface CloudRunRenderValuesAuditModule {
  parseArgs: (argv: string[]) => {
    valuesPath: string;
    outDir: string;
    releaseId: string;
    strict: boolean;
  };
  writeCloudRunRenderValuesAudit: (options: {
    valuesPath: string;
    outDir?: string;
    releaseId?: string;
    strict?: boolean;
  }) => Promise<{
    status: string;
    readyForStrictRender: boolean;
    outputDirectory: string;
    auditPath: string;
    markdownPath: string;
    missingStrictKeys: string[];
    placeholderKeys: string[];
    valueConsistencyChecks: Array<{ id: string; key: string; status: string; fix: string }>;
    valueConsistencyBlockers: Array<{ id: string; key: string; status: string; fix: string }>;
    derivedValues: Array<{ key: string; status: string }>;
    manualReviewFlags: Array<{ key: string; status: string }>;
    secretVersionKeys: Array<{ envName: string; versionKey: string; status: string }>;
    releaseIdConsistency: {
      status: string;
      blocking: boolean;
      requestedReleaseId: string;
      valueReleaseId: string;
      normalizedRequestedReleaseId: string;
      normalizedValueReleaseId: string;
      fix: string;
    };
    redactionChecklist: string[];
    stopConditions: string[];
    nextActions: string[];
  }>;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Cloud Run render-values audit", () => {
  it("parses safe args and rejects raw secret-shaped CLI args", async () => {
    const { parseArgs } = await loadAudit();

    expect(
      parseArgs([
        "--values",
        "/secure/local/cloudrun-render-values.json",
        "--out-dir=/tmp/sentinel-render-audit",
        "--release-id",
        "release-1",
        "--strict"
      ])
    ).toEqual({
      valuesPath: "/secure/local/cloudrun-render-values.json",
      outDir: "/tmp/sentinel-render-audit",
      releaseId: "release-1",
      strict: true
    });
    expect(() => parseArgs(["--values", "/tmp/values.json", "--oauth-client-secret=secret"])).toThrow(/Raw secret CLI args/u);
  });

  it("writes a ready private audit packet without leaking secret values", async () => {
    const { writeCloudRunRenderValuesAudit } = await loadAudit();
    const tempDir = await makeTempDir();
    const valuesPath = await writeValues(tempDir, safeRenderValues());

    const packet = await writeCloudRunRenderValuesAudit({
      valuesPath,
      outDir: tempDir,
      releaseId: "release-20260523-001",
      strict: true
    });
    const packetJson = JSON.parse(await readFile(packet.auditPath, "utf8")) as { status: string };
    const markdown = await readFile(packet.markdownPath, "utf8");

    expect(packet.status).toBe("ready-to-render");
    expect(packet.readyForStrictRender).toBe(true);
    expect(packet.missingStrictKeys).toEqual([]);
    expect(packet.placeholderKeys).toEqual([]);
    expect(packet.valueConsistencyBlockers).toEqual([]);
    expect(packet.valueConsistencyChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "source-commit-shape", status: "passed" }),
        expect.objectContaining({ id: "hosted-product-url", status: "passed" }),
        expect.objectContaining({ id: "oauth-redirect-product-url", status: "passed" }),
        expect.objectContaining({ id: "budget-resource-billing-account", status: "passed" }),
        expect.objectContaining({ id: "gemini-ip-allowlist", status: "passed" })
      ])
    );
    expect(packet.releaseIdConsistency).toMatchObject({
      status: "matched",
      blocking: false,
      normalizedRequestedReleaseId: "release-20260523-001",
      normalizedValueReleaseId: "release-20260523-001"
    });
    expect(packet.derivedValues).toEqual(
      expect.arrayContaining([
        { key: "SENTINEL_CLOUD_RUN_IMAGE", status: "derived" },
        { key: "SENTINEL_CLOUD_RUN_SERVICE_ACCOUNT_EMAIL", status: "derived" },
        { key: "SENTINEL_GCP_BUDGET_SHORT_ID", status: "provided" },
        { key: "SENTINEL_GEMINI_API_KEY_SHORT_ID", status: "provided" }
      ])
    );
    expect(packet.secretVersionKeys.every((item) => item.status === "version-set")).toBe(true);
    expect(packet.manualReviewFlags.find((item) => item.key === "XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED")).toMatchObject({
      status: "not-attested"
    });
    expect(packet.redactionChecklist.join(" ")).toContain("filled render-values file");
    expect(packet.nextActions.join(" ")).toContain("render:cloudrun-manifest");
    expect(packetJson.status).toBe("ready-to-render");
    expect(markdown).toContain("Ready for strict render: yes");
    expect(markdown).toContain("Status: matched");
    expect(markdown).toContain("Value consistency blockers: 0");
    expect(JSON.stringify(packet)).not.toContain("AIza");
    expect(JSON.stringify(packet)).not.toContain("private-admin-token");
  });

  it("blocks mismatched CLI and values-file release ids before rendering", async () => {
    const { writeCloudRunRenderValuesAudit } = await loadAudit();
    const tempDir = await makeTempDir();
    const valuesPath = await writeValues(tempDir, safeRenderValues());

    const packet = await writeCloudRunRenderValuesAudit({
      valuesPath,
      outDir: tempDir,
      releaseId: "release-20260523-other"
    });

    expect(packet.status).toBe("release-id-mismatch");
    expect(packet.readyForStrictRender).toBe(false);
    expect(packet.releaseIdConsistency).toMatchObject({
      status: "mismatch",
      blocking: true,
      normalizedRequestedReleaseId: "release-20260523-other",
      normalizedValueReleaseId: "release-20260523-001"
    });
    expect(packet.stopConditions.join(" ")).toContain("SENTINEL_RELEASE_ID");
    expect(packet.nextActions.join(" ")).toContain("same non-placeholder release id");
    await expect(
      writeCloudRunRenderValuesAudit({
        valuesPath,
        outDir: tempDir,
        releaseId: "release-20260523-other",
        strict: true
      })
    ).rejects.toThrow(/release-id-mismatch/u);
  });

  it("reports missing placeholders before strict rendering", async () => {
    const { writeCloudRunRenderValuesAudit } = await loadAudit();
    const tempDir = await makeTempDir();

    const packet = await writeCloudRunRenderValuesAudit({
      valuesPath: "docs/deployment/cloudrun-render-values.template.json",
      outDir: tempDir
    });

    expect(packet.status).toBe("needs-values");
    expect(packet.readyForStrictRender).toBe(false);
    expect(packet.missingStrictKeys).toEqual(
      expect.arrayContaining([
        "GOOGLE_CLOUD_PROJECT",
        "SENTINEL_SOURCE_COMMIT",
        "NEXT_PUBLIC_PRODUCT_URL",
        "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS"
      ])
    );
    expect(packet.placeholderKeys).toEqual(expect.arrayContaining(["GOOGLE_CLOUD_PROJECT", "SENTINEL_RELEASE_ID"]));
    expect(packet.nextActions.join(" ")).toContain("Fill the missing non-secret values");
    expect(packet.auditPath).toContain("cloudrun-render-values-audit.json");
  });

  it("blocks stale production values before strict rendering", async () => {
    const { writeCloudRunRenderValuesAudit } = await loadAudit();
    const tempDir = await makeTempDir();
    const valuesPath = await writeValues(tempDir, {
      ...safeRenderValues(),
      SENTINEL_SOURCE_COMMIT: "short-sha",
      NEXT_PUBLIC_PRODUCT_URL: "http://127.0.0.1:3000",
      XPRIZE_DEMO_VIDEO_URL: "https://example.com/sentinel-demo",
      XPRIZE_SUBMISSION_CLOSE_AT: "2026-08-18T13:00:00-07:00",
      XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS: "3",
      XPRIZE_CATEGORY: "Professional Services Access",
      GOOGLE_OAUTH_REDIRECT_URI: "https://old.example.com/api/oauth/google/callback",
      WORKSPACE_GMAIL_TOPIC: "projects/old-project/topics/workspace-gmail-updates",
      SENTINEL_GCP_BUDGET_ID: "billingAccounts/old-billing/budgets/budget-123",
      SENTINEL_GEMINI_API_KEY_ID: "projects/999999999999/locations/global/keys/gemini-key-123",
      SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS: "0.0.0.0,*",
      GEMINI_API_KEY_VERSION: "latest"
    });

    const packet = await writeCloudRunRenderValuesAudit({
      valuesPath,
      outDir: tempDir,
      releaseId: "release-20260523-001"
    });

    expect(packet.status).toBe("value-consistency-blocked");
    expect(packet.readyForStrictRender).toBe(false);
    expect(packet.valueConsistencyBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "source-commit-shape", key: "SENTINEL_SOURCE_COMMIT" }),
        expect.objectContaining({ id: "hosted-product-url", key: "NEXT_PUBLIC_PRODUCT_URL" }),
        expect.objectContaining({ id: "demo-video-host", key: "XPRIZE_DEMO_VIDEO_URL" }),
        expect.objectContaining({ id: "submission-close", key: "XPRIZE_SUBMISSION_CLOSE_AT" }),
        expect.objectContaining({ id: "evidence-response-sla", key: "XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS" }),
        expect.objectContaining({ id: "category-fit", key: "XPRIZE_CATEGORY" }),
        expect.objectContaining({ id: "oauth-redirect-product-url", key: "GOOGLE_OAUTH_REDIRECT_URI" }),
        expect.objectContaining({ id: "gmail-topic-project", key: "WORKSPACE_GMAIL_TOPIC" }),
        expect.objectContaining({ id: "budget-resource-billing-account", key: "SENTINEL_GCP_BUDGET_ID" }),
        expect.objectContaining({ id: "gemini-api-key-project-number", key: "SENTINEL_GEMINI_API_KEY_ID" }),
        expect.objectContaining({ id: "gemini-ip-allowlist", key: "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS" }),
        expect.objectContaining({ id: "secret-version-gemini_api_key_version", key: "GEMINI_API_KEY_VERSION" })
      ])
    );
    expect(packet.stopConditions.join(" ")).toContain("stale, mismatched, or invalid");
    await expect(
      writeCloudRunRenderValuesAudit({
        valuesPath,
        outDir: tempDir,
        releaseId: "release-20260523-001",
        strict: true
      })
    ).rejects.toThrow(/value-consistency-blocked/u);
  });

  it("fails strict mode when render values are not ready", async () => {
    const { writeCloudRunRenderValuesAudit } = await loadAudit();
    const tempDir = await makeTempDir();

    await expect(
      writeCloudRunRenderValuesAudit({
        valuesPath: "docs/deployment/cloudrun-render-values.template.json",
        outDir: tempDir,
        strict: true
      })
    ).rejects.toThrow(/render-values audit is needs-values/u);
  });
});

async function loadAudit() {
  // @ts-expect-error The audit helper is an executable ESM script without a TypeScript declaration file.
  return (await import("../scripts/audit-cloudrun-render-values.mjs")) as CloudRunRenderValuesAuditModule;
}

async function makeTempDir() {
  const path = await mkdtemp(join(tmpdir(), "sentinel-cloudrun-values-audit-"));
  tempDirs.push(path);
  return path;
}

async function writeValues(tempDir: string, values: Record<string, string>, fileName = "render-values.json") {
  const path = join(tempDir, fileName);
  await writeFile(path, `${JSON.stringify(values, null, 2)}\n`, "utf8");
  return path;
}

function safeRenderValues() {
  return {
    GOOGLE_CLOUD_PROJECT: "sentinel-prod",
    GOOGLE_CLOUD_PROJECT_NUMBER: "123456789012",
    SENTINEL_CLOUD_RUN_REGION: "us-central1",
    SENTINEL_RELEASE_ID: "release-20260523-001",
    SENTINEL_SOURCE_COMMIT: "0123456789abcdef0123456789abcdef01234567",
    SENTINEL_SOURCE_COMMIT_AT: "2026-05-23T17:24:17.894Z",
    SENTINEL_SOURCE_BRANCH: "origin/main",
    NEXT_PUBLIC_PRODUCT_URL: "https://sme-workspace-sentinel-abc-uc.a.run.app",
    XPRIZE_DEMO_VIDEO_URL: "https://youtu.be/sentinel-demo",
    XPRIZE_REPOSITORY_URL: "https://github.com/sanjabh11/sme-compliance-sentinel",
    XPRIZE_REPOSITORY_ACCESS_MODE: "private-shared",
    XPRIZE_REPOSITORY_JUDGE_ACCESS_EMAILS: "testing@devpost.com,judging@hacker.fund",
    XPRIZE_SUBMISSION_CLOSE_AT: "2026-08-17T13:00:00-07:00",
    XPRIZE_CATEGORY: "Small Business Services",
    XPRIZE_JUDGING_PERIOD_END_AT: "2026-09-15T17:00:00-07:00",
    XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS: "2",
    GOOGLE_CLOUD_BILLING_ACCOUNT_ID: "000000-111111-222222",
    SENTINEL_GCP_BUDGET_SHORT_ID: "budget-123",
    GOOGLE_OAUTH_CLIENT_ID: "123456789012-abcdef.apps.googleusercontent.com",
    GOOGLE_OAUTH_REQUESTED_SCOPES: "https://www.googleapis.com/auth/drive.metadata.readonly,https://www.googleapis.com/auth/gmail.metadata",
    GOOGLE_OAUTH_DEFERRED_RESTRICTED_SCOPES: "https://www.googleapis.com/auth/drive",
    GOOGLE_OAUTH_SCOPE_REVIEW_CONFIRMED: "false",
    SENTINEL_GEMINI_API_KEY_SHORT_ID: "gemini-key-123",
    SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS: "34.10.10.10",
    XPRIZE_ENTRANT_TYPE: "team",
    SENTINEL_ADMIN_ACTION_TOKEN_VERSION: "2",
    GEMINI_API_KEY_VERSION: "2",
    GOOGLE_OAUTH_CLIENT_SECRET_VERSION: "2",
    SENTINEL_EVIDENCE_SIGNING_SECRET_VERSION: "2",
    WORKSPACE_DRIVE_CHANNEL_TOKEN_VERSION: "2"
  };
}
