import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

interface CloudRunRenderHandoffModule {
  parseArgs: (argv: string[]) => {
    valuesPath: string;
    outDir: string;
    releaseId: string;
    verifyHandoffPath: string;
    strict: boolean;
  };
  prepareCloudRunRenderHandoff: (options: {
    valuesPath: string;
    outDir: string;
    releaseId?: string;
    strict?: boolean;
    gitRunner?: (args: string[]) => string;
  }) => Promise<{
    overallStatus: string;
    releaseId: string;
    privateRoot: string;
    valuesPath: string;
    handoffPath: string;
    handoffMarkdownPath: string;
    renderValuesAudit: {
      status: string;
      auditPath: string;
      evidencePacketPath: string;
      missingStrictKeys: string[];
      intakeSummary: {
        ready: number;
        placeholder: number;
      };
    };
    privateValueChecklist: {
      status: string;
      requiredBeforeDryRunCount: number;
      publicClaimEvidenceCount: number;
      consistencyBlockerCount: number;
      process: string[];
      requiredBeforeDryRun: Array<{
        key: string;
        owner: string;
        status: string;
        fix: string;
      }>;
      publicClaimEvidenceQueue: Array<{
        key: string;
        owner: string;
        status: string;
        acceptedProof: string;
      }>;
      consistencyBlockers: Array<{
        key: string;
        status: string;
        fix: string;
      }>;
    };
    evidencePacketVerification: {
      overallStatus: string;
      verificationPath: string;
    };
    blockers: string[];
    nextActions: string[];
    stopConditions: string[];
    proofBoundary: string;
  }>;
  verifyCloudRunRenderHandoff: (path: string) => Promise<{
    overallStatus: string;
    handoffPath: string;
    verificationPath: string;
    releaseId: string;
    renderEvidenceVerifierStatus: string;
    summary: {
      passed: number;
      blocked: number;
    };
    blockers: string[];
    proofBoundary: string;
    stopConditions: string[];
  }>;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Cloud Run render handoff", () => {
  it("parses safe args and rejects raw secret-shaped args", async () => {
    const { parseArgs } = await loadHandoff();

    expect(
      parseArgs([
        "--values",
        "/secure/local/cloudrun-render-values.json",
        "--out-dir=/secure/local/deployment",
        "--release-id",
        "release-20260524-0123456",
        "--verify-handoff",
        "/secure/local/cloudrun-render-handoff.json",
        "--strict"
      ])
    ).toMatchObject({
      valuesPath: "/secure/local/cloudrun-render-values.json",
      outDir: "/secure/local/deployment",
      releaseId: "release-20260524-0123456",
      verifyHandoffPath: "/secure/local/cloudrun-render-handoff.json",
      strict: true
    });
    expect(parseArgs(["/secure/local/custom-values.json"])).toMatchObject({
      valuesPath: "/secure/local/custom-values.json"
    });
    expect(() => parseArgs(["--gemini-api-key", "secret"])).toThrow(/Raw secret CLI args/u);
  });

