import { buildQuestionnaireDraft } from "@/lib/questionnaire";
import { sentinelConfig } from "@/lib/config";
import type {
  DashboardSnapshot,
  TrustAccessRequest,
  TrustCenterAnalytics,
  TrustCenterProfile,
  TrustEngagementStage,
  TrustPacket,
  TrustPacketSection,
  TrustProspectEngagement
} from "@/lib/types";

export function buildTrustCenterProfile(snapshot: DashboardSnapshot): TrustCenterProfile {
  const remediated = snapshot.findings.filter((finding) => finding.status === "remediated").length;
  const criticalOpen = snapshot.findings.filter(
    (finding) => finding.severity === "critical" && finding.status !== "remediated" && finding.status !== "dismissed"
  ).length;
  const readinessPostureScore = Math.max(35, Math.min(96, 78 + remediated * 8 - criticalOpen * 14));

  return {
    generatedAt: new Date().toISOString(),
    publicName: "SME Workspace Sentinel Trust Center Lite",
    headline: "Google Workspace-first SOC2 readiness evidence for seed-stage teams.",
    readinessPostureScore,
    approvedClaims: [
      "Human approval is required before non-trivial remediation.",
      "Judge and prospect exports are redacted by default.",
      "The scanner uses deterministic DLP first and routes only justified samples to Gemini.",
      "The product tracks revenue, cost, user, testimonial, and AI-operation evidence for XPRIZE review."
    ],
    restrictedClaims: [
      "Does not certify SOC2 compliance.",
      "Does not replace a CPA auditor, lawyer, or formal security assessment.",
      "Does not publicly expose customer security findings."
    ],
    evidenceLinks: [
      { label: "Risks detected", kind: "metric", value: String(snapshot.findings.length) },
      { label: "Public exposures closed", kind: "metric", value: String(remediated) },
      { label: "Agent runs", kind: "metric", value: String(snapshot.agentRuns.length) },
      { label: "Public trust documents", kind: "document", value: String(snapshot.trustDocuments.filter((item) => item.visibility === "public").length) },
      { label: "Requestable trust documents", kind: "document", value: String(snapshot.trustDocuments.filter((item) => item.visibility === "requestable").length) },
      { label: "Consented testimonials", kind: "testimonial", value: String(snapshot.tenant.evidence.testimonials.filter((item) => item.consentToShare).length) },
      { label: "Latest audit event", kind: "audit-log", value: snapshot.auditEvents[0]?.message ?? "No audit events yet" }
    ],
    accessRequestWorkflow: [
      "Prospect requests access to selected trust documents.",
      "NDA-gated documents require explicit NDA acceptance before approval.",
      "Admin approves only public or requestable documents; private customer findings stay internal.",
      "Prospect receives a time-limited packet with approved claims, evidence links, and approved document summaries.",
      "Any questionnaire answer remains draft-only until human approval."
    ],
    disclaimer:
      "This profile is readiness evidence only. It does not represent audit assurance, certification, legal advice, or a guarantee of compliance."
  };
}

export function buildTrustPacket(
  snapshot: DashboardSnapshot,
  input: {
    id: string;
    token: string;
    prospectAlias: string;
    prospectDomain?: string;
    createdAt: string;
    expiresAt: string;
    sections?: TrustPacketSection[];
    accessRequest?: TrustAccessRequest;
  }
): TrustPacket {
  const sections = input.sections?.length ? input.sections : defaultTrustPacketSections;
  const profile = redactProfileForProspect(buildTrustCenterProfile(snapshot));
  const publicExposuresClosed = snapshot.remediations.filter(
    (remediation) => remediation.action === "disable_public_sharing" && remediation.outcome !== "failed"
  ).length;
  const consentedTestimonials = snapshot.tenant.evidence.testimonials.filter((testimonial) => testimonial.consentToShare);
  const questionnaire = buildQuestionnaireDraft(snapshot);
  const approvedDocuments = sections.includes("approved-documents")
    ? buildApprovedDocuments(snapshot, input.accessRequest)
    : [];

  return {
    id: input.id,
    token: input.token,
    tenantId: snapshot.tenant.id,
    prospectAlias: input.prospectAlias,
    prospectDomain: input.prospectDomain,
    status: Date.parse(input.expiresAt) <= Date.now() ? "expired" : "active",
    redacted: true,
    sections,
    accessRequestId: input.accessRequest?.id,
    accessUrl: `/api/trust-center/packets/${input.token}`,
    accessCount: 0,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    profile,
    summaryMetrics: {
      risksDetected: snapshot.findings.length,
      publicExposuresClosed,
      filesInspected: snapshot.aggregateCounters.filesInspected,
      bytesRoutedToGemini: snapshot.aggregateCounters.bytesRoutedToGemini,
      agentRuns: snapshot.agentRuns.length,
      consentedTestimonials: consentedTestimonials.length,
      approvedDocuments: approvedDocuments.length
    },
    approvedDocuments,
    aiOperations: sections.includes("ai-operations")
      ? snapshot.agentRuns.slice(0, 8).map((run) => ({
          purpose: run.purpose,
          model: run.model,
          provider: run.provider,
          estimatedCostUsd: run.estimatedCostUsd,
          completedAt: run.completedAt
        }))
      : [],
    testimonials: sections.includes("consented-testimonials")
      ? consentedTestimonials.map((testimonial) => ({
          ...testimonial,
          customerName: "Consented pilot customer"
        }))
      : [],
    questionnairePreview: sections.includes("questionnaire-preview") ? questionnaire.questions.slice(0, 3) : [],
    disclaimer:
      "This redacted Trust Packet is time-limited prospect evidence. It excludes customer security findings, private invoices, secrets, and non-consented testimonials."
  };
}

