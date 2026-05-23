import { describe, expect, it, beforeEach } from "vitest";
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

  it("keeps import packet language inside the claim guard boundary", () => {
    const result = buildEvidenceVaultImport({
      source: "verify-production",
      redacted: true,
      payload: hostedVerifyProductionReport
    });

    expect(scanClaimText({ artifact: "evidence-vault-import", text: JSON.stringify(result, null, 2) })).toEqual([]);
    expect(getDashboardSnapshot().readiness.evidenceVault.requiredArtifacts.length).toBeGreaterThan(0);
  });
});
