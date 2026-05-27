import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

interface HostedProofBundleModule {
  parseArgs: (argv: string[]) => {
    url: string;
    outDir: string;
    releaseId: string;
    includeWriteChecks: boolean;
    strict: boolean;
    adminTokenEnv: string;
    adminToken: string;
  };
  collectHostedProofBundle: (options: {
    url: string;
    outDir: string;
    releaseId: string;
    includeWriteChecks?: boolean;
    strict?: boolean;
    timeoutMs?: number;
    adminTokenEnv?: string;
    adminToken?: string;
  }) => Promise<{
    releaseId: string;
    outputDirectory: string;
    writeAuth: {
      configured: boolean;
      tokenEnv: string;
    };
    summary: {
      artifactCount: number;
      releaseEvidenceStatus?: string;
      releaseIntegrityStatus?: string;
    };
    releaseIntegrity: {
      status: string;
      checks: Array<{ id: string; status: string }>;
    };
    blockers: string[];
    releaseEvidence?: {
      overallStatus: string;
      proofFlagStatus?: string;
      summary: Record<string, number>;
    };
    artifacts: Array<{
      id: string;
      fileName: string;
      status: string;
    }>;
  }>;
}

const requiredProofFlagEnvNames = [
  "XPRIZE_REPOSITORY_ACCESS_CONFIGURED",
  "XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED",
  "XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED",
  "XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED",
  "XPRIZE_CATEGORY_IMPACT_EVIDENCE_CONFIGURED",
  "XPRIZE_AI_NATIVE_OPERATIONS_EVIDENCE_CONFIGURED",
  "XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED",
  "XPRIZE_EVIDENCE_RESPONSE_READY"
];

