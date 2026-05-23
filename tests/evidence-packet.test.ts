import { describe, expect, it } from "vitest";
import { buildAuditIntegritySummary } from "@/lib/audit-integrity";
import { buildEvidencePacket, buildSignedEvidencePacket } from "@/lib/evidence";
import { getDashboardSnapshot, getState, recordPilotEvidence, resetState } from "@/lib/store";

describe("evidence packet formats", () => {
  it("exports redacted markdown with consent and related-party boundaries", () => {
    resetState();
    recordPilotEvidence({
      customerAlias: "Private Finance Buyer",
      segment: "Accounting firm preparing for enterprise review",
      monthlyRevenueUsd: 299,
      activeUsers: 4,
      proofStatus: "financial-doc-ready",
      consentStatus: "private",
      invoiceReference: "invoice-private-456"
    });

    const packet = buildEvidencePacket({ redacted: true, format: "markdown" });

    expect(packet.filename).toBe("sentinel-judge-evidence.md");
    expect(packet.contentType).toContain("text/markdown");
    expect(packet.body).toContain("Consent And Related-Party Boundary");
    expect(packet.body).toContain("Financial Evidence Ledger");
    expect(packet.body).toContain("Private Evidence Vault");
    expect(packet.body).toContain("Arms-length pilots:");
    expect(packet.body).toContain("Audit chain valid: true");
    expect(packet.body).not.toContain("Private Finance Buyer");
    expect(packet.body).not.toContain("Accounting firm preparing");
    expect(packet.export.consentSummary.financialDocsReady).toBeGreaterThan(0);
    expect(packet.export.auditIntegrity.valid).toBe(true);
    expect(packet.export.auditIntegrity.headHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("exports CSV with monthly revenue, consent, operations, and redacted pilots", () => {
    resetState();

    const packet = buildEvidencePacket({ redacted: true, format: "csv" });

    expect(packet.filename).toBe("sentinel-judge-evidence.csv");
    expect(packet.contentType).toContain("text/csv");
    expect(packet.body.split("\n")[0]).toBe("section,metric,value,notes");
    expect(packet.body).toContain("revenue_by_month,May");
    expect(packet.body).toContain("financial_evidence_summary,mock-only");
    expect(packet.body).toContain("financial_evidence_item,pilot-invoice");
    expect(packet.body).toContain("evidence_vault_summary,missing");
    expect(packet.body).toContain("evidence_vault_item,pilot-invoice");
    expect(packet.body).toContain("consent,arms_length_pilots");
    expect(packet.body).toContain("operations,bytes_scanned_by_dlp");
    expect(packet.body).toContain("audit_integrity,valid,true");
    expect(packet.body).toContain("pilot,Redacted arms-length pilot");
    expect(packet.body).not.toContain("Redacted seed-stage CTO");
  });

  it("keeps JSON packet available for existing consumers", () => {
    resetState();

    const packet = buildEvidencePacket({ redacted: true, format: "json" });
    const parsed = JSON.parse(packet.body) as {
      redacted: boolean;
      consentSummary: { armsLengthPilots: number };
      financialEvidence: { summary: { "mock-only": number; missing: number } };
      evidenceVault: { summary: { "mock-only": number; missing: number } };
      auditEvents: Array<{ type: string; message: string }>;
      auditIntegrity: { valid: boolean; totalEvents: number };
    };

    expect(packet.filename).toBe("sentinel-judge-evidence.json");
    expect(parsed.redacted).toBe(true);
    expect(parsed.auditEvents[0].type).toBe("evidence_exported");
    expect(parsed.auditEvents[0].message).toContain("Redacted judge evidence export generated");
    expect(parsed.auditIntegrity.valid).toBe(true);
    expect(parsed.auditIntegrity.totalEvents).toBe(parsed.auditEvents.length);
    expect(parsed.consentSummary.armsLengthPilots).toBeGreaterThan(0);
    expect(parsed.financialEvidence.summary["mock-only"]).toBeGreaterThan(0);
    expect(parsed.financialEvidence.summary.missing).toBeGreaterThan(0);
    expect(parsed.evidenceVault.summary.missing).toBeGreaterThan(0);
  });

  it("detects tampering in the audit hash chain", () => {
    resetState();
    recordPilotEvidence({
      customerAlias: "Private Finance Buyer",
      segment: "Accounting firm preparing for enterprise review",
      monthlyRevenueUsd: 299,
      activeUsers: 4,
      proofStatus: "financial-doc-ready",
      consentStatus: "private"
    });

    const snapshot = getDashboardSnapshot();
    expect(buildAuditIntegritySummary(snapshot.auditEvents).valid).toBe(true);

    const tampered = snapshot.auditEvents.map((event, index) =>
      index === 0 ? { ...event, message: "Tampered message after export." } : event
    );
    const summary = buildAuditIntegritySummary(tampered);

    expect(summary.valid).toBe(false);
    expect(summary.invalidHashes).toBe(1);
    expect(summary.firstInvalidEventId).toBe(tampered[0].id);
  });

  it("backfills legacy unsealed audit rows with explicit migration metadata", () => {
    resetState();
    const state = getState();
    state.auditEvents.unshift({
      id: "legacy_unsealed_export",
      tenantId: state.tenant.id,
      actor: "system",
      type: "evidence_exported",
      message: "Legacy export generated before audit hash-chain rollout.",
      createdAt: "2026-05-22T00:00:00.000Z"
    });

    const packet = buildEvidencePacket({ redacted: false, format: "markdown" });
    const legacyEvent = packet.export.auditEvents.find((event) => event.id === "legacy_unsealed_export");

    expect(packet.export.auditIntegrity.valid).toBe(true);
    expect(packet.export.auditIntegrity.legacySealedEvents).toBeGreaterThanOrEqual(1);
    expect(packet.export.auditEvents.some((event) => event.type === "audit_integrity_backfilled")).toBe(true);
    expect(legacyEvent?.metadata?.integrityBackfilledAt).toBeTruthy();
    expect(packet.body).toContain("Legacy audit events sealed after migration:");
  });

  it("builds a print-ready sealed packet with a digest and production signing gaps", () => {
    resetState();

    const packet = buildSignedEvidencePacket({ redacted: true });

    expect(packet.filename).toBe("sentinel-judge-evidence-sealed.html");
    expect(packet.contentType).toContain("text/html");
    expect(packet.body).toContain("Integrity Seal");
    expect(packet.body).toContain(packet.seal.canonicalDigest);
    expect(packet.seal.status).toBe("unsigned-local");
    expect(packet.seal.algorithm).toBe("sha256");
    expect(packet.seal.canonicalDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(packet.sourcePacket.export.auditEvents[0].type).toBe("evidence_exported");
    expect(packet.sourcePacket.export.auditEvents[0].message).toContain("sealed judge evidence packet export generated");
    expect(packet.sourcePacket.export.auditIntegrity.valid).toBe(true);
    expect(packet.seal.productionGaps.join(" ")).toContain("SENTINEL_EVIDENCE_SIGNING_SECRET");
    expect(packet.body).not.toContain("Redacted seed-stage CTO");
  });
});
