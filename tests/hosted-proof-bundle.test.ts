import { mkdtemp, readFile, rm } from "node:fs/promises";
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
          expect.objectContaining({ envName: "XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED", status: "passed" })
        ])
      );
      expect(releaseEvidence.slots.map((slot) => slot.id)).toEqual(
        expect.arrayContaining(["cloud-run-deployment", "workspace-sync", "live-gemini", "judge-access", "business-viability"])
      );
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

function payloadForRequest(url: string, method: string, options: { noGeminiProvider?: boolean } = {}) {
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
        }
      ],
      proofArtifacts: [
        { id: "repository-access", status: "ready" },
        { id: "live-gemini-log", status: options.noGeminiProvider ? "external-required" : "ready" }
      ],
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
      checks: [{ status: "missing" }],
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
