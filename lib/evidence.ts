import { createHash, createHmac } from "node:crypto";
import { getDashboardSnapshot, writeAudit } from "@/lib/store";
import { sentinelConfig } from "@/lib/config";
import { buildAuditIntegritySummary } from "@/lib/audit-integrity";
import type {
  AuditEvent,
  EvidenceConsentSummary,
  EvidenceExport,
  EvidenceIntegritySeal,
  EvidencePacket,
  EvidencePacketFormat,
  EvidenceVault,
  FinancialEvidenceLedger,
  FindingStatus,
  PilotCustomerRecord,
  Severity,
  SignedEvidencePacket,
  Testimonial
} from "@/lib/types";

const severities: Severity[] = ["critical", "high", "medium", "low", "info"];
const statuses: FindingStatus[] = [
  "recommended",
  "approved",
  "remediated",
  "dismissed",
  "false_positive",
  "rescanning"
];

export function buildEvidenceExport({ redacted, auditMessage }: { redacted: boolean; auditMessage?: string }): EvidenceExport {
  writeAudit(
    "system",
    "evidence_exported",
    auditMessage ?? (redacted ? "Redacted judge evidence export generated." : "Private admin evidence export generated.")
  );
  const snapshot = getDashboardSnapshot();
  const findingsBySeverity = countBy(severities, snapshot.findings.map((finding) => finding.severity));
  const findingsByStatus = countBy(statuses, snapshot.findings.map((finding) => finding.status));
  const falsePositives = findingsByStatus.false_positive;
  const falsePositiveRate = snapshot.findings.length === 0 ? 0 : Number((falsePositives / snapshot.findings.length).toFixed(3));
  const publicExposuresClosed = snapshot.remediations.filter(
    (remediation) => remediation.action === "disable_public_sharing" && remediation.outcome !== "failed"
  ).length;

  const consentSummary = buildConsentSummary(snapshot.pilotRecords);

  return {
    generatedAt: new Date().toISOString(),
    redacted,
    consentSummary,
    tenant: {
      id: snapshot.tenant.id,
      name: redacted ? "Redacted pilot tenant" : snapshot.tenant.name,
      category: snapshot.tenant.category,
      positioning: snapshot.tenant.positioning
    },
    businessEvidence: {
      ...snapshot.tenant.evidence,
      testimonials: redactTestimonials(snapshot.tenant.evidence.testimonials, redacted)
    },
    financialEvidence: redactFinancialEvidence(snapshot.readiness.financialEvidence, redacted),
    evidenceVault: redactEvidenceVault(snapshot.readiness.evidenceVault, redacted),
    aggregateCounters: snapshot.aggregateCounters,
    findingsBySeverity,
    findingsByStatus,
    remediationsApproved: snapshot.remediations.length,
    publicExposuresClosed,
    falsePositiveRate,
    pilotRecords: redactPilotRecords(snapshot.pilotRecords, redacted),
    agentRuns: snapshot.agentRuns.map((run) =>
      redacted
        ? {
            ...run,
            promptSummary: redactText(run.promptSummary),
            outputSummary: redactText(run.outputSummary)
          }
        : run
    ),
    auditEvents: snapshot.auditEvents.map((event) => (redacted ? redactAuditEventRecord(event) : event)),
    auditIntegrity: buildAuditIntegritySummary(snapshot.auditEvents),
    testimonials: redactTestimonials(snapshot.tenant.evidence.testimonials, redacted),
    strategy: snapshot.strategy,
    answerLibrarySummary: snapshot.readiness.answerLibrary,
    trustAccessSummary: snapshot.readiness.trustAccess
  };
}

export function buildEvidencePacket(input: { redacted: boolean; format?: EvidencePacketFormat; auditMessage?: string }): EvidencePacket {
  const format = input.format ?? "json";
  const exportData = buildEvidenceExport({ redacted: input.redacted, auditMessage: input.auditMessage });
  const filename = `sentinel-${input.redacted ? "judge" : "private"}-evidence.${format === "markdown" ? "md" : format}`;

  if (format === "markdown") {
    return {
      generatedAt: exportData.generatedAt,
      format,
      redacted: input.redacted,
      filename,
      contentType: "text/markdown; charset=utf-8",
      body: buildMarkdownPacket(exportData),
      export: exportData
    };
  }

  if (format === "csv") {
    return {
      generatedAt: exportData.generatedAt,
      format,
      redacted: input.redacted,
      filename,
      contentType: "text/csv; charset=utf-8",
      body: buildCsvPacket(exportData),
      export: exportData
    };
  }

  return {
    generatedAt: exportData.generatedAt,
    format: "json",
    redacted: input.redacted,
    filename,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(exportData, null, 2),
    export: exportData
  };
}

