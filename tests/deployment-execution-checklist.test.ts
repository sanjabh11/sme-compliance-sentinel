import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

interface DeploymentExecutionChecklistModule {
  deploymentImportRequiredCommandIds: string[];
  parseArgs: (argv: string[]) => {
    bundleDir: string;
    resultsPath: string;
    outFile: string;
    strict: boolean;
  };
  prepareDeploymentExecutionChecklist: (options: {
    bundleDir: string;
    resultsPath?: string;
    outFile?: string;
    strict?: boolean;
  }) => Promise<{
    overallStatus: string;
    releaseId: string;
    sourceUrl: string;
    summary: {
      total: number;
      passed: number;
      blocked: number;
    };
    entries: Array<{
      commandId: string;
      releaseId: string;
      sourceUrl: string;
      status: string;
      recordedAt: string;
      expectedArtifactPath: string;
      evidencePath: string;
      commandSha256: string;
      blockers: string[];
    }>;
    blockers: string[];
  }>;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("deployment execution checklist", () => {
  it("parses safe args and rejects raw secret-shaped args", async () => {
    const { parseArgs } = await loadChecklist();

    expect(
      parseArgs([
        "--bundle-dir",
        "/secure/local/hosted-proof/release-1",
        "--results=/secure/local/deployment-command-results.json",
        "--out-file",
        "/secure/local/hosted-proof/release-1/deployment-execution-checklist.json",
        "--strict"
      ])
    ).toMatchObject({
      bundleDir: "/secure/local/hosted-proof/release-1",
      resultsPath: "/secure/local/deployment-command-results.json",
      outFile: "/secure/local/hosted-proof/release-1/deployment-execution-checklist.json",
      strict: true
    });
    expect(() => parseArgs(["--admin-token=secret"])).toThrow(/Raw secret CLI args/u);
  });

  it("writes a passed checklist from private command results", async () => {
    const { deploymentImportRequiredCommandIds, prepareDeploymentExecutionChecklist } = await loadChecklist();
    const bundleDir = await makeBundle(deploymentImportRequiredCommandIds);
    const resultsPath = join(bundleDir, "operator-results.json");
    await writeFile(
      resultsPath,
      `${JSON.stringify(
        {
          entries: deploymentImportRequiredCommandIds.map((commandId) => ({
            commandId,
            status: "passed",
            recordedAt: "2026-05-23T12:00:00.000Z",
            evidencePath: `gs://sentinel-private/releases/release-1/${commandId}.json`,
            evidenceSha256: "a".repeat(64),
            note: "Recorded from private operator transcript."
          }))
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const checklist = await prepareDeploymentExecutionChecklist({
      bundleDir,
      resultsPath,
      strict: true
    });
    const checklistJson = await readFile(join(bundleDir, "deployment-execution-checklist.json"), "utf8");
    const checklistMarkdown = await readFile(join(bundleDir, "deployment-execution-checklist.md"), "utf8");

    expect(checklist.overallStatus).toBe("passed");
    expect(checklist.releaseId).toBe("release-1");
    expect(checklist.sourceUrl).toBe("https://sentinel.example.com");
    expect(checklist.summary).toMatchObject({
      total: deploymentImportRequiredCommandIds.length,
      passed: deploymentImportRequiredCommandIds.length,
      blocked: 0
    });
    expect(checklist.entries[0]).toMatchObject({
      commandId: deploymentImportRequiredCommandIds[0],
      releaseId: "release-1",
      sourceUrl: "https://sentinel.example.com",
      status: "passed",
      expectedArtifactPath: `gs://sentinel-private/releases/release-1/${deploymentImportRequiredCommandIds[0]}.json`,
      evidencePath: `gs://sentinel-private/releases/release-1/${deploymentImportRequiredCommandIds[0]}.json`,
      blockers: []
    });
    expect(checklist.entries[0].commandSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.parse(checklistJson)).toMatchObject({ overallStatus: "passed" });
    expect(checklistMarkdown).toContain("Deployment Execution Checklist");
  });

  it("blocks strict mode when operator results are missing", async () => {
    const { deploymentImportRequiredCommandIds, prepareDeploymentExecutionChecklist } = await loadChecklist();
    const bundleDir = await makeBundle(deploymentImportRequiredCommandIds);

    await expect(
      prepareDeploymentExecutionChecklist({
        bundleDir,
        strict: true
      })
    ).rejects.toThrow(/Deployment execution checklist is blocked/u);
  });
});

async function loadChecklist() {
  // @ts-expect-error The checklist helper is an executable ESM script without a TypeScript declaration file.
  return (await import("../scripts/prepare-deployment-execution-checklist.mjs")) as DeploymentExecutionChecklistModule;
}

async function makeBundle(commandIds: string[]) {
  const bundleDir = await mkdtemp(join(tmpdir(), "sentinel-deployment-checklist-"));
  tempDirs.push(bundleDir);
  const releaseId = "release-1";
  const sourceUrl = "https://sentinel.example.com";
  const artifactManifest = commandIds.map((commandId) => ({
    id: `${commandId}-artifact`,
    label: `${commandId} artifact`,
    privateStorePath: `gs://sentinel-private/releases/${releaseId}/${commandId}.json`
  }));
  const commandSequence = commandIds.map((commandId) => ({
    id: commandId,
    label: commandId,
    command: `run ${commandId}`,
    mutatesProduction: commandId.includes("deploy") || commandId.includes("hosted"),
    requiresAdminToken: commandId.includes("hosted"),
    expectedArtifactId: `${commandId}-artifact`
  }));

  await writeFile(
    join(bundleDir, "manifest.json"),
    `${JSON.stringify({ releaseId, baseUrl: sourceUrl }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    join(bundleDir, "deployment-packet.json"),
    `${JSON.stringify({ releaseId, productUrl: sourceUrl, artifactManifest, commandSequence }, null, 2)}\n`,
    "utf8"
  );

  return bundleDir;
}
