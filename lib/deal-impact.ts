import { buildRiskScoreTrend } from "@/lib/risk-score";
import { buildTrustCenterAnalytics } from "@/lib/trust-center";
import { sentinelConfig } from "@/lib/config";
import type { DashboardSnapshot, DealImpactMilestone, DealImpactReport } from "@/lib/types";

export function buildDealImpactReport(
  snapshot: DashboardSnapshot,
  input: { redacted?: boolean; targetAlias?: string; targetSegment?: string } = {}
): DealImpactReport {
  const redacted = input.redacted ?? true;
  const primaryPilot = snapshot.pilotRecords.find((pilot) => pilot.armsLength && !pilot.relatedParty) ?? snapshot.pilotRecords[0];
  const targetAlias = redacted ? "Redacted prospect or pilot" : input.targetAlias || primaryPilot?.customerAlias || "Target account";
  const targetSegment = redacted
    ? input.targetSegment || primaryPilot?.segment || "Seed-stage security-review buyer"
    : input.targetSegment || primaryPilot?.segment || "Target segment";
  const riskTrend = buildRiskScoreTrend(snapshot.scoreHistory);
  const trustAnalytics = buildTrustCenterAnalytics(snapshot);
  const roi = snapshot.readiness.roiCalculator;
  const latest = riskTrend.latest;
  const previous = riskTrend.previous;
  const publicExposuresClosed = snapshot.remediations.filter(
    (remediation) => remediation.action === "disable_public_sharing" && remediation.outcome !== "failed"
  ).length;
  const report: DealImpactReport = {
    generatedAt: new Date().toISOString(),
    redacted,
    targetAlias,
    targetSegment,
    headline: "Workspace risk reduced into sales-ready trust evidence.",
    summaryMetrics: {
      workspaceRiskScore: latest?.workspaceRiskScore ?? snapshot.readiness.riskScore.workspaceRiskScore,
      dealImpactScore: latest?.dealImpactScore ?? snapshot.readiness.riskScore.dealImpactScore,
      evidenceMaturity: latest?.evidenceMaturity ?? snapshot.readiness.riskScore.evidenceMaturity,
      workspaceRiskDelta: riskTrend.deltas.workspaceRiskScore,
      dealImpactDelta: riskTrend.deltas.dealImpactScore,
      evidenceMaturityDelta: riskTrend.deltas.evidenceMaturity,
      mrrUsd: snapshot.tenant.evidence.mrrUsd,
      estimatedMonthlyValueUsd: roi.estimatedMonthlyValueUsd,
      paybackMultiple: roi.paybackMultiple,
      trustPacketAccesses: trustAnalytics.totalPacketAccesses,
      questionnairePacks: snapshot.questionnairePacks.length,
      remediationsApproved: snapshot.remediations.length,
      publicExposuresClosed
    },
    milestones: buildMilestones(snapshot),
    buyerProofPoints: buildBuyerProofPoints(snapshot, trustAnalytics.totalPacketAccesses, roi.paybackMultiple),
    recommendedNextActions: buildRecommendedNextActions(snapshot, trustAnalytics.totalPacketAccesses),
    productionGaps: buildProductionGaps(snapshot),
    exportText: "",
    disclaimer:
      "Deal impact is readiness and sales-context evidence only. It is not a security certification, legal conclusion, audit opinion, or guaranteed revenue outcome."
  };

  report.exportText = buildDealImpactExportText(report, previous?.capturedAt);
  return report;
}

function buildMilestones(snapshot: DashboardSnapshot): DealImpactMilestone[] {
  const agentRuns = snapshot.agentRuns.length;
  const remediations = snapshot.remediations.length;
  const trustPackets = snapshot.trustPackets.length;
  const questionnaires = snapshot.questionnairePacks.length;
  const signedPilotProof = snapshot.pilotRecords.filter((pilot) => pilot.proofStatus === "financial-doc-ready").length;

  return [
    milestone("Hybrid AI risk scan", `${agentRuns} agent run(s) recorded`, agentRuns > 0),
    milestone("Human-approved remediation", `${remediations} remediation record(s)`, remediations > 0),
    milestone("Trust proof shared", `${trustPackets} Trust Packet(s) created`, trustPackets > 0),
    milestone("Questionnaire acceleration", `${questionnaires} response pack(s) created`, questionnaires > 0),
    {
      label: "Financial proof",
      value: `${signedPilotProof} pilot(s) marked financial-doc-ready`,
      status: signedPilotProof > 0 ? "proven-local" : "needs-production"
    }
  ];
}

