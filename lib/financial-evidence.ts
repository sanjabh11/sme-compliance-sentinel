import { sentinelConfig } from "@/lib/config";
import type {
  DashboardSnapshot,
  FinancialEvidenceLedger,
  FinancialEvidenceLedgerItem,
  FinancialEvidenceStatus,
  PilotCustomerRecord
} from "@/lib/types";

type FinancialEvidenceSnapshot = Pick<DashboardSnapshot, "tenant" | "pilotRecords">;

const months: Array<keyof FinancialEvidenceLedger["revenueByMonth"]> = ["May", "June", "July", "August"];

export function buildFinancialEvidenceLedger(snapshot: FinancialEvidenceSnapshot): FinancialEvidenceLedger {
  const generatedAt = new Date().toISOString();
  const evidenceMode: FinancialEvidenceLedger["evidenceMode"] = sentinelConfig.evidenceMode === "production" ? "production" : "mock";
  const qualifiedPilots = snapshot.pilotRecords.filter((pilot) => pilot.armsLength && !pilot.relatedParty);
  const relatedPartyPilots = snapshot.pilotRecords.filter((pilot) => pilot.relatedParty);
  const missingInvoicePilots = qualifiedPilots.filter(
    (pilot) => pilot.proofStatus === "invoice-needed" || pilot.proofStatus === "testimonial-consented"
  );
  const mockPilots = qualifiedPilots.filter((pilot) => pilot.proofStatus === "mock");
  const privateFinancialPilots = qualifiedPilots.filter((pilot) => pilot.proofStatus === "financial-doc-ready");
  const consentedPilots = qualifiedPilots.filter((pilot) => pilot.consentStatus === "consented" && pilot.testimonialQuote);
  const pendingConsentPilots = qualifiedPilots.filter((pilot) => pilot.consentStatus === "pending");

  const revenueByMonth = Object.fromEntries(
    months.map((month) => [
      month,
      {
        amountUsd: snapshot.tenant.evidence.revenueByMonth[month],
        status: monthlyRevenueStatus(snapshot.tenant.evidence.revenueByMonth[month], missingInvoicePilots.length, mockPilots.length)
      }
    ])
  ) as FinancialEvidenceLedger["revenueByMonth"];

  const items: FinancialEvidenceLedgerItem[] = [
    ...months.map((month) =>
      makeItem({
        id: `financial_revenue_${month.toLowerCase()}`,
        kind: "monthly-revenue",
        label: `${month} recurring revenue rollup`,
        month,
        amountUsd: snapshot.tenant.evidence.revenueByMonth[month],
        status: revenueByMonth[month].status,
        source: "Tenant evidence rollup from pilot records.",
        ownerRole: "finance",
        privateHandling: "Judge-facing exports show totals only; invoices stay private unless a judge requests them.",
        evidence:
          evidenceMode === "production"
            ? `${qualifiedPilots.length} arms-length pilot record(s) contribute to this rollup.`
            : "Seeded local pilot records are useful for demo flow only.",
        fix:
          evidenceMode === "production"
            ? "Attach payment-processor or invoice evidence for each contributing customer."
            : "Replace seeded local revenue with production-mode payment records before submission.",
        relatedPartyRisk: relatedPartyPilots.length > 0,
        consentRequired: false
      })
    ),
    ...qualifiedPilots.map((pilot) => buildPilotInvoiceItem(pilot)),
    makeItem({
      id: "financial_total_costs",
      kind: "cost-record",
      label: "Cloud and operating cost record",
      amountUsd: snapshot.tenant.evidence.totalCostsUsd,
      status: productionPrivateStatus(snapshot.tenant.evidence.totalCostsUsd > 0),
      source: "Evidence Room operating-cost field.",
      ownerRole: "finance",
      privateHandling: "Keep receipts and Cloud Billing screenshots private; publish only aggregate cost totals.",
      evidence:
        evidenceMode === "production"
          ? `$${snapshot.tenant.evidence.totalCostsUsd} cost basis is ready for private backup.`
          : "Local cost basis is a seeded planning number.",
      fix: "Attach Cloud Billing budget/export screenshots and operating receipts before Devpost submission.",
      relatedPartyRisk: false,
      consentRequired: false
    }),
    makeItem({
      id: "financial_cac_spend",
      kind: "cac-record",
      label: "Customer acquisition spend record",
      amountUsd: snapshot.tenant.evidence.customerAcquisitionSpendUsd,
      status: productionPrivateStatus(snapshot.tenant.evidence.customerAcquisitionSpendUsd > 0),
      source: "Evidence Room CAC field.",
      ownerRole: "sales",
      privateHandling: "Publish aggregate CAC only; store campaign receipts and outreach logs privately.",
      evidence:
        evidenceMode === "production"
          ? `$${snapshot.tenant.evidence.customerAcquisitionSpendUsd} CAC basis is ready for private backup.`
          : "Local CAC is seeded for judge-flow demonstration.",
      fix: "Attach outreach spend receipts, campaign logs, or founder-sales time assumptions with dates.",
      relatedPartyRisk: false,
      consentRequired: false
    }),
    makeItem({
      id: "financial_active_users",
      kind: "active-user-proof",
      label: "Active user proof",
      amountUsd: undefined,
      status: productionPrivateStatus(snapshot.tenant.evidence.activeUsers > 0),
      source: "Pilot records and tenant user counts.",
      ownerRole: "founder",
      privateHandling: "Share redacted screenshots or logs with judges only; do not expose user emails publicly.",
      evidence: `${snapshot.tenant.evidence.activeUsers} active user(s) currently counted across qualified pilots.`,
      fix: "Replace seeded user counts with product analytics or Workspace install logs from production.",
      relatedPartyRisk: relatedPartyPilots.length > 0,
      consentRequired: false
    }),
    ...consentedPilots.map((pilot) => buildTestimonialItem(pilot)),
    makeItem({
      id: "financial_related_party_review",
      kind: "related-party-review",
      label: "Related-party revenue separation",
      status: relatedPartyStatus(relatedPartyPilots.length),
      source: "Pilot records with arms-length and related-party flags.",
      ownerRole: "legal",
      privateHandling: "Show relationship notes privately if any customer is not arms-length.",
      evidence:
        relatedPartyPilots.length === 0
          ? "No related-party pilots are included in qualified revenue."
          : `${relatedPartyPilots.length} related-party pilot(s) require separate handling.`,
      fix:
        relatedPartyPilots.length === 0
          ? "Keep reviewing new pilot records before counting them as revenue proof."
          : "Exclude related-party revenue from judge metrics or provide explicit relationship disclosure.",
      relatedPartyRisk: relatedPartyPilots.length > 0,
      consentRequired: false
    })
  ];

  const summary = summarizeItems(items);
  const blockers = buildBlockers({
    missingInvoiceCount: missingInvoicePilots.length,
    mockPilotCount: mockPilots.length,
    relatedPartyCount: relatedPartyPilots.length,
    pendingConsentCount: pendingConsentPilots.length,
    privateFinancialCount: privateFinancialPilots.length
  });

  return {
    generatedAt,
    evidenceMode,
    summary,
    revenueByMonth,
    totalMrrUsd: snapshot.tenant.evidence.mrrUsd,
    totalCostsUsd: snapshot.tenant.evidence.totalCostsUsd,
    customerAcquisitionSpendUsd: snapshot.tenant.evidence.customerAcquisitionSpendUsd,
    activeUsers: snapshot.tenant.evidence.activeUsers,
    items,
    blockers,
    nextActions: [
      "Replace seeded pilot rows with production-mode customer/payment records.",
      "Attach private invoices or payment-processor exports for every counted pilot.",
      "Capture active-user evidence from production analytics or Google Workspace install logs.",
      "Attach Cloud Billing and CAC proof as private judge evidence.",
      "Collect explicit testimonial consent before quoting any customer."
    ],
    disclaimer:
      "Financial evidence is private by default. Public or judge exports should use redacted aliases, aggregate totals, and explicit consent boundaries."
  };
}