export function buildSignedEvidencePacket(input: { redacted: boolean }): SignedEvidencePacket {
  const sourcePacket = buildEvidencePacket({
    redacted: input.redacted,
    format: "markdown",
    auditMessage: input.redacted
      ? "Redacted sealed judge evidence packet export generated."
      : "Private sealed evidence packet export generated."
  });
  const canonicalBody = JSON.stringify(sourcePacket.export);
  const seal = buildEvidenceSeal(canonicalBody);
  const body = buildPrintableSignedPacket(sourcePacket, seal);

  return {
    generatedAt: sourcePacket.generatedAt,
    redacted: input.redacted,
    filename: `sentinel-${input.redacted ? "judge" : "private"}-evidence-sealed.html`,
    contentType: "text/html; charset=utf-8",
    body,
    sourcePacket,
    seal
  };
}

function redactPilotRecords(pilotRecords: PilotCustomerRecord[], redacted: boolean): PilotCustomerRecord[] {
  return pilotRecords
    .filter((pilot) => !redacted || (pilot.armsLength && !pilot.relatedParty))
    .map((pilot, index) =>
      redacted
        ? {
            ...pilot,
            customerAlias: `Redacted arms-length pilot ${index + 1}`,
            segment: "Redacted customer segment",
            invoiceReference: pilot.invoiceReference ? "Available in private admin evidence room" : undefined,
            testimonialQuote: pilot.consentStatus === "consented" ? pilot.testimonialQuote : undefined,
            notes: undefined
          }
        : pilot
    );
}

function buildConsentSummary(pilotRecords: PilotCustomerRecord[]): EvidenceConsentSummary {
  return {
    armsLengthPilots: pilotRecords.filter((pilot) => pilot.armsLength && !pilot.relatedParty).length,
    relatedPartyPilots: pilotRecords.filter((pilot) => pilot.relatedParty).length,
    privatePilots: pilotRecords.filter((pilot) => pilot.consentStatus === "private").length,
    consentedTestimonials: pilotRecords.filter((pilot) => pilot.consentStatus === "consented" && pilot.testimonialQuote).length,
    pendingConsent: pilotRecords.filter((pilot) => pilot.consentStatus === "pending").length,
    financialDocsReady: pilotRecords.filter((pilot) => pilot.proofStatus === "financial-doc-ready").length
  };
}

function redactAuditEventRecord(event: AuditEvent): AuditEvent {
  return {
    id: event.id,
    tenantId: event.tenantId,
    actor: event.actor,
    type: event.type,
    targetId: event.targetId,
    message: redactAuditMessage(event),
    createdAt: event.createdAt,
    metadata: event.metadata ? { redacted: true } : undefined
  };
}

