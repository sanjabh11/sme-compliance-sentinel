import type { CustomerLeadRequest } from "@/lib/customer-leads";

export interface CustomerConsentPacket {
  id: string;
  generatedAt: string;
  status: "template-ready";
  packetTitle: string;
  customerAlias: string;
  redactedContact: string;
  fieldCount: number;
  scopeSummary: string;
  allowedSources: string[];
  excludedData: string[];
  aiUseBoundary: string[];
  remediationApprovalBoundary: string[];
  signatureChecklist: string[];
  nextSteps: string[];
  claimBoundaries: string[];
  safeHandling: string;
  exportText: string;
}

export function buildCustomerConsentPacket(input: CustomerLeadRequest, now = new Date()): CustomerConsentPacket {
  const workEmail = cleanLeadText(input.workEmail, 160);
  if (!isValidEmail(workEmail)) {
    throw new Error("A valid work email is required before preparing a consent packet.");
  }

  const company = cleanLeadText(input.company, 90);
  const name = cleanLeadText(input.name, 90);
  const customerAlias = company || (name ? `${name.split(" ")[0]}'s team` : "Prospective pilot team");
  const buyerDeadline = cleanLeadText(input.buyerDeadline, 40) || "Not specified";
  const pilotGoal = cleanLeadText(input.pilotGoal, 180) || "Prepare for an enterprise security review";
  const generatedAt = now.toISOString();

  const packet = {
    id: `consent_${generatedAt.replace(/[^0-9]/gu, "").slice(0, 14)}`,
    generatedAt,
    status: "template-ready",
    packetTitle: "One-day Workspace risk scan consent packet",
    customerAlias,
    redactedContact: redactEmail(workEmail),
    fieldCount: countProvidedFields(input),
    scopeSummary: `${customerAlias} is requesting a fixed-scope Workspace risk scan for: ${pilotGoal}. Buyer deadline: ${buyerDeadline}.`,
    allowedSources: [
      "Google Drive metadata and explicitly approved sample file text.",
      "Gmail metadata, labels, and history cursors; message bodies are excluded by default.",
      "One agreed high-risk sample event for demonstrating deterministic checks, Gemini explanation, and human approval."
    ],
    excludedData: [
      "OAuth refresh tokens, API keys, passwords, and secrets.",
      "Private invoices, unrelated folders, raw customer files, and broad domain-wide crawls.",
      "Public testimonials, customer names, or security findings without separate written consent."
    ],
    aiUseBoundary: [
      "Tier 0 and deterministic checks run before any semantic AI review.",
      "Gemini receives only bounded, justified samples after redaction and data-minimization checks.",
      "Low-risk metadata changes are skipped and do not require AI review."
    ],
    remediationApprovalBoundary: [
      "Non-trivial remediation starts as a staged recommendation.",
      "Sharing changes, labels, or owner notifications require named customer approval.",
      "Approvals, dismissals, false positives, rescans, and actions are recorded in the audit trail."
    ],
    signatureChecklist: [
      "Customer approver name, role, work email, and signature date.",
      "Allowed Workspace sources and excluded content confirmed.",
      "Approval contact for staged remediation confirmed.",
      "Separate permission for public testimonial or customer naming, if any."
    ],
    nextSteps: [
      "Review the scope and excluded-data boundary.",
      "Name the approval owner for staged remediation.",
      "Sign and return the consent packet before live Workspace OAuth.",
      "Register the signed packet privately before scanning live data."
    ],
    claimBoundaries: [
      "This packet supports SOC2 readiness evidence only; it is not certification, audit assurance, or legal advice.",
      "This template is not signed consent and does not authorize live Workspace access by itself.",
      "Customer names, raw files, private invoices, OAuth details, and findings stay out of public proof unless separately approved."
    ],
    safeHandling:
      "The customer-facing consent packet is a redacted template. Treat signed consent as a private artifact and do not commit it to Git."
  } satisfies Omit<CustomerConsentPacket, "exportText">;

  return {
    ...packet,
    exportText: buildConsentExportText(packet)
  };
}

function buildConsentExportText(packet: Omit<CustomerConsentPacket, "exportText">) {
  return [
    `# ${packet.packetTitle}`,
    "",
    `Generated: ${packet.generatedAt}`,
    `Customer alias: ${packet.customerAlias}`,
    `Contact: ${packet.redactedContact}`,
    `Status: ${packet.status}`,
    "",
    "## Scope Summary",
    packet.scopeSummary,
    "",
    "## Allowed Sources",
    ...packet.allowedSources.map((item) => `- ${item}`),
    "",
    "## Excluded Data",
    ...packet.excludedData.map((item) => `- ${item}`),
    "",
    "## AI Use Boundary",
    ...packet.aiUseBoundary.map((item) => `- ${item}`),
    "",
    "## Remediation Approval Boundary",
    ...packet.remediationApprovalBoundary.map((item) => `- ${item}`),
    "",
    "## Signature Checklist",
    ...packet.signatureChecklist.map((item) => `- ${item}`),
    "",
    "## Next Steps",
    ...packet.nextSteps.map((item) => `- ${item}`),
    "",
    "## Claim Boundaries",
    ...packet.claimBoundaries.map((item) => `- ${item}`),
    "",
    packet.safeHandling
  ].join("\n");
}

function countProvidedFields(input: CustomerLeadRequest) {
  return [input.name, input.workEmail, input.company, input.buyerDeadline, input.pilotGoal].filter((value) => cleanLeadText(value, 1)).length;
}

function cleanLeadText(value: string | undefined, maxLength: number) {
  return (value ?? "")
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

function redactEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  const prefix = local.slice(0, 1) || "x";
  return `${prefix}***@${domain}`;
}
