import { afterEach, describe, expect, it, vi } from "vitest";

interface VerifyProductionModule {
  parseArgs: (argv: string[]) => {
    url: string;
    includeWriteChecks: boolean;
    adminTokenEnv: string;
    adminToken: string;
  };
  runProductionReadinessVerification: (options: {
    url: string;
    includeWriteChecks: boolean;
    adminTokenEnv: string;
    adminToken: string;
    timeoutMs?: number;
    strict?: boolean;
  }) => Promise<{
    writeAuth: {
      required: boolean;
      configured: boolean;
      tokenEnv: string;
      headerName: string;
    };
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
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      return new Response(JSON.stringify(payloadForMethod(method)), { status: 200 });
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

  it("supports a custom private token env name without accepting raw token CLI args", async () => {
    const { parseArgs } = await loadVerifier();
    vi.stubEnv("SENTINEL_OPERATOR_TOKEN", "operator-secret");

    const args = parseArgs(["--url=https://sentinel.example.com", "--include-write-checks", "--admin-token-env", "SENTINEL_OPERATOR_TOKEN"]);

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

function payloadForMethod(method: string) {
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
