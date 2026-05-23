import { buildWorkspaceOAuthPlan } from "@/lib/workspace-oauth";
import type {
  DashboardSnapshot,
  EvidenceVaultArtifactKind,
  PilotConsentPacket,
  PilotConsentPacketChecklistItem,
  PilotConversionStatus,
  PilotProspectRecord
} from "@/lib/types";

type PilotConsentSnapshot = Pick<
  DashboardSnapshot,
  "pilotProspects" | "evidenceVaultArtifacts" | "trustPackets" | "questionnairePacks" | "connections"
>;

export function buildPilotConsentPacket(snapshot: PilotConsentSnapshot): PilotConsentPacket {
  const targetProspect = selectTargetProspect(snapshot.pilotProspects);
  const consentReady = hasEvidence(snapshot, "pilot-consent");
  const hasTrustProof = snapshot.trustPackets.length > 0 || snapshot.questionnairePacks.length > 0;
  const oauthPlan = buildWorkspaceOAuthPlan();
  const consentChecklist = buildConsentChecklist(snapshot, Boolean(targetProspect), consentReady, hasTrustProof);
  const blockers = buildBlockers(targetProspect, consentChecklist, oauthPlan.configured);
  const authorizationScore = scoreAuthorizationReadiness(consentChecklist, oauthPlan.configured);
  const status = resolveStatus(targetProspect, consentReady, blockers);
  const packet = {
    generatedAt: new Date().toISOString(),
    status,
    targetProspect,
    authorizationScore,
    packetTitle: "One-day Google Workspace risk scan consent and scope packet",
    pilotOffer: "$199 one-day Google Workspace risk scan plus SOC2 readiness evidence packet.",
    customerSummary:
      "Customer authorizes a fixed-scope Google Workspace risk review for agreed sources only. Sentinel stages findings and recommendations for human approval and keeps raw customer data, secrets, invoices, OAuth tokens, and findings private.",
    allowedWorkspaceSources: [
      {
        label: "Google Drive metadata and consented sampled file text",
        status: "included",
        reason: "Needed to detect risky sharing and sensitive-data exposure in the agreed pilot scope."
      },
      {
        label: "Gmail metadata and labels",
        status: "included",
        reason: "Needed to reconcile Workspace change history without reading message bodies by default."
      },
      {
        label: "One agreed high-risk sample event",
        status: "included",
        reason: "Needed to demonstrate deterministic screening, Gemini semantic review when justified, and HITL recommendation flow."
      }
    ],
    excludedData: [
      {
        label: "OAuth refresh tokens and secrets",
        status: "excluded",
        reason: "Stored only in Secret Manager in production and never included in logs, prompts, or exports."
      },
      {
        label: "Customer-wide Drive/Gmail content crawl",
        status: "excluded",
        reason: "The paid pilot is a fixed-scope scan, not a complete domain-wide audit."
      },
      {
        label: "Restricted Drive mutation scope",
        status: "deferred",
        reason: "Requested only after paid pilot need is proven and the customer explicitly approves human-reviewed remediation."
      }
    ],
    oauthScopes: [
      ...oauthPlan.requestedScopes.map((scope) => ({
        scope: scope.scope,
        sensitivity: scope.sensitivity,
        status: "requested" as const,
        reason: scope.reason
      })),
      ...oauthPlan.deferredScopes.map((scope) => ({
        scope: scope.scope,
        sensitivity: scope.sensitivity,
        status: "deferred" as const,
        reason: scope.reason
      }))
    ],
    aiDataRules: [
      "Tier 0 and Tier 1 filters run before Gemini so low-risk metadata changes are skipped.",
      "Gemini receives only justified, bounded samples after budget/model/data-minimization checks pass.",
      "Detector quotes, secrets, raw customer files, and OAuth tokens are excluded from public exports.",
      "If Gemini is blocked by policy, deterministic staged findings can still be reviewed by a human."
    ],
    remediationRules: [
      "Non-trivial remediation starts as a staged recommendation.",
      "Customer approval is required before changing sharing permissions or labels.",
      "Every approval, dismissal, false positive, rescan, and remediation writes an audit event.",
      "Safe auto-actions must be explicitly enabled by the tenant and cannot include broad mutation by default."
    ],
    evidenceArtifacts: [
      artifact("pilot-consent", "Signed pilot consent and scope packet", "Workspace OAuth install"),
      artifact("workspace-oauth-log", "OAuth install and sync cursor proof", "Judge evidence export"),
      artifact("gemini-usage-log", "Gemini usage and cost metadata", "Judge evidence export"),
      artifact("pilot-invoice", "Pilot invoice", "Revenue evidence"),
      artifact("payment-export", "Payment export or receipt", "Revenue evidence")
    ],
    signatureFields: [
      "Customer organization alias or legal name for private record.",
      "Customer approver name, role, email, and signature date.",
      "Allowed Workspace sources and excluded data confirmation.",
      "Permission to store redacted proof artifacts privately for judge or buyer review.",
      "Separate consent flag for testimonial or public naming."
    ],
    consentChecklist,
    blockers,
    nextActions: buildNextActions(targetProspect, consentChecklist, oauthPlan.configured),
    claimBoundaries: [
      "This packet authorizes a fixed-scope operational pilot; it is not certification, legal review, audit assurance, or a complete security assessment.",
      "Do not request live Workspace OAuth until the signed consent packet is registered as a pilot-consent artifact.",
      "Do not publish customer names, raw files, findings, OAuth details, or testimonials unless the packet explicitly permits that use.",
      "Keep Marketplace listing and restricted Drive mutation scope separate from the first consented pilot."
    ],
    exportText: "",
    disclaimer:
      "This consent packet is an operational scope and evidence-control aid. It does not provide legal advice, audit assurance, certification, or a guarantee that a customer will pass a security review."
  } satisfies PilotConsentPacket;

  return {
    ...packet,
    exportText: buildExportText(packet)
  };
}