export function buildTrustCenterAnalytics(
  snapshot: Pick<DashboardSnapshot, "trustPackets" | "trustAccessRequests">
): TrustCenterAnalytics {
  const packets = snapshot.trustPackets;
  const packetsCreated = packets.length;
  const totalPacketAccesses = packets.reduce((total, packet) => total + packet.accessCount, 0);
  const topProspects = buildProspectEngagement(packets);

  return {
    generatedAt: new Date().toISOString(),
    packetsCreated,
    activePackets: packets.filter((packet) => packet.status === "active" && Date.parse(packet.expiresAt) > Date.now()).length,
    expiredPackets: packets.filter((packet) => packet.status === "expired" || Date.parse(packet.expiresAt) <= Date.now()).length,
    totalPacketAccesses,
    accessedPackets: packets.filter((packet) => packet.accessCount > 0).length,
    pendingAccessRequests: snapshot.trustAccessRequests.filter((request) => request.status === "pending").length,
    approvedAccessRequests: snapshot.trustAccessRequests.filter((request) => request.status === "approved").length,
    deniedAccessRequests: snapshot.trustAccessRequests.filter((request) => request.status === "denied").length,
    averageAccessesPerPacket: packetsCreated ? Number((totalPacketAccesses / packetsCreated).toFixed(1)) : 0,
    topProspects,
    followUpQueue: buildFollowUpQueue(topProspects),
    productionGaps: buildTrustAnalyticsProductionGaps(packetsCreated, totalPacketAccesses),
    disclaimer:
      "Trust analytics are engagement signals for sales follow-up and judge context. They do not prove closed revenue or customer compliance outcomes."
  };
}

export const defaultTrustPacketSections: TrustPacketSection[] = [
  "trust-profile",
  "risk-metrics",
  "approved-documents",
  "ai-operations",
  "consented-testimonials",
  "questionnaire-preview"
];

function buildApprovedDocuments(snapshot: DashboardSnapshot, accessRequest?: TrustAccessRequest) {
  const approvedIds = new Set(accessRequest?.status === "approved" ? accessRequest.approvedDocumentIds : []);

  return snapshot.trustDocuments
    .filter((document) => document.status === "available")
    .filter((document) => document.visibility === "public" || approvedIds.has(document.id))
    .filter((document) => document.visibility !== "private")
    .map((document) => ({
      id: document.id,
      title: document.title,
      category: document.category,
      visibility: document.visibility,
      requiresNda: document.requiresNda,
      summary: document.redactedSummary,
      lastReviewedAt: document.lastReviewedAt
    }));
}

function redactProfileForProspect(profile: TrustCenterProfile): TrustCenterProfile {
  return {
    ...profile,
    evidenceLinks: profile.evidenceLinks.map((link) =>
      link.kind === "audit-log"
        ? {
            ...link,
            value: "Redacted operational audit event. Detailed logs remain in the private admin Evidence Room."
          }
        : link
    )
  };
}

