import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

interface DeploymentExecutionChecklistModule {
  deploymentImportRequiredCommandIds: string[];
  parseArgs: (argv: string[]) => {
    bundleDir: string;
    resultsPath: string;
    writeResultsTemplatePath: string;
    outFile: string;
    strict: boolean;
  };
  writeDeploymentCommandResultsTemplate: (options: {
    bundleDir: string;
    outputPath?: string;
    writeResultsTemplatePath?: string;
  }) => Promise<{
    path: string;
    releaseId: string;
    sourceUrl: string;
    entryCount: number;
    privateHandling: string;
  }>;
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
      evidenceFileVerification: {
        status: string;
        local: boolean;
        path: string;
        expectedSha256: string;
        actualSha256: string;
        byteLength: number;
        fileType?: string;
        blockers: string[];
      };
      commandSha256: string;
      blockers: string[];
    }>;
    resultsTemplate: {
      status: string;
      releaseId: string;
      sourceUrl: string;
      entryCount: number;
      expectedCommandCount: number;
      blockers: string[];
    };
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
        "--write-results-template",
        "/secure/local/deployment-command-results.template.json",
        "--out-file",
        "/secure/local/hosted-proof/release-1/deployment-execution-checklist.json",
        "--strict"
      ])
    ).toMatchObject({
      bundleDir: "/secure/local/hosted-proof/release-1",
      resultsPath: "/secure/local/deployment-command-results.json",
      writeResultsTemplatePath: "/secure/local/deployment-command-results.template.json",
      outFile: "/secure/local/hosted-proof/release-1/deployment-execution-checklist.json",
      strict: true
    });
    expect(() => parseArgs(["--admin-token=secret"])).toThrow(/Raw secret CLI args/u);
  });

  it("writes a private command results template that is blocked until filled", async () => {
    const {
      deploymentImportRequiredCommandIds,
      prepareDeploymentExecutionChecklist,
      writeDeploymentCommandResultsTemplate
    } = await loadChecklist();
    const bundleDir = await makeBundle(deploymentImportRequiredCommandIds);
    const resultsTemplatePath = join(bundleDir, "deployment-command-results.template.json");

    expect(deploymentImportRequiredCommandIds).toContain("cloudrun-release-values");
    expect(deploymentImportRequiredCommandIds).toContain("cloudrun-render-handoff-verify");
    expect(deploymentImportRequiredCommandIds).toContain("cloudrun-render-evidence-verify");
    expect(deploymentImportRequiredCommandIds.indexOf("cloudrun-release-values")).toBeLessThan(
      deploymentImportRequiredCommandIds.indexOf("cloudrun-render-handoff-verify")
    );
    expect(deploymentImportRequiredCommandIds.indexOf("cloudrun-render-handoff-verify")).toBeLessThan(
      deploymentImportRequiredCommandIds.indexOf("cloudrun-render-values-audit")
    );
    expect(deploymentImportRequiredCommandIds.indexOf("cloudrun-render-values-audit")).toBeLessThan(
      deploymentImportRequiredCommandIds.indexOf("cloudrun-render-evidence-verify")
    );
    expect(deploymentImportRequiredCommandIds.indexOf("cloudrun-render-evidence-verify")).toBeLessThan(
      deploymentImportRequiredCommandIds.indexOf("cloudrun-render-manifest")
    );

    const summary = await writeDeploymentCommandResultsTemplate({
      bundleDir,
      outputPath: resultsTemplatePath
    });
    const template = JSON.parse(await readFile(resultsTemplatePath, "utf8")) as {
      entries: Array<{
        commandId: string;
        status: string;
        releaseId: string;
        sourceUrl: string;
        recordedAt: string;
        expectedArtifactPath: string;
        evidencePath: string;
        evidenceSha256: string;
        commandSha256: string;
      }>;
      instructions: string[];
    };
    const checklist = await prepareDeploymentExecutionChecklist({
      bundleDir,
      resultsPath: resultsTemplatePath
    });

    expect(summary).toMatchObject({
      path: resultsTemplatePath,
      releaseId: "release-1",
      sourceUrl: "https://sentinel.example.com",
      entryCount: deploymentImportRequiredCommandIds.length
    });
    expect(summary.privateHandling).toContain("outside Git");
    expect(template.instructions.join(" ")).toContain("Change status from pending to passed");
    expect(template.entries).toHaveLength(deploymentImportRequiredCommandIds.length);
    expect(template.entries[0]).toMatchObject({
      commandId: deploymentImportRequiredCommandIds[0],
      status: "pending",
      releaseId: "release-1",
      sourceUrl: "https://sentinel.example.com",
      recordedAt: "REPLACE_WITH_ISO_TIMESTAMP",
      expectedArtifactPath: `gs://sentinel-private/releases/release-1/${deploymentImportRequiredCommandIds[0]}.json`,
      evidencePath: `gs://sentinel-private/releases/release-1/${deploymentImportRequiredCommandIds[0]}.json`,
      evidenceSha256: "REPLACE_WITH_SHA256_OF_PRIVATE_ARTIFACT"
    });
    expect(template.entries[0].commandSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(template)).not.toContain("SENTINEL_ADMIN_ACTION_TOKEN");
    expect(JSON.stringify(template)).not.toContain("private-admin-token");
    expect(checklist.overallStatus).toBe("blocked");
    expect(checklist.entries[0].blockers.join(" ")).toContain("status is pending");
    expect(checklist.entries[0].blockers.join(" ")).toContain("recordedAt must be an ISO timestamp");
    expect(checklist.entries[0].blockers.join(" ")).toContain("valid evidenceSha256");
  });

  it("accepts hosted proof endpoint wrappers for deployment packet artifacts", async () => {
    const {
      deploymentImportRequiredCommandIds,
      writeDeploymentCommandResultsTemplate
    } = await loadChecklist();
    const bundleDir = await makeBundle(deploymentImportRequiredCommandIds, { wrappedDeploymentPacket: true });
    const resultsTemplatePath = join(bundleDir, "deployment-command-results.template.json");

    const summary = await writeDeploymentCommandResultsTemplate({
      bundleDir,
      outputPath: resultsTemplatePath
    });
    const template = JSON.parse(await readFile(resultsTemplatePath, "utf8")) as {
      entries: Array<{
        commandId: string;
        expectedArtifactPath: string;
        commandSha256: string;
        requiresAdminToken: boolean;
      }>;
    };

    expect(summary).toMatchObject({
      releaseId: "release-1",
      sourceUrl: "https://sentinel.example.com",
      entryCount: deploymentImportRequiredCommandIds.length
    });
    expect(template.entries[0]).toMatchObject({
      commandId: deploymentImportRequiredCommandIds[0],
      expectedArtifactPath: `gs://sentinel-private/releases/release-1/${deploymentImportRequiredCommandIds[0]}.json`,
      requiresAdminToken: false
    });
    expect(template.entries[0].commandSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("writes a passed checklist from private command results", async () => {
    const {
      deploymentImportRequiredCommandIds,
      prepareDeploymentExecutionChecklist,
      writeDeploymentCommandResultsTemplate
    } = await loadChecklist();
    const bundleDir = await makeBundle(deploymentImportRequiredCommandIds);
    const resultsPath = await writeFilledResultsTemplate({
      bundleDir,
      commandIds: deploymentImportRequiredCommandIds,
      writeDeploymentCommandResultsTemplate
    });

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
    expect(checklist.resultsTemplate).toMatchObject({
      status: "passed",
      releaseId: "release-1",
      sourceUrl: "https://sentinel.example.com",
      entryCount: deploymentImportRequiredCommandIds.length,
      expectedCommandCount: deploymentImportRequiredCommandIds.length,
      blockers: []
    });
    expect(checklist.entries[0]).toMatchObject({
      commandId: deploymentImportRequiredCommandIds[0],
      releaseId: "release-1",
      sourceUrl: "https://sentinel.example.com",
      status: "passed",
      resultReleaseId: "release-1",
      resultSourceUrl: "https://sentinel.example.com",
      expectedArtifactPath: `gs://sentinel-private/releases/release-1/${deploymentImportRequiredCommandIds[0]}.json`,
      evidencePath: `gs://sentinel-private/releases/release-1/${deploymentImportRequiredCommandIds[0]}.json`,
      evidenceFileVerification: {
        status: "external-private",
        local: false
      },
      blockers: []
    });
    expect(checklist.entries[0].commandSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.parse(checklistJson)).toMatchObject({ overallStatus: "passed" });
    expect(checklistMarkdown).toContain("Deployment Execution Checklist");
  });

  it("verifies local private evidence files before hosted proof import", async () => {
    const {
      deploymentImportRequiredCommandIds,
      prepareDeploymentExecutionChecklist,
      writeDeploymentCommandResultsTemplate
    } = await loadChecklist();
    const bundleDir = await makeBundle(deploymentImportRequiredCommandIds, { localArtifacts: true });
    const resultsPath = await writeFilledResultsTemplate({
      bundleDir,
      commandIds: deploymentImportRequiredCommandIds,
      writeDeploymentCommandResultsTemplate,
      mutateEntry: (entry) => ({
        ...entry,
        evidenceSha256: sha256(localEvidenceContent(String(entry.commandId)))
      })
    });

    const checklist = await prepareDeploymentExecutionChecklist({
      bundleDir,
      resultsPath,
      strict: true
    });

    expect(checklist.overallStatus).toBe("passed");
    expect(checklist.entries.every((entry) => entry.evidenceFileVerification.status === "verified")).toBe(true);
    expect(checklist.entries.every((entry) => entry.evidenceFileVerification.local)).toBe(true);
    expect(checklist.entries[0].evidenceFileVerification.actualSha256).toBe(
      sha256(localEvidenceContent(deploymentImportRequiredCommandIds[0]))
    );
  });

  it("blocks local private evidence files that are missing, checksum-drifted, secret-shaped, symlinked, or non-regular", async () => {
    const {
      deploymentImportRequiredCommandIds,
      prepareDeploymentExecutionChecklist,
      writeDeploymentCommandResultsTemplate
    } = await loadChecklist();
    const bundleDir = await makeBundle(deploymentImportRequiredCommandIds, { localArtifacts: true });
    const [missingCommandId, checksumCommandId, secretCommandId, symlinkCommandId, directoryCommandId] =
      deploymentImportRequiredCommandIds;
    const secretContent = "Bearer abcdefghijklmnopqrstuvwxyz123456\n";
    const symlinkContent = localEvidenceContent(symlinkCommandId);
    const symlinkTargetPath = join(bundleDir, "private-evidence", "reviewed-symlink-target.json");
    await writeFile(localEvidencePath(bundleDir, secretCommandId), secretContent, "utf8");
    await writeFile(symlinkTargetPath, symlinkContent, "utf8");
    await rm(localEvidencePath(bundleDir, symlinkCommandId), { force: true });
    await symlink(symlinkTargetPath, localEvidencePath(bundleDir, symlinkCommandId));
    await rm(localEvidencePath(bundleDir, directoryCommandId), { force: true });
    await mkdir(localEvidencePath(bundleDir, directoryCommandId));
    const resultsPath = await writeFilledResultsTemplate({
      bundleDir,
      commandIds: deploymentImportRequiredCommandIds,
      writeDeploymentCommandResultsTemplate,
      mutateEntry: (entry) => ({
        ...entry,
        evidenceSha256:
          entry.commandId === checksumCommandId
            ? "b".repeat(64)
            : entry.commandId === secretCommandId
              ? sha256(secretContent)
              : entry.commandId === symlinkCommandId
                ? sha256(symlinkContent)
                : entry.commandId === directoryCommandId
                  ? "c".repeat(64)
              : sha256(localEvidenceContent(String(entry.commandId)))
      })
    });
    await rm(localEvidencePath(bundleDir, missingCommandId), { force: true });

    const checklist = await prepareDeploymentExecutionChecklist({
      bundleDir,
      resultsPath
    });
    const entriesById = Object.fromEntries(checklist.entries.map((entry) => [entry.commandId, entry]));

    expect(checklist.overallStatus).toBe("blocked");
    expect(entriesById[missingCommandId].evidenceFileVerification.status).toBe("blocked");
    expect(entriesById[missingCommandId].blockers.join(" ")).toContain("local evidence file is not readable");
    expect(entriesById[checksumCommandId].blockers.join(" ")).toContain("local evidence SHA-256");
    expect(entriesById[secretCommandId].blockers.join(" ")).toContain("local evidence file contains secret-shaped text");
    expect(entriesById[symlinkCommandId].evidenceFileVerification).toMatchObject({
      status: "blocked",
      fileType: "symbolic-link"
    });
    expect(entriesById[symlinkCommandId].blockers.join(" ")).toContain("local evidence file is a symbolic link");
    expect(entriesById[directoryCommandId].evidenceFileVerification).toMatchObject({
      status: "blocked",
      fileType: "not-regular-file"
    });
    expect(entriesById[directoryCommandId].blockers.join(" ")).toContain("local evidence path is not a regular file");
  });

  it("fails closed when deployment checklist output paths would follow symlinks", async () => {
    const {
      deploymentImportRequiredCommandIds,
      prepareDeploymentExecutionChecklist,
      writeDeploymentCommandResultsTemplate
    } = await loadChecklist();
    const bundleDir = await makeBundle(deploymentImportRequiredCommandIds);
    const realTemplateDir = join(bundleDir, "reviewed-template-output");
    const symlinkedTemplateDir = join(bundleDir, "symlinked-template-output");
    await mkdir(realTemplateDir);
    await symlink(realTemplateDir, symlinkedTemplateDir);

    await expect(
      writeDeploymentCommandResultsTemplate({
        bundleDir,
        outputPath: join(symlinkedTemplateDir, "deployment-command-results.json")
      })
    ).rejects.toThrow(/symbolic link/u);
    expect(await readdir(realTemplateDir)).toEqual([]);

    const templateTargetPath = join(bundleDir, "reviewed-template-target.json");
    const templateSymlinkPath = join(bundleDir, "deployment-command-results.symlink.json");
    await writeFile(templateTargetPath, "unchanged-template\n", "utf8");
    await symlink(templateTargetPath, templateSymlinkPath);
    await expect(
      writeDeploymentCommandResultsTemplate({
        bundleDir,
        outputPath: templateSymlinkPath
      })
    ).rejects.toThrow(/symbolic link/u);
    expect(await readFile(templateTargetPath, "utf8")).toBe("unchanged-template\n");

    const resultsPath = await writeFilledResultsTemplate({
      bundleDir,
      commandIds: deploymentImportRequiredCommandIds,
      writeDeploymentCommandResultsTemplate
    });
    const markdownOutFile = join(bundleDir, "deployment-execution-checklist.md");
    await writeFile(markdownOutFile, "unchanged-md-outfile\n", "utf8");
    await expect(
      prepareDeploymentExecutionChecklist({
        bundleDir,
        resultsPath,
        outFile: markdownOutFile
      })
    ).rejects.toThrow(/must end in \.json/u);
    expect(await readFile(markdownOutFile, "utf8")).toBe("unchanged-md-outfile\n");

    const checklistTargetPath = join(bundleDir, "reviewed-checklist-target.json");
    const checklistSymlinkPath = join(bundleDir, "deployment-execution-checklist.symlink.json");
    await writeFile(checklistTargetPath, "unchanged-checklist\n", "utf8");
    await symlink(checklistTargetPath, checklistSymlinkPath);
    await expect(
      prepareDeploymentExecutionChecklist({
        bundleDir,
        resultsPath,
        outFile: checklistSymlinkPath
      })
    ).rejects.toThrow(/symbolic link/u);
    expect(await readFile(checklistTargetPath, "utf8")).toBe("unchanged-checklist\n");

    const regularChecklistPath = join(bundleDir, "deployment-execution-checklist.regular.json");
    const markdownSymlinkPath = join(bundleDir, "deployment-execution-checklist.regular.md");
    const markdownTargetPath = join(bundleDir, "reviewed-checklist-target.md");
    await writeFile(regularChecklistPath, "unchanged-json\n", "utf8");
    await writeFile(markdownTargetPath, "unchanged-markdown\n", "utf8");
    await symlink(markdownTargetPath, markdownSymlinkPath);
    await expect(
      prepareDeploymentExecutionChecklist({
        bundleDir,
        resultsPath,
        outFile: regularChecklistPath
      })
    ).rejects.toThrow(/symbolic link/u);
    expect(await readFile(regularChecklistPath, "utf8")).toBe("unchanged-json\n");
    expect(await readFile(markdownTargetPath, "utf8")).toBe("unchanged-markdown\n");
  });

  it("fails closed when deployment checklist input JSON paths have symlinked parents", async () => {
    const {
      deploymentImportRequiredCommandIds,
      prepareDeploymentExecutionChecklist,
      writeDeploymentCommandResultsTemplate
    } = await loadChecklist();
    const bundleDir = await makeBundle(deploymentImportRequiredCommandIds);
    const symlinkedBundleDir = join(bundleDir, "symlinked-bundle");
    await symlink(bundleDir, symlinkedBundleDir);
    await expect(
      writeDeploymentCommandResultsTemplate({
        bundleDir: symlinkedBundleDir,
        outputPath: join(bundleDir, "should-not-write-from-symlinked-bundle.json")
      })
    ).rejects.toThrow(/symbolic link/u);

    const resultsPath = await writeFilledResultsTemplate({
      bundleDir,
      commandIds: deploymentImportRequiredCommandIds,
      writeDeploymentCommandResultsTemplate
    });
    const realResultsDir = join(bundleDir, "reviewed-results-dir");
    const symlinkedResultsDir = join(bundleDir, "symlinked-results-dir");
    const symlinkedResultsPath = join(symlinkedResultsDir, "deployment-command-results.json");
    const blockedOutFile = join(bundleDir, "should-not-write-from-symlinked-results.json");
    await mkdir(realResultsDir);
    await writeFile(join(realResultsDir, "deployment-command-results.json"), await readFile(resultsPath, "utf8"), "utf8");
    await symlink(realResultsDir, symlinkedResultsDir);

    await expect(
      prepareDeploymentExecutionChecklist({
        bundleDir,
        resultsPath: symlinkedResultsPath,
        outFile: blockedOutFile
      })
    ).rejects.toThrow(/symbolic link/u);
    await expect(readFile(blockedOutFile, "utf8")).rejects.toThrow(/ENOENT/u);
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

  it("blocks stale command results that do not match release, URL, evidence path, or checksum", async () => {
    const {
      deploymentImportRequiredCommandIds,
      prepareDeploymentExecutionChecklist,
      writeDeploymentCommandResultsTemplate
    } = await loadChecklist();
    const bundleDir = await makeBundle(deploymentImportRequiredCommandIds);
    const [firstCommandId, secondCommandId, thirdCommandId] = deploymentImportRequiredCommandIds;
    const resultsPath = await writeFilledResultsTemplate({
      bundleDir,
      commandIds: deploymentImportRequiredCommandIds,
      writeDeploymentCommandResultsTemplate,
      mutateEntry: (entry) => ({
        ...entry,
        releaseId: entry.commandId === firstCommandId ? "release-old" : entry.releaseId,
        sourceUrl: entry.commandId === secondCommandId ? "https://old.example.com" : entry.sourceUrl,
        evidencePath:
          entry.commandId === thirdCommandId
            ? "gs://sentinel-private/releases/release-old/stale.json"
            : entry.evidencePath,
        evidenceSha256: entry.commandId === thirdCommandId ? "not-a-sha" : entry.evidenceSha256
      })
    });

    const checklist = await prepareDeploymentExecutionChecklist({
      bundleDir,
      resultsPath
    });
    const entriesById = Object.fromEntries(checklist.entries.map((entry) => [entry.commandId, entry]));

    expect(checklist.overallStatus).toBe("blocked");
    expect(entriesById[firstCommandId].blockers.join(" ")).toContain("releaseId release-old does not match release-1");
    expect(entriesById[secondCommandId].blockers.join(" ")).toContain(
      "sourceUrl https://old.example.com does not match https://sentinel.example.com"
    );
    expect(entriesById[thirdCommandId].blockers.join(" ")).toContain("evidencePath must match expectedArtifactPath");
    expect(entriesById[thirdCommandId].blockers.join(" ")).toContain("valid evidenceSha256");
  });

  it("blocks passed-looking results that did not come from the generated results template", async () => {
    const { deploymentImportRequiredCommandIds, prepareDeploymentExecutionChecklist } = await loadChecklist();
    const bundleDir = await makeBundle(deploymentImportRequiredCommandIds);
    const resultsPath = join(bundleDir, "handwritten-results.json");
    await writeFile(
      resultsPath,
      `${JSON.stringify(
        {
          entries: deploymentImportRequiredCommandIds.map((commandId) => ({
            commandId,
            status: "passed",
            releaseId: "release-1",
            sourceUrl: "https://sentinel.example.com",
            recordedAt: "2026-05-23T12:00:00.000Z",
            evidencePath: `gs://sentinel-private/releases/release-1/${commandId}.json`,
            evidenceSha256: "a".repeat(64)
          }))
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const checklist = await prepareDeploymentExecutionChecklist({
      bundleDir,
      resultsPath
    });

    expect(checklist.overallStatus).toBe("blocked");
    expect(checklist.resultsTemplate).toMatchObject({ status: "blocked" });
    expect(checklist.resultsTemplate.blockers.join(" ")).toContain("generatedAt");
    expect(checklist.resultsTemplate.blockers.join(" ")).toContain("instructions are missing");
  });
});

async function loadChecklist() {
  // @ts-expect-error The checklist helper is an executable ESM script without a TypeScript declaration file.
  return (await import("../scripts/prepare-deployment-execution-checklist.mjs")) as DeploymentExecutionChecklistModule;
}

async function makeBundle(commandIds: string[], options: { localArtifacts?: boolean; wrappedDeploymentPacket?: boolean } = {}) {
  const bundleDir = await mkdtemp(join(tmpdir(), "sentinel-deployment-checklist-"));
  tempDirs.push(bundleDir);
  const releaseId = "release-1";
  const sourceUrl = "https://sentinel.example.com";
  if (options.localArtifacts) {
    await mkdir(join(bundleDir, "private-evidence"), { recursive: true });
  }
  const artifactManifest = commandIds.map((commandId) => ({
    id: `${commandId}-artifact`,
    label: `${commandId} artifact`,
    privateStorePath: options.localArtifacts
      ? localEvidencePath(bundleDir, commandId)
      : `gs://sentinel-private/releases/${releaseId}/${commandId}.json`
  }));
  const commandSequence = commandIds.map((commandId) => ({
    id: commandId,
    label: commandId,
    command: `run ${commandId}`,
    mutatesProduction: commandId.includes("deploy") || commandId.includes("hosted"),
    requiresAdminToken: options.wrappedDeploymentPacket && !commandId.includes("hosted") ? "[REDACTED]" : commandId.includes("hosted"),
    expectedArtifactId: `${commandId}-artifact`
  }));

  await writeFile(
    join(bundleDir, "manifest.json"),
    `${JSON.stringify({ releaseId, baseUrl: sourceUrl }, null, 2)}\n`,
    "utf8"
  );
  const deploymentPacket = { releaseId, productUrl: sourceUrl, artifactManifest, commandSequence };
  await writeFile(
    join(bundleDir, "deployment-packet.json"),
    `${JSON.stringify(
      options.wrappedDeploymentPacket
        ? {
            generatedAt: "2026-05-23T12:00:00.000Z",
            endpoint: "/api/production/deployment-packet",
            httpStatus: 200,
            ok: true,
            payload: deploymentPacket
          }
        : deploymentPacket,
      null,
      2
    )}\n`,
    "utf8"
  );
  if (options.localArtifacts) {
    await Promise.all(commandIds.map((commandId) => writeFile(localEvidencePath(bundleDir, commandId), localEvidenceContent(commandId), "utf8")));
  }

  return bundleDir;
}

async function writeFilledResultsTemplate(input: {
  bundleDir: string;
  commandIds: string[];
  writeDeploymentCommandResultsTemplate: DeploymentExecutionChecklistModule["writeDeploymentCommandResultsTemplate"];
  mutateEntry?: (entry: Record<string, unknown>) => Record<string, unknown>;
}) {
  const resultsPath = join(input.bundleDir, "deployment-command-results.json");
  await input.writeDeploymentCommandResultsTemplate({
    bundleDir: input.bundleDir,
    outputPath: resultsPath
  });
  const template = JSON.parse(await readFile(resultsPath, "utf8")) as {
    entries: Array<Record<string, unknown>>;
  };

  template.entries = template.entries.map((entry) => {
    const filledEntry = {
      ...entry,
      status: "passed",
      recordedAt: "2026-05-23T12:00:00.000Z",
      evidenceSha256: "a".repeat(64),
      note: "Recorded from private operator transcript."
    };

    return input.mutateEntry ? input.mutateEntry(filledEntry) : filledEntry;
  });
  await writeFile(resultsPath, `${JSON.stringify(template, null, 2)}\n`, "utf8");

  return resultsPath;
}

function localEvidencePath(bundleDir: string, commandId: string) {
  return join(bundleDir, "private-evidence", `${commandId}.json`);
}

function localEvidenceContent(commandId: string) {
  return `${JSON.stringify({ commandId, releaseId: "release-1", sourceUrl: "https://sentinel.example.com" })}\n`;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
