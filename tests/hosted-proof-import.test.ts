import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

interface HostedProofImportModule {
  parseArgs: (argv: string[]) => {
    bundleDir: string;
    sourceFile: string;
    url: string;
    adminTokenEnv: string;
    adminToken: string;
    dryRun: boolean;
    confirmImport: boolean;
    allowLocal: boolean;
  };
  importHostedProofBundle: (options: {
    bundleDir?: string;
    sourceFile?: string;
    url?: string;
    adminTokenEnv?: string;
    adminToken?: string;
    timeoutMs?: number;
    ownerNote?: string;
    dryRun?: boolean;
    confirmImport?: boolean;
    allowLocal?: boolean;
  }) => Promise<{
    status: string;
    sourceUrl: string;
    requestFile: string;
    responseFile: string | null;
    writeAuth: {
      configured: boolean;
      tokenEnv: string;
      headerName: string;
    };
    response: {
      httpStatus: number;
      importStatus: string;
      artifactCount: number;
    };
  }>;
}

const tempDirs: string[] = [];

describe("hosted proof bundle Evidence Vault importer", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("parses private token env names while rejecting raw token args", async () => {
    const { parseArgs } = await loadImporter();
    vi.stubEnv("SENTINEL_OPERATOR_TOKEN", "private-admin-token");

    const args = parseArgs([
      "--bundle-dir",
      "/tmp/sentinel-proof/release-1",
      "--url=https://sentinel.example.com",
      "--admin-token-env",
      "SENTINEL_OPERATOR_TOKEN",
      "--confirm-import"
    ]);

    expect(args.bundleDir).toBe("/tmp/sentinel-proof/release-1");
    expect(args.sourceFile).toBe("/tmp/sentinel-proof/release-1/verify-production.json");
    expect(args.url).toBe("https://sentinel.example.com");
    expect(args.adminTokenEnv).toBe("SENTINEL_OPERATOR_TOKEN");
    expect(args.adminToken).toBe("private-admin-token");
    expect(args.confirmImport).toBe(true);
    expect(() => parseArgs(["--admin-token", "secret"])).toThrow(/Raw token CLI args/u);
    expect(() => parseArgs(["--token=secret"])).toThrow(/Raw token CLI args/u);
  });

  it("writes a redacted dry-run request without contacting the hosted app", async () => {
    const { importHostedProofBundle } = await loadImporter();
    const bundleDir = await makeBundle();
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const summary = await importHostedProofBundle({
      bundleDir,
      dryRun: true,
      adminTokenEnv: "SENTINEL_OPERATOR_TOKEN",
      adminToken: "private-admin-token"
    });
    const requestJson = await readFile(join(bundleDir, "evidence-vault-import-request.json"), "utf8");
    const summaryJson = await readFile(join(bundleDir, "evidence-vault-import-summary.json"), "utf8");

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(summary.status).toBe("dry-run");
    expect(summary.sourceUrl).toBe("https://sentinel.example.com");
    expect(summary.responseFile).toBeNull();
    expect(JSON.parse(requestJson)).toMatchObject({
      source: "verify-production",
      redacted: true,
      sourceUrl: "https://sentinel.example.com"
    });
    expect(`${requestJson}${summaryJson}`).not.toContain("private-admin-token");
  });

  it("posts the redacted request with the private admin header and stores a sanitized response", async () => {
    const { importHostedProofBundle, parseArgs } = await loadImporter();
    const bundleDir = await makeBundle();
    vi.stubEnv("SENTINEL_OPERATOR_TOKEN", "private-admin-token");
    const fetchImpl = vi.fn(async (...request: [string | URL | Request, RequestInit?]) => {
      void request;
      return new Response(
        JSON.stringify({
          ok: true,
          importResult: {
            status: "ready",
            artifactCount: 7,
            checksumSha256: "a".repeat(64)
          },
          artifacts: [{ id: "vault_gemini_usage_log", checksumSha256: "b".repeat(64) }],
          echoedAuthorization: "Bearer private-admin-token"
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchImpl);

    const args = parseArgs([
      "--bundle-dir",
      bundleDir,
      "--admin-token-env",
      "SENTINEL_OPERATOR_TOKEN",
      "--confirm-import"
    ]);
    const summary = await importHostedProofBundle(args);
    const [url, init] = fetchImpl.mock.calls[0];
    const responseJson = await readFile(join(bundleDir, "evidence-vault-import-response.json"), "utf8");
    const summaryJson = await readFile(join(bundleDir, "evidence-vault-import-summary.json"), "utf8");

    expect(String(url)).toBe("https://sentinel.example.com/api/evidence/vault/import");
    expect(init?.method).toBe("POST");
    expect(headerValue(init, "x-sentinel-admin-token")).toBe("private-admin-token");
    expect(summary.status).toBe("imported");
    expect(summary.response.artifactCount).toBe(7);
    expect(`${responseJson}${summaryJson}`).not.toContain("private-admin-token");
    expect(responseJson).not.toContain("Bearer");
    expect(responseJson).toContain("[REDACTED]");
  });

  it("rejects local, non-verifier, or unredacted source files before import", async () => {
    const { importHostedProofBundle } = await loadImporter();
    const localBundle = await makeBundle("http://127.0.0.1:3000");
    const invalidBundle = await makeBundle("https://sentinel.example.com", { results: undefined });
    const unsafeBundle = await makeBundle("https://sentinel.example.com", {
      results: [{ id: "workspace-bootstrap", status: "passed", detail: "Bearer should-not-leak-token-value" }]
    });

    await expect(importHostedProofBundle({ bundleDir: localBundle, dryRun: true })).rejects.toThrow(/hosted HTTPS URL/u);
    await expect(importHostedProofBundle({ bundleDir: invalidBundle, dryRun: true })).rejects.toThrow(/results array/u);
    await expect(importHostedProofBundle({ bundleDir: unsafeBundle, dryRun: true })).rejects.toThrow(/unredacted sensitive data/u);
    await expect(importHostedProofBundle({ bundleDir: localBundle, dryRun: true, allowLocal: true })).resolves.toMatchObject({
      status: "dry-run",
      sourceUrl: "http://127.0.0.1:3000"
    });
  });
});

async function loadImporter() {
  // @ts-expect-error The hosted proof importer is an executable ESM script without a TypeScript declaration file.
  return (await import("../scripts/import-hosted-proof-bundle.mjs")) as HostedProofImportModule;
}

async function makeBundle(baseUrl = "https://sentinel.example.com", overrides: Record<string, unknown> = {}) {
  const bundleDir = await mkdtemp(join(tmpdir(), "sentinel-import-"));
  tempDirs.push(bundleDir);
  await writeFile(
    join(bundleDir, "verify-production.json"),
    `${JSON.stringify({ ...verifyProductionReport(baseUrl), ...overrides }, null, 2)}\n`,
    "utf8"
  );
  return bundleDir;
}

function verifyProductionReport(baseUrl: string) {
  return {
    generatedAt: "2026-05-23T12:00:00.000Z",
    baseUrl,
    mode: "read-and-write-through",
    strict: true,
    summary: {
      total: 6,
      passedTransport: 6,
      failedTransport: 0,
      blockedOrNeedsReview: 0
    },
    results: [
      {
        id: "cloudrun-deployment-evidence",
        status: "passed",
        detail: "0 replacement finding(s); 0 blocker(s)."
      },
      {
        id: "gemini-proof-status",
        status: "passed",
        detail: "gemini-api on gemini-3.5-flash; token=[REDACTED] api_key=[REDACTED]"
      },
      {
        id: "persistence-write-through",
        status: "passed",
        detail: "Firestore, BigQuery, and Secret Manager write-through passed."
      }
    ]
  };
}

function headerValue(init: RequestInit | undefined, name: string) {
  const headers = init?.headers;
  if (!headers || headers instanceof Headers || Array.isArray(headers)) {
    return undefined;
  }

  return headers[name];
}