function buildMarkdownPacket(packet: EvidenceExport) {
  const lines = [
    `# SME Workspace Sentinel Evidence Packet`,
    "",
    `Generated: ${packet.generatedAt}`,
    `Redacted: ${packet.redacted}`,
    `Category: ${packet.tenant.category}`,
    "",
    "Boundary: SOC2 readiness evidence and risk detection only. This packet is not a certification, legal conclusion, or auditor opinion.",
    "",
    "## Business Evidence",
    `MRR: $${packet.businessEvidence.mrrUsd}`,
    `Pilot count: ${packet.businessEvidence.pilotCount}`,
    `Active users: ${packet.businessEvidence.activeUsers}`,
    `Revenue by month: ${Object.entries(packet.businessEvidence.revenueByMonth)
      .map(([month, amount]) => `${month} $${amount}`)
      .join("; ")}`,
    `Total costs: $${packet.businessEvidence.totalCostsUsd}`,
    `Customer acquisition spend: $${packet.businessEvidence.customerAcquisitionSpendUsd}`,
    `Financial evidence summary: verified ${packet.financialEvidence.summary.verified}; private-on-request ${packet.financialEvidence.summary["private-on-request"]}; missing ${packet.financialEvidence.summary.missing}; mock-only ${packet.financialEvidence.summary["mock-only"]}`,
    `Evidence Vault summary: verified ${packet.evidenceVault.summary.verified}; uploaded ${packet.evidenceVault.summary.uploaded}; requested ${packet.evidenceVault.summary.requested}; missing ${packet.evidenceVault.summary.missing}; needs redaction ${packet.evidenceVault.summary["needs-redaction"]}; mock-only ${packet.evidenceVault.summary["mock-only"]}`,
    "",
    "## Financial Evidence Ledger",
    ...packet.financialEvidence.items
      .slice(0, 12)
      .map((item) => `- ${item.label}: ${item.status}; ${item.kind}; ${item.fix}`),
    "",
    "## Private Evidence Vault",
    ...packet.evidenceVault.requiredArtifacts
      .slice(0, 15)
      .map((artifact) => `- ${artifact.label}: ${artifact.status}; owner ${artifact.ownerRole}; ${artifact.nextAction}`),
    "",
    "## Consent And Related-Party Boundary",
    `Arms-length pilots: ${packet.consentSummary.armsLengthPilots}`,
    `Related-party pilots: ${packet.consentSummary.relatedPartyPilots}`,
    `Private pilots: ${packet.consentSummary.privatePilots}`,
    `Consented testimonials: ${packet.consentSummary.consentedTestimonials}`,
    `Pending consent: ${packet.consentSummary.pendingConsent}`,
    `Financial docs ready: ${packet.consentSummary.financialDocsReady}`,
    "",
    "## Risk And Operations",
    `Files inspected: ${packet.aggregateCounters.filesInspected}`,
    `Bytes extracted: ${packet.aggregateCounters.bytesExtracted}`,
    `Bytes scanned by DLP: ${packet.aggregateCounters.bytesScannedByDlp}`,
    `Bytes routed to Gemini: ${packet.aggregateCounters.bytesRoutedToGemini}`,
    `Remediations approved: ${packet.remediationsApproved}`,
    `Public exposures closed: ${packet.publicExposuresClosed}`,
    `False-positive rate: ${packet.falsePositiveRate}`,
    `Audit chain valid: ${packet.auditIntegrity.valid}`,
    `Audit chain head: ${packet.auditIntegrity.headHash ?? "missing"}`,
    `Audit chain sealed events: ${packet.auditIntegrity.sealedEvents}/${packet.auditIntegrity.totalEvents}`,
    `Legacy audit events sealed after migration: ${packet.auditIntegrity.legacySealedEvents}`,
    "",
    "## Agent Runs",
    ...packet.agentRuns.slice(0, 10).map((run) => `- ${run.completedAt}: ${run.provider} ${run.model} for ${run.purpose}; cost $${run.estimatedCostUsd}`),
    packet.agentRuns.length ? "" : "- No agent runs recorded in this packet.",
    "",
    "## Pilot Records",
    ...packet.pilotRecords.map(
      (pilot) =>
        `- ${pilot.customerAlias}: ${pilot.armsLength && !pilot.relatedParty ? "arms-length" : "related/other"}; proof ${pilot.proofStatus}; consent ${pilot.consentStatus}; $${pilot.monthlyRevenueUsd}/mo`
    ),
    "",
    "## Testimonials",
    ...packet.testimonials.map((testimonial) => `- ${testimonial.customerName}: ${testimonial.quote}`)
  ];

  return `${lines.join("\n")}\n`;
}

