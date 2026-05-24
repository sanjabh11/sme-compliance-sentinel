import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

interface CloudRunRenderModule {
  parseArgs: (argv: string[]) => {
    template: string;
    valuesPath: string;
    outDir: string;
    releaseId: string;
    strict: boolean;
    writeValuesTemplatePath: string;
    writeReleaseValuesPath: string;
  };
  buildReleaseCandidateValues: (options?: {
    gitRunner?: (args: string[]) => string;
  }) => Record<string, string>;
  writeRenderValuesTemplate: (outputPath?: string) => Promise<{
    path: string;
    keyCount: number;
    privateHandling: string;
  }>;
  writeReleaseCandidateValues: (
    outputPath: string,
    options?: {
      gitRunner?: (args: string[]) => string;
    }
  ) => Promise<{
    path: string;
    keyCount: number;
    releaseId: string;
    sourceCommit: string;
    sourceCommitAt: string;
    sourceBranch: string;
    repositoryUrl: string;
    privateHandling: string;
    nextActions: string[];
  }>;
  renderCloudRunManifest: (options: {
    template?: string;
    valuesPath?: string;
    outDir?: string;
    releaseId?: string;
    strict?: boolean;
  }) => Promise<{
    status: string;
    outputDirectory: string;
    renderedManifestPath: string;
    dryRunCommand: string;
    deployCommand: string;
    verification: {
      overallStatus: string;
      replacementCount: number;
      blockerCount: number;
      secretRefCount: number;
    };
  }>;
}

const tempDirs: string[] = [];

