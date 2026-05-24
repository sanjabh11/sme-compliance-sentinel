import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

interface VerifyProductionModule {
  parseArgs: (argv: string[]) => {
    url: string;
    releaseId: string;
    strict: boolean;
    includeWriteChecks: boolean;
    adminTokenEnv: string;
    adminToken: string;
    outPath: string;
  };
  runProductionReadinessVerification: (options: {
    url: string;
    releaseId?: string;
    includeWriteChecks: boolean;
    adminTokenEnv: string;
    adminToken: string;
    timeoutMs?: number;
    strict?: boolean;
    outPath?: string;
  }) => Promise<{
    overallStatus?: string;
    baseUrl?: string;
    releaseLineage?: {
      status: string;
      blockers: string[];
      checks: Array<{
        id: string;
        status: string;
        expected: string;
        actual: string;
      }>;
    };
    writeAuth: {
      required: boolean;
      configured: boolean;
      tokenEnv: string;
      headerName: string;
    };
    manualIntervention?: {
      phaseId: string;
      bucket: string;
      owner: string;
      priority: number;
      commands: string[];
      stopCondition: string;
    };
    blockers?: string[];
    proofBoundary?: string;
    stopConditions?: string[];
  }>;
}

describe("verify-production readiness script auth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("loads the admin token from env and sends it only to write-through checks", async () => {
    const { parseArgs, runProductionReadinessVerification } = await loadVerifier();
    vi.stubEnv("SENTINEL_ADMIN_ACTION_TOKEN", "private-admin-token");
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      return new Response(JSON.stringify(payloadForRequest(String(url), method)), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchImpl);

    const args = parseArgs(["--url", "https://sentinel.example.com", "--include-write-checks"]);
    const report = await runProductionReadinessVerification(args);
    const postCalls = fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST");
    const getCalls = fetchImpl.mock.calls.filter(([, init]) => init?.method === "GET");

    expect(args.adminToken).toBe("private-admin-token");
    expect(report.writeAuth).toMatchObject({
      required: true,
      configured: true,
      tokenEnv: "SENTINEL_ADMIN_ACTION_TOKEN",
      headerName: "x-sentinel-admin-token"
    });
    expect(postCalls.length).toBeGreaterThan(0);
    expect(postCalls.every(([, init]) => headerValue(init, "x-sentinel-admin-token") === "private-admin-token")).toBe(true);
    expect(getCalls.every(([, init]) => !headerValue(init, "x-sentinel-admin-token"))).toBe(true);
    expect(JSON.stringify(report)).not.toContain("private-admin-token");
  });

  it("checks hosted release lineage against deployment packet and pushed provenance", async () => {
    const { parseArgs, runProductionReadinessVerification } = await loadVerifier();
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      return new Response(JSON.stringify(payloadForRequest(String(url), method)), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchImpl);

    const args = parseArgs(["--url", "https://sentinel.example.com/", "--release-id", "release-20260523-001"]);
    const report = await runProductionReadinessVerification(args);
    const checksById = Object.fromEntries(report.releaseLineage?.checks.map((check) => [check.id, check]) ?? []);

    expect(report.overallStatus).toBe("passed");
    expect(report.baseUrl).toBe("https://sentinel.example.com");
    expect(report.releaseLineage).toMatchObject({
      status: "passed",
      blockers: []
    });
    expect(checksById["deployment-packet-release-id"]).toMatchObject({
      status: "passed",
      expected: "release-20260523-001",
      actual: "release-20260523-001"
    });
    expect(checksById["deployment-packet-product-url"]).toMatchObject({
      status: "passed",
      expected: "https://sentinel.example.com",
      actual: "https://sentinel.example.com"
    });
    expect(checksById["project-provenance-pushed-head"]).toMatchObject({
      status: "passed",
      expected: "0123456789abcdef0123456789abcdef01234567",
      actual: "0123456789abcdef0123456789abcdef01234567"
    });
  });

  it("blocks hosted verification output when release lineage is stale or mismatched", async () => {
    const { parseArgs, runProductionReadinessVerification } = await loadVerifier();
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      return new Response(JSON.stringify(payloadForRequest(String(url), method, "stale-lineage")), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchImpl);

    const args = parseArgs(["--url=https://sentinel.example.com", "--release-id", "release-20260523-001"]);
    const report = await runProductionReadinessVerification(args);
    const checksById = Object.fromEntries(report.releaseLineage?.checks.map((check) => [check.id, check]) ?? []);

    expect(report.overallStatus).toBe("blocked");
    expect(report.releaseLineage?.status).toBe("blocked");
    expect(report.releaseLineage?.blockers.join(" ")).toContain("Expected release-20260523-001");
    expect(checksById["deployment-packet-release-id"]).toMatchObject({
      status: "blocked",
      actual: "release-old"
    });
    expect(checksById["deployment-packet-product-url"]).toMatchObject({
      status: "blocked",
      actual: "https://old.example.com"
    });
    expect(checksById["project-provenance-pushed-head"]).toMatchObject({
      status: "blocked",
      expected: "0123456789abcdef0123456789abcdef01234567",
      actual: "abcdefabcdefabcdefabcdefabcdefabcdefabcd"
    });
  });

  it("returns a structured hosted-proof blocker when the Cloud Run URL is missing", async () => {
    const { parseArgs, runProductionReadinessVerification } = await loadVerifier();

    const args = parseArgs(["--strict", "--out", "/secure/local/verify-production.json"]);
    const report = await runProductionReadinessVerification(args);

    expect(args).toMatchObject({
      url: "",
      outPath: "/secure/local/verify-production.json",
      strict: true
    });
    expect(report).toMatchObject({
      overallStatus: "blocked",
      baseUrl: "missing",
      manualIntervention: {
        phaseId: "hosted-proof-capture",
        bucket: "external-proof",
        owner: "engineering",
        priority: 5
      }
    });
    expect(report.blockers?.join(" ")).toContain("NEXT_PUBLIC_PRODUCT_URL is missing");
    expect(report.manualIntervention?.commands.join(" ")).toContain("gcloud run services describe");
    expect(report.manualIntervention?.commands.join(" ")).toContain("verify:production");
    expect(report.manualIntervention?.commands.join(" ")).toContain("--release-id $SENTINEL_RELEASE_ID");
    expect(report.manualIntervention?.commands.join(" ")).toContain(
      "--out /secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-readonly.json"
    );
    expect(report.manualIntervention?.stopCondition).toContain("Stop before setting hosted");
    expect(report.proofBoundary).toContain("operator handoff only");
    expect(report.stopConditions?.join(" ")).toContain("Do not treat this missing-URL report as hosted proof");
    expect(JSON.stringify(report)).not.toContain("private-admin-token");
  });

  it("writes the missing-url blocker report to a private output path and exits non-zero", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-production-verifier-"));
    const outPath = join(tempDir, "verify-production-missing-url.json");

    try {
      expect(() =>
        execFileSync(
          process.execPath,
          ["scripts/verify-production-readiness.mjs", "--out", outPath],
          {
            cwd: process.cwd(),
            env: { ...process.env, NEXT_PUBLIC_PRODUCT_URL: "" },
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"]
          }
        )
      ).toThrow();

      const report = JSON.parse(readFileSync(outPath, "utf8")) as {
        overallStatus: string;
        outputPath: string;
        manualIntervention: { phaseId: string };
      };

      expect(report).toMatchObject({
        overallStatus: "blocked",
        outputPath: outPath,
        manualIntervention: {
          phaseId: "hosted-proof-capture"
        }
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("supports a custom private token env name without accepting raw token CLI args", async () => {
    const { parseArgs } = await loadVerifier();
    vi.stubEnv("SENTINEL_OPERATOR_TOKEN", "operator-secret");

    const args = parseArgs([
      "--url=https://sentinel.example.com",
      "--release-id",
      "release-20260523-001",
      "--include-write-checks",
      "--admin-token-env",
      "SENTINEL_OPERATOR_TOKEN"
    ]);

    expect(args.releaseId).toBe("release-20260523-001");
    expect(args.adminTokenEnv).toBe("SENTINEL_OPERATOR_TOKEN");
    expect(args.adminToken).toBe("operator-secret");
  });
});

async function loadVerifier() {
  // @ts-expect-error The production verifier is an executable ESM script without a TypeScript declaration file.
  return (await import("../scripts/verify-production-readiness.mjs")) as VerifyProductionModule;
}

function headerValue(init: RequestInit | undefined, name: string) {
  const headers = init?.headers;
  if (!headers || headers instanceof Headers || Array.isArray(headers)) {
    return undefined;
  }

  return headers[name];
}

function payloadForRequest(url: string, method: string, variant: "ready" | "stale-lineage" = "ready") {
  if (method === "POST") {
    return {
      status: "passed",
      overallStatus: "passed",
      provider: "gemini-api",
      model: "gemini-3.5-flash",
      proofSummary: "Synthetic proof passed.",
      checks: []
    };
  }

  if (url.includes("/api/production/deployment-packet")) {
    const stale = variant === "stale-lineage";
    const releaseId = stale ? "release-old" : "release-20260523-001";
    const productUrl = stale ? "https://old.example.com" : "https://sentinel.example.com";

    return {
      overallStatus: "passed",
      status: "passed",
      releaseId,
      productUrl,
      artifactManifest: [],
      commandSequence: [],
      blockers: [],
      evidenceVaultImportTemplate: {
        sourceUrl: productUrl,
        payload: { releaseId }
      }
    };
  }

  if (url.includes("/api/xprize/provenance")) {
    return {
      overallStatus: "passed",
      status: "passed",
      blockers: [],
      git: {
        headCommit: "0123456789abcdef0123456789abcdef01234567",
        remoteHeadCommit:
          variant === "stale-lineage"
            ? "abcdefabcdefabcdefabcdefabcdefabcdefabcd"
            : "0123456789abcdef0123456789abcdef01234567",
        upstreamBranch: "origin/main"
      }
    };
  }

  return {
    overallStatus: "passed",
    status: "passed",
    xprizeGate: { overallStatus: "passed", blockingSummary: [] },
    blockers: [],
    checks: [],
    summary: { blocked: 0, warning: 0, status: "passed" },
    violations: [],
    warnings: [],
    demoVideoScript: [],
    replacementFindings: [],
    secretFindings: [],
    reviewerAttestations: [],
    blockingSummary: [],
    factualWinConfidence: "bounded"
  };
}