function buildPrintableSignedPacket(packet: EvidencePacket, seal: EvidenceIntegritySeal) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>SME Workspace Sentinel Evidence Packet</title>
  <style>
    body { color: #17302b; font-family: Arial, sans-serif; line-height: 1.55; margin: 32px; }
    h1, h2 { color: #0f2c27; }
    code, pre { background: #f4f7f6; border: 1px solid #dce6e2; border-radius: 6px; padding: 3px 5px; }
    pre { overflow-wrap: anywhere; white-space: pre-wrap; }
    .seal { border: 2px solid #1b6b58; border-radius: 8px; margin: 20px 0; padding: 16px; }
    .warning { background: #fffaf0; border: 1px solid #f0dca6; border-radius: 8px; padding: 12px; }
    @media print { body { margin: 18mm; } button { display: none; } }
  </style>
</head>
<body>
  <h1>SME Workspace Sentinel Evidence Packet</h1>
  <p><strong>Generated:</strong> ${escapeHtml(packet.generatedAt)}</p>
  <p><strong>Redacted:</strong> ${packet.redacted}</p>
  <p><strong>Boundary:</strong> SOC2 readiness evidence and risk detection only. This is not certification, legal advice, audit assurance, or guaranteed compliance.</p>
  <section class="seal">
    <h2>Integrity Seal</h2>
    <p><strong>Status:</strong> ${escapeHtml(seal.status)}</p>
    <p><strong>Algorithm:</strong> ${escapeHtml(seal.algorithm)}</p>
    <p><strong>Canonical digest:</strong> <code>${escapeHtml(seal.canonicalDigest)}</code></p>
    ${seal.signature ? `<p><strong>Signature:</strong> <code>${escapeHtml(seal.signature)}</code></p>` : ""}
    <p><strong>Signer:</strong> ${escapeHtml(seal.signer)}</p>
    <p><strong>Signed at:</strong> ${escapeHtml(seal.signedAt)}</p>
  </section>
  ${
    seal.productionGaps.length
      ? `<section class="warning"><h2>Production Gaps</h2><ul>${seal.productionGaps
          .map((gap) => `<li>${escapeHtml(gap)}</li>`)
          .join("")}</ul></section>`
      : ""
  }
  <section>
    <h2>Verification Instructions</h2>
    <ol>${seal.verificationInstructions.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
  </section>
  <section>
    <h2>Packet Body</h2>
    <pre>${escapeHtml(packet.body)}</pre>
  </section>
</body>
</html>`;
}

function buildEvidenceSeal(canonicalBody: string): EvidenceIntegritySeal {
  const canonicalDigest = createHash("sha256").update(canonicalBody).digest("hex");
  const signedAt = new Date().toISOString();
  const hasSigningSecret = sentinelConfig.evidenceSigningSecretConfigured && sentinelConfig.evidenceSigningSecret.length > 0;
  const signature = hasSigningSecret
    ? createHmac("sha256", sentinelConfig.evidenceSigningSecret).update(canonicalDigest).digest("hex")
    : undefined;

  return {
    status: signature ? "signed" : "unsigned-local",
    algorithm: signature ? "hmac-sha256" : "sha256",
    canonicalDigest,
    signature,
    signedAt,
    signer: signature ? "SENTINEL_EVIDENCE_SIGNING_SECRET" : "local unsigned digest",
    verificationInstructions: [
      "Export the redacted JSON packet from the same state.",
      "Canonicalize the packet export as JSON and compute SHA-256 over that canonical body.",
      "Compare the resulting digest with the canonical digest shown in this seal.",
      "When a production signing secret is configured, verify the HMAC-SHA256 signature over the canonical digest."
    ],
    productionGaps: buildEvidenceSealProductionGaps(Boolean(signature))
  };
}

function buildEvidenceSealProductionGaps(signed: boolean) {
  return [
    ...(signed ? [] : ["Configure SENTINEL_EVIDENCE_SIGNING_SECRET before presenting this as a signed production packet."]),
    ...(sentinelConfig.storageMode !== "gcp-rest"
      ? ["Persist the exported source evidence to Firestore/BigQuery before relying on the digest for production proof."]
      : []),
    ...(sentinelConfig.evidenceMode !== "production"
      ? ["Use production evidence mode only after replacing seeded pilot records with real consented customer evidence."]
      : []),
    "Generate the final packet from the hosted product immediately before Devpost submission."
  ];
}

function buildCsvPacket(packet: EvidenceExport) {
  const rows: string[][] = [
    ["section", "metric", "value", "notes"],
    ["business", "mrr_usd", String(packet.businessEvidence.mrrUsd), "Aggregate MRR field"],
    ["business", "pilot_count", String(packet.businessEvidence.pilotCount), "Qualified pilot count"],
    ["business", "active_users", String(packet.businessEvidence.activeUsers), "Aggregate active users"],
    ["business", "total_costs_usd", String(packet.businessEvidence.totalCostsUsd), "Costs excluding CAC"],
    ["business", "customer_acquisition_spend_usd", String(packet.businessEvidence.customerAcquisitionSpendUsd), "Marketing/CAC spend"],
    ...Object.entries(packet.businessEvidence.revenueByMonth).map(([month, amount]) => [
      "revenue_by_month",
      month,
      String(amount),
      "USD"
    ]),
    ...Object.entries(packet.financialEvidence.summary).map(([status, count]) => [
      "financial_evidence_summary",
      status,
      String(count),
      "Ledger item count by proof status"
    ]),
    ...packet.financialEvidence.items.slice(0, 25).map((item) => [
      "financial_evidence_item",
      item.kind,
      item.status,
      `${item.label}; ${item.privateHandling}`
    ]),
    ...Object.entries(packet.evidenceVault.summary).map(([status, count]) => [
      "evidence_vault_summary",
      status,
      String(count),
      "Private artifact count by proof status"
    ]),
    ...packet.evidenceVault.requiredArtifacts.slice(0, 30).map((artifact) => [
      "evidence_vault_item",
      artifact.kind,
      artifact.status,
      `${artifact.label}; owner=${artifact.ownerRole}; redacted=${artifact.redacted}`
    ]),
    ["consent", "arms_length_pilots", String(packet.consentSummary.armsLengthPilots), "Excludes related-party pilots"],
    ["consent", "related_party_pilots", String(packet.consentSummary.relatedPartyPilots), "Reported separately"],
    ["consent", "private_pilots", String(packet.consentSummary.privatePilots), "Customer details withheld"],
    ["consent", "consented_testimonials", String(packet.consentSummary.consentedTestimonials), "Testimonials safe to share"],
    ["consent", "pending_consent", String(packet.consentSummary.pendingConsent), "Do not publish"],
    ["operations", "files_inspected", String(packet.aggregateCounters.filesInspected), ""],
    ["operations", "bytes_scanned_by_dlp", String(packet.aggregateCounters.bytesScannedByDlp), ""],
    ["operations", "bytes_routed_to_gemini", String(packet.aggregateCounters.bytesRoutedToGemini), ""],
    ["operations", "remediations_approved", String(packet.remediationsApproved), ""],
    ["operations", "public_exposures_closed", String(packet.publicExposuresClosed), ""],
    ["audit_integrity", "valid", String(packet.auditIntegrity.valid), "Newest-first SHA-256 audit event chain"],
    ["audit_integrity", "head_hash", packet.auditIntegrity.headHash ?? "missing", "Use private audit log for full verification"],
    [
      "audit_integrity",
      "sealed_events",
      `${packet.auditIntegrity.sealedEvents}/${packet.auditIntegrity.totalEvents}`,
      "Missing or invalid seals keep production proof blocked"
    ],
    [
      "audit_integrity",
      "legacy_sealed_events",
      String(packet.auditIntegrity.legacySealedEvents),
      "Events labeled after hash-chain migration; not certification proof"
    ],
    ...packet.pilotRecords.map((pilot) => [
      "pilot",
      pilot.customerAlias,
      String(pilot.monthlyRevenueUsd),
      `${pilot.armsLength && !pilot.relatedParty ? "arms-length" : "related/other"}; proof=${pilot.proofStatus}; consent=${pilot.consentStatus}`
    ]),
    ...packet.agentRuns.map((run) => ["agent_run", run.completedAt, run.provider, `${run.model}; ${run.purpose}; cost=${run.estimatedCostUsd}`])
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string) {
  if (/[",\n\r]/u.test(value)) {
    return `"${value.replace(/"/gu, '""')}"`;
  }

  return value;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function countBy<T extends string>(keys: T[], values: T[]) {
  const initial = Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
  return values.reduce<Record<T, number>>((counts, value) => {
    counts[value] += 1;
    return counts;
  }, initial);
}

function redactTestimonials(testimonials: Testimonial[], redacted: boolean): Testimonial[] {
  return testimonials
    .filter((testimonial) => !redacted || testimonial.consentToShare)
    .map((testimonial) =>
      redacted
        ? {
            ...testimonial,
            customerName: "Consented pilot customer"
          }
        : testimonial
    );
}

function redactFinancialEvidence(ledger: FinancialEvidenceLedger, redacted: boolean): FinancialEvidenceLedger {
  if (!redacted) {
    return ledger;
  }

  let customerIndex = 0;

  return {
    ...ledger,
    items: ledger.items.map((item) => {
      if (!item.customerAlias) {
        return item;
      }

      customerIndex += 1;
      const alias = `Redacted financial customer ${customerIndex}`;

      return {
        ...item,
        label: `${alias} ${item.kind.replaceAll("-", " ")}`,
        customerAlias: alias,
        source: "Private proof source available in admin evidence room.",
        evidence: redactText(item.evidence)
      };
    })
  };
}

function redactEvidenceVault(vault: EvidenceVault, redacted: boolean): EvidenceVault {
  if (!redacted) {
    return vault;
  }

  let customerIndex = 0;

  return {
    ...vault,
    requiredArtifacts: vault.requiredArtifacts.map((artifact) => {
      if (!artifact.customerAlias) {
        return artifact;
      }

      customerIndex += 1;
      const alias = `Redacted vault customer ${customerIndex}`;

      return {
        ...artifact,
        label: `${alias} ${artifact.kind.replaceAll("-", " ")}`,
        customerAlias: alias,
        sourceDescription: "Private evidence source available in admin Evidence Vault.",
        checksumSha256: artifact.checksumSha256,
        blocker: artifact.blocker ? redactText(artifact.blocker) : undefined
      };
    })
  };
}

function redactText(text: string) {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/MainStreet Security Labs/g, "Redacted pilot tenant")
    .replace(/Northstar Health/g, "Redacted customer")
    .replace(/Vendor security packet - public link\.txt/g, "Redacted Workspace item");
}

function redactAuditMessage(event: AuditEvent) {
  if (event.type === "pilot_evidence_recorded") {
    return "Pilot evidence recorded for redacted customer segment.";
  }

  return redactText(event.message);
}
