import type { BusinessVerificationChecklistItem } from "@/lib/business-verification";
import type { FinancialEvidenceLedger } from "@/lib/types";

export type StripeProofStatus = "ready" | "blocked" | "manual";

export interface StripeProofStatusItem {
  id: string;
  label: string;
  status: StripeProofStatus;
  evidence: string;
  requiredProof: string;
  ownerAction: string;
  doesNotProve: string;
}

export interface StripeProofStatusSummary {
  ready: number;
  blocked: number;
  manual: number;
  total: number;
  complete: boolean;
  boundary: string;
}

export interface StripeProofStatusPanel {
  items: StripeProofStatusItem[];
  summary: StripeProofStatusSummary;
}

function summarize(items: StripeProofStatusItem[]): StripeProofStatusSummary {
  const ready = items.filter((item) => item.status === "ready").length;
  const blocked = items.filter((item) => item.status === "blocked").length;
  const manual = items.filter((item) => item.status === "manual").length;

  return {
    ready,
    blocked,
    manual,
    total: items.length,
    complete: blocked === 0 && manual === 0,
    boundary:
      "This admin card shows non-secret Stripe proof readiness only. It does not expose API keys, customer identities, invoice IDs, payment IDs, raw Stripe exports, or bank/payment records.",
  };
}

export function buildStripeProofStatusPanel({
  businessVerificationChecklist,
  financialEvidence,
}: {
  businessVerificationChecklist: BusinessVerificationChecklistItem[];
  financialEvidence: FinancialEvidenceLedger;
}): StripeProofStatusPanel {
  const blockedBusinessItems = businessVerificationChecklist.filter((item) => item.status === "blocked");
  const businessDetailsReady = blockedBusinessItems.length === 0;
  const liveMrrReady =
    financialEvidence.evidenceMode === "production" &&
    financialEvidence.totalMrrUsd > 0 &&
    financialEvidence.summary.missing === 0 &&
    financialEvidence.summary["mock-only"] === 0 &&
    financialEvidence.summary.verified > 0;
  const invoiceProofReady =
    financialEvidence.evidenceMode === "production" &&
    financialEvidence.summary.verified > 0 &&
    financialEvidence.summary.missing === 0 &&
    financialEvidence.summary["mock-only"] === 0;

  const items: StripeProofStatusItem[] = [
    {
      id: "stripe-business-details",
      label: "Stripe business details",
      status: businessDetailsReady ? "ready" : "blocked",
      evidence: businessDetailsReady
        ? "Public support, terms, privacy, refund, address, phone, and email fields are configured."
        : `${blockedBusinessItems.length} public business-detail item(s) still need owner-approved values.`,
      requiredProof: "Hosted /support, /terms-of-service, /privacy, and /cancellation-refund-policy routes with public business details.",
      ownerAction: businessDetailsReady
        ? "Submit the verified URLs in Stripe business details."
        : "Set the missing public Vercel environment values and redeploy before submitting Stripe URLs.",
      doesNotProve: "Stripe account acceptance, active payment capabilities, paid subscriptions, or invoices.",
    },
    {
      id: "stripe-test-checkout",
      label: "Stripe test checkout",
      status: businessDetailsReady ? "manual" : "blocked",
      evidence: businessDetailsReady
        ? "Business-detail pages are ready; test checkout still requires an owner-run Stripe test-mode proof."
        : "Business-detail blocker remains, so test checkout proof is not enough for Stripe readiness.",
      requiredProof: "A Stripe test-mode Checkout Session created with test price/key evidence and no live-mode key substitution.",
      ownerAction: "Run the private test checkout verifier and retain only redacted session status, livemode=false, and timestamp metadata.",
      doesNotProve: "Live revenue, MRR, payment-method collection, webhook fulfillment, or production subscription health.",
    },
    {
      id: "stripe-live-mrr",
      label: "Live MRR",
      status: liveMrrReady ? "ready" : "blocked",
      evidence: liveMrrReady
        ? `$${financialEvidence.totalMrrUsd}/mo production-mode MRR has verified private financial backup.`
        : `${financialEvidence.evidenceMode} mode; ${financialEvidence.summary.missing} missing and ${financialEvidence.summary["mock-only"]} mock-only financial item(s).`,
      requiredProof: "Production-mode Stripe active subscriptions or paid invoices with redacted private backup and total MRR greater than zero.",
      ownerAction: liveMrrReady
        ? "Keep raw Stripe exports and invoices private; publish only aggregate proof status."
        : "Attach arms-length invoice/payment proof or Stripe live export before claiming live MRR.",
      doesNotProve: "Retention, product-market fit, future revenue, accounting recognition, or customer outcome impact.",
    },
    {
      id: "stripe-invoice-payment-proof",
      label: "Invoice/payment proof",
      status: invoiceProofReady ? "ready" : "blocked",
      evidence: invoiceProofReady
        ? `${financialEvidence.summary.verified} verified private financial evidence item(s) are available.`
        : `${financialEvidence.summary.verified} verified, ${financialEvidence.summary["private-on-request"]} private, ${financialEvidence.summary.missing} missing, ${financialEvidence.summary["mock-only"]} mock.`,
      requiredProof: "Private invoice/payment artifacts with redaction, checksum, consent boundary, and owner-reviewed relationship status.",
      ownerAction: invoiceProofReady
        ? "Retain private evidence and expose only aggregate readiness."
        : "Register private invoice/payment artifacts in the Evidence Vault or exclude the related pilot from counted revenue.",
      doesNotProve: "Raw payment authenticity to public users, customer permission to name logos, or case-study outcome proof.",
    },
  ];

  return {
    items,
    summary: summarize(items),
  };
}
