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
  manualHandoff: {
    status: "ready-for-manual-follow-up";
    subject: string;
    body: string;
    packetMarkdown: string;
    proofBoundary: string;
  };
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

function buildManualHandoff({
  customerAlias,
  redactedContact,
  buyerDeadline,
  pilotGoal,
  createdAt,
  nextSteps,
  consentChecklist,
  trustPacketPreviewSections,
  safeHandling
}: {
  customerAlias: string;
  redactedContact: string;
  buyerDeadline: string;
  pilotGoal: string;
  createdAt: string;
  nextSteps: string[];
  consentChecklist: string[];
  trustPacketPreviewSections: string[];
  safeHandling: string;
}): CustomerLeadReceipt["manualHandoff"] {
  const safeDeadline = buyerDeadline || "Not specified";
  const safeGoal = pilotGoal || "Prepare buyer-ready Workspace risk evidence";
  const proofBoundary =
    "Manual follow-up only. This packet is not durable CRM evidence, signed customer consent, revenue proof, active-user proof, or live Workspace access proof.";
  const subject = `SME Workspace Sentinel pilot scope for ${customerAlias}`;
  const body = [
    `Pilot scope draft for ${customerAlias}`,
    "",
    `Redacted contact: ${redactedContact}`,
    `Buyer deadline: ${safeDeadline}`,
    `Pilot goal: ${safeGoal}`,
    "",
    "Next manual steps:",
    ...nextSteps.map((item) => `- ${item}`),
    "",
    "Consent boundary:",
    ...consentChecklist.map((item) => `- ${item}`),
    "",
    proofBoundary
  ].join("\n");
  const packetMarkdown = [
    "# SME Workspace Sentinel - Manual Pilot Scope Handoff",
    "",
    `Created: ${createdAt}`,
    `Customer alias: ${customerAlias}`,
    `Redacted contact: ${redactedContact}`,
    `Buyer deadline: ${safeDeadline}`,
    `Pilot goal: ${safeGoal}`,
    "",
    "## One-Day Pilot Scope",
    "- Confirm approved Workspace surfaces before OAuth.",
    "- Run deterministic checks before any semantic AI review.",
    "- Stage non-trivial remediation for named human approval.",
    "- Export a redacted Trust Packet after review.",
    "",
    "## Next Manual Steps",
    ...nextSteps.map((item) => `- ${item}`),
    "",
    "## Consent Checklist",
    ...consentChecklist.map((item) => `- ${item}`),
    "",
    "## Trust Packet Preview",
    ...trustPacketPreviewSections.map((item) => `- ${item}`),
    "",
    "## Proof Boundary",
    proofBoundary,
    safeHandling
  ].join("\n");

  return {
    status: "ready-for-manual-follow-up",
    subject,
    body,
    packetMarkdown,
    proofBoundary
  };
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
  const redactedContact = redactEmail(workEmail);
  const nextSteps = [
    "Confirm the buyer deadline and approved Workspace surfaces.",
    "Send the consent checklist before any live Workspace access.",
    "Book the one-day scan after the approval owner confirms scope."
  ];
  const consentChecklist = [
    "Drive and Gmail metadata scope is approved before OAuth.",
    "Excluded folders, private invoices, and raw customer files stay out of the scan.",
    "Gemini review is used only when deterministic checks justify semantic explanation.",
    "Non-trivial remediation remains human-approved."
  ];
  const trustPacketPreviewSections = [
    "Scan scope and sample-risk summary",
    "Redacted finding and staged recommendation",
    "Approval trail and open proof gaps",
    "Questionnaire-ready answer with human-review note"
  ];
  const safeHandling =
    "This local request stores only a redacted lead receipt in app memory. Configure a real lead destination before treating it as durable CRM evidence.";

  return {
    id: `lead_${createdAt.replace(/[^0-9]/gu, "").slice(0, 14)}`,
    createdAt,
    status: "captured-locally",
    fieldCount,
    customerAlias,
    redactedContact,
    destinationStatus: "lead-destination-needed",
    nextSteps,
    consentChecklist,
    trustPacketPreviewSections,
    safeHandling,
    manualHandoff: buildManualHandoff({
      customerAlias,
      redactedContact,
      buyerDeadline: cleanLeadText(input.buyerDeadline, 80),
      pilotGoal: cleanLeadText(input.pilotGoal, 160),
      createdAt,
      nextSteps,
      consentChecklist,
      trustPacketPreviewSections,
      safeHandling
    })
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
