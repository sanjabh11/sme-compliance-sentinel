import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
    releaseId: string | null;
    releaseIntegrityStatus: string | null;
    proofFlagStatus: string | null;
    deploymentExecutionChecklistStatus: string | null;
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
const deploymentImportRequiredCommandIds = [
  "lint",
  "typecheck",
  "test",
  "build",
  "source-release",
  "provenance",
  "cloudrun-release-values",
  "cloudrun-render-handoff-verify",
  "cloudrun-render-values-audit",
  "cloudrun-render-evidence-verify",
  "cloudrun-render-manifest",
  "cloudrun-template-strict",
  "cloudrun-dry-run-preflight",
  "cloudrun-dry-run-packet-verify",
  "cloudrun-dry-run",
  "cloudrun-deploy",
  "cloudrun-describe",
  "cloudrun-deployment-transcript-collect",
  "hosted-readonly",
  "hosted-write-through",
  "hosted-evidence",
  "hosted-proof-bundle",
  "hosted-proof-import-dry-run"
];

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
    expect(summary.releaseId).toBe("release-1");
    expect(summary.releaseIntegrityStatus).toBe("passed");
    expect(summary.proofFlagStatus).toBe("passed");
    expect(summary.deploymentExecutionChecklistStatus).toBe("passed");
    expect(summary.sourceUrl).toBe("https://sentinel.example.com");
    expect(summary.responseFile).toBeNull();
    expect(JSON.parse(requestJson)).toMatchObject({
      source: "verify-production",
      redacted: true,
      sourceUrl: "https://sentinel.example.com"
    });
    expect(`${requestJson}${summaryJson}`).not.toContain("private-admin-token");
  });

  it("replaces existing dry-run import files without stale bytes or temp leftovers", async () => {
    const { importHostedProofBundle } = await loadImporter();
    const bundleDir = await makeBundle();
    const requestPath = join(bundleDir, "evidence-vault-import-request.json");
    const summaryPath = join(bundleDir, "evidence-vault-import-summary.json");

    await writeFile(requestPath, `{"source":"stale","padding":"${"x".repeat(1000)}"}\n`, "utf8");
    await writeFile(summaryPath, `{"status":"stale","padding":"${"y".repeat(1000)}"}\n`, "utf8");

    const summary = await importHostedProofBundle({
      bundleDir,
      dryRun: true,
      adminTokenEnv: "SENTINEL_OPERATOR_TOKEN",
      adminToken: "private-admin-token"
    });
    const requestJson = await readFile(requestPath, "utf8");
    const summaryJson = await readFile(summaryPath, "utf8");

    expect(summary.status).toBe("dry-run");
    expect(JSON.parse(requestJson)).toMatchObject({
      source: "verify-production",
      redacted: true,
      sourceUrl: "https://sentinel.example.com"
    });
    expect(JSON.parse(summaryJson)).toMatchObject({
      status: "dry-run",
      releaseId: "release-1"
    });
    expect(`${requestJson}${summaryJson}`).not.toContain("stale");
    expect(`${requestJson}${summaryJson}`).not.toContain("padding");
    expect((await readdir(bundleDir)).filter((path) => path.endsWith(".tmp"))).toEqual([]);
  });

  it("fails closed when an import output file is a symlink", async () => {
    const { importHostedProofBundle } = await loadImporter();
    const bundleDir = await makeBundle();
    const requestPath = join(bundleDir, "evidence-vault-import-request.json");
    const requestTargetPath = join(bundleDir, "reviewed-import-request.json");

    await writeFile(requestTargetPath, "unchanged-request\n", "utf8");
    await symlink(requestTargetPath, requestPath);

    await expect(
      importHostedProofBundle({
        bundleDir,
        dryRun: true,
        adminTokenEnv: "SENTINEL_OPERATOR_TOKEN",
        adminToken: "private-admin-token"
      })
    ).rejects.toThrow(/symbolic link/u);
    await expect(readFile(requestTargetPath, "utf8")).resolves.toBe("unchanged-request\n");
    expect((await readdir(bundleDir)).filter((path) => path.endsWith(".tmp"))).toEqual([]);
  });

  it("fails closed when the hosted proof bundle directory is a user-created symlink", async () => {
    const { importHostedProofBundle } = await loadImporter();
    const realBundleDir = await makeBundle();
    const tempDir = await mkdtemp(join(tmpdir(), "sentinel-import-linked-parent-"));
    const linkedBundleDir = join(tempDir, "linked-bundle");
    tempDirs.push(tempDir);

    await symlink(realBundleDir, linkedBundleDir, "dir");

    await expect(
      importHostedProofBundle({
        bundleDir: linkedBundleDir,
        dryRun: true,
        adminTokenEnv: "SENTINEL_OPERATOR_TOKEN",
        adminToken: "private-admin-token"
      })
    ).rejects.toThrow(/symbolic link/u);
    await expect(readFile(join(realBundleDir, "evidence-vault-import-request.json"), "utf8")).rejects.toThrow();
    expect((await readdir(realBundleDir)).filter((path) => path.endsWith(".tmp"))).toEqual([]);
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

  it("rejects hosted bundles when release metadata is missing or inconsistent", async () => {
    const { importHostedProofBundle } = await loadImporter();
    const missingMetadataDir = await mkdtemp(join(tmpdir(), "sentinel-import-missing-"));
    tempDirs.push(missingMetadataDir);
    await writeFile(
      join(missingMetadataDir, "verify-production.json"),
      `${JSON.stringify(verifyProductionReport("https://sentinel.example.com"), null, 2)}\n`,
      "utf8"
    );
    const mismatchedBundle = await makeBundle("https://sentinel.example.com", {}, { manifestReleaseId: "release-2" });
    const blockedIntegrityBundle = await makeBundle("https://sentinel.example.com", {}, { releaseIntegrityStatus: "blocked" });

    await expect(importHostedProofBundle({ bundleDir: missingMetadataDir, dryRun: true })).rejects.toThrow(
      /missing manifest\.json/u
    );
    await expect(importHostedProofBundle({ bundleDir: mismatchedBundle, dryRun: true })).rejects.toThrow(
      /Release consistency check failed/u
    );
    await expect(importHostedProofBundle({ bundleDir: blockedIntegrityBundle, dryRun: true })).rejects.toThrow(
      /Release integrity check failed/u
    );
  });

  it("rejects final imports when claimed XPRIZE proof flags lack matching bundle evidence", async () => {
    const { importHostedProofBundle } = await loadImporter();
    const blockedProofFlagBundle = await makeBundle("https://sentinel.example.com", {}, {
      proofFlagStatus: "blocked",
      proofFlagChecks: [
        {
          envName: "XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED",
          status: "blocked",
          detail: "Hosted launch readiness claims Gemini proof, but provider=gemini-api evidence is missing."
        }
      ]
    });
    const reviewProofFlagBundle = await makeBundle("https://sentinel.example.com", {}, {
      proofFlagStatus: "needs-review",
      proofFlagChecks: [
        {
          envName: "XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED",
          status: "needs-review",
          detail: "launch-readiness.json did not include this env flag."
        }
      ]
    });

    await expect(importHostedProofBundle({ bundleDir: blockedProofFlagBundle, dryRun: true })).rejects.toThrow(
      /XPRIZE proof flag check failed/u
    );
    await expect(importHostedProofBundle({ bundleDir: reviewProofFlagBundle, dryRun: true })).rejects.toThrow(
      /XPRIZE proof flag check failed/u
    );
  });

  it("rejects final hosted proof import until the deployment execution checklist passes", async () => {
    const { importHostedProofBundle } = await loadImporter();
    const missingChecklistBundle = await makeBundle("https://sentinel.example.com", {}, { includeExecutionChecklist: false });
    const blockedChecklistBundle = await makeBundle("https://sentinel.example.com", {}, { executionChecklistStatus: "blocked" });
    const missingTemplateLineageBundle = await makeBundle("https://sentinel.example.com", {}, { includeResultsTemplateLineage: false });

    await expect(
      importHostedProofBundle({
        bundleDir: missingChecklistBundle,
        confirmImport: true,
        adminToken: "private-admin-token"
      })
    ).rejects.toThrow(/deployment-execution-checklist\.json/u);
    await expect(
      importHostedProofBundle({
        bundleDir: blockedChecklistBundle,
        confirmImport: true,
        adminToken: "private-admin-token"
      })
    ).rejects.toThrow(/Deployment execution checklist is blocked/u);
    await expect(
      importHostedProofBundle({
        bundleDir: missingTemplateLineageBundle,
        confirmImport: true,
        adminToken: "private-admin-token"
      })
    ).rejects.toThrow(/command-results template lineage/u);
  });

  it("rejects hosted proof import when the execution checklist contains stale release evidence", async () => {
    const { importHostedProofBundle } = await loadImporter();
    const staleChecklistBundle = await makeBundle("https://sentinel.example.com");
    const checklistPath = join(staleChecklistBundle, "deployment-execution-checklist.json");
    const checklist = JSON.parse(await readFile(checklistPath, "utf8"));
    checklist.entries[0] = {
      ...checklist.entries[0],
      resultReleaseId: "release-old",
      evidenceSha256: "not-a-sha"
    };
    await writeFile(checklistPath, `${JSON.stringify(checklist, null, 2)}\n`, "utf8");

    await expect(
      importHostedProofBundle({
        bundleDir: staleChecklistBundle,
        confirmImport: true,
        adminToken: "private-admin-token"
      })
    ).rejects.toThrow(/incomplete or stale entries/u);
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

async function makeBundle(
  baseUrl = "https://sentinel.example.com",
  overrides: Record<string, unknown> = {},
  metadataOverrides: {
    manifestReleaseId?: string;
    releaseEvidenceReleaseId?: string;
    releaseIntegrityStatus?: string;
    proofFlagStatus?: string;
    proofFlagChecks?: Array<Record<string, unknown>>;
    includeExecutionChecklist?: boolean;
    executionChecklistStatus?: string;
    includeResultsTemplateLineage?: boolean;
    resultsTemplateStatus?: string;
  } = {}
) {
  const bundleDir = await mkdtemp(join(tmpdir(), "sentinel-import-"));
  const releaseId = "release-1";
  const manifestReleaseId = metadataOverrides.manifestReleaseId ?? releaseId;
  const releaseEvidenceReleaseId = metadataOverrides.releaseEvidenceReleaseId ?? releaseId;
  const releaseIntegrityStatus = metadataOverrides.releaseIntegrityStatus ?? "passed";
  const proofFlagStatus = metadataOverrides.proofFlagStatus ?? "passed";
  const executionChecklistStatus = metadataOverrides.executionChecklistStatus ?? "passed";
  const resultsTemplateStatus = metadataOverrides.resultsTemplateStatus ?? "passed";
  const proofFlagChecks = metadataOverrides.proofFlagChecks ?? [
    {
      envName: "XPRIZE_REPOSITORY_ACCESS_CONFIGURED",
      status: "passed",
      detail: "Repository proof flag cross-check passed."
    }
  ];
  tempDirs.push(bundleDir);
  await writeFile(
    join(bundleDir, "verify-production.json"),
    `${JSON.stringify({ ...verifyProductionReport(baseUrl), ...overrides }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    join(bundleDir, "manifest.json"),
    `${JSON.stringify(
      {
        generatedAt: "2026-05-23T12:00:00.000Z",
        releaseId: manifestReleaseId,
        baseUrl,
        releaseIntegrity: { status: releaseIntegrityStatus }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(bundleDir, "release-evidence-manifest.json"),
    `${JSON.stringify(
      {
        generatedAt: "2026-05-23T12:00:00.000Z",
        releaseId: releaseEvidenceReleaseId,
        baseUrl,
        releaseIntegrity: { status: releaseIntegrityStatus },
        overallStatus: releaseIntegrityStatus === "passed" && proofFlagStatus !== "blocked" ? "ready-for-private-review" : "blocked",
        proofFlagStatus,
        proofFlagChecks
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  if (metadataOverrides.includeExecutionChecklist !== false) {
    await writeFile(
      join(bundleDir, "deployment-execution-checklist.json"),
      `${JSON.stringify(
        {
          generatedAt: "2026-05-23T12:00:00.000Z",
          releaseId,
          sourceUrl: baseUrl,
          overallStatus: executionChecklistStatus,
          ...(metadataOverrides.includeResultsTemplateLineage === false
            ? {}
            : {
                resultsTemplate: {
                  status: resultsTemplateStatus,
                  generatedAt: "2026-05-23T12:00:30.000Z",
                  releaseId,
                  sourceUrl: baseUrl,
                  entryCount: deploymentImportRequiredCommandIds.length,
                  expectedCommandCount: deploymentImportRequiredCommandIds.length,
                  blockers: resultsTemplateStatus === "passed" ? [] : ["Results template lineage is blocked."]
                }
              }),
          entries: deploymentImportRequiredCommandIds.map((commandId) => ({
            commandId,
            releaseId,
            sourceUrl: baseUrl,
            resultReleaseId: releaseId,
            resultSourceUrl: baseUrl,
            status: executionChecklistStatus === "passed" ? "passed" : "blocked",
            recordedAt: "2026-05-23T12:01:00.000Z",
            expectedArtifactPath: `gs://private/releases/${releaseId}/${commandId}.json`,
            evidencePath: `gs://private/releases/${releaseId}/${commandId}.json`,
            evidenceSha256: "a".repeat(64)
          }))
        },
        null,
        2
      )}\n`,
      "utf8"
    );
  }
  return bundleDir;
}

function verifyProductionReport(baseUrl: string) {
  return {
    generatedAt: "2026-05-23T12:00:00.000Z",
    baseUrl,
    releaseId: "release-1",
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
