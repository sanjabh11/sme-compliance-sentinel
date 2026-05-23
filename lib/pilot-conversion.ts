import { sentinelConfig } from "@/lib/config";
import type {
  DashboardSnapshot,
  EvidenceVaultArtifactKind,
  EvidenceVaultArtifactStatus,
  PilotConversionAsset,
  PilotConversionKit,
  PilotConversionStatus,
  PilotConversionStep,
  PilotProspectRecord
} from "@/lib/types";

type ConversionEvidenceOwnerRole = PilotConversionKit["evidenceChecklist"][number]["ownerRole"];

type PilotConversionSnapshot = Pick<
  DashboardSnapshot,
  | "tenant"
  | "pilotProspects"
  | "pilotRecords"
  | "evidenceVaultArtifacts"
  | "trustPackets"
  | "questionnairePacks"
  | "agentRuns"
  | "findings"
  | "remediations"
  | "auditEvents"
>;

export function buildPilotConversionKit(snapshot: PilotConversionSnapshot): PilotConversionKit {
  const targetProspect = selectTargetProspect(snapshot.pilotProspects);
  const conversionSteps = buildConversionSteps(snapshot, targetProspect);
  const closeAssets = buildCloseAssets(snapshot, targetProspect);
  const evidenceChecklist = buildEvidenceChecklist(snapshot);
  const blockers = buildBlockers(snapshot, targetProspect, conversionSteps, evidenceChecklist);
  const conversionScore = scoreConversionReadiness(snapshot, targetProspect, conversionSteps, evidenceChecklist);
  const status = resolveStatus(blockers, conversionScore);

  return {
    generatedAt: new Date().toISOString(),
    status,
    targetProspect,
    conversionScore,
    offer: "$199 one-day Google Workspace risk scan plus SOC2 readiness evidence packet.",
    pricing: "$199 for the first one-day scan, then $49-$199/month for the evidence room based on tenant size and review volume.",
    closeNarrative: [
      "Lead with a narrow buyer problem: a small team has a security review or enterprise procurement blocker and uses Google Workspace today.",
      "Offer a fixed-scope, consented scan that proves what was inspected, skipped, routed to Gemini, approved by a human, and exported as readiness evidence.",
      "Convert only arms-length paid pilots into XPRIZE revenue evidence after invoice/payment proof, active-user proof, cost/CAC records, and consent artifacts exist.",
      "Do not sell certification. Sell faster risk discovery and buyer-readable SOC2 readiness evidence."
    ],
    conversionSteps,
    closeAssets,
    evidenceChecklist,
    blockers,
    nextActions: buildNextActions(blockers, targetProspect, closeAssets),
    claimBoundaries: [
      "Pipeline and close-kit content is sales-operations planning until an arms-length customer pays and private proof exists.",
      "Do not scan live Workspace data before written consent, scope approval, and OAuth installation.",
      "Do not count related-party revenue or seeded local records as XPRIZE business evidence.",
      "Use SOC2 readiness evidence, risks detected, human-approved remediation, and redacted judge evidence language.",
      "Keep invoices, customer identities, OAuth data, and security findings private or redacted."
    ],
    disclaimer:
      "This conversion kit helps close and document a paid pilot. It does not create revenue, certify compliance, provide audit assurance, or replace customer consent and private evidence review."
  };
}

function selectTargetProspect(prospects: PilotProspectRecord[]) {
  return [...prospects]
    .filter((prospect) => prospect.stage !== "lost")
    .sort((a, b) => stagePriority(b.stage) - stagePriority(a.stage) || b.fitScore - a.fitScore || b.estimatedMrrUsd - a.estimatedMrrUsd)[0];
}