describe("hosted proof bundle collector", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("parses operator args from env without accepting raw token flags", async () => {
    const { parseArgs } = await loadCollector();
    vi.stubEnv("SENTINEL_OPERATOR_TOKEN", "private-admin-token");

    const args = parseArgs([
      "--url=https://sentinel.example.com",
      "--out-dir",
      "/tmp/sentinel-proof",
      "--release-id",
      "release-test",
      "--include-write-checks",
      "--strict",
      "--admin-token-env",
      "SENTINEL_OPERATOR_TOKEN"
    ]);

    expect(args.url).toBe("https://sentinel.example.com");
    expect(args.outDir).toBe("/tmp/sentinel-proof");
    expect(args.releaseId).toBe("release-test");
    expect(args.includeWriteChecks).toBe(true);
    expect(args.strict).toBe(true);
    expect(args.adminTokenEnv).toBe("SENTINEL_OPERATOR_TOKEN");
    expect(args.adminToken).toBe("private-admin-token");
  });

  it("writes a redacted hosted proof bundle and keeps admin tokens out of artifacts", async () => {
    const { collectHostedProofBundle } = await loadCollector();
    const tempDir = await mkdtemp(join(tmpdir(), "sentinel-proof-"));
    vi.stubEnv("SENTINEL_ADMIN_ACTION_TOKEN", "private-admin-token");
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      return new Response(JSON.stringify(payloadForRequest(href, method)), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchImpl);

    try {
      const manifest = await collectHostedProofBundle({
        url: "https://sentinel.example.com",
        outDir: tempDir,
        releaseId: "release test/unsafe",
        includeWriteChecks: true,
        adminTokenEnv: "SENTINEL_ADMIN_ACTION_TOKEN",
        adminToken: "private-admin-token",
        timeoutMs: 1000
      });
      const manifestJson = await readFile(join(manifest.outputDirectory, "manifest.json"), "utf8");
      const judgeAccessJson = await readFile(join(manifest.outputDirectory, "judge-access-pack.json"), "utf8");
      const releaseEvidenceJson = await readFile(join(manifest.outputDirectory, "release-evidence-manifest.json"), "utf8");
      const verifyJson = await readFile(join(manifest.outputDirectory, "verify-production.json"), "utf8");
      const readme = await readFile(join(manifest.outputDirectory, "README.md"), "utf8");
      const releaseEvidence = JSON.parse(releaseEvidenceJson) as {
        overallStatus: string;
        releaseIntegrity: { status: string };
        proofFlagStatus: string;
        proofFlagChecks: Array<{ envName: string; status: string; detail: string }>;
        slots: Array<{ id: string; status: string; evidence: Array<{ id: string; status: string }> }>;
      };
      const postCalls = fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST");
      const getCalls = fetchImpl.mock.calls.filter(([, init]) => (init?.method ?? "GET") === "GET");

      expect(manifest.releaseId).toBe("release-test-unsafe");
      expect(manifest.summary.artifactCount).toBeGreaterThanOrEqual(12);
      expect(manifest.summary.releaseIntegrityStatus).toBe("passed");
      expect(manifest.releaseIntegrity.status).toBe("passed");
      expect(manifest.artifacts.map((artifact) => artifact.id)).toEqual(
        expect.arrayContaining([
          "verify-production",
          "launch-readiness",
          "judge-access-pack",
          "deployment-packet",
          "hosted-evidence",
          "source-release",
          "project-provenance",
          "license-manifest",
          "workspace-sync-status",
          "deployment-command-results-template-json",
          "deployment-execution-checklist-json",
          "release-evidence-manifest",
          "manifest"
        ])
      );
      expect(manifest.releaseEvidence?.overallStatus).toBe("needs-proof");
      expect(manifest.releaseEvidence?.proofFlagStatus).toBe("passed");
      expect(releaseEvidence.overallStatus).toBe("needs-proof");
      expect(releaseEvidence.releaseIntegrity.status).toBe("passed");
      expect(releaseEvidence.proofFlagStatus).toBe("passed");
      expect(releaseEvidence.proofFlagChecks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ envName: "XPRIZE_REPOSITORY_ACCESS_CONFIGURED", status: "passed" }),
          expect.objectContaining({ envName: "XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED", status: "passed" }),
          expect.objectContaining({ envName: "XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED", status: "passed" }),
          expect.objectContaining({ envName: "XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED", status: "not-claimed" }),
          expect.objectContaining({ envName: "XPRIZE_CATEGORY_IMPACT_EVIDENCE_CONFIGURED", status: "not-claimed" }),
          expect.objectContaining({ envName: "XPRIZE_AI_NATIVE_OPERATIONS_EVIDENCE_CONFIGURED", status: "not-claimed" }),
          expect.objectContaining({ envName: "XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED", status: "not-claimed" }),
          expect.objectContaining({ envName: "XPRIZE_EVIDENCE_RESPONSE_READY", status: "not-claimed" })
        ])
      );
      expect(releaseEvidence.proofFlagChecks.map((check) => check.envName)).toEqual(
        expect.arrayContaining(requiredProofFlagEnvNames)
      );
      expect(releaseEvidence.slots.map((slot) => slot.id)).toEqual(
        expect.arrayContaining([
          "cloud-run-deployment",
          "workspace-sync",
          "live-gemini",
          "judge-access",
          "deployment-execution-control",
          "business-viability"
        ])
      );
      expect(
        releaseEvidence.slots.find((slot) => slot.id === "deployment-execution-control")?.evidence.map((item) => item.id)
      ).toEqual(expect.arrayContaining(["deployment-command-results-template-json", "deployment-execution-checklist-json"]));
      expect(releaseEvidence.slots.find((slot) => slot.id === "deployment-execution-control")?.status).toBe("missing");
      expect(releaseEvidence.slots.find((slot) => slot.id === "workspace-sync")?.evidence.map((item) => item.id)).toContain(
        "workspace-watch-renewal"
      );
      expect(releaseEvidence.slots.find((slot) => slot.id === "cloud-run-deployment")?.status).not.toBe("verified");
      expect(postCalls.length).toBeGreaterThan(0);
      expect(postCalls.every(([, init]) => headerValue(init, "x-sentinel-admin-token") === "private-admin-token")).toBe(true);
      expect(getCalls.every(([, init]) => !headerValue(init, "x-sentinel-admin-token"))).toBe(true);
      expect(`${manifestJson}${judgeAccessJson}${releaseEvidenceJson}${verifyJson}${readme}`).not.toContain("private-admin-token");
      expect(judgeAccessJson).not.toContain("leaked-secret");
      expect(judgeAccessJson).toContain("[REDACTED]");
      expect(manifestJson).toContain("Admin tokens are read only from the configured environment variable");
      expect(readme).toContain("# Hosted Proof Bundle");
      expect(readme).toContain("Release Evidence Manifest");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("lets verified hosted Evidence Vault Cloud Run proof satisfy the release Cloud Run slot", async () => {
    const { collectHostedProofBundle } = await loadCollector();
    const tempDir = await mkdtemp(join(tmpdir(), "sentinel-proof-cloudrun-"));
    vi.stubEnv("SENTINEL_ADMIN_ACTION_TOKEN", "private-admin-token");
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      return new Response(JSON.stringify(payloadForRequest(href, method, { capturedCloudRunVaultProof: true })), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchImpl);

    try {
      const manifest = await collectHostedProofBundle({
        url: "https://sentinel.example.com",
        outDir: tempDir,
        releaseId: "release-test-cloudrun",
        includeWriteChecks: true,
        adminTokenEnv: "SENTINEL_ADMIN_ACTION_TOKEN",
        adminToken: "private-admin-token",
        timeoutMs: 1000
      });
      const releaseEvidenceJson = await readFile(join(manifest.outputDirectory, "release-evidence-manifest.json"), "utf8");
      const releaseEvidence = JSON.parse(releaseEvidenceJson) as {
        slots: Array<{ id: string; status: string; evidence: Array<{ id: string; status: string }> }>;
        proofFlagChecks: Array<{ envName: string; status: string }>;
      };
      const cloudRunSlot = releaseEvidence.slots.find((slot) => slot.id === "cloud-run-deployment");

      expect(cloudRunSlot).toMatchObject({
        status: "verified"
      });
      expect(cloudRunSlot?.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "cloudrun-deployment-output",
            status: "captured"
          }),
          expect.objectContaining({
            id: "cloudrun-deployment-evidence",
            status: "template-needs-values"
          })
        ])
      );
      expect(releaseEvidence.proofFlagChecks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            envName: "XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED",
            status: "passed"
          })
        ])
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails closed when hosted proof bundle output paths would follow symlinks", async () => {
    const { collectHostedProofBundle } = await loadCollector();
    const tempDir = await mkdtemp(join(tmpdir(), "sentinel-proof-symlink-"));
    const realOutDir = join(tempDir, "real-out");
    const symlinkedOutDir = join(tempDir, "symlinked-out");
    const leafSymlinkBaseDir = join(tempDir, "leaf-symlink-base");
    const realLeafOutDir = join(tempDir, "real-leaf-out");
    const leafSymlinkOutDir = join(leafSymlinkBaseDir, "release-test-unsafe");
    const artifactOutDir = join(tempDir, "artifact-out");
    const artifactOutputDirectory = join(artifactOutDir, "release-test-unsafe");
    const readmeOutDir = join(tempDir, "readme-out");
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      return new Response(JSON.stringify(payloadForRequest(href, method)), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchImpl);
    await mkdir(realOutDir);
    await mkdir(leafSymlinkBaseDir);
    await mkdir(realLeafOutDir);
    await symlink(realOutDir, symlinkedOutDir, "dir");
    await symlink(realLeafOutDir, leafSymlinkOutDir, "dir");

    try {
      await expect(
        collectHostedProofBundle({
          url: "https://sentinel.example.com",
          outDir: symlinkedOutDir,
          releaseId: "release test/unsafe",
          timeoutMs: 1000
        })
      ).rejects.toThrow(/symbolic link/u);

      await expect(
        collectHostedProofBundle({
          url: "https://sentinel.example.com",
          outDir: leafSymlinkBaseDir,
          releaseId: "release test/unsafe",
          timeoutMs: 1000
        })
      ).rejects.toThrow(/symbolic link/u);
      expect(await readdir(realLeafOutDir)).toHaveLength(0);

      await mkdir(artifactOutputDirectory, { recursive: true });
      const verifyTargetPath = join(tempDir, "reviewed-verify-production.json");
      await writeFile(verifyTargetPath, "reviewed verify production\n", "utf8");
      await symlink(verifyTargetPath, join(artifactOutputDirectory, "verify-production.json"));
      const verifyTargetContent = await readFile(verifyTargetPath, "utf8");

      await expect(
        collectHostedProofBundle({
          url: "https://sentinel.example.com",
          outDir: artifactOutDir,
          releaseId: "release test/unsafe",
          timeoutMs: 1000
        })
      ).rejects.toThrow(/already contains files/u);
      expect(await readFile(verifyTargetPath, "utf8")).toBe(verifyTargetContent);

      const manifest = await collectHostedProofBundle({
        url: "https://sentinel.example.com",
        outDir: readmeOutDir,
        releaseId: "release test/unsafe",
        timeoutMs: 1000
      });
      const readmePath = join(manifest.outputDirectory, "README.md");
      const verifyJsonPath = join(manifest.outputDirectory, "verify-production.json");
      const verifyJsonBefore = await readFile(verifyJsonPath, "utf8");
      const readmeTargetPath = join(tempDir, "reviewed-hosted-proof-readme.md");
      await writeFile(readmeTargetPath, await readFile(readmePath, "utf8"), "utf8");
      await rm(readmePath, { force: true });
      await symlink(readmeTargetPath, readmePath);
      const readmeTargetContent = await readFile(readmeTargetPath, "utf8");

      await expect(
        collectHostedProofBundle({
          url: "https://sentinel.example.com",
          outDir: readmeOutDir,
          releaseId: "release test/unsafe",
          timeoutMs: 1000
        })
      ).rejects.toThrow(/already contains files/u);
      expect(await readFile(verifyJsonPath, "utf8")).toBe(verifyJsonBefore);
      expect(await readFile(readmeTargetPath, "utf8")).toBe(readmeTargetContent);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks the release manifest when a claimed Gemini proof flag lacks provider evidence", async () => {
    const { collectHostedProofBundle } = await loadCollector();
    const tempDir = await mkdtemp(join(tmpdir(), "sentinel-proof-"));
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      return new Response(JSON.stringify(payloadForRequest(href, method, { noGeminiProvider: true })), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchImpl);

    try {
      const manifest = await collectHostedProofBundle({
        url: "https://sentinel.example.com",
        outDir: tempDir,
        releaseId: "release-test",
        includeWriteChecks: false,
        timeoutMs: 1000
      });
      const releaseEvidenceJson = await readFile(join(manifest.outputDirectory, "release-evidence-manifest.json"), "utf8");
      const releaseEvidence = JSON.parse(releaseEvidenceJson) as {
        overallStatus: string;
        proofFlagStatus: string;
        proofFlagBlockers: string[];
        proofFlagChecks: Array<{ envName: string; status: string }>;
      };

      expect(releaseEvidence.overallStatus).toBe("blocked");
      expect(releaseEvidence.proofFlagStatus).toBe("blocked");
      expect(releaseEvidence.proofFlagBlockers.join(" ")).toContain("XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED");
      expect(releaseEvidence.proofFlagChecks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ envName: "XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED", status: "blocked" })
        ])
      );
      expect(manifest.blockers.join(" ")).toContain("XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks the release manifest when a claimed business evidence flag lacks hosted business proof", async () => {
    const { collectHostedProofBundle } = await loadCollector();
    const tempDir = await mkdtemp(join(tmpdir(), "sentinel-proof-"));
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      return new Response(JSON.stringify(payloadForRequest(href, method, { claimBusinessEvidence: true })), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchImpl);

    try {
      const manifest = await collectHostedProofBundle({
        url: "https://sentinel.example.com",
        outDir: tempDir,
        releaseId: "release-test",
        includeWriteChecks: false,
        timeoutMs: 1000
      });
      const releaseEvidenceJson = await readFile(join(manifest.outputDirectory, "release-evidence-manifest.json"), "utf8");
      const releaseEvidence = JSON.parse(releaseEvidenceJson) as {
        overallStatus: string;
        proofFlagStatus: string;
        proofFlagBlockers: string[];
        proofFlagChecks: Array<{ envName: string; status: string }>;
      };

      expect(releaseEvidence.overallStatus).toBe("blocked");
      expect(releaseEvidence.proofFlagStatus).toBe("blocked");
      expect(releaseEvidence.proofFlagBlockers.join(" ")).toContain("XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED");
      expect(releaseEvidence.proofFlagChecks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ envName: "XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED", status: "blocked" })
        ])
      );
      expect(manifest.blockers.join(" ")).toContain("XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

async function loadCollector() {
  // @ts-expect-error The hosted proof collector is an executable ESM script without a TypeScript declaration file.
  return (await import("../scripts/collect-hosted-proof-bundle.mjs")) as HostedProofBundleModule;
}

function headerValue(init: RequestInit | undefined, name: string) {
  const headers = init?.headers;
  if (!headers || headers instanceof Headers || Array.isArray(headers)) {
    return undefined;
  }

  return headers[name];
}

function payloadForRequest(
  url: string,
  method: string,
  options: { noGeminiProvider?: boolean; claimBusinessEvidence?: boolean; capturedCloudRunVaultProof?: boolean } = {}
) {
  if (method === "POST") {
    return {
      overallStatus: "passed",
      status: "passed",
      provider: options.noGeminiProvider ? "mock-gemini" : "gemini-api",
      model: "gemini-3.5-flash",
      checks: []
    };
  }

  if (url.includes("/api/production/gemini-smoke")) {
    return {
      status: options.noGeminiProvider ? "mock-only" : "passed",
      provider: options.noGeminiProvider ? "mock-gemini" : "gemini-api",
      model: "gemini-3.5-flash",
      decisionSummary: options.noGeminiProvider ? "Only mock Gemini evidence is present." : "Hosted Gemini proof status passed."
    };
  }

  if (url.includes("/api/production/launch-readiness")) {
    return {
      overallStatus: "external-required",
      envMatrix: [
        {
          name: "XPRIZE_REPOSITORY_ACCESS_CONFIGURED",
          status: "configured",
          currentValue: "true"
        },
        {
          name: "XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED",
          status: "configured",
          currentValue: "true"
        },
        {
          name: "XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED",
          status: "configured",
          currentValue: "true"
        },
        {
          name: "XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED",
          status: options.claimBusinessEvidence ? "configured" : "missing",
          currentValue: options.claimBusinessEvidence ? "true" : "missing"
        },
        {
          name: "XPRIZE_CATEGORY_IMPACT_EVIDENCE_CONFIGURED",
          status: "missing",
          currentValue: "missing"
        },
        {
          name: "XPRIZE_AI_NATIVE_OPERATIONS_EVIDENCE_CONFIGURED",
          status: "missing",
          currentValue: "missing"
        },
        {
          name: "XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED",
          status: "missing",
          currentValue: "missing"
        },
        {
          name: "XPRIZE_EVIDENCE_RESPONSE_READY",
          status: "missing",
          currentValue: "missing"
        }
      ],
      proofArtifacts: [
        { id: "repository-access", status: "ready" },
        { id: "live-gemini-log", status: options.noGeminiProvider ? "external-required" : "ready" }
      ],
      blockers: []
    };
  }

  if (url.includes("/api/production/deployment-evidence")) {
    return {
      overallStatus: "template-needs-values",
      status: "template-needs-values",
      replacementFindings: [{ id: "render-values-required" }],
      blockers: []
    };
  }

  if (url.includes("/api/xprize/judge-access-pack")) {
    return {
      overallStatus: "blocked",
      accessChecks: [{ status: "missing" }],
      walkthrough: [{ id: "open-dashboard" }],
      credentialSecret: "leaked-secret"
    };
  }

  if (url.includes("/api/xprize/source-release")) {
    return {
      overallStatus: "published",
      releasableFileCount: 42,
      secretFindings: []
    };
  }

  if (url.includes("/api/xprize/provenance")) {
    return {
      overallStatus: "passed",
      git: {
        headCommit: "a".repeat(40),
        remoteHeadCommit: "a".repeat(40),
        upstreamBranch: "origin/main"
      },
      checks: [{ id: "repository-pushed", status: "passed" }],
      blockers: []
    };
  }

  if (url.includes("/api/xprize/license-manifest")) {
    return {
      summary: {
        status: "warning",
        restrictedLicenseReviewCount: 0,
        obligationReviewCount: 1,
        licenseNeedsReviewCount: 1
      },
      blockers: []
    };
  }

  if (url.includes("/api/workspace/sync/status")) {
    return {
      overallStatus: "passed",
      syncState: {
        mode: "oauth",
        driveCursor: "redacted",
        gmailCursor: "redacted"
      },
      renewalPlan: {
        status: "due",
        nextAction: "renew watches"
      }
    };
  }

  if (url.includes("/api/production/deployment-packet")) {
    return {
      releaseId: "release-test-unsafe",
      status: "template-needs-values",
      productUrl: "https://sentinel.example.com",
      artifactManifest: [],
      commandSequence: [],
      evidenceVaultImportTemplate: {
        sourceUrl: "https://sentinel.example.com",
        payload: {
          releaseId: "release-test-unsafe"
        }
      },
      blockers: []
    };
  }

  if (url.includes("/api/production/hosted-evidence")) {
    return {
      overallStatus: "needs-hosted-proof",
      checks: [
        ...(options.capturedCloudRunVaultProof
          ? [
              {
                id: "cloudrun-deployment-output",
                status: "captured",
                evidence: "Verified Evidence Vault artifact: Cloud Run deployment evidence JSON."
              }
            ]
          : []),
        { id: "production-readiness-write-through", status: "needs-review" }
      ],
      blockers: []
    };
  }

  return {
    overallStatus: "passed",
    status: "passed",
    xprizeGate: { overallStatus: "passed", blockingSummary: [] },
    summary: { status: "passed", blocked: 0, warning: 0 },
    blockers: [],
    checks: [],
    violations: [],
    warnings: [],
    results: [],
    replacementFindings: [],
    secretFindings: [],
    accessToken: "private-admin-token"
  };
}
