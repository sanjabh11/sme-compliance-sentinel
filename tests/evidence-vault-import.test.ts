import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postEvidenceVaultImport } from "@/app/api/evidence/vault/import/route";
import { scanClaimText } from "@/lib/claim-guard";
import { buildEvidenceVaultImport } from "@/lib/evidence-vault-import";
import { getDashboardSnapshot, importEvidenceVaultArtifacts, resetState } from "@/lib/store";

const hostedVerifyProductionReport = {
  generatedAt: "2026-05-23T12:00:00.000Z",
  baseUrl: "https://sme-workspace-sentinel-abc-uc.a.run.app",
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
      status: "ready-to-dry-run",
      detail: "0 replacement finding(s); 0 blocker(s)."
    },
    {
      id: "gemini-proof-status",
      status: "passed",
      detail: "gemini-api on gemini-3.5-flash; token=[redacted] api_key=[redacted]"
    },
    {
      id: "persistence-write-through",
      status: "passed",
      detail: "Firestore, BigQuery, and Secret Manager write-through passed."
    },
    {
      id: "workspace-bootstrap",
      status: "passed",
      detail: "Drive and Gmail watches initialized; Bearer should-not-leak-token-value"
    },
    {
      id: "cost-controls-write-through",
      status: "passed",
      detail: "Cloud Billing budget and Gemini key restrictions verified."
    },
    {
      id: "source-release",
      status: "published",
      detail: "Source release guard passed."
    }
  ]
};

