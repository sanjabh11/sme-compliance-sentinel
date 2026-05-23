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
  };
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
      "--strict"
    ]);

    expect(args).toMatchObject({
      template: "cloudrun.service.yaml",
      valuesPath: "/secure/local/render-values.json",
      outDir: "/tmp/sentinel-render",
      releaseId: "release-1",
      strict: true
    });
    expect(() => parseArgs(["--gemini-api-key", "secret"])).toThrow(/Raw secret CLI args/u);
    expect(() => parseArgs(["--token=secret"])).toThrow(/Raw secret CLI args/u);
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
    expect(renderedManifest).toContain("sentinel-admin-action-token:projects/123456789012/secrets/sentinel-admin-action-token");
    expect(renderedManifest).toContain('value: "https://sme-workspace-sentinel-abc-uc.a.run.app"');
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

  it("fails strict mode when required production values are still missing", async () => {
    const { renderCloudRunManifest } = await loadRenderer();
    const tempDir = await makeTempDir();

    await expect(renderCloudRunManifest({ outDir: tempDir, releaseId: "missing-values", strict: true })).rejects.toThrow(
      /Rendered manifest is template-needs-values/u
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

function safeRenderValues() {
  return {
    GOOGLE_CLOUD_PROJECT: "sentinel-prod",
    GOOGLE_CLOUD_PROJECT_NUMBER: "123456789012",
    SENTINEL_CLOUD_RUN_REGION: "us-central1",
    SENTINEL_RELEASE_ID: "release-20260523-001",
    NEXT_PUBLIC_PRODUCT_URL: "https://sme-workspace-sentinel-abc-uc.a.run.app",
    XPRIZE_DEMO_VIDEO_URL: "https://youtu.be/sentinel-demo",
    XPRIZE_REPOSITORY_URL: "https://github.com/sanjabh11/sme-compliance-sentinel",
    GOOGLE_CLOUD_BILLING_ACCOUNT_ID: "000000-111111-222222",
    SENTINEL_GCP_BUDGET_SHORT_ID: "budget-123",
    GOOGLE_OAUTH_CLIENT_ID: "123456789012-abcdef.apps.googleusercontent.com",
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