function buildConversionSteps(
  snapshot: PilotConversionSnapshot,
  targetProspect?: PilotProspectRecord
): PilotConversionStep[] {
  const hasTarget = Boolean(targetProspect);
  const hasTrustPacket = snapshot.trustPackets.length > 0;
  const hasQuestionnaire = snapshot.questionnairePacks.some((pack) => pack.status === "exported") || snapshot.questionnairePacks.length > 0;
  const hasRun = snapshot.agentRuns.length > 0;
  const hasFinding = snapshot.findings.length > 0;
  const hasRemediation = snapshot.remediations.length > 0;
  const hasFinancialProof = hasEvidence(snapshot, ["pilot-invoice", "payment-export"]);
  const hasUserProof = hasEvidence(snapshot, ["active-user-log"]);
  const hasConsent = hasEvidence(snapshot, ["pilot-consent"]);

  return [
    step({
      id: "target-and-scope",
      label: "Target and scope a high-fit pilot",
      status: hasTarget ? "ready" : "blocked",
      ownerRole: "founder",
      requiredEvidence: ["Redacted prospect record", "Pain signal", "Expected MRR", "Owner"],
      proofSurface: "/api/pilots/prospects",
      nextAction: hasTarget ? `Use ${targetProspect?.prospectAlias} as the next conversion target.` : "Add one high-fit arms-length prospect."
    }),
    step({
      id: "send-proof-backed-outreach",
      label: "Send proof-backed outreach",
      status: hasTrustPacket || hasQuestionnaire ? "ready" : "needs-proof",
      ownerRole: "sales",
      requiredEvidence: ["One-day offer", "Trust Packet or questionnaire proof", "Claim boundary"],
      proofSurface: "/api/pilots/conversion-kit",
      nextAction: hasTrustPacket || hasQuestionnaire ? "Send the close email and request a scope call." : "Create a Trust Packet or questionnaire response pack before outreach."
    }),
    step({
      id: "collect-consent",
      label: "Collect consent and data boundary",
      status: hasConsent ? "ready" : "needs-proof",
      ownerRole: "legal",
      requiredEvidence: ["Written pilot consent", "Allowed Workspace sources", "Redaction boundary", "No-certification wording"],
      proofSurface: "/api/pilots/consent-packet",
      nextAction: "Generate the consent packet, collect signature, and register the pilot-consent artifact before live Workspace access."
    }),
    step({
      id: "invoice-payment",
      label: "Invoice and payment proof",
      status: hasFinancialProof ? "ready" : "blocked",
      ownerRole: "finance",
      requiredEvidence: ["Invoice", "Payment export", "Revenue month", "Related-party flag"],
      proofSurface: "/api/financial-evidence/ledger",
      nextAction: "Send invoice for the one-day scan and register payment proof privately."
    }),
    step({
      id: "workspace-install",
      label: "Workspace OAuth install",
      status: snapshot.auditEvents.some((event) => event.type === "sync_reconciliation_completed") ? "ready" : "needs-proof",
      ownerRole: "engineering",
      requiredEvidence: ["OAuth install", "Secret Manager token path", "Drive cursor", "Gmail history cursor"],
      proofSurface: "/api/oauth/google/start",
      nextAction: "Install OAuth for the pilot and verify token storage plus cursor initialization."
    }),
    step({
      id: "run-scan",
      label: "Run scan and stage recommendation",
      status: hasRun && hasFinding ? "ready" : "needs-proof",
      ownerRole: "security",
      requiredEvidence: ["Low-risk skip", "High-risk scan", "Gemini or deterministic provider", "Finding rationale"],
      proofSurface: "/api/agent-runs",
      nextAction: "Run one high-risk event and preserve the agent-run metadata."
    }),
    step({
      id: "approve-remediation",
      label: "Approve remediation and log outcome",
      status: hasRemediation ? "ready" : "needs-proof",
      ownerRole: "security",
      requiredEvidence: ["Approver role", "Approval event", "Remediation record", "Score snapshot"],
      proofSurface: "/api/findings/[id]/approve",
      nextAction: "Approve or dismiss a staged recommendation and preserve the audit trail."
    }),
    step({
      id: "package-evidence",
      label: "Package private judge and buyer evidence",
      status: hasFinancialProof && hasUserProof && hasConsent && hasRun ? "ready" : "needs-proof",
      ownerRole: "founder",
      requiredEvidence: ["Financial proof", "Active-user proof", "Consent", "Agent logs", "Redacted packet"],
      proofSurface: "/api/evidence/export?redacted=true",
      nextAction: "Generate the redacted packet and attach private artifacts in the Evidence Vault."
    })
  ];
}

