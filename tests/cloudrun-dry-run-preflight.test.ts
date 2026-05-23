import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

interface CloudRunDryRunPreflightModule {
  parseArgs: (argv: string[]) => {
    valuesPath: string;
    outDir: string;
    releaseId: string;
    template: string;
    strict: boolean;
  };
  prepareCloudRunDryRunPacket: (options: {
    valuesPath: string;
    outDir?: string;
    releaseId?: string;
    template?: string;
    strict?: boolean;
  }) => Promise<{
    status: string;
    readyForDryRun: boolean;
    outputDirectory: string;
    releaseId: string;
    verifierPath: string;
    dryRunCommand: string;
    verification: {
      overallStatus: string;
      blockerCount: number;
      replacementCount: number;
      manualReviewCount: number;
    };
    redactionChecklist: string[];
    evidenceFilesToPreserve: string[];
    nextActions: string[];
  }>;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Cloud Run dry-run preflight packet", () => {
  it("parses safe args and rejects raw secret-shaped CLI args", async () => {
    const { parseArgs } = await loadPreflight();

    expect(
      parseArgs([
        "--values",
        "/secure/local/cloudrun-render-values.json",
        "--out-dir=/tmp/sentinel-deploy",
        "--release-id",
        "release-1",
        "--template=cloudrun.service.yaml",
        "--strict"
      ])
    ).toEqual({
      valuesPath: "/secure/local/cloudrun-render-values.json",
      outDir: "/tmp/sentinel-deploy",
      releaseId: "release-1",
      template: "cloudrun.service.yaml",
      strict: true
    });
    expect(() => parseArgs(["--values", "/tmp/values.json", "--admin-token=secret"])).toThrow(/Raw secret CLI args/u);
  });

  it("writes a ready private dry-run packet from reviewed non-secret values", async () => {
    const { prepareCloudRunDryRunPacket } = await loadPreflight();
    const tempDir = await makeTempDir();
    const valuesPath = await writeValues(tempDir, safeRenderValues());

    const packet = await prepareCloudRunDryRunPacket({
      valuesPath,
      outDir: tempDir,
      releaseId: "release-20260523-001",
      strict: true
    });
    const packetJson = JSON.parse(
      await readFile(join(packet.outputDirectory, "cloudrun-dry-run-preflight-packet.json"), "utf8")
    ) as { status: string };
    const packetMarkdown = await readFile(join(packet.outputDirectory, "cloudrun-dry-run-preflight-packet.md"), "utf8");

    expect(packet.status).toBe("ready-to-dry-run");
    expect(packet.readyForDryRun).toBe(true);
    expect(packet.verification).toMatchObject({
      overallStatus: "ready-to-dry-run",
      blockerCount: 0,
      replacementCount: 0
    });
    expect(packet.verification.manualReviewCount).toBeGreaterThan(0);
    expect(packet.dryRunCommand).toContain("--dry-run");
    expect(packet.redactionChecklist.join(" ")).toContain("filled render-values file");
    expect(packet.evidenceFilesToPreserve).toEqual(
      expect.arrayContaining([
        join(packet.outputDirectory, "cloudrun-dry-run-preflight-packet.json"),
        join(packet.outputDirectory, "cloudrun-dry-run-preflight-packet.md")
      ])
    );
    expect(packetJson.status).toBe("ready-to-dry-run");
    expect(packetMarkdown).toContain("Status: ready-to-dry-run");
    expect(JSON.stringify(packet)).not.toContain("AIza");
    expect(JSON.stringify(packet)).not.toContain("private-admin-token");
  });

  it("stops before dry-run when render values are still placeholders", async () => {
    const { prepareCloudRunDryRunPacket } = await loadPreflight();
    const tempDir = await makeTempDir();

    const packet = await prepareCloudRunDryRunPacket({
      valuesPath: "docs/deployment/cloudrun-render-values.template.json",
      outDir: tempDir
    });

    expect(packet.status).toBe("needs-values");
    expect(packet.readyForDryRun).toBe(false);
    expect(packet.verification.replacementCount).toBeGreaterThan(0);
    expect(packet.nextActions.join(" ")).toContain("Fill the remaining non-secret render values");
    expect(packet.evidenceFilesToPreserve).toEqual(
      expect.arrayContaining([join(packet.outputDirectory, "cloudrun-dry-run-preflight-packet.json")])
    );
  });
});

async function loadPreflight() {
  // @ts-expect-error The preflight helper is an executable ESM script without a TypeScript declaration file.
  return (await import("../scripts/prepare-cloudrun-dry-run-packet.mjs")) as CloudRunDryRunPreflightModule;
}

async function makeTempDir() {
  const path = await mkdtemp(join(tmpdir(), "sentinel-cloudrun-preflight-"));
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
    XPRIZE_CATEGORY: "Small Business Services",
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