function buildPilotInvoiceItem(pilot: PilotCustomerRecord): FinancialEvidenceLedgerItem {
  return makeItem({
    id: `financial_invoice_${pilot.id}`,
    kind: "pilot-invoice",
    label: `${pilot.customerAlias} invoice/payment proof`,
    amountUsd: pilot.monthlyRevenueUsd,
    customerAlias: pilot.customerAlias,
    status: pilotInvoiceStatus(pilot),
    source: pilot.invoiceReference ?? "Pilot CRM proof status.",
    ownerRole: "finance",
    privateHandling: "Keep customer name, invoice, and payment metadata private; export only alias and status.",
    evidence:
      pilot.proofStatus === "financial-doc-ready"
        ? "Private financial document is marked ready."
        : pilot.proofStatus === "testimonial-consented"
          ? "Customer quote is consented, but invoice/payment proof still needs separate backup."
          : pilot.proofStatus === "mock"
            ? "Seeded local pilot row."
            : "Invoice/payment proof has not been attached.",
    fix:
      pilot.proofStatus === "financial-doc-ready"
        ? "Confirm private invoice/payment evidence is available for judge request."
        : "Attach invoice/payment proof or exclude this pilot from counted revenue.",
    relatedPartyRisk: pilot.relatedParty,
    consentRequired: false
  });
}