function buildProspectEngagement(packets: TrustPacket[]): TrustProspectEngagement[] {
  const byProspect = new Map<string, TrustProspectEngagement>();

  for (const packet of packets) {
    const key = packet.prospectDomain ?? packet.prospectAlias;
    const existing =
      byProspect.get(key) ??
      {
        prospectAlias: packet.prospectAlias,
        prospectDomain: packet.prospectDomain,
        packetsCreated: 0,
        accessCount: 0,
        approvedDocumentCount: 0,
        latestPacketAt: undefined,
        lastAccessedAt: undefined,
        stage: "new" as TrustEngagementStage,
        nextAction: "Send a redacted Trust Packet to start prospect engagement."
      };

    existing.packetsCreated += 1;
    existing.accessCount += packet.accessCount;
    existing.approvedDocumentCount += packet.approvedDocuments.length;
    existing.latestPacketAt =
      !existing.latestPacketAt || packet.createdAt.localeCompare(existing.latestPacketAt) > 0
        ? packet.createdAt
        : existing.latestPacketAt;
    existing.lastAccessedAt =
      packet.lastAccessedAt && (!existing.lastAccessedAt || packet.lastAccessedAt.localeCompare(existing.lastAccessedAt) > 0)
        ? packet.lastAccessedAt
        : existing.lastAccessedAt;
    existing.stage = classifyEngagementStage(existing);
    existing.nextAction = nextTrustCenterAction(existing);
    byProspect.set(key, existing);
  }

  return [...byProspect.values()].sort((a, b) => {
    const accessDelta = b.accessCount - a.accessCount;
    if (accessDelta !== 0) {
      return accessDelta;
    }

    return (b.lastAccessedAt ?? b.latestPacketAt ?? "").localeCompare(a.lastAccessedAt ?? a.latestPacketAt ?? "");
  });
}

function buildFollowUpQueue(prospects: TrustProspectEngagement[]) {
  return prospects
    .filter((prospect) => prospect.stage !== "new")
    .sort((a, b) => {
      const stageRank = stagePriority(b.stage) - stagePriority(a.stage);
      if (stageRank !== 0) {
        return stageRank;
      }

      return (b.lastAccessedAt ?? b.latestPacketAt ?? "").localeCompare(a.lastAccessedAt ?? a.latestPacketAt ?? "");
    })
    .slice(0, 6);
}

function classifyEngagementStage(prospect: TrustProspectEngagement): TrustEngagementStage {
  if (!prospect.accessCount) {
    return isOlderThanDays(prospect.latestPacketAt, 7) ? "stale" : "new";
  }

  if (prospect.accessCount >= 3 || prospect.approvedDocumentCount >= 2) {
    return "hot";
  }

  return isOlderThanDays(prospect.lastAccessedAt, 14) ? "stale" : "engaged";
}

function nextTrustCenterAction(prospect: TrustProspectEngagement) {
  switch (prospect.stage) {
    case "hot":
      return "Ask founder/sales to book a security-review follow-up and attach consented proof privately.";
    case "engaged":
      return "Send a targeted questionnaire response pack or ask which controls the prospect needs next.";
    case "stale":
      return "Rotate the packet or confirm the prospect still needs Trust Center access.";
    case "new":
    default:
      return "Wait for packet access before using this as demand evidence.";
  }
}

function stagePriority(stage: TrustEngagementStage) {
  switch (stage) {
    case "hot":
      return 3;
    case "engaged":
      return 2;
    case "stale":
      return 1;
    case "new":
    default:
      return 0;
  }
}

function isOlderThanDays(isoTimestamp: string | undefined, days: number) {
  if (!isoTimestamp) {
    return false;
  }

  return Date.now() - Date.parse(isoTimestamp) > days * 24 * 60 * 60 * 1000;
}

function buildTrustAnalyticsProductionGaps(packetsCreated: number, totalPacketAccesses: number) {
  return [
    ...(sentinelConfig.storageMode !== "gcp-rest"
      ? ["Persist Trust Packet creation and access events to Firestore/BigQuery instead of memory mode."]
      : []),
    ...(sentinelConfig.evidenceMode !== "production"
      ? ["Use production evidence mode only after replacing seeded prospect and pilot records with real consented data."]
      : []),
    ...(packetsCreated === 0 ? ["Create at least one Trust Packet for a real prospect."] : []),
    ...(totalPacketAccesses === 0 ? ["Capture at least one real prospect packet access before using analytics as traction evidence."] : []),
    "Host Trust Packet links behind deployed product access controls before sharing with real prospects."
  ];
}