describe("Cloud Run manifest renderer", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("parses safe render args while rejecting raw secret flags", async () => {
    const { parseArgs } = await loadRenderer();

    const args = parseArgs([
      "--template",
      "cloudrun.service.yaml",
      "--values=/secure/local/render-values.json",
      "--out-dir",
      "/tmp/sentinel-render",
      "--release-id",
      "release-1",
      "--write-values-template",
      "/tmp/sentinel-render-values.json",
      "--write-release-values",
      "/tmp/sentinel-release-values.json",
      "--strict"
    ]);

    expect(args).toMatchObject({
      template: "cloudrun.service.yaml",
      valuesPath: "/secure/local/render-values.json",
      outDir: "/tmp/sentinel-render",
      releaseId: "release-1",
      writeValuesTemplatePath: "/tmp/sentinel-render-values.json",
      writeReleaseValuesPath: "/tmp/sentinel-release-values.json",
      strict: true
    });
    expect(() => parseArgs(["--gemini-api-key", "secret"])).toThrow(/Raw secret CLI args/u);
    expect(() => parseArgs(["--token=secret"])).toThrow(/Raw secret CLI args/u);
  });

  it("writes a private release-candidate values starter from Git metadata only", async () => {
    const { buildReleaseCandidateValues, writeReleaseCandidateValues } = await loadRenderer();
    const tempDir = await makeTempDir();
    const valuesPath = join(tempDir, "cloudrun-release-values.json");
    const gitRunner = makeFakeGitRunner();

    const values = buildReleaseCandidateValues({ gitRunner });
    const summary = await writeReleaseCandidateValues(valuesPath, { gitRunner });
    const writtenValues = JSON.parse(await readFile(valuesPath, "utf8")) as Record<string, string>;

    expect(values).toMatchObject({
      SENTINEL_RELEASE_ID: "release-20260524-0123456",
      SENTINEL_SOURCE_COMMIT: "0123456789abcdef0123456789abcdef01234567",
      SENTINEL_SOURCE_COMMIT_AT: "2026-05-24T10:48:19+05:30",
      SENTINEL_SOURCE_BRANCH: "origin/main",
      XPRIZE_REPOSITORY_URL: "https://github.com/sanjabh11/sme-compliance-sentinel"
    });
    expect(values.GOOGLE_CLOUD_PROJECT).toBe("PROJECT_ID");
    expect(values.NEXT_PUBLIC_PRODUCT_URL).toBe("https://YOUR-SERVICE-URL");
    expect(values.XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED).toBe("false");
    expect(writtenValues).toEqual(values);
    expect(summary).toMatchObject({
      path: valuesPath,
      releaseId: "release-20260524-0123456",
      sourceCommit: "0123456789abcdef0123456789abcdef01234567",
      repositoryUrl: "https://github.com/sanjabh11/sme-compliance-sentinel"
    });
    expect(summary.privateHandling).toContain("non-secret private starter");
    expect(summary.nextActions.join(" ")).toContain("audit:cloudrun-values");
    expect(JSON.stringify(writtenValues)).not.toContain("AIza");
    expect(JSON.stringify(writtenValues)).not.toContain("GOCSPX");
    expect(JSON.stringify(summary)).not.toContain("private-admin-token");

    await expect(writeReleaseCandidateValues("", { gitRunner })).rejects.toThrow(/requires a private output path/u);
  });

  it("writes a non-secret render values template and rejects placeholders in strict mode", async () => {
    const { renderCloudRunManifest, writeRenderValuesTemplate } = await loadRenderer();
    const tempDir = await makeTempDir();
    const valuesPath = join(tempDir, "cloudrun-render-values.template.json");

    const summary = await writeRenderValuesTemplate(valuesPath);
    const templateValues = JSON.parse(await readFile(valuesPath, "utf8")) as Record<string, string>;

    expect(summary.path).toBe(valuesPath);
    expect(summary.keyCount).toBeGreaterThan(15);
    expect(summary.privateHandling).toContain("non-secret template");
    expect(templateValues).toMatchObject({
      SENTINEL_SOURCE_COMMIT: "SOURCE_COMMIT",
      SENTINEL_SOURCE_COMMIT_AT: "SOURCE_COMMIT_AT",
      XPRIZE_CATEGORY: "Small Business Services",
      XPRIZE_REPOSITORY_ACCESS_CONFIGURED: "false",
      XPRIZE_REPOSITORY_ACCESS_MODE: "private-shared",
      XPRIZE_REPOSITORY_JUDGE_ACCESS_EMAILS: "testing@devpost.com,judging@hacker.fund",
      XPRIZE_SOURCE_CODE_COMPLETE_CONFIRMED: "false",
      XPRIZE_SUBMISSION_CLOSE_AT: "2026-08-17T13:00:00-07:00",
      XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED: "false",
      XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED: "false",
      XPRIZE_DEMO_VIDEO_UNDER_3_MIN_CONFIRMED: "false",
      XPRIZE_WORKING_PROJECT_ACCESS_CONFIGURED: "false",
      XPRIZE_TESTING_INSTRUCTIONS_CONFIGURED: "false",
      XPRIZE_JUDGE_ACCESS_CONFIGURED: "false",
      XPRIZE_JUDGING_PERIOD_END_AT: "2026-09-15T17:00:00-07:00",
      SENTINEL_CLOUD_RUN_VPC_CONNECTOR: "sentinel-egress",
      SENTINEL_CLOUD_RUN_VPC_EGRESS: "all-traffic",
      XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED: "false",
      XPRIZE_AGENT_EXECUTION_LOGS_CONFIGURED: "false",
      XPRIZE_THIRD_PARTY_REVIEW_APPROVED: "false",
      XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS: "2",
      XPRIZE_EVIDENCE_RESPONSE_PRIVATE_CONTACT_CONFIGURED: "false",
      SENTINEL_GEMINI_QUOTA_EVIDENCE_CONFIRMED: "false",
      WORKSPACE_DRIVE_WEBHOOK_URL: "https://YOUR-SERVICE-URL/api/webhooks/pubsub/drive",
      GOOGLE_OAUTH_REQUESTED_SCOPES: "https://www.googleapis.com/auth/drive.metadata.readonly,https://www.googleapis.com/auth/gmail.metadata",
      GOOGLE_OAUTH_DEFERRED_RESTRICTED_SCOPES: "https://www.googleapis.com/auth/drive",
      GOOGLE_OAUTH_SCOPE_REVIEW_CONFIRMED: "false",
      SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS: "STATIC_EGRESS_IPS"
    });
    expect(Object.keys(templateValues)).not.toEqual(
      expect.arrayContaining(["GEMINI_API_KEY", "GOOGLE_OAUTH_CLIENT_SECRET", "SENTINEL_ADMIN_ACTION_TOKEN"])
    );
    await expect(renderCloudRunManifest({ valuesPath, outDir: tempDir, strict: true })).rejects.toThrow(
      /Strict Cloud Run render values missing or placeholder: .*SENTINEL_SOURCE_COMMIT/u
    );
  });

  it("renders a private production candidate manifest and verifier bundle from non-secret values", async () => {
    const { renderCloudRunManifest } = await loadRenderer();
    const tempDir = await makeTempDir();
    const valuesPath = await writeValues(tempDir, safeRenderValues());

    const summary = await renderCloudRunManifest({
      valuesPath,
      outDir: tempDir,
      releaseId: "release-20260523-001",
      strict: true
    });
    const renderedManifest = await readFile(summary.renderedManifestPath, "utf8");
    const verifierJson = await readFile(join(summary.outputDirectory, "cloudrun-manifest-verifier.json"), "utf8");
    const dryRunCommand = await readFile(join(summary.outputDirectory, "cloudrun-dry-run-command.txt"), "utf8");
    const summaryJson = await readFile(join(summary.outputDirectory, "cloudrun-render-summary.json"), "utf8");

    expect(summary.status).toBe("ready-to-dry-run");
    expect(summary.verification).toMatchObject({
      overallStatus: "ready-to-dry-run",
      replacementCount: 0,
      blockerCount: 0,
      secretRefCount: 5
    });
    expect(renderedManifest).toContain("us-central1-docker.pkg.dev/sentinel-prod/sentinel/web:release-20260523-001");
    expect(renderedManifest).toContain("sentinel-runtime@sentinel-prod.iam.gserviceaccount.com");
    expect(renderedManifest).toContain("run.googleapis.com/vpc-access-connector: sentinel-egress");
    expect(renderedManifest).toContain("run.googleapis.com/vpc-access-egress: all-traffic");
    expect(renderedManifest).toContain("sentinel-admin-action-token:projects/123456789012/secrets/sentinel-admin-action-token");
    expect(renderedManifest).toContain('value: "0123456789abcdef0123456789abcdef01234567"');
    expect(renderedManifest).toContain('value: "2026-05-23T17:24:17.894Z"');
    expect(renderedManifest).toContain('value: "https://sme-workspace-sentinel-abc-uc.a.run.app"');
    expect(renderedManifest).toContain('name: XPRIZE_REPOSITORY_ACCESS_CONFIGURED\n              value: "false"');
    expect(renderedManifest).toContain('name: XPRIZE_REPOSITORY_ACCESS_MODE\n              value: "private-shared"');
    expect(renderedManifest).toContain(
      'name: XPRIZE_REPOSITORY_JUDGE_ACCESS_EMAILS\n              value: "testing@devpost.com,judging@hacker.fund"'
    );
    expect(renderedManifest).toContain('name: XPRIZE_SOURCE_CODE_COMPLETE_CONFIRMED\n              value: "false"');
    expect(renderedManifest).toContain('name: XPRIZE_SUBMISSION_CLOSE_AT\n              value: "2026-08-17T13:00:00-07:00"');
    expect(renderedManifest).toContain('name: XPRIZE_JUDGING_PERIOD_END_AT\n              value: "2026-09-15T17:00:00-07:00"');
    expect(renderedManifest).toContain('name: XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS\n              value: "2"');
    expect(renderedManifest).toContain('name: XPRIZE_EVIDENCE_RESPONSE_PRIVATE_CONTACT_CONFIGURED\n              value: "false"');
    expect(renderedManifest).toContain('name: XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED\n              value: "false"');
    expect(renderedManifest).toContain('name: XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED\n              value: "false"');
    expect(renderedManifest).toContain(
      'name: WORKSPACE_DRIVE_WEBHOOK_URL\n              value: "https://sme-workspace-sentinel-abc-uc.a.run.app/api/webhooks/pubsub/drive"'
    );
    expect(renderedManifest).toContain(
      'name: GOOGLE_OAUTH_REQUESTED_SCOPES\n              value: "https://www.googleapis.com/auth/drive.metadata.readonly,https://www.googleapis.com/auth/gmail.metadata"'
    );
    expect(renderedManifest).toContain('name: GOOGLE_OAUTH_SCOPE_REVIEW_CONFIRMED\n              value: "false"');
    expect(renderedManifest).toContain('key: "2"');
    expect(renderedManifest).toContain("secretKeyRef:");
    expect(renderedManifest).not.toContain("PROJECT_ID");
    expect(renderedManifest).not.toContain('value: "PROJECT_NUMBER"');
    expect(renderedManifest).not.toContain("projects/PROJECT_NUMBER/secrets/");
    expect(renderedManifest).not.toContain("YOUR-SERVICE-URL");
    expect(renderedManifest).not.toContain('value: "RELEASE_ID"');
    expect(`${renderedManifest}${verifierJson}${dryRunCommand}${summaryJson}`).not.toContain("private-admin-token");
    expect(dryRunCommand).toContain("--dry-run");
    expect(dryRunCommand).toContain("cloudrun.service.rendered.yaml");
    expect(JSON.parse(verifierJson)).toMatchObject({ overallStatus: "ready-to-dry-run" });
  });

  it("rejects raw secrets or unsupported secret-bearing keys in render values", async () => {
    const { renderCloudRunManifest } = await loadRenderer();
    const tempDir = await makeTempDir();
    const rawSecretValues = await writeValues(tempDir, {
      ...safeRenderValues(),
      GEMINI_API_KEY: "redacted-value"
    });
    const unsafeTextValues = await writeValues(tempDir, {
      ...safeRenderValues(),
      XPRIZE_TESTING_INSTRUCTIONS: "password=do-not-commit"
    }, "unsafe-text.json");

    await expect(renderCloudRunManifest({ valuesPath: rawSecretValues, outDir: tempDir })).rejects.toThrow(
      /must not include raw secret key GEMINI_API_KEY/u
    );
    await expect(renderCloudRunManifest({ valuesPath: unsafeTextValues, outDir: tempDir })).rejects.toThrow(
      /appears to contain a raw secret/u
    );
  });

  it("rejects a CLI release id that disagrees with the values file", async () => {
    const { renderCloudRunManifest } = await loadRenderer();
    const tempDir = await makeTempDir();
    const valuesPath = await writeValues(tempDir, safeRenderValues());

    await expect(
      renderCloudRunManifest({
        valuesPath,
        outDir: tempDir,
        releaseId: "release-20260523-other",
        strict: true
      })
    ).rejects.toThrow(/does not match SENTINEL_RELEASE_ID/u);
  });

  it("fails strict mode when required production values are still missing", async () => {
    const { renderCloudRunManifest } = await loadRenderer();
    const tempDir = await makeTempDir();

    await expect(renderCloudRunManifest({ outDir: tempDir, releaseId: "missing-values", strict: true })).rejects.toThrow(
      /Strict Cloud Run render values missing/u
    );
  });
});

