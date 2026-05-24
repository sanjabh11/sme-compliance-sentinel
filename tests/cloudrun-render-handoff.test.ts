import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