function buildCloseAssets(
  snapshot: PilotConversionSnapshot,
  targetProspect?: PilotProspectRecord
): PilotConversionAsset[] {
  const prospectLabel = targetProspect?.prospectAlias ?? "your team";
  const painSignal = targetProspect?.painSignal ?? "an upcoming enterprise security review";
  const painSentence = sentenceWithoutTerminalPunctuation(painSignal);
  const hasTrustPacket = snapshot.trustPackets.length > 0;
  const hasQuestionnaire = snapshot.questionnairePacks.length > 0;

  return [
    {
      id: "founder-email",
      label: "Founder close email",
      channel: "email",
      status: targetProspect ? "ready" : "blocked",
      copy: `Subject: One-day Google Workspace risk scan for ${prospectLabel}\n\nYou mentioned ${painSentence}. We can run a fixed-scope Google Workspace risk scan, show what was inspected and skipped, stage any recommendation for human approval, and leave you with a redacted SOC2 readiness evidence packet for your buyer conversation. The pilot is $199 for one day and only uses consented data sources.`,
      claimBoundary: "Readiness evidence only; no certification, legal, audit, or guaranteed buyer outcome claim.",
      nextAction: "Send after attaching the one-page scope and consent boundary."
    },
    {
      id: "scope-call",
      label: "20-minute scope-call script",
      channel: "call-script",
      status: targetProspect ? "ready" : "blocked",
      copy:
        "Confirm the buyer deadline, Workspace sources in scope, content that must stay out of AI context, approval owner, success criteria, invoice contact, and whether a redacted Trust Packet can be shared with the buyer.",
      claimBoundary: "Do not promise full coverage; define exactly what is scanned and what remains out of scope.",
      nextAction: "Use during the first live call before requesting OAuth access."
    },
    {
      id: "pilot-proposal",
      label: "Fixed-scope pilot proposal",
      channel: "proposal",
      status: targetProspect ? "ready" : "blocked",
      copy:
        "Deliverables: consented Workspace metadata/content sample scan, low-risk skip proof, deterministic sensitive-data checks, Gemini semantic review only when justified, staged recommendation review, one approved remediation or false-positive decision, redacted evidence packet, and private proof register.",
      claimBoundary: "Proposal describes operational deliverables, not compliance certification.",
      nextAction: "Attach to invoice and consent request."
    },
    {
      id: "consent-clause",
      label: "Consent and data boundary",
      channel: "consent",
      status: "needs-proof",
      copy:
        "Customer authorizes a fixed-scope review of agreed Google Workspace resources for risk detection and readiness evidence. Non-trivial remediation requires customer approval. Customer names, raw files, secrets, invoices, and findings are not shared publicly without explicit consent.",
      claimBoundary: "Consent text is operational and should be reviewed by the responsible owner before use.",
      nextAction: "Register signed consent in the Evidence Vault before scanning live data."
    },
    {
      id: "invoice-checklist",
      label: "Invoice and proof checklist",
      channel: "invoice",
      status: sentinelConfig.evidenceMode === "production" ? "needs-proof" : "blocked",
      copy:
        "Record invoice id, payment status, revenue month, amount, payer relationship, active users, cost/CAC record, and whether testimonial use is consented. Keep raw payment data private.",
      claimBoundary: "Do not count revenue as XPRIZE proof until arms-length payment evidence exists.",
      nextAction: "Register invoice and payment export artifacts with checksums."
    },
    {
      id: "proof-attachment-list",
      label: "Proof attachments",
      channel: "evidence",
      status: hasTrustPacket && hasQuestionnaire ? "ready" : "needs-proof",
      copy:
        "Attach redacted Trust Packet, questionnaire response excerpt, launch plan, Evidence Vault checklist, and claim boundaries. Replace seeded screenshots with hosted production proof before final submission.",
      claimBoundary: "Public attachments must be redacted and consented.",
      nextAction: hasTrustPacket && hasQuestionnaire ? "Attach to follow-up." : "Create Trust Packet and questionnaire proof first."
    }
  ];
}

function buildEvidenceChecklist(snapshot: PilotConversionSnapshot): PilotConversionKit["evidenceChecklist"] {
  return [
    checklistItem(snapshot, "pilot-invoice", "Pilot invoice", "finance", "/api/evidence/vault", "Register a private invoice artifact."),
    checklistItem(snapshot, "payment-export", "Payment export", "finance", "/api/evidence/vault", "Register a payment export or receipt."),
    checklistItem(snapshot, "pilot-consent", "Pilot consent and scope proof", "legal", "/api/pilots/consent-packet", "Register signed data-access consent and scope packet."),
    checklistItem(snapshot, "active-user-log", "Active-user proof", "sales", "/api/evidence/vault", "Attach product analytics or Workspace install logs."),
    checklistItem(snapshot, "testimonial-consent", "Testimonial consent", "sales", "/api/evidence/vault", "Collect explicit testimonial or feedback consent."),
    checklistItem(snapshot, "workspace-oauth-log", "Workspace OAuth/sync log", "engineering", "/api/workspace/sync/reconcile", "Attach OAuth install and cursor reconciliation proof."),
    checklistItem(snapshot, "gemini-usage-log", "Gemini usage log", "engineering", "/api/agent-runs", "Attach model, timestamp, token, and cost metadata."),
    checklistItem(snapshot, "cloud-billing-proof", "Cloud billing and cost proof", "engineering", "/api/production/cost-controls", "Attach budget, quota, and key restriction proof."),
    checklistItem(snapshot, "customer-reference", "Customer relationship proof", "founder", "/api/evidence/vault", "Register private customer reference proof.")
  ];
}

function checklistItem(
  snapshot: PilotConversionSnapshot,
  id: EvidenceVaultArtifactKind,
  label: string,
  ownerRole: ConversionEvidenceOwnerRole,
  source: string,
  nextAction: string
) {
  const artifact = snapshot.evidenceVaultArtifacts.find((item) => item.kind === id);
  const status = artifactStatusToConversionStatus(artifact?.status);

  return {
    id,
    label,
    status,
    ownerRole,
    source,
    nextAction: status === "ready" ? "Keep artifact redacted and ready for private judge request." : nextAction
  };
}

