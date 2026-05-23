import { sentinelConfig } from "@/lib/config";
import { buildEvidenceVault } from "@/lib/evidence-vault";
import { buildPilotConversionKit } from "@/lib/pilot-conversion";
import type {
  DashboardSnapshot,
  EvidenceIntakeItem,
  EvidenceIntakePriority,
  EvidenceIntakeQueue,
  EvidenceIntakeStatus,
  EvidenceVaultArtifact,
  EvidenceVaultArtifactKind
} from "@/lib/types";

type EvidenceIntakeSnapshot = Pick<
  DashboardSnapshot,
  | "tenant"
  | "pilotRecords"
  | "pilotProspects"
  | "evidenceVaultArtifacts"
  | "trustPackets"
  | "questionnairePacks"
  | "agentRuns"
  | "findings"
  | "remediations"
  | "auditEvents"
  | "connections"
>;

export function buildEvidenceIntakeQueue(snapshot: EvidenceIntakeSnapshot): EvidenceIntakeQueue {
  const vault = buildEvidenceVault(snapshot);
  const conversionKit = buildPilotConversionKit(snapshot);
  const conversionKinds = new Set(conversionKit.evidenceChecklist.map((item) => item.id));
  const items = vault.requiredArtifacts
    .map((artifact) => buildIntakeItem(artifact, conversionKinds))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || statusRank(a.status) - statusRank(b.status) || a.label.localeCompare(b.label));
  const proofQualityScore = scoreProofQuality(items);
  const criticalMissing = items.filter((item) => item.priority === "p0" && item.status === "blocked").length;
  const redactionBacklog = items.filter((item) => item.status === "needs-redaction").length;
  const overallStatus = resolveOverallStatus(vault.evidenceMode, criticalMissing, redactionBacklog, proofQualityScore);

  return {
    generatedAt: new Date().toISOString(),
    overallStatus,
    evidenceMode: vault.evidenceMode,
    proofQualityScore,
    items,
    criticalMissing,
    redactionBacklog,
    nextActions: buildNextActions(items, criticalMissing, redactionBacklog),
    claimBoundaries: [
      "A registered artifact is a private intake record until it is redacted, checksummed, verified, and backed by production storage.",
      "Do not publish customer names, invoice values tied to identities, OAuth tokens, raw Workspace content, secrets, or security findings.",
      "Do not count an artifact as XPRIZE proof while SENTINEL_EVIDENCE_MODE is mock or the source is seeded/local-only.",
      "Only consented testimonials and redacted aggregate metrics can appear in public submission materials."
    ],
    disclaimer:
      "The intake queue prioritizes private proof collection. It does not verify customer payment, user activity, Google Cloud usage, legal consent, or compliance certification by itself."
  };
}

function buildIntakeItem(artifact: EvidenceVaultArtifact, conversionKinds: Set<string>): EvidenceIntakeItem {
  const priority = priorityForArtifact(artifact, conversionKinds);
  const status = statusForArtifact(artifact);
  const guidance = guidanceForKind(artifact.kind);

  return {
    id: `intake_${artifact.id}`,
    artifactId: artifact.id,
    kind: artifact.kind,
    label: artifact.label,
    priority,
    status,
    artifactStatus: artifact.status,
    ownerRole: artifact.ownerRole,
    requiredFor: artifact.requiredFor,
    whyNeeded: whyNeededForArtifact(artifact, priority),
    acceptedProof: guidance.acceptedProof,
    redactionChecklist: guidance.redactionChecklist,
    rejectionTriggers: guidance.rejectionTriggers,
    registrationPayload: {
      id: artifact.id,
      kind: artifact.kind,
      label: artifact.label,
      ownerRole: artifact.ownerRole,
      status: status === "blocked" ? "requested" : artifact.status,
      redacted: false,
      sourceDescription: artifact.sourceDescription,
      privateHandling: artifact.privateHandling,
      requiredFor: artifact.requiredFor,
      nextAction: artifact.nextAction,
      linkedPilotId: artifact.linkedPilotId,
      linkedFinancialItemId: artifact.linkedFinancialItemId,
      amountUsd: artifact.amountUsd,
      customerAlias: artifact.customerAlias
    },
    nextAction: nextActionForIntake(artifact, status)
  };
}