function buildConsentChecklist(
  snapshot: PilotConsentSnapshot,
  hasTarget: boolean,
  consentReady: boolean,
  hasTrustProof: boolean
): PilotConsentPacketChecklistItem[] {
  const hasOauthInstall = snapshot.connections.some((connection) => connection.mode === "oauth" || connection.mode === "domain-wide-delegation");

  return [
    item("target", "High-fit prospect selected", hasTarget ? "ready" : "blocked", "founder", undefined, "Select one arms-length prospect with a concrete buyer deadline."),
    item(
      "scope",
      "Allowed sources and excluded data written down",
      hasTarget ? "ready" : "blocked",
      "legal",
      "pilot-consent",
      "Attach the consent packet with included/excluded data boundaries."
    ),
    item(
      "trust-proof",
      "Proof-backed context available",
      hasTrustProof ? "ready" : "needs-proof",
      "sales",
      undefined,
      "Create a Trust Packet or questionnaire response pack before asking for OAuth."
    ),
    item(
      "signature",
      "Signed consent artifact registered",
      consentReady ? "ready" : "needs-proof",
      "legal",
      "pilot-consent",
      "Register the signed pilot-consent artifact in the Evidence Vault."
    ),
    item(
      "oauth",
      "OAuth install gated behind consent",
      hasOauthInstall ? "ready" : consentReady ? "needs-proof" : "blocked",
      "engineering",
      "workspace-oauth-log",
      consentReady ? "Install OAuth and register cursor proof." : "Do not request OAuth until consent is signed."
    )
  ];
}

function buildBlockers(
  targetProspect: PilotProspectRecord | undefined,
  checklist: PilotConsentPacketChecklistItem[],
  oauthConfigured: boolean
) {
  return [
    ...(targetProspect ? [] : ["No target prospect selected for consent packet."]),
    ...checklist.filter((check) => check.status === "blocked").map((check) => `${check.label}: ${check.nextAction}`),
    ...(oauthConfigured ? [] : ["OAuth client credentials are not configured, so live consent URL generation remains blocked."])
  ].slice(0, 8);
}

