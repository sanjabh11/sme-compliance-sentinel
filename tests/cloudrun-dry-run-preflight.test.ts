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
    verifyPacketPath: string;
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
    bucket: string;
    phaseProgress: {
      phaseId: string;
      ratingOutOf5: number;
      currentSliceRemainingPercent: number;
      nextPhaseId: string;
      nextPhaseBucket: string;
      basis: string;
    };
    operatorHandoff: {
      status: string;
      nextPhaseId: string;
      nextPhaseBucket: string;
      readyForPrivateGcloudDryRun: boolean;
      privateArtifactPaths: string[];
      commandSequence: Array<{
        id: string;
        owner: string;
        command: string;
        mutatesCloudRun: boolean;
        expectedPrivateArtifact: string;
        stopCondition: string;
      }>;
      stopConditions: string[];
      proofBoundary: string;
    };
    redactionChecklist: string[];
    evidenceFilesToPreserve: string[];
    evidenceFileDigests: Array<{
      role: string;
      path: string;
      sha256: string;
      byteLength: number;
    }>;
    nextActions: string[];
  }>;
  verifyCloudRunDryRunPacket: (packetPath: string) => Promise<{
    status: string;
    readyForDryRun: boolean;
    packetPath: string;
    packetVerifierPath: string;
    releaseId: string;
    packetStatus: string;
    digestCount: number;
    matchedDigestCount: number;
    failedDigestCount: number;
    digestChecks: Array<{
      role: string;
      path: string;
      status: string;
      expectedSha256: string;
      actualSha256: string;
      expectedByteLength: number;
      actualByteLength: number;
      fix: string;
    }>;
    stopConditions: string[];
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
      verifyPacketPath: "",
      strict: true
    });
    expect(parseArgs(["--verify-packet", "/secure/local/preflight.json", "--strict"])).toMatchObject({
      verifyPacketPath: "/secure/local/preflight.json",
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
    ) as { status: string; evidenceFileDigests: Array<{ role: string; sha256: string; byteLength: number }> };
    const packetMarkdown = await readFile(join(packet.outputDirectory, "cloudrun-dry-run-preflight-packet.md"), "utf8");

    expect(packet.status).toBe("ready-to-dry-run");
    expect(packet.readyForDryRun).toBe(true);
    expect(packet.bucket).toBe("code-controllable");
    expect(packet.verification).toMatchObject({
      overallStatus: "ready-to-dry-run",
      blockerCount: 0,
      replacementCount: 0
    });
    expect(packet.phaseProgress).toMatchObject({
      phaseId: "cloudrun-render-dry-run",
      ratingOutOf5: 4,
      currentSliceRemainingPercent: 0,
      nextPhaseId: "hosted-proof-capture",
      nextPhaseBucket: "external-proof"
    });
    expect(packet.phaseProgress.basis).toContain("local manifest render");
    expect(packet.operatorHandoff).toMatchObject({
      status: "ready-for-private-gcloud-dry-run",
      nextPhaseId: "hosted-proof-capture",
      nextPhaseBucket: "external-proof",
      readyForPrivateGcloudDryRun: true
    });
    expect(packet.operatorHandoff.commandSequence.map((command) => command.id)).toEqual([
      "cloudrun-dry-run",
      "cloudrun-deploy",
      "cloudrun-describe",
      "collect-cloudrun-deployment"
    ]);
    expect(packet.operatorHandoff.commandSequence.find((command) => command.id === "cloudrun-deploy")).toMatchObject({
      mutatesCloudRun: true,
      expectedPrivateArtifact: expect.stringContaining("cloudrun-deploy.log")
    });
    expect(packet.operatorHandoff.privateArtifactPaths).toEqual(
      expect.arrayContaining([
        expect.stringContaining("cloudrun-dry-run.log"),
        expect.stringContaining("cloudrun-deployment-transcript-packet.json")
      ])
    );
    expect(packet.operatorHandoff.proofBoundary).toContain("does not run gcloud");
    expect(packet.verification.manualReviewCount).toBeGreaterThan(0);
    expect(packet.dryRunCommand).toContain("--dry-run");
    expect(packet.redactionChecklist.join(" ")).toContain("filled render-values file");
    expect(packet.evidenceFilesToPreserve).toEqual(
      expect.arrayContaining([
        join(packet.outputDirectory, "cloudrun-dry-run-preflight-packet.json"),
        join(packet.outputDirectory, "cloudrun-dry-run-preflight-packet.md"),
        join(packet.outputDirectory, "cloudrun-dry-run-packet-verifier.json")
      ])
    );
    expect(packet.evidenceFileDigests.map((item) => item.role)).toEqual([
      "rendered-manifest",
      "manifest-verifier",
      "render-summary",
      "dry-run-command",
      "deploy-command"
    ]);
    expect(packet.evidenceFileDigests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "rendered-manifest",
          path: expect.stringContaining("cloudrun.service.rendered.yaml"),
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          byteLength: expect.any(Number)
        }),
        expect.objectContaining({
          role: "manifest-verifier",
          path: expect.stringContaining("cloudrun-manifest-verifier.json"),
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/u)
        })
      ])
    );
    expect(packet.evidenceFileDigests.every((item) => item.byteLength > 0)).toBe(true);
    expect(packetJson.status).toBe("ready-to-dry-run");
    expect(packetJson.evidenceFileDigests[0].sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(packetMarkdown).toContain("Status: ready-to-dry-run");
    expect(packetMarkdown).toContain("## Phase Progress");
    expect(packetMarkdown).toContain("Rating: 4/5");
    expect(packetMarkdown).toContain("## Operator Handoff");
    expect(packetMarkdown).toContain("collect-cloudrun-deployment");
    expect(packetMarkdown).toContain("## Evidence File Digests");
    expect(JSON.stringify(packet)).not.toContain("AIza");
    expect(JSON.stringify(packet)).not.toContain("private-admin-token");
  });

  it("verifies preflight packet digests and blocks if rendered artifacts drift before dry-run", async () => {
    const { prepareCloudRunDryRunPacket, verifyCloudRunDryRunPacket } = await loadPreflight();
    const tempDir = await makeTempDir();
    const valuesPath = await writeValues(tempDir, safeRenderValues());

    const packet = await prepareCloudRunDryRunPacket({
      valuesPath,
      outDir: tempDir,
      releaseId: "release-20260523-001",
      strict: true
    });
    const packetPath = join(packet.outputDirectory, "cloudrun-dry-run-preflight-packet.json");
    const verified = await verifyCloudRunDryRunPacket(packetPath);
    const verifierPath = join(packet.outputDirectory, "cloudrun-dry-run-packet-verifier.json");
    const verifierJson = JSON.parse(await readFile(verifierPath, "utf8")) as {
      status: string;
      packetPath: string;
      packetVerifierPath: string;
      digestCount: number;
    };

    expect(verified).toMatchObject({
      status: "verified",
      readyForDryRun: true,
      packetPath,
      packetVerifierPath: verifierPath,
      releaseId: "release-20260523-001",
      packetStatus: "ready-to-dry-run",
      digestCount: 5,
      matchedDigestCount: 5,
      failedDigestCount: 0
    });
    expect(verified.digestChecks.every((check) => check.status === "matched")).toBe(true);
    expect(verified.nextActions.join(" ")).toContain("Run the generated dry-run command");
    expect(verified.nextActions.join(" ")).toContain("cloudrun-dry-run-packet-verifier.json");
    expect(verifierJson).toMatchObject({
      status: "verified",
      packetPath,
      packetVerifierPath: verifierPath,
      digestCount: 5
    });

    const manifestDigest = packet.evidenceFileDigests.find((item) => item.role === "rendered-manifest");
    if (!manifestDigest) {
      throw new Error("Test setup expected rendered-manifest digest.");
    }
    await writeFile(manifestDigest.path, `${await readFile(manifestDigest.path, "utf8")}\n# drift after preflight\n`, "utf8");
    const drifted = await verifyCloudRunDryRunPacket(packetPath);
    const driftedVerifierJson = JSON.parse(await readFile(verifierPath, "utf8")) as { status: string; failedDigestCount: number };

    expect(drifted).toMatchObject({
      status: "blocked",
      readyForDryRun: false,
      failedDigestCount: 1
    });
    expect(drifted.digestChecks.find((check) => check.role === "rendered-manifest")).toMatchObject({
      status: "mismatch",
      expectedSha256: manifestDigest.sha256
    });
    expect(drifted.stopConditions.join(" ")).toContain("Do not run Cloud Run dry-run");
    expect(driftedVerifierJson).toMatchObject({
      status: "blocked",
      failedDigestCount: 1
    });
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
    expect(packet.phaseProgress).toMatchObject({
      phaseId: "cloudrun-render-dry-run",
      ratingOutOf5: 2,
      nextPhaseId: "hosted-proof-capture",
      nextPhaseBucket: "external-proof"
    });
    expect(packet.phaseProgress.currentSliceRemainingPercent).toBeGreaterThan(45);
    expect(packet.operatorHandoff).toMatchObject({
      status: "blocked-before-gcloud",
      readyForPrivateGcloudDryRun: false
    });
    expect(packet.operatorHandoff.stopConditions.join(" ")).toContain("Do not run gcloud dry-run");
    expect(packet.verification.replacementCount).toBeGreaterThan(0);
    expect(packet.nextActions.join(" ")).toContain("Fill the remaining non-secret render values");
    expect(packet.evidenceFilesToPreserve).toEqual(
      expect.arrayContaining([join(packet.outputDirectory, "cloudrun-dry-run-preflight-packet.json")])
    );
    expect(packet.evidenceFileDigests.map((item) => item.role)).toEqual(
      expect.arrayContaining(["rendered-manifest", "manifest-verifier", "render-summary"])
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