function hasEvidence(snapshot: PilotConversionSnapshot, kinds: string[]) {
  return snapshot.evidenceVaultArtifacts.some((artifact) => kinds.includes(artifact.kind) && artifactStatusToConversionStatus(artifact.status) === "ready");
}

function artifactStatusToConversionStatus(status?: EvidenceVaultArtifactStatus): PilotConversionStatus {
  if (status === "verified" || status === "uploaded") {
    return "ready";
  }

  if (status === "requested" || status === "needs-redaction") {
    return "needs-proof";
  }

  return "blocked";
}

function buildBlockers(
  snapshot: PilotConversionSnapshot,
  targetProspect: PilotProspectRecord | undefined,
  steps: PilotConversionStep[],
  evidenceChecklist: PilotConversionKit["evidenceChecklist"]
) {
  return [
    ...(targetProspect ? [] : ["No high-fit target prospect is available for conversion."]),
    ...(sentinelConfig.evidenceMode !== "production" ? ["SENTINEL_EVIDENCE_MODE is not production, so closed-pilot proof remains local planning evidence."] : []),
    ...steps.filter((step) => step.status === "blocked").map((step) => `${step.label}: ${step.nextAction}`),
    ...evidenceChecklist.filter((item) => item.status === "blocked").map((item) => `${item.label}: ${item.nextAction}`),
    ...(snapshot.trustPackets.length ? [] : ["No Trust Packet is available for proof-backed outreach."]),
    ...(snapshot.questionnairePacks.length ? [] : ["No questionnaire response pack is available for proof-backed outreach."])
  ].slice(0, 12);
}

function buildNextActions(
  blockers: string[],
  targetProspect: PilotProspectRecord | undefined,
  assets: PilotConversionAsset[]
) {
  if (!blockers.length) {
    return [
      "Send the founder close email and proposal to the target prospect.",
      "Collect consent and invoice/payment evidence before Workspace OAuth access.",
      "Run the scan, stage remediation, and generate private judge evidence immediately after the paid pilot."
    ];
  }

  return [
    ...(targetProspect ? [`Prioritize ${targetProspect.prospectAlias}: ${targetProspect.nextAction}`] : ["Add one high-fit arms-length prospect with a concrete security-review deadline."]),
    ...assets.filter((asset) => asset.status !== "ready").map((asset) => asset.nextAction),
    "Create a Trust Packet and questionnaire excerpt before the next outreach.",
    "Register invoice, payment, active-user, consent, Gemini, Workspace, and cost artifacts in the Evidence Vault."
  ].slice(0, 8);
}

function scoreConversionReadiness(
  snapshot: PilotConversionSnapshot,
  targetProspect: PilotProspectRecord | undefined,
  steps: PilotConversionStep[],
  evidenceChecklist: PilotConversionKit["evidenceChecklist"]
) {
  const stepScore = steps.reduce((total, stepItem) => total + scoreForStatus(stepItem.status), 0) / steps.length;
  const evidenceScore = evidenceChecklist.reduce((total, item) => total + scoreForStatus(item.status), 0) / evidenceChecklist.length;
  const targetScore = targetProspect ? targetProspect.fitScore : 0;
  const proofBoost = Math.min(10, snapshot.trustPackets.length * 4 + snapshot.questionnairePacks.length * 3 + snapshot.agentRuns.length * 2);

  return Math.round(targetScore * 0.35 + stepScore * 0.35 + evidenceScore * 0.2 + proofBoost);
}

function scoreForStatus(status: PilotConversionStatus) {
  if (status === "ready") {
    return 100;
  }

  if (status === "needs-proof") {
    return 55;
  }

  return 0;
}

function resolveStatus(blockers: string[], score: number): PilotConversionStatus {
  if (
    blockers.some((blocker) => {
      const normalized = blocker.toLowerCase();
      return normalized.includes("no high-fit") || normalized.includes("invoice") || normalized.includes("payment");
    })
  ) {
    return "blocked";
  }

  return score >= 80 && blockers.length === 0 ? "ready" : "needs-proof";
}

function step(input: PilotConversionStep): PilotConversionStep {
  return input;
}

function sentenceWithoutTerminalPunctuation(value: string) {
  return value.trim().replace(/[.!?]+$/u, "");
}

function stagePriority(stage: PilotProspectRecord["stage"]) {
  switch (stage) {
    case "won":
      return 7;
    case "pilot-started":
      return 6;
    case "pilot-proposed":
      return 5;
    case "demo-scheduled":
      return 4;
    case "contacted":
      return 3;
    case "targeted":
      return 2;
    case "lost":
      return 0;
    default:
      return 1;
  }
}