function buildTestimonialItem(pilot: PilotCustomerRecord): FinancialEvidenceLedgerItem {
  return makeItem({
    id: `financial_testimonial_${pilot.id}`,
    kind: "testimonial-consent",
    label: `${pilot.customerAlias} testimonial consent`,
    customerAlias: pilot.customerAlias,
    status: sentinelConfig.evidenceMode === "production" ? "private-on-request" : "mock-only",
    source: "Pilot CRM testimonial consent field.",
    ownerRole: "sales",
    privateHandling: "Show quote only when consent is explicit; keep customer identity redacted unless consent permits naming.",
    evidence: "A testimonial quote is present with consent marked in the pilot record.",
    fix: "Store signed consent or email approval beside the quote before judge submission.",
    relatedPartyRisk: pilot.relatedParty,
    consentRequired: true
  });
}

function makeItem(input: FinancialEvidenceLedgerItem): FinancialEvidenceLedgerItem {
  return input;
}

function monthlyRevenueStatus(amountUsd: number, missingInvoiceCount: number, mockPilotCount: number): FinancialEvidenceStatus {
  if (amountUsd <= 0) {
    return "missing";
  }

  if (sentinelConfig.evidenceMode !== "production") {
    return "mock-only";
  }

  if (missingInvoiceCount > 0 || mockPilotCount > 0) {
    return "missing";
  }

  return sentinelConfig.storageMode === "gcp-rest" ? "verified" : "private-on-request";
}

function pilotInvoiceStatus(pilot: PilotCustomerRecord): FinancialEvidenceStatus {
  if (pilot.proofStatus === "mock") {
    return "mock-only";
  }

  if (pilot.proofStatus !== "financial-doc-ready") {
    return "missing";
  }

  if (sentinelConfig.evidenceMode !== "production") {
    return "mock-only";
  }

  return sentinelConfig.storageMode === "gcp-rest" ? "verified" : "private-on-request";
}

function productionPrivateStatus(hasAmountOrCount: boolean): FinancialEvidenceStatus {
  if (!hasAmountOrCount) {
    return "missing";
  }

  return sentinelConfig.evidenceMode === "production" ? "private-on-request" : "mock-only";
}

function relatedPartyStatus(relatedPartyCount: number): FinancialEvidenceStatus {
  if (relatedPartyCount > 0) {
    return "missing";
  }

  return sentinelConfig.evidenceMode === "production" ? "verified" : "mock-only";
}

function summarizeItems(items: FinancialEvidenceLedgerItem[]): Record<FinancialEvidenceStatus, number> {
  return items.reduce<Record<FinancialEvidenceStatus, number>>(
    (summary, item) => {
      summary[item.status] += 1;
      return summary;
    },
    { "mock-only": 0, missing: 0, "private-on-request": 0, verified: 0 }
  );
}

function buildBlockers(input: {
  missingInvoiceCount: number;
  mockPilotCount: number;
  relatedPartyCount: number;
  pendingConsentCount: number;
  privateFinancialCount: number;
}) {
  return [
    ...(sentinelConfig.evidenceMode !== "production"
      ? ["SENTINEL_EVIDENCE_MODE is not production, so financial rows are demo proof only."]
      : []),
    ...(sentinelConfig.storageMode !== "gcp-rest"
      ? ["Financial evidence is not persisted to Firestore/BigQuery yet."]
      : []),
    ...(input.missingInvoiceCount > 0 ? [`${input.missingInvoiceCount} qualified pilot(s) still need invoice/payment proof.`] : []),
    ...(input.mockPilotCount > 0 ? [`${input.mockPilotCount} qualified pilot(s) are still marked mock-only.`] : []),
    ...(input.relatedPartyCount > 0 ? [`${input.relatedPartyCount} related-party pilot(s) require disclosure or exclusion.`] : []),
    ...(input.pendingConsentCount > 0 ? [`${input.pendingConsentCount} pilot testimonial consent state(s) are pending.`] : []),
    ...(sentinelConfig.evidenceMode === "production" && input.privateFinancialCount === 0
      ? ["No production financial document is marked ready yet."]
      : [])
  ].slice(0, 8);
}
