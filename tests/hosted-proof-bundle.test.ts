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
      const verifyJson = await readFile(join(manifest.outputDirectory, "verify-production.json"), "utf8");
      const readme = await readFile(join(manifest.outputDirectory, "README.md"), "utf8");
      const postCalls = fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST");
      const getCalls = fetchImpl.mock.calls.filter(([, init]) => (init?.method ?? "GET") === "GET");

      expect(manifest.releaseId).toBe("release-test-unsafe");
      expect(manifest.summary.artifactCount).toBeGreaterThanOrEqual(8);
      expect(manifest.artifacts.map((artifact) => artifact.id)).toEqual(
        expect.arrayContaining(["verify-production", "judge-access-pack", "deployment-packet", "hosted-evidence", "manifest"])
      );
      expect(postCalls.length).toBeGreaterThan(0);
      expect(postCalls.every(([, init]) => headerValue(init, "x-sentinel-admin-token") === "private-admin-token")).toBe(true);
      expect(getCalls.every(([, init]) => !headerValue(init, "x-sentinel-admin-token"))).toBe(true);
      expect(`${manifestJson}${judgeAccessJson}${verifyJson}${readme}`).not.toContain("private-admin-token");
      expect(judgeAccessJson).not.toContain("leaked-secret");
      expect(judgeAccessJson).toContain("[REDACTED]");
      expect(manifestJson).toContain("Admin tokens are read only from the configured environment variable");
      expect(readme).toContain("# Hosted Proof Bundle");
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

function payloadForRequest(url: string, method: string) {
  if (method === "POST") {
    return {
      overallStatus: "passed",
      status: "passed",
      provider: "gemini-api",
      model: "gemini-3.5-flash",
      checks: []
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

  if (url.includes("/api/production/deployment-packet")) {
    return {
      status: "template-needs-values",
      artifactManifest: [],
      commandSequence: [],
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