  it("writes a release-prefilled values starter and verified render evidence handoff without claiming hosted proof", async () => {
    const { prepareCloudRunRenderHandoff, verifyCloudRunRenderHandoff } = await loadHandoff();
    const tempDir = await makeTempDir();
    const valuesPath = join(tempDir, "cloudrun-render-values.json");
    const outDir = join(tempDir, "deployment");

    const handoff = await prepareCloudRunRenderHandoff({
      valuesPath,
      outDir,
      strict: true,
      gitRunner: makeFakeGitRunner()
    });
    const values = JSON.parse(await readFile(valuesPath, "utf8")) as Record<string, string>;
    const handoffJson = JSON.parse(await readFile(handoff.handoffPath, "utf8")) as typeof handoff;
    const handoffMarkdown = await readFile(handoff.handoffMarkdownPath, "utf8");
    const evidenceVerifier = JSON.parse(await readFile(handoff.evidencePacketVerification.verificationPath, "utf8")) as {
      overallStatus: string;
    };

    expect(handoff.overallStatus).toBe("ready-for-private-values");
    expect(handoff.releaseId).toBe("release-20260524-0123456");
    expect(handoff.renderValuesAudit.status).toBe("needs-values");
    expect(handoff.renderValuesAudit.missingStrictKeys.length).toBeGreaterThan(0);
    expect(handoff.renderValuesAudit.intakeSummary.ready).toBeGreaterThan(0);
    expect(handoff.privateValueChecklist.status).toBe("needs-private-values");
    expect(handoff.privateValueChecklist.requiredBeforeDryRunCount).toBeGreaterThan(0);
    expect(handoff.privateValueChecklist.publicClaimEvidenceCount).toBeGreaterThan(0);
    expect(handoff.privateValueChecklist.requiredBeforeDryRun.some((row) => row.key === "GOOGLE_CLOUD_PROJECT")).toBe(true);
    expect(handoff.privateValueChecklist.requiredBeforeDryRun).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "SENTINEL_CLOUD_RUN_IMAGE",
          derivationHint: expect.stringContaining("SENTINEL_RELEASE_ID"),
          fix: expect.stringContaining("normally derived")
        })
      ])
    );
    expect(handoff.privateValueChecklist.consistencyBlockers.some((row) => row.key === "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS")).toBe(true);
    expect(handoff.privateValueChecklist.process.join(" ")).toContain("never paste secret values");
    expect(handoff.privateValueChecklist.process.join(" ")).toContain("before any gcloud dry-run");
    expect(handoff.evidencePacketVerification.overallStatus).toBe("verified");
    expect(evidenceVerifier.overallStatus).toBe("verified");
    expect(handoff.blockers).toEqual([]);
    expect(values).toMatchObject({
      SENTINEL_RELEASE_ID: "release-20260524-0123456",
      SENTINEL_SOURCE_COMMIT: "0123456789abcdef0123456789abcdef01234567",
      SENTINEL_SOURCE_COMMIT_AT: "2026-05-24T05:18:19.000Z",
      SENTINEL_SOURCE_BRANCH: "origin/main",
      XPRIZE_REPOSITORY_URL: "https://github.com/sanjabh11/sme-compliance-sentinel"
    });
    expect(handoff.nextActions.join(" ")).toContain("Fill the remaining non-secret production values");
    expect(handoff.nextActions.join(" ")).toContain("audit:cloudrun-values");
    expect(handoff.stopConditions.join(" ")).toContain("Do not run strict render");
    expect(handoff.proofBoundary).toContain("does not deploy Cloud Run");
    expect(handoff.proofBoundary).toContain("prove revenue");
    expect(handoff.proofBoundary).toContain("guarantee judging outcome");
    expect(handoffMarkdown).toContain("Cloud Run Render Handoff");
    expect(handoffMarkdown).toContain("ready-for-private-values");
    expect(handoffMarkdown).toContain("Private Value Fill Checklist");
    expect(handoffMarkdown).toContain("Derivation / Override Guidance");
    expect(handoffMarkdown).toContain("Derived from SENTINEL_CLOUD_RUN_REGION");
    expect(handoffMarkdown).toContain("GOOGLE_CLOUD_PROJECT");
    expect(handoffMarkdown).toContain("Public Claim Evidence Queue");
    expect(handoffJson).toMatchObject({
      overallStatus: "ready-for-private-values",
      privateValueChecklist: {
        status: "needs-private-values"
      },
      evidencePacketVerification: { overallStatus: "verified" }
    });
    expect(JSON.stringify(handoff)).not.toContain("AIza");
    expect(JSON.stringify(handoff)).not.toContain("GOCSPX");
    expect(JSON.stringify(handoff)).not.toContain("private-admin-token");

    const verified = await verifyCloudRunRenderHandoff(handoff.handoffPath);
    const verifierJson = JSON.parse(await readFile(verified.verificationPath, "utf8")) as typeof verified;

    expect(verified).toMatchObject({
      overallStatus: "verified",
      releaseId: "release-20260524-0123456",
      renderEvidenceVerifierStatus: "verified"
    });
    expect(verified.summary.blocked).toBe(0);
    expect(verified.proofBoundary).toContain("does not deploy Cloud Run");
    expect(verified.stopConditions.join(" ")).toContain("Do not run Cloud Run dry-run");
    expect(verifierJson).toMatchObject({ overallStatus: "verified" });
  });

  it("uses SENTINEL_PRIVATE_ROOT for the default values path when no explicit path is supplied", async () => {
    const { parseArgs, prepareCloudRunRenderHandoff } = await loadHandoff();
    const tempDir = await makeTempDir();
    const privateRoot = join(tempDir, "operator-private-root");
    const previousPrivateRoot = process.env.SENTINEL_PRIVATE_ROOT;
    const previousValuesPath = process.env.SENTINEL_CLOUD_RUN_VALUES_PATH;

    try {
      process.env.SENTINEL_PRIVATE_ROOT = privateRoot;
      delete process.env.SENTINEL_CLOUD_RUN_VALUES_PATH;

      const args = parseArgs([]);
      const handoff = await prepareCloudRunRenderHandoff({
        valuesPath: args.valuesPath,
        outDir: join(tempDir, "deployment"),
        gitRunner: makeFakeGitRunner()
      });

      expect(args.valuesPath).toBe(join(privateRoot, "cloudrun-render-values.json"));
      expect(handoff.privateRoot).toBe(privateRoot);
      expect(handoff.valuesPath).toBe(join(privateRoot, "cloudrun-render-values.json"));
    } finally {
      if (previousPrivateRoot === undefined) {
        delete process.env.SENTINEL_PRIVATE_ROOT;
      } else {
        process.env.SENTINEL_PRIVATE_ROOT = previousPrivateRoot;
      }
      if (previousValuesPath === undefined) {
        delete process.env.SENTINEL_CLOUD_RUN_VALUES_PATH;
      } else {
        process.env.SENTINEL_CLOUD_RUN_VALUES_PATH = previousValuesPath;
      }
    }
  });

  it("verifies handoff integrity and blocks tampered Markdown or claim boundaries", async () => {
    const { prepareCloudRunRenderHandoff, verifyCloudRunRenderHandoff } = await loadHandoff();
    const tempDir = await makeTempDir();
    const clean = await prepareCloudRunRenderHandoff({
      valuesPath: join(tempDir, "values.json"),
      outDir: join(tempDir, "deployment"),
      gitRunner: makeFakeGitRunner()
    });

    await writeFile(clean.handoffMarkdownPath, "# stale handoff\n", "utf8");
    const tamperedMarkdown = await verifyCloudRunRenderHandoff(clean.handoffPath);

    expect(tamperedMarkdown.overallStatus).toBe("blocked");
    expect(tamperedMarkdown.blockers.join(" ")).toContain("handoff-markdown-regenerated");

    const handoffJson = JSON.parse(await readFile(clean.handoffPath, "utf8")) as Record<string, unknown>;
    handoffJson.proofBoundary = "Ready for production.";
    await writeFile(clean.handoffPath, `${JSON.stringify(handoffJson, null, 2)}\n`, "utf8");
    const tamperedBoundary = await verifyCloudRunRenderHandoff(clean.handoffPath);

    expect(tamperedBoundary.overallStatus).toBe("blocked");
    expect(tamperedBoundary.blockers.join(" ")).toContain("handoff-proof-boundary");

    const missingChecklist = await prepareCloudRunRenderHandoff({
      valuesPath: join(tempDir, "missing-checklist-values.json"),
      outDir: join(tempDir, "missing-checklist-deployment"),
      gitRunner: makeFakeGitRunner()
    });
    const missingChecklistJson = JSON.parse(await readFile(missingChecklist.handoffPath, "utf8")) as Record<string, unknown>;
    delete missingChecklistJson.privateValueChecklist;
    await writeFile(missingChecklist.handoffPath, `${JSON.stringify(missingChecklistJson, null, 2)}\n`, "utf8");
    const missingChecklistVerification = await verifyCloudRunRenderHandoff(missingChecklist.handoffPath);

    expect(missingChecklistVerification.overallStatus).toBe("blocked");
    expect(missingChecklistVerification.blockers.join(" ")).toContain("handoff-private-value-checklist-shape");
    expect(missingChecklistVerification.blockers.join(" ")).toContain("handoff-markdown-regenerated");

    const countDrift = await prepareCloudRunRenderHandoff({
      valuesPath: join(tempDir, "count-drift-values.json"),
      outDir: join(tempDir, "count-drift-deployment"),
      gitRunner: makeFakeGitRunner()
    });
    const countDriftJson = JSON.parse(await readFile(countDrift.handoffPath, "utf8")) as {
      privateValueChecklist?: {
        requiredBeforeDryRunCount?: number;
      };
    };
    if (countDriftJson.privateValueChecklist) {
      countDriftJson.privateValueChecklist.requiredBeforeDryRunCount = 0;
    }
    await writeFile(countDrift.handoffPath, `${JSON.stringify(countDriftJson, null, 2)}\n`, "utf8");
    const countDriftVerification = await verifyCloudRunRenderHandoff(countDrift.handoffPath);

    expect(countDriftVerification.overallStatus).toBe("blocked");
    expect(countDriftVerification.blockers.join(" ")).toContain("handoff-private-value-checklist-counts");

    const pathDrift = await prepareCloudRunRenderHandoff({
      valuesPath: join(tempDir, "path-drift-values.json"),
      outDir: join(tempDir, "path-drift-deployment"),
      gitRunner: makeFakeGitRunner()
    });
    const outsideEvidencePacketPath = join(tempDir, "outside-cloudrun-render-evidence-packet.json");
    const outsideEvidenceVerifierPath = join(tempDir, "cloudrun-render-evidence-packet-verifier.json");
    const outsideMarkdownPath = join(tempDir, "outside-cloudrun-render-handoff.md");
    const pathDriftJson = JSON.parse(await readFile(pathDrift.handoffPath, "utf8")) as {
      handoffMarkdownPath?: string;
      renderValuesAudit?: {
        evidencePacketPath?: string;
      };
    };
    await writeFile(outsideEvidencePacketPath, await readFile(pathDrift.renderValuesAudit.evidencePacketPath, "utf8"), "utf8");
    await writeFile(outsideMarkdownPath, await readFile(pathDrift.handoffMarkdownPath, "utf8"), "utf8");
    pathDriftJson.handoffMarkdownPath = outsideMarkdownPath;
    if (pathDriftJson.renderValuesAudit) {
      pathDriftJson.renderValuesAudit.evidencePacketPath = outsideEvidencePacketPath;
    }
    await writeFile(pathDrift.handoffPath, `${JSON.stringify(pathDriftJson, null, 2)}\n`, "utf8");
    const pathDriftVerification = await verifyCloudRunRenderHandoff(pathDrift.handoffPath);

    expect(pathDriftVerification.overallStatus).toBe("blocked");
    expect(pathDriftVerification.blockers.join(" ")).toContain("handoff-markdown-path-match");
    expect(pathDriftVerification.blockers.join(" ")).toContain("render-evidence-packet-path-match");
    await expect(readFile(outsideEvidenceVerifierPath, "utf8")).rejects.toThrow(/ENOENT/u);

    const symlinkedHandoff = await prepareCloudRunRenderHandoff({
      valuesPath: join(tempDir, "symlink-values.json"),
      outDir: join(tempDir, "symlink-deployment"),
      gitRunner: makeFakeGitRunner()
    });
    const symlinkTargetPath = join(tempDir, "reviewed-cloudrun-render-handoff.json");
    await writeFile(symlinkTargetPath, await readFile(symlinkedHandoff.handoffPath, "utf8"), "utf8");
    await rm(symlinkedHandoff.handoffPath, { force: true });
    await symlink(symlinkTargetPath, symlinkedHandoff.handoffPath);
    const symlinkTargetContent = await readFile(symlinkTargetPath, "utf8");
    const symlinkedVerification = await verifyCloudRunRenderHandoff(symlinkedHandoff.handoffPath);

    expect(symlinkedVerification.overallStatus).toBe("blocked");
    expect(symlinkedVerification.blockers.join(" ")).toContain("symbolic link");

    const realOutDir = join(tempDir, "reviewed-render-handoff-output");
    const symlinkedOutDir = join(tempDir, "symlinked-render-handoff-output");
    await mkdir(realOutDir);
    await symlink(realOutDir, symlinkedOutDir);
    await expect(
      prepareCloudRunRenderHandoff({
        valuesPath: join(tempDir, "symlink-output-dir-values.json"),
        outDir: symlinkedOutDir,
        gitRunner: makeFakeGitRunner()
      })
    ).rejects.toThrow(/symbolic link/u);

    await expect(
      prepareCloudRunRenderHandoff({
        valuesPath: symlinkedHandoff.valuesPath,
        outDir: join(tempDir, "symlink-deployment"),
        gitRunner: makeFakeGitRunner()
      })
    ).rejects.toThrow(/symbolic link/u);
    expect(await readFile(symlinkTargetPath, "utf8")).toBe(symlinkTargetContent);
  });

  it("fails closed before partial writes when handoff outputs or input parents are symlinked", async () => {
    const { prepareCloudRunRenderHandoff, verifyCloudRunRenderHandoff } = await loadHandoff();
    const tempDir = await makeTempDir();
    const valuesPath = join(tempDir, "partial-write-values.json");
    const outDir = join(tempDir, "partial-write-deployment");
    const handoff = await prepareCloudRunRenderHandoff({
      valuesPath,
      outDir,
      gitRunner: makeFakeGitRunner()
    });
    const originalHandoffJson = await readFile(handoff.handoffPath, "utf8");
    const markdownTargetPath = join(tempDir, "reviewed-cloudrun-render-handoff.md");
    await writeFile(markdownTargetPath, "unchanged-markdown\n", "utf8");
    await rm(handoff.handoffMarkdownPath, { force: true });
    await symlink(markdownTargetPath, handoff.handoffMarkdownPath);

    await expect(
      prepareCloudRunRenderHandoff({
        valuesPath,
        outDir,
        gitRunner: makeFakeGitRunner()
      })
    ).rejects.toThrow(/symbolic link/u);
    expect(await readFile(handoff.handoffPath, "utf8")).toBe(originalHandoffJson);
    expect(await readFile(markdownTargetPath, "utf8")).toBe("unchanged-markdown\n");
    expect((await readdir(outDir)).filter((path) => path.endsWith(".tmp"))).toEqual([]);

    const realHandoffDir = dirname(handoff.handoffPath);
    const symlinkedHandoffDir = join(tempDir, "symlinked-handoff-parent");
    const verifierTargetPath = join(realHandoffDir, "cloudrun-render-handoff-verifier.json");
    await rm(verifierTargetPath, { force: true });
    await symlink(realHandoffDir, symlinkedHandoffDir);

    await expect(verifyCloudRunRenderHandoff(join(symlinkedHandoffDir, "cloudrun-render-handoff.json"))).rejects.toThrow(
      /symbolic link/u
    );
    await expect(readFile(verifierTargetPath, "utf8")).rejects.toThrow(/ENOENT/u);
  });

  it("blocks mismatched release ids before private handoff proceeds", async () => {
    const { prepareCloudRunRenderHandoff } = await loadHandoff();
    const tempDir = await makeTempDir();
    const valuesPath = join(tempDir, "cloudrun-render-values.json");

    const handoff = await prepareCloudRunRenderHandoff({
      valuesPath,
      outDir: join(tempDir, "deployment"),
      releaseId: "release-manual-mismatch",
      gitRunner: makeFakeGitRunner()
    });

    expect(handoff.overallStatus).toBe("blocked");
    expect(handoff.blockers.join(" ")).toContain("release-id");
    await expect(
      prepareCloudRunRenderHandoff({
        valuesPath: join(tempDir, "second-values.json"),
        outDir: join(tempDir, "second-deployment"),
        releaseId: "release-manual-mismatch",
        strict: true,
        gitRunner: makeFakeGitRunner()
      })
    ).rejects.toThrow(/Cloud Run render handoff is blocked/u);
  });
});

async function loadHandoff() {
  // @ts-expect-error The handoff helper is an executable ESM script without a TypeScript declaration file.
  return (await import("../scripts/prepare-cloudrun-render-handoff.mjs")) as CloudRunRenderHandoffModule;
}

async function makeTempDir() {
  const path = await mkdtemp(join(tmpdir(), "sentinel-cloudrun-render-handoff-"));
  tempDirs.push(path);

  return path;
}

function makeFakeGitRunner() {
  return (args: string[]) => {
    const command = args.join(" ");
    const outputs: Record<string, string> = {
      "rev-parse HEAD": "0123456789abcdef0123456789abcdef01234567",
      "log -1 --format=%cI": "2026-05-24T10:48:19+05:30",
      "rev-parse --abbrev-ref --symbolic-full-name @{u}": "origin/main",
      "rev-parse --abbrev-ref HEAD": "main",
      "remote get-url origin": "git@github.com:sanjabh11/sme-compliance-sentinel.git"
    };

    if (outputs[command] === undefined) {
      throw new Error(`unexpected git command ${command}`);
    }

    return outputs[command];
  };
}