describe("Evidence Vault hosted proof import", () => {
  beforeEach(() => {
    resetState();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds checksummed artifact candidates from hosted verify-production JSON", () => {
    const result = buildEvidenceVaultImport({
      source: "verify-production",
      redacted: true,
      payload: hostedVerifyProductionReport,
      ownerNote: "Operator reviewed hosted smoke output."
    });

    expect(result.status).toBe("ready");
    expect(result.checksumSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.candidates.map((candidate) => candidate.artifactId)).toEqual(
      expect.arrayContaining([
        "vault_production_readiness_report",
        "vault_cloud_run_deployment_proof",
        "vault_gemini_usage_log",
        "vault_gcp_persistence_proof",
        "vault_workspace_oauth_log",
        "vault_cloud_billing_proof",
        "vault_repository_proof"
      ])
    );
    expect(result.candidates.every((candidate) => candidate.status === "verified")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("should-not-leak-token-value");
    expect(JSON.stringify(result)).not.toContain("Bearer");
  });

  it("keeps local or unredacted imports out of verified production proof", () => {
    const result = buildEvidenceVaultImport({
      source: "verify-production",
      redacted: false,
      payload: {
        ...hostedVerifyProductionReport,
        baseUrl: "http://127.0.0.1:3000"
      }
    });

    expect(result.status).toBe("needs-redaction");
    expect(result.blockers.join(" ")).toContain("redacted");
    expect(result.candidates.every((candidate) => candidate.status === "needs-redaction")).toBe(true);

    const redactedLocal = buildEvidenceVaultImport({
      source: "verify-production",
      redacted: true,
      payload: {
        ...hostedVerifyProductionReport,
        baseUrl: "http://127.0.0.1:3000"
      }
    });
    expect(redactedLocal.warnings.join(" ")).toContain("not a hosted HTTPS URL");
    expect(redactedLocal.candidates.every((candidate) => candidate.status === "mock-only")).toBe(true);
  });

  it("registers imported candidates into expected Evidence Vault artifact slots", () => {
    const { importResult, artifacts, snapshot } = importEvidenceVaultArtifacts({
      source: "verify-production",
      redacted: true,
      payload: hostedVerifyProductionReport
    });

    expect(importResult.artifactCount).toBeGreaterThanOrEqual(6);
    expect(artifacts.map((artifact) => artifact.id)).toContain("vault_gemini_usage_log");
    expect(artifacts.find((artifact) => artifact.id === "vault_gemini_usage_log")?.checksumSha256).toMatch(/^[a-f0-9]{64}$/u);

    const vault = snapshot.readiness.evidenceVault;
    expect(vault.requiredArtifacts.find((artifact) => artifact.id === "vault_gemini_usage_log")?.status).toBe("verified");
    expect(vault.requiredArtifacts.find((artifact) => artifact.id === "vault_gcp_persistence_proof")?.status).toBe("verified");
    expect(snapshot.auditEvents.some((event) => event.type === "evidence_vault_artifact_registered")).toBe(true);
  });

  it("maps Workspace watch renewal verification into the Workspace OAuth evidence slot", () => {
    const result = buildEvidenceVaultImport({
      source: "verify-production",
      redacted: true,
      payload: {
        ...hostedVerifyProductionReport,
        summary: {
          total: 1,
          passedTransport: 1,
          failedTransport: 0,
          blockedOrNeedsReview: 0
        },
        results: [
          {
            id: "workspace-watch-renewal",
            status: "passed",
            detail: "Drive and Gmail channels renewed before expiration."
          }
        ]
      }
    });

    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactId: "vault_workspace_oauth_log",
          kind: "workspace-oauth-log",
          label: "Workspace watch renewal row",
          status: "verified"
        })
      ])
    );
  });

  it("registers reviewed Cloud Run deployment transcript proof as verified hosted evidence", () => {
    const result = buildEvidenceVaultImport({
      source: "cloudrun-deployment",
      redacted: true,
      sourceUrl: "https://sme-workspace-sentinel-abc-uc.a.run.app",
      payload: {
        generatedAt: "2026-05-27T10:00:00.000Z",
        status: "ready-for-hosted-verification",
        releaseId: "release-20260527-abc123",
        checks: [
          {
            id: "service-url-present",
            status: "passed",
            evidence: "https://sme-workspace-sentinel-abc-uc.a.run.app"
          },
          {
            id: "revision-present",
            status: "passed",
            evidence: "sme-workspace-sentinel-00011-87l"
          }
        ],
        blockers: []
      }
    });

    expect(result.status).toBe("ready");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      artifactId: "vault_cloud_run_deployment_proof",
      kind: "cloud-run-proof",
      status: "verified"
    });
  });

  it("does not downgrade verified Cloud Run proof when a later hosted report still has template rows", () => {
    const cloudRunImport = importEvidenceVaultArtifacts({
      source: "cloudrun-deployment",
      redacted: true,
      sourceUrl: "https://sme-workspace-sentinel-abc-uc.a.run.app",
      payload: {
        generatedAt: "2026-05-27T10:00:00.000Z",
        status: "ready-for-hosted-verification",
        releaseId: "release-20260527-abc123",
        blockers: []
      }
    });
    const verifiedCloudRunArtifact = cloudRunImport.snapshot.readiness.evidenceVault.requiredArtifacts.find(
      (artifact) => artifact.id === "vault_cloud_run_deployment_proof"
    );

    expect(verifiedCloudRunArtifact?.status).toBe("verified");
    expect(verifiedCloudRunArtifact?.checksumSha256).toMatch(/^[a-f0-9]{64}$/u);

    const laterHostedReport = {
      ...hostedVerifyProductionReport,
      summary: {
        total: 1,
        passedTransport: 1,
        failedTransport: 0,
        blockedOrNeedsReview: 1
      },
      results: [
        {
          id: "cloudrun-deployment-evidence",
          status: "template-needs-values",
          detail: "Template still reports placeholder rows in a broader hosted verifier."
        }
      ]
    };

    const hostedReportImport = importEvidenceVaultArtifacts({
      source: "verify-production",
      redacted: true,
      payload: laterHostedReport
    });
    const preservedCloudRunArtifact = hostedReportImport.snapshot.readiness.evidenceVault.requiredArtifacts.find(
      (artifact) => artifact.id === "vault_cloud_run_deployment_proof"
    );

    expect(preservedCloudRunArtifact).toMatchObject({
      status: "verified",
      checksumSha256: verifiedCloudRunArtifact?.checksumSha256
    });
  });

  it("keeps import packet language inside the claim guard boundary", () => {
    const result = buildEvidenceVaultImport({
      source: "verify-production",
      redacted: true,
      payload: hostedVerifyProductionReport
    });

    expect(scanClaimText({ artifact: "evidence-vault-import", text: JSON.stringify(result, null, 2) })).toEqual([]);
    expect(getDashboardSnapshot().readiness.evidenceVault.requiredArtifacts.length).toBeGreaterThan(0);
  });

  it("requires the admin action token on the production import route", async () => {
    vi.stubEnv("SENTINEL_MOCK_MODE", "false");
    vi.stubEnv("SENTINEL_ADMIN_ACTION_TOKEN", "private-admin-token");

    const blockedResponse = await postEvidenceVaultImport(importRequest());
    expect(blockedResponse.status).toBe(401);
    expect(await blockedResponse.json()).toMatchObject({ ok: false });

    const wrongTokenResponse = await postEvidenceVaultImport(importRequest("wrong-token"));
    expect(wrongTokenResponse.status).toBe(403);

    const allowedResponse = await postEvidenceVaultImport(importRequest("private-admin-token"));
    expect(allowedResponse.status).toBe(200);
    const payload = (await allowedResponse.json()) as { importResult: { status: string; artifactCount: number } };
    expect(payload.importResult.status).toBe("ready");
    expect(payload.importResult.artifactCount).toBeGreaterThan(0);
  });
});

function importRequest(token?: string) {
  return new Request("https://sentinel.example.com/api/evidence/vault/import", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-sentinel-admin-token": token } : {})
    },
    body: JSON.stringify({
      source: "verify-production",
      redacted: true,
      payload: hostedVerifyProductionReport
    })
  });
}
