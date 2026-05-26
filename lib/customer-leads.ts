export interface CustomerLeadRequest {
  name?: string;
  workEmail: string;
  company?: string;
  buyerDeadline?: string;
  pilotGoal?: string;
}

export interface CustomerLeadReceipt {
  id: string;
  createdAt: string;
  status: "captured-locally";
  fieldCount: number;
  customerAlias: string;
  redactedContact: string;
  destinationStatus: "lead-destination-needed";
  nextSteps: string[];
  consentChecklist: string[];
  trustPacketPreviewSections: string[];
  safeHandling: string;
}

const MAX_LEAD_FIELDS = 5;
const retainedLeadReceipts: CustomerLeadReceipt[] = [];

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

function redactEmail(email: string) {
  const cleaned = email.toLowerCase();
  const [local, domain] = cleaned.split("@");
  if (!local || !domain) {
    return "email captured";
  }

  const visible = local.slice(0, 1);
  return `${visible}***@${domain}`;
}

function countLeadFields(input: CustomerLeadRequest) {
  return [input.name, input.workEmail, input.company, input.buyerDeadline, input.pilotGoal].filter((value) => cleanLeadText(value, 1)).length;
}

export function buildCustomerLeadReceipt(input: CustomerLeadRequest, now = new Date()): CustomerLeadReceipt {
  const workEmail = cleanLeadText(input.workEmail, 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(workEmail)) {
    throw new Error("A valid work email is required for the pilot scope request.");
  }

  const fieldCount = countLeadFields({ ...input, workEmail });
  if (fieldCount > MAX_LEAD_FIELDS) {
    throw new Error("Lead capture must stay at five fields or fewer.");
  }

  const company = cleanLeadText(input.company, 90);
  const name = cleanLeadText(input.name, 80);
  const customerAlias = company || (name ? `${name.split(" ")[0]}'s team` : "New pilot lead");
  const createdAt = now.toISOString();

  return {
    id: `lead_${createdAt.replace(/[^0-9]/gu, "").slice(0, 14)}`,
    createdAt,
    status: "captured-locally",
    fieldCount,
    customerAlias,
    redactedContact: redactEmail(workEmail),
    destinationStatus: "lead-destination-needed",
    nextSteps: [
      "Confirm the buyer deadline and approved Workspace surfaces.",
      "Send the consent checklist before any live Workspace access.",
      "Book the one-day scan after the approval owner confirms scope."
    ],
    consentChecklist: [
      "Drive and Gmail metadata scope is approved before OAuth.",
      "Excluded folders, private invoices, and raw customer files stay out of the scan.",
      "Gemini review is used only when deterministic checks justify semantic explanation.",
      "Non-trivial remediation remains human-approved."
    ],
    trustPacketPreviewSections: [
      "Scan scope and sample-risk summary",
      "Redacted finding and staged recommendation",
      "Approval trail and open proof gaps",
      "Questionnaire-ready answer with human-review note"
    ],
    safeHandling:
      "This local request stores only a redacted lead receipt in app memory. Configure a real lead destination before treating it as durable CRM evidence."
  };
}

export function captureCustomerLead(input: CustomerLeadRequest, now = new Date()) {
  const receipt = buildCustomerLeadReceipt(input, now);
  retainedLeadReceipts.unshift(receipt);
  retainedLeadReceipts.splice(25);
  return receipt;
}

export function listRetainedLeadReceipts() {
  return [...retainedLeadReceipts];
}
