import type {
  DashboardSnapshot,
  Finding,
  RemediationActionRecord,
  RiskScore,
  RiskScoreSnapshot,
  RiskScoreSnapshotReason,
  RiskScoreTrend
} from "@/lib/types";

type RiskScoreInput = Pick<DashboardSnapshot, "findings" | "agentRuns" | "remediations" | "tenant" | "pilotRecords">;

export function buildRiskScore(snapshot: RiskScoreInput): RiskScore {
  const activeFindings = getActiveFindings(snapshot.findings);
  const openCriticalFindings = activeFindings.filter((finding) => finding.severity === "critical").length;
  const remediated = snapshot.remediations.length;
  const agentRuns = snapshot.agentRuns.length;
  const financialProof = snapshot.pilotRecords.filter((pilot) => pilot.proofStatus === "financial-doc-ready").length;
  const consentedProof = snapshot.pilotRecords.filter((pilot) => pilot.consentStatus === "consented").length;
  const evidenceMaturity = Math.min(
    100,
    30 + snapshot.tenant.evidence.pilotCount * 4 + financialProof * 8 + consentedProof * 4 + agentRuns * 6 + remediated * 8
  );
  const workspaceRiskScore = Math.max(5, Math.min(100, 28 + openCriticalFindings * 22 + activeFindings.length * 7 - remediated * 18));
  const dealImpactScore = Math.min(100, 45 + snapshot.tenant.evidence.pilotCount * 4 + remediated * 10 + agentRuns * 5);

  return {
    workspaceRiskScore,
    dealImpactScore,
    openCriticalFindings,
    evidenceMaturity,
    scoringNotes: [
      "Workspace risk increases with active open findings and decreases after approved remediation.",
      "Dismissed and false-positive findings do not continue inflating the active risk score.",
      "Deal impact rises with pilots, agent-run evidence, and public exposure closures.",
      "Evidence maturity remains capped until real financial and customer proof replaces mock records."
    ]
  };
}

export function buildRiskScoreSnapshot(
  snapshot: RiskScoreInput,
  input: {
    id: string;
    capturedAt: string;
    reason: RiskScoreSnapshotReason;
    targetId?: string;
  }
): RiskScoreSnapshot {
  const score = buildRiskScore(snapshot);
  const activeFindings = getActiveFindings(snapshot.findings);
  const falsePositives = snapshot.findings.filter((finding) => finding.status === "false_positive").length;

  return {
    id: input.id,
    tenantId: snapshot.tenant.id,
    capturedAt: input.capturedAt,
    reason: input.reason,
    targetId: input.targetId,
    workspaceRiskScore: score.workspaceRiskScore,
    dealImpactScore: score.dealImpactScore,
    evidenceMaturity: score.evidenceMaturity,
    openCriticalFindings: score.openCriticalFindings,
    activeFindings: activeFindings.length,
    remediationsCount: snapshot.remediations.length,
    agentRunsCount: snapshot.agentRuns.length,
    mrrUsd: snapshot.tenant.evidence.mrrUsd,
    activeUsers: snapshot.tenant.evidence.activeUsers,
    publicExposuresClosed: countPublicExposuresClosed(snapshot.remediations),
    falsePositiveRate: snapshot.findings.length ? Math.round((falsePositives / snapshot.findings.length) * 100) : 0
  };
}

export function buildRiskScoreTrend(scoreHistory: RiskScoreSnapshot[]): RiskScoreTrend {
  const history = [...scoreHistory].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).slice(0, 12);
  const latest = history[0];
  const previous = history[1];
  const deltas = {
    workspaceRiskScore: latest && previous ? latest.workspaceRiskScore - previous.workspaceRiskScore : 0,
    dealImpactScore: latest && previous ? latest.dealImpactScore - previous.dealImpactScore : 0,
    evidenceMaturity: latest && previous ? latest.evidenceMaturity - previous.evidenceMaturity : 0,
    mrrUsd: latest && previous ? latest.mrrUsd - previous.mrrUsd : 0
  };

  return {
    history,
    latest,
    previous,
    deltas,
    direction: classifyTrend(deltas, history.length),
    narrative: buildTrendNarrative(deltas, history.length),
    nextMilestones: buildNextMilestones(latest),
    productionWarning:
      "Local score history proves product behavior only. Top-tier submission proof still needs durable Firestore/BigQuery history from live tenants."
  };
}

function getActiveFindings(findings: Finding[]) {
  return findings.filter(
    (finding) => finding.status !== "remediated" && finding.status !== "dismissed" && finding.status !== "false_positive"
  );
}

function countPublicExposuresClosed(remediations: RemediationActionRecord[]) {
  return remediations.filter((remediation) => remediation.action === "disable_public_sharing").length;
}

function classifyTrend(deltas: RiskScoreTrend["deltas"], historyLength: number): RiskScoreTrend["direction"] {
  if (historyLength < 2) {
    return "insufficient_data";
  }

  const positiveSignals = [
    deltas.workspaceRiskScore < 0,
    deltas.dealImpactScore > 0,
    deltas.evidenceMaturity > 0,
    deltas.mrrUsd > 0
  ].filter(Boolean).length;
  const negativeSignals = [
    deltas.workspaceRiskScore > 0,
    deltas.dealImpactScore < 0,
    deltas.evidenceMaturity < 0,
    deltas.mrrUsd < 0
  ].filter(Boolean).length;

  if (positiveSignals >= 2 && negativeSignals === 0) {
    return "improving";
  }

  if (negativeSignals >= 2 && positiveSignals === 0) {
    return "regressing";
  }

  return "mixed";
}

function buildTrendNarrative(deltas: RiskScoreTrend["deltas"], historyLength: number) {
  if (historyLength < 2) {
    return "Capture another score snapshot after a scan, approval, remediation, or pilot update to prove movement over time.";
  }

  const riskText =
    deltas.workspaceRiskScore < 0
      ? `Workspace risk improved by ${Math.abs(deltas.workspaceRiskScore)} point(s).`
      : deltas.workspaceRiskScore > 0
        ? `Workspace risk increased by ${deltas.workspaceRiskScore} point(s).`
        : "Workspace risk is unchanged.";
  const evidenceText =
    deltas.evidenceMaturity > 0
      ? `Evidence maturity improved by ${deltas.evidenceMaturity} point(s).`
      : "Evidence maturity did not improve in the latest step.";
  const revenueText = deltas.mrrUsd > 0 ? `MRR increased by $${deltas.mrrUsd}.` : "MRR is unchanged in the latest step.";

  return `${riskText} ${evidenceText} ${revenueText}`;
}

function buildNextMilestones(latest?: RiskScoreSnapshot) {
  if (!latest) {
    return ["Run a high-risk scan, approve remediation, and record the first score movement."];
  }

  return [
    ...(latest.activeFindings > 0 ? ["Close active findings through human-approved remediation or documented dismissal."] : []),
    ...(latest.evidenceMaturity < 80 ? ["Attach real financial proof and consented customer feedback to raise evidence maturity."] : []),
    ...(latest.mrrUsd === 0 ? ["Record arms-length paid pilot revenue before using score history in submission evidence."] : []),
    "Persist score snapshots to Firestore/BigQuery after production deployment."
  ];
}