function priorityForArtifact(artifact: EvidenceVaultArtifact, conversionKinds: Set<string>): EvidenceIntakePriority {
  if (conversionKinds.has(artifact.kind) || artifact.requiredFor === "Business Viability") {
    return "p0";
  }

  if (artifact.requiredFor === "AI-Native Operations" || artifact.requiredFor === "Submission Logistics") {
    return "p1";
  }

  return "p2";
}

function statusForArtifact(artifact: EvidenceVaultArtifact): EvidenceIntakeStatus {
  if (artifact.status === "verified" && artifact.redacted && artifact.checksumSha256) {
    return "ready";
  }

  if (artifact.status === "uploaded" || artifact.status === "verified" || artifact.status === "needs-redaction") {
    return artifact.redacted ? "needs-proof" : "needs-redaction";
  }

  if (artifact.status === "requested") {
    return "needs-proof";
  }

  return "blocked";
}

function whyNeededForArtifact(artifact: EvidenceVaultArtifact, priority: EvidenceIntakePriority) {
  const prefix =
    priority === "p0"
      ? "Required to make paid-pilot revenue, users, or consent defensible."
      : priority === "p1"
        ? "Required to prove deployed Google/Gemini/submission readiness."
        : "Required to improve prospect trust and buyer review readiness.";

  return `${prefix} ${artifact.sourceDescription}`;
}

function nextActionForIntake(artifact: EvidenceVaultArtifact, status: EvidenceIntakeStatus) {
  if (status === "ready") {
    return "Keep this artifact private and available for judge request.";
  }

  if (status === "needs-redaction") {
    return "Redact customer-identifying and security-sensitive fields, add checksum, then mark verified after owner review.";
  }

  if (status === "needs-proof") {
    return "Attach source proof, confirm owner review, add checksum if verified, and keep raw data private.";
  }

  if (artifact.status === "mock-only") {
    return "Replace seeded/local proof with real production evidence before counting it.";
  }

  return artifact.nextAction;
}

function guidanceForKind(kind: EvidenceVaultArtifactKind) {
  const common = {
    redactionChecklist: [
      "Replace customer/company names with aliases unless explicit naming consent exists.",
      "Remove emails, tokens, raw file names, domains, invoice identifiers, and security finding details from public exports.",
      "Keep the source document private and expose only status, owner, checksum, and redacted summary."
    ],
    rejectionTriggers: [
      "Related-party or seeded demo evidence is presented as arms-length revenue.",
      "The artifact contains secrets, tokens, raw Workspace content, or unconsented customer identity.",
      "The artifact is marked verified without owner review and SHA-256 checksum."
    ]
  };

  switch (kind) {
    case "pilot-consent":
      return {
        acceptedProof: ["Signed pilot consent and scope packet.", "Allowed Workspace sources and excluded-data boundary.", "Customer approval owner, date, and redaction/naming preference."],
        ...common
      };
    case "pilot-invoice":
    case "payment-export":
      return {
        acceptedProof: ["Paid invoice PDF or payment processor receipt.", "Bank/payment export with payer identity privately reviewable.", "Revenue month and related-party note."],
        ...common
      };
    case "active-user-log":
      return {
        acceptedProof: ["Product analytics screenshot/export.", "Workspace install log or allowlisted pilot user count.", "Dated usage summary for the pilot period."],
        ...common
      };
    case "testimonial-consent":
    case "customer-reference":
      return {
        acceptedProof: ["Signed consent, approval email, or recorded testimonial permission.", "Allowed quote text and naming/redaction preference.", "Customer reference owner and expiry/review date."],
        ...common
      };
    case "cloud-billing-proof":
    case "cloud-run-proof":
    case "gcp-persistence-proof":
    case "production-readiness-report":
    case "cost-receipt":
    case "cac-receipt":
      return {
        acceptedProof: [
          "Hosted verification JSON, Cloud Run deploy output, or Google Cloud API response.",
          "Cloud Billing budget/export, persistence write-through, or operating receipt.",
          "Redacted checksum and owner review note."
        ],
        ...common
      };
    case "gemini-usage-log":
      return {
        acceptedProof: ["Gemini model name, timestamp, request/cost metadata, and guardrail decision.", "Redacted app log from deployed workflow.", "Budget/quota context for the run."],
        ...common
      };
    case "workspace-oauth-log":
      return {
        acceptedProof: ["OAuth install timestamp and scopes.", "Drive start/page token and Gmail history cursor evidence.", "Sync reconciliation log without raw customer content."],
        ...common
      };
    case "product-url-proof":
    case "repository-proof":
    case "demo-video-proof":
      return {
        acceptedProof: ["Hosted URL, repository URL, or public demo video URL.", "Judge access/testing note.", "Human review note for license, privacy, and asset clearance."],
        ...common
      };
    case "trust-policy":
      return {
        acceptedProof: ["Reviewed security/trust policy.", "Prospect-safe summary and owner approval.", "Expiry or next-review date."],
        ...common
      };
    default:
      return {
        acceptedProof: ["Private source artifact with owner review.", "Redacted summary.", "Checksum if marked verified."],
        ...common
      };
  }
}