async function loadRenderer() {
  // @ts-expect-error The renderer is an executable ESM script without a TypeScript declaration file.
  return (await import("../scripts/render-cloudrun-manifest.mjs")) as CloudRunRenderModule;
}

async function makeTempDir() {
  const path = await mkdtemp(join(tmpdir(), "sentinel-cloudrun-render-"));
  tempDirs.push(path);
  return path;
}

async function writeValues(tempDir: string, values: Record<string, string>, fileName = "render-values.json") {
  const path = join(tempDir, fileName);
  await writeFile(path, `${JSON.stringify(values, null, 2)}\n`, "utf8");
  return path;
}

function makeFakeGitRunner() {
  return (args: string[]) => {
    const command = args.join(" ");
    const responses: Record<string, string> = {
      "rev-parse HEAD": "0123456789abcdef0123456789abcdef01234567",
      "log -1 --format=%cI": "2026-05-24T10:48:19+05:30",
      "rev-parse --abbrev-ref --symbolic-full-name @{u}": "origin/main",
      "rev-parse --abbrev-ref HEAD": "main",
      "remote get-url origin": "https://github.com/sanjabh11/sme-compliance-sentinel.git"
    };

    if (responses[command]) {
      return responses[command];
    }

    throw new Error(`Unexpected git command ${command}`);
  };
}

function safeRenderValues() {
  return {
    GOOGLE_CLOUD_PROJECT: "sentinel-prod",
    GOOGLE_CLOUD_PROJECT_NUMBER: "123456789012",
    SENTINEL_CLOUD_RUN_REGION: "us-central1",
    SENTINEL_CLOUD_RUN_VPC_CONNECTOR: "sentinel-egress",
    SENTINEL_CLOUD_RUN_VPC_EGRESS: "all-traffic",
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
