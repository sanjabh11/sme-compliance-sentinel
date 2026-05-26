import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

interface CloudRunOperatorEnvironmentModule {
  parseArgs: (argv: string[]) => {
    packetPath: string;
    privateRoot: string;
    gcloudBin: string;
    outFile: string;
    strict: boolean;
  };
  verifyCloudRunOperatorEnvironment: (options: {
    packetPath: string;
    privateRoot?: string;
    gcloudBin?: string;
    outFile?: string;
    strict?: boolean;
  }) => Promise<{
    status: string;
    readyForPrivateGcloudDryRun: boolean;
    releaseId: string;
    packetPrivateRoot: string;
    operatorPrivateRoot: string;
    operatorPrivateBasePath: string;
    gcloud: {
      status: string;
      path: string;
      note: string;
    };
    checks: Array<{
      id: string;
      status: string;
      evidence: string;
      fix: string;
    }>;
    blockers: Array<{
      id: string;
      status: string;
      evidence: string;
      fix: string;
    }>;
    stopConditions: string[];
    manualCommands: Array<{
      id: string;
      status: string;
      command: string;
      mutatesCloudRun: boolean;
    }>;
    proofBoundary: string;
    nextActions: string[];
  }>;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Cloud Run operator environment preflight", () => {
  it("parses safe args and rejects raw secret-shaped CLI args", async () => {
    const { parseArgs } = await loadOperatorEnv();

    expect(
      parseArgs([
        "--packet",
        "artifacts/deployment/release-1/cloudrun-dry-run-preflight-packet.json",
        "--private-root=/private/tmp/sentinel-secure/local",
        "--gcloud-bin",
        "/tmp/google-cloud-sdk/bin/gcloud",
        "--out",
        "/tmp/cloudrun-operator-environment.json",
        "--strict"
      ])
    ).toEqual({
      packetPath: "artifacts/deployment/release-1/cloudrun-dry-run-preflight-packet.json",
      privateRoot: "/private/tmp/sentinel-secure/local",
      gcloudBin: "/tmp/google-cloud-sdk/bin/gcloud",
      outFile: "/tmp/cloudrun-operator-environment.json",
      strict: true
    });
    expect(() => parseArgs(["--packet", "/tmp/packet.json", "--oauth-client-secret=raw"])).toThrow(/Raw secret CLI args/u);
  });

  it("passes only when packet, verifier, private root, and gcloud are ready", async () => {
    const { verifyCloudRunOperatorEnvironment } = await loadOperatorEnv();
    const tempDir = await makeTempDir();
    const privateRoot = join(tempDir, "private-root");
    const fakeGcloud = await writeFakeGcloud(tempDir);
    const packetPath = await writePacketBundle(tempDir, { privateRoot });

    const report = await verifyCloudRunOperatorEnvironment({
      packetPath,
      gcloudBin: fakeGcloud,
      strict: true
    });
    const reportJson = JSON.parse(await readFile(join(tempDir, "cloudrun-operator-environment.json"), "utf8")) as { status: string };
    const reportMarkdown = await readFile(join(tempDir, "cloudrun-operator-environment.md"), "utf8");

    expect(report.status).toBe("ready-for-private-gcloud-dry-run");
    expect(report.readyForPrivateGcloudDryRun).toBe(true);
    expect(report.packetPrivateRoot).toBe(privateRoot);
    expect(report.operatorPrivateRoot).toBe(privateRoot);
    expect(report.operatorPrivateBasePath).toBe(join(privateRoot, "cloudrun", "release-operator-1"));
    expect(report.gcloud).toMatchObject({
      status: "available",
      path: fakeGcloud
    });
    expect(report.gcloud.note).toContain("does not run gcloud");
    expect(report.checks.every((check) => check.status === "passed")).toBe(true);
    expect(report.manualCommands.find((command) => command.id === "cloudrun-dry-run")).toMatchObject({
      status: "ready",
      mutatesCloudRun: false
    });
    expect(report.manualCommands.find((command) => command.id === "cloudrun-deploy")).toMatchObject({
      status: "review-dry-run-first",
      mutatesCloudRun: true
    });
    expect(report.manualCommands.find((command) => command.id === "cloudrun-dry-run")?.command).toContain(fakeGcloud);
    expect(report.manualCommands.find((command) => command.id === "cloudrun-dry-run")?.command).toContain("cloudrun-dry-run.log");
    expect(report.proofBoundary).toContain("does not run gcloud");
    expect(report.proofBoundary).toContain("prove revenue");
    expect(reportJson.status).toBe("ready-for-private-gcloud-dry-run");
    expect(reportMarkdown).toContain("Cloud Run Operator Environment Preflight");
    expect(reportMarkdown).not.toContain("Bearer ");
  });

  it("blocks when the operator private root differs from the packet private root", async () => {
    const { verifyCloudRunOperatorEnvironment } = await loadOperatorEnv();
    const tempDir = await makeTempDir();
    const packetPrivateRoot = join(tempDir, "packet-private-root");
    const operatorPrivateRoot = join(tempDir, "operator-private-root");
    const fakeGcloud = await writeFakeGcloud(tempDir);
    const packetPath = await writePacketBundle(tempDir, { privateRoot: packetPrivateRoot });

    const report = await verifyCloudRunOperatorEnvironment({
      packetPath,
      privateRoot: operatorPrivateRoot,
      gcloudBin: fakeGcloud
    });
    const blockedIds = report.blockers.map((blocker) => blocker.id);

    expect(report.status).toBe("blocked");
    expect(report.readyForPrivateGcloudDryRun).toBe(false);
    expect(blockedIds).toContain("packet-private-root-aligned");
    expect(report.nextActions.join(" ")).toContain(`SENTINEL_PRIVATE_ROOT=${operatorPrivateRoot}`);
    expect(report.manualCommands.find((command) => command.id === "cloudrun-dry-run")?.status).toBe("blocked");
  });