function scoreProofQuality(items: EvidenceIntakeItem[]) {
  if (!items.length) {
    return 0;
  }

  const total = items.reduce((sum, item) => sum + weightForPriority(item.priority) * scoreForStatus(item.status), 0);
  const max = items.reduce((sum, item) => sum + weightForPriority(item.priority) * 100, 0);
  return Math.round((total / max) * 100);
}

function resolveOverallStatus(
  evidenceMode: EvidenceIntakeQueue["evidenceMode"],
  criticalMissing: number,
  redactionBacklog: number,
  proofQualityScore: number
): EvidenceIntakeQueue["overallStatus"] {
  if (evidenceMode !== "production" || sentinelConfig.storageMode !== "gcp-rest" || criticalMissing > 0) {
    return "blocked";
  }

  return proofQualityScore >= 90 && redactionBacklog === 0 ? "ready" : "needs-proof";
}

function buildNextActions(items: EvidenceIntakeItem[], criticalMissing: number, redactionBacklog: number) {
  return [
    ...(criticalMissing > 0 ? [`Collect ${criticalMissing} priority-zero paid-pilot artifact(s) before treating revenue, users, or consent as judge proof.`] : []),
    ...(redactionBacklog > 0 ? [`Redact ${redactionBacklog} uploaded/verified artifact(s) before any judge-facing export.`] : []),
    ...items
      .filter((item) => item.status !== "ready")
      .slice(0, 5)
      .map((item) => `${item.label}: ${item.nextAction}`),
    "Register artifacts with POST /api/evidence/vault, then regenerate the Evidence Vault, conversion kit, and submission binder."
  ].slice(0, 8);
}

function scoreForStatus(status: EvidenceIntakeStatus) {
  if (status === "ready") {
    return 100;
  }

  if (status === "needs-proof") {
    return 55;
  }

  if (status === "needs-redaction") {
    return 35;
  }

  return 0;
}

function weightForPriority(priority: EvidenceIntakePriority) {
  if (priority === "p0") {
    return 3;
  }

  if (priority === "p1") {
    return 2;
  }

  return 1;
}

function priorityRank(priority: EvidenceIntakePriority) {
  return priority === "p0" ? 0 : priority === "p1" ? 1 : 2;
}

function statusRank(status: EvidenceIntakeStatus) {
  switch (status) {
    case "blocked":
      return 0;
    case "needs-redaction":
      return 1;
    case "needs-proof":
      return 2;
    case "ready":
      return 3;
    default:
      return 4;
  }
}