function buildNextActions(
  targetProspect: PilotProspectRecord | undefined,
  checklist: PilotConsentPacketChecklistItem[],
  oauthConfigured: boolean
) {
  const open = checklist.filter((check) => check.status !== "ready");

  return [
    ...(targetProspect ? [`Send the scope packet to ${targetProspect.prospectAlias} before requesting OAuth.`] : ["Select a high-fit arms-length prospect."]),
    ...open.slice(0, 4).map((check) => check.nextAction),
    ...(oauthConfigured ? ["Use the OAuth launch URL only after consent is signed."] : ["Configure Google OAuth env vars after signed consent is available."]),
    "Register signed consent, OAuth install proof, Gemini usage metadata, invoice, and payment export in the Evidence Vault."
  ].slice(0, 8);
}

function scoreAuthorizationReadiness(checklist: PilotConsentPacketChecklistItem[], oauthConfigured: boolean) {
  const checklistScore = checklist.reduce((sum, check) => sum + scoreForStatus(check.status), 0) / checklist.length;
  return Math.round(checklistScore * 0.85 + (oauthConfigured ? 15 : 0));
}

function resolveStatus(targetProspect: PilotProspectRecord | undefined, consentReady: boolean, blockers: string[]): PilotConversionStatus {
  if (!targetProspect || blockers.some((blocker) => blocker.includes("OAuth install gated"))) {
    return "blocked";
  }

  return consentReady && blockers.length === 0 ? "ready" : "needs-proof";
}

function hasEvidence(snapshot: PilotConsentSnapshot, kind: EvidenceVaultArtifactKind) {
  return snapshot.evidenceVaultArtifacts.some((artifactItem) => artifactItem.kind === kind && artifactItem.status === "verified" && artifactItem.redacted);
}

function selectTargetProspect(prospects: PilotProspectRecord[]) {
  return [...prospects]
    .filter((prospect) => prospect.stage !== "lost")
    .sort((a, b) => stagePriority(b.stage) - stagePriority(a.stage) || b.fitScore - a.fitScore || b.estimatedMrrUsd - a.estimatedMrrUsd)[0];
}

function item(
  id: string,
  label: string,
  status: PilotConversionStatus,
  ownerRole: PilotConsentPacketChecklistItem["ownerRole"],
  evidenceArtifactKind: EvidenceVaultArtifactKind | undefined,
  nextAction: string
): PilotConsentPacketChecklistItem {
  return {
    id,
    label,
    status,
    ownerRole,
    evidenceArtifactKind,
    nextAction
  };
}

function artifact(kind: EvidenceVaultArtifactKind, label: string, requiredBefore: string) {
  return { kind, label, requiredBefore };
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

function buildExportText(packet: Omit<PilotConsentPacket, "exportText">) {
  return [
    `# ${packet.packetTitle}`,
    "",
    `Target: ${packet.targetProspect?.prospectAlias ?? "Not selected"}`,
    `Status: ${packet.status}`,
    `Authorization score: ${packet.authorizationScore}`,
    "",
    "## Customer Summary",
    packet.customerSummary,
    "",
    "## Allowed Sources",
    ...packet.allowedWorkspaceSources.map((scope) => `- ${scope.label}: ${scope.reason}`),
    "",
    "## Excluded Or Deferred",
    ...packet.excludedData.map((scope) => `- ${scope.label}: ${scope.reason}`),
    "",
    "## Requested OAuth Scopes",
    ...packet.oauthScopes.map((scope) => `- ${scope.scope}: ${scope.status}; ${scope.reason}`),
    "",
    "## Approval Rules",
    ...packet.remediationRules.map((rule) => `- ${rule}`),
    "",
    "## Signature Fields",
    ...packet.signatureFields.map((field) => `- ${field}`),
    "",
    "## Claim Boundaries",
    ...packet.claimBoundaries.map((boundary) => `- ${boundary}`),
    "",
    packet.disclaimer
  ].join("\n");
}