  it("blocks when gcloud is unavailable or packet verifier is missing", async () => {
    const { verifyCloudRunOperatorEnvironment } = await loadOperatorEnv();
    const tempDir = await makeTempDir();
    const privateRoot = join(tempDir, "private-root");
    const packetPath = await writePacketBundle(tempDir, { privateRoot, writeVerifier: false });

    const report = await verifyCloudRunOperatorEnvironment({
      packetPath,
      gcloudBin: join(tempDir, "missing-gcloud")
    });
    const blockedIds = report.blockers.map((blocker) => blocker.id);

    expect(report.status).toBe("blocked");
    expect(blockedIds).toEqual(expect.arrayContaining(["packet-verifier-ready", "gcloud-binary-available"]));
    expect(report.stopConditions.join(" ")).toContain("Do not run Cloud Run dry-run");
    expect(report.nextActions.join(" ")).toContain("Google Cloud CLI");
  });

  it("blocks unsafe command drift before any operator dry-run", async () => {
    const { verifyCloudRunOperatorEnvironment } = await loadOperatorEnv();
    const tempDir = await makeTempDir();
    const privateRoot = join(tempDir, "private-root");
    const fakeGcloud = await writeFakeGcloud(tempDir);
    const packetPath = await writePacketBundle(tempDir, {
      privateRoot,
      dryRunCommand: "gcloud run services delete sme-workspace-sentinel --region us-central1 --project sentinel-prod --dry-run"
    });

    const report = await verifyCloudRunOperatorEnvironment({
      packetPath,
      gcloudBin: fakeGcloud
    });
    const blockedIds = report.blockers.map((blocker) => blocker.id);

    expect(report.status).toBe("blocked");
    expect(blockedIds).toContain("dry-run-command-safe");
    expect(report.manualCommands.find((command) => command.id === "cloudrun-dry-run")?.status).toBe("blocked");
  });
});

async function loadOperatorEnv() {
  // @ts-expect-error The operator preflight helper is an executable ESM script without a TypeScript declaration file.
  return (await import("../scripts/verify-cloudrun-operator-environment.mjs")) as CloudRunOperatorEnvironmentModule;
}

async function makeTempDir() {
  const path = await mkdtemp(join(tmpdir(), "sentinel-cloudrun-operator-env-"));
  tempDirs.push(path);
  return path;
}

async function writeFakeGcloud(tempDir: string) {
  const path = join(tempDir, "gcloud");

  await writeFile(path, "#!/bin/sh\nprintf 'fake gcloud should not be executed\\n'\n", "utf8");
  await chmod(path, 0o755);

  return path;
}

async function writePacketBundle(
  tempDir: string,
  options: {
    privateRoot: string;
    writeVerifier?: boolean;
    dryRunCommand?: string;
  }
) {
  const releaseId = "release-operator-1";
  const dryRunCommand = options.dryRunCommand ??
    "gcloud run services replace artifacts/deployment/release-operator-1/cloudrun.service.rendered.yaml --region us-central1 --project sentinel-prod --dry-run";
  const deployCommand =
    "gcloud run services replace artifacts/deployment/release-operator-1/cloudrun.service.rendered.yaml --region us-central1 --project sentinel-prod";
  const privateBasePath = join(options.privateRoot, "cloudrun", releaseId);
  const packet = {
    status: "ready-to-dry-run",
    readyForDryRun: true,
    releaseId,
    privateRoot: options.privateRoot,
    dryRunCommand,
    deployCommand,
    operatorHandoff: {
      privateArtifactPaths: [
        join(privateBasePath, "cloudrun-dry-run.log"),
        join(privateBasePath, "cloudrun-deploy.log"),
        join(privateBasePath, "cloudrun-describe.json"),
        join(privateBasePath, "cloudrun-deployment-transcript-packet.json")
      ],
      commandSequence: [
        {
          id: "cloudrun-dry-run",
          command: dryRunCommand
        },
        {
          id: "cloudrun-deploy",
          command: deployCommand
        },
        {
          id: "cloudrun-describe",
          command: "gcloud run services describe sme-workspace-sentinel --region us-central1 --project sentinel-prod --format=json"
        },
        {
          id: "collect-cloudrun-deployment",
          command:
            `npm run collect:cloudrun-deployment -- --release-id ${releaseId} --dry-run-log ${join(privateBasePath, "cloudrun-dry-run.log")} --deploy-log ${join(privateBasePath, "cloudrun-deploy.log")} --describe-json ${join(privateBasePath, "cloudrun-describe.json")} --out-dir artifacts/deployment --strict`
        }
      ]
    }
  };
  const packetPath = join(tempDir, "cloudrun-dry-run-preflight-packet.json");

  await writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  if (options.writeVerifier !== false) {
    await writeFile(
      join(tempDir, "cloudrun-dry-run-packet-verifier.json"),
      `${JSON.stringify({ status: "verified", readyForDryRun: true, releaseId }, null, 2)}\n`,
      "utf8"
    );
  }

  return packetPath;
}