function milestone(label: string, value: string, present: boolean): DealImpactMilestone {
  return {
    label,
    value,
    status: present ? "proven-local" : "missing"
  };
}

function buildBuyerProofPoints(snapshot: DashboardSnapshot, trustPacketAccesses: number, paybackMultiple: number) {
  return [
    `${snapshot.findings.length} Workspace risk finding(s) captured in the local evidence trail.`,
    `${snapshot.remediations.length} human-approved remediation record(s) available for review.`,
    `${snapshot.questionnairePacks.length} questionnaire response pack(s) available for security-review acceleration.`,
    `${trustPacketAccesses} Trust Packet access event(s) captured as prospect engagement signal.`,
    `${paybackMultiple}x estimated monthly payback from the current evidence-calibrated ROI model.`
  ];
}

function buildRecommendedNextActions(snapshot: DashboardSnapshot, trustPacketAccesses: number) {
  return [
    ...(snapshot.findings.some((finding) => finding.status === "recommended")
      ? ["Approve or dismiss open recommendations before sharing final deal-impact proof."]
      : []),
    ...(snapshot.remediations.length === 0 ? ["Complete one human-approved remediation to show before/after risk movement."] : []),
    ...(snapshot.questionnairePacks.length === 0
      ? ["Generate one customer-specific questionnaire pack for the active prospect."]
      : []),
    ...(snapshot.trustPackets.length === 0 ? ["Create a redacted Trust Packet for the active prospect."] : []),
    ...(trustPacketAccesses === 0 ? ["Capture a real prospect Trust Packet access before treating engagement as traction."] : []),
    "Attach production Cloud Run, Gemini, Workspace OAuth, and financial proof before using this in final XPRIZE evidence."
  ];
}

function buildProductionGaps(snapshot: DashboardSnapshot) {
  return [
    ...(sentinelConfig.storageMode !== "gcp-rest" ? ["Persist deal-impact source events to Firestore/BigQuery."] : []),
    ...(sentinelConfig.evidenceMode !== "production"
      ? ["Replace seeded pilot records with real paid customer evidence before treating this as production impact."]
      : []),
    ...(snapshot.scoreHistory.length < 2 ? ["Capture before/after score history from a real tenant."] : []),
    ...(snapshot.agentRuns.some((run) => run.provider === "mock-gemini" || run.provider === "deterministic")
      ? ["Run at least one deployed Gemini API workflow and preserve usage logs."]
      : []),
    "Generate final report from the hosted product after live Workspace OAuth sync."
  ];
}

function buildDealImpactExportText(report: DealImpactReport, previousSnapshotAt?: string) {
  return [
    "# SME Workspace Sentinel Deal Impact Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Target: ${report.targetAlias}`,
    `Segment: ${report.targetSegment}`,
    `Redacted: ${report.redacted}`,
    `Previous snapshot: ${previousSnapshotAt ?? "not available"}`,
    "",
    report.headline,
    "",
    "## Impact Metrics",
    `Workspace risk score: ${report.summaryMetrics.workspaceRiskScore} (${formatDelta(report.summaryMetrics.workspaceRiskDelta)})`,
    `Deal impact score: ${report.summaryMetrics.dealImpactScore} (${formatDelta(report.summaryMetrics.dealImpactDelta)})`,
    `Evidence maturity: ${report.summaryMetrics.evidenceMaturity} (${formatDelta(report.summaryMetrics.evidenceMaturityDelta)})`,
    `Estimated monthly value: $${report.summaryMetrics.estimatedMonthlyValueUsd}`,
    `Payback multiple: ${report.summaryMetrics.paybackMultiple}x`,
    `MRR field: $${report.summaryMetrics.mrrUsd}`,
    "",
    "## Milestones",
    ...report.milestones.map((milestone) => `- ${milestone.label}: ${milestone.value} (${milestone.status})`),
    "",
    "## Buyer Proof Points",
    ...report.buyerProofPoints.map((point) => `- ${point}`),
    "",
    "## Recommended Next Actions",
    ...report.recommendedNextActions.map((action) => `- ${action}`),
    "",
    "## Production Gaps",
    ...report.productionGaps.map((gap) => `- ${gap}`),
    "",
    `Boundary: ${report.disclaimer}`
  ].join("\n");
}

function formatDelta(value: number) {
  if (value > 0) {
    return `+${value}`;
  }

  return String(value);
}
