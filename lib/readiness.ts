import type {
  AiCostGuardrail,
  AnswerLibrarySummary,
  AnswerLibrarySegmentSummary,
  ApprovalQueueSummary,
  ComplianceCopyGuardrail,
  DashboardSnapshot,
  FounderRoiEstimate,
  JudgeNarrative,
  OAuthReadiness,
  PilotCustomerRecord,
  ReadinessCommandCenter,
  TrustAccessSummary
} from "@/lib/types";
import { buildPersistenceReadiness } from "@/lib/persistence";
import { buildSyncReliability } from "@/lib/workspace-sync";
import { bannedComplianceClaims, buildRuntimeClaimGuardResult, approvedCompliancePhrases } from "@/lib/claim-guard";
import { buildXPrizeSubmissionGate } from "@/lib/xprize-gate";
import { sentinelConfig } from "@/lib/config";
import { buildFrameworkCoverage } from "@/lib/framework-evidence";
import { buildCloudCostControlCenter } from "@/lib/cloud-cost-controls";
import { buildRiskScore, buildRiskScoreTrend } from "@/lib/risk-score";
import { buildApprovalOps } from "@/lib/approval-ops";
import { buildTrustCenterAnalytics } from "@/lib/trust-center";
import { buildFinancialEvidenceLedger } from "@/lib/financial-evidence";
import { buildEvidenceVault } from "@/lib/evidence-vault";
import { buildEvidenceIntakeQueue } from "@/lib/evidence-intake";
import { buildPilotLaunchPlan } from "@/lib/pilot-launch";
import { buildPilotConversionKit } from "@/lib/pilot-conversion";
import { buildPilotConsentPacket } from "@/lib/pilot-consent";
import { buildPilotProspectPipeline } from "@/lib/prospect-pipeline";
import { buildSubmissionComplianceCenter } from "@/lib/submission-compliance";
import { buildDevpostSubmissionPack } from "@/lib/devpost-submission";
import { buildDemoVideoCompliancePack } from "@/lib/demo-video";
import { buildProjectProvenanceReport } from "@/lib/project-provenance";
import { buildProductionLaunchCommandCenter } from "@/lib/production-launch";
import { buildProductionProvisioningPack } from "@/lib/production-provisioning";
import { buildProductionGeminiProofStatus } from "@/lib/production-gemini";
import { buildMarketPositioningCommandCenter } from "@/lib/market-positioning";

export function buildReadinessCommandCenter(
  snapshot: Pick<
    DashboardSnapshot,
    | "tenant"
    | "connections"
    | "findings"
    | "agentRuns"
    | "auditEvents"
    | "remediations"
    | "pilotRecords"
    | "pilotProspects"
    | "evidenceVaultArtifacts"
    | "trustDocuments"
    | "trustAccessRequests"
    | "trustPackets"
    | "questionnairePacks"
    | "answerLibrary"
    | "playbooks"
    | "scoreHistory"
    | "aggregateCounters"
    | "syncState"
  >
): ReadinessCommandCenter {
  const readinessWithoutLaunchAndPipeline = {
    generatedAt: new Date().toISOString(),
    usp: "One-day Google Workspace risk scan that turns sensitive-data exposure into SOC2 readiness evidence, Trust Center proof, and security-review acceleration for seed-stage teams.",
    riskScore: buildRiskScore(snapshot),
    riskTrend: buildRiskScoreTrend(snapshot.scoreHistory),
    xprizeGate: buildXPrizeSubmissionGate(snapshot),
    submissionCompliance: buildSubmissionComplianceCenter(snapshot),
    devpostSubmissionPack: buildDevpostSubmissionPack(snapshot),
    demoVideoCompliance: buildDemoVideoCompliancePack(snapshot),
    projectProvenance: buildProjectProvenanceReport(),
    productionLaunch: buildProductionLaunchCommandCenter(snapshot),
    productionProvisioning: buildProductionProvisioningPack(),
    productionGeminiProof: buildProductionGeminiProofStatus(snapshot),
    marketPositioning: buildMarketPositioningCommandCenter(snapshot),
    pilotConsentPacket: buildPilotConsentPacket(snapshot),
    oauthReadiness: buildOAuthReadiness(),
    persistenceReadiness: buildPersistenceReadiness(),
    syncReliability: buildSyncReliability(snapshot.syncState, snapshot.aggregateCounters),
    claimGuard: buildRuntimeClaimGuardResult(),
    approvalQueue: buildApprovalQueue(snapshot),
    approvalOps: buildApprovalOps(snapshot),
    answerLibrary: buildAnswerLibrarySummary(snapshot),
    trustAccess: buildTrustAccessSummary(snapshot),
    trustAnalytics: buildTrustCenterAnalytics(snapshot),
    pilotCrm: buildPilotCrm(snapshot),
    financialEvidence: buildFinancialEvidenceLedger(snapshot),
    evidenceVault: buildEvidenceVault(snapshot),
    evidenceIntakeQueue: buildEvidenceIntakeQueue(snapshot),
    aiCostGuardrail: buildAiCostGuardrail(snapshot),
    cloudCostControls: buildCloudCostControlCenter(snapshot),
    complianceCopyGuardrail: buildComplianceCopyGuardrail(),
    frameworkCoverage: buildFrameworkCoverage(),
    playbooks: snapshot.playbooks,
    roiCalculator: buildRoiEstimate(snapshot),
    judgeNarrative: buildJudgeNarrative()
  };

  const pilotLaunchPlan = buildPilotLaunchPlan({ ...snapshot, readiness: readinessWithoutLaunchAndPipeline });

  return {
    ...readinessWithoutLaunchAndPipeline,
    pilotLaunchPlan,
    pilotConversionKit: buildPilotConversionKit(snapshot),
    pilotProspectPipeline: buildPilotProspectPipeline({
      ...snapshot,
      readiness: { ...readinessWithoutLaunchAndPipeline, pilotLaunchPlan }
    })
  };
}

function buildApprovalQueue(snapshot: Pick<DashboardSnapshot, "findings">): ApprovalQueueSummary {
  const actionable = snapshot.findings.filter((finding) => finding.recommendation.humanApprovalRequired);
  const openApprovals = actionable.filter(
    (finding) => finding.approval.status !== "approved" && finding.approval.status !== "not_required"
  );
  const earliestDueAt = openApprovals
    .map((finding) => finding.approval.dueAt)
    .sort((a, b) => a.localeCompare(b))[0];
  const escalationTargets = Array.from(
    new Set(openApprovals.map((finding) => finding.approval.escalationTarget).filter((target) => target !== "none"))
  ).sort();

  return {
    pending: actionable.filter((finding) => finding.approval.status === "pending").length,
    dueSoon: actionable.filter((finding) => finding.approval.status === "due_soon").length,
    overdue: actionable.filter((finding) => finding.approval.status === "overdue").length,
    approved: actionable.filter((finding) => finding.approval.status === "approved").length,
    earliestDueAt,
    escalationTargets
  };
}

function buildAnswerLibrarySummary(
  snapshot: Pick<DashboardSnapshot, "answerLibrary" | "questionnairePacks">
): AnswerLibrarySummary {
  const activeItems = snapshot.answerLibrary.filter((item) => item.status !== "retired");
  const now = Date.now();
  const sevenDaysFromNow = now + 7 * 24 * 60 * 60 * 1000;
  const totalAnswers = snapshot.questionnairePacks.reduce((total, pack) => total + pack.questionsCount, 0);
  const totalLibraryHits = snapshot.questionnairePacks.reduce((total, pack) => total + pack.libraryHitCount, 0);
  const nextReviewAt = activeItems
    .map((item) => item.nextReviewAt)
    .sort((a, b) => a.localeCompare(b))[0];

  return {
    totalApproved: activeItems.length,
    reviewDue: activeItems.filter((item) => item.status === "review_due").length,
    dueSoon: activeItems.filter((item) => {
      const nextReviewMs = Date.parse(item.nextReviewAt);
      return nextReviewMs > now && nextReviewMs <= sevenDaysFromNow;
    }).length,
    totalUsage: activeItems.reduce((total, item) => total + item.usageCount, 0),
    libraryHitRate: totalAnswers ? Math.round((totalLibraryHits / totalAnswers) * 100) : 0,
    nextReviewAt,
    segmentHistory: buildAnswerLibrarySegmentHistory(snapshot)
  };
}

function buildAnswerLibrarySegmentHistory(
  snapshot: Pick<DashboardSnapshot, "answerLibrary" | "questionnairePacks">
): AnswerLibrarySegmentSummary[] {
  const bySegment = new Map<string, AnswerLibrarySegmentSummary>();

  for (const pack of snapshot.questionnairePacks) {
    const segment = pack.customerSegment || "Unsegmented security review";
    const existing =
      bySegment.get(segment) ??
      {
        segment,
        packCount: 0,
        approvedAnswers: 0,
        libraryHits: 0,
        lastPackAt: undefined
      };

    existing.packCount += 1;
    existing.approvedAnswers += pack.approvedCount;
    existing.libraryHits += pack.libraryHitCount;
    existing.lastPackAt =
      !existing.lastPackAt || pack.updatedAt.localeCompare(existing.lastPackAt) > 0 ? pack.updatedAt : existing.lastPackAt;
    bySegment.set(segment, existing);
  }

  for (const item of snapshot.answerLibrary) {
    for (const segment of item.segmentTags) {
      const existing =
        bySegment.get(segment) ??
        {
          segment,
          packCount: 0,
          approvedAnswers: 0,
          libraryHits: 0,
          lastPackAt: undefined
        };

      existing.approvedAnswers += item.status === "retired" ? 0 : 1;
      bySegment.set(segment, existing);
    }
  }

  return [...bySegment.values()].sort((a, b) => (b.lastPackAt ?? "").localeCompare(a.lastPackAt ?? "")).slice(0, 8);
}

function buildTrustAccessSummary(
  snapshot: Pick<DashboardSnapshot, "trustDocuments" | "trustAccessRequests">
): TrustAccessSummary {
  const now = Date.now();
  const thirtyDaysFromNow = now + 30 * 24 * 60 * 60 * 1000;

  return {
    publicDocuments: snapshot.trustDocuments.filter((document) => document.visibility === "public").length,
    requestableDocuments: snapshot.trustDocuments.filter((document) => document.visibility === "requestable").length,
    privateDocuments: snapshot.trustDocuments.filter((document) => document.visibility === "private").length,
    pendingRequests: snapshot.trustAccessRequests.filter((request) => request.status === "pending").length,
    approvedRequests: snapshot.trustAccessRequests.filter((request) => request.status === "approved").length,
    deniedRequests: snapshot.trustAccessRequests.filter((request) => request.status === "denied").length,
    ndaRequiredDocuments: snapshot.trustDocuments.filter((document) => document.requiresNda).length,
    expiringApprovals: snapshot.trustAccessRequests.filter((request) => {
      if (request.status !== "approved" || !request.expiresAt) {
        return false;
      }

      const expiresAt = Date.parse(request.expiresAt);
      return expiresAt > now && expiresAt <= thirtyDaysFromNow;
    }).length
  };
}

function buildOAuthReadiness(): OAuthReadiness {
  return {
    mode: "pilot-test-users",
    requiredScopes: [
      {
        scope: "https://www.googleapis.com/auth/drive.metadata.readonly",
        sensitivity: "sensitive",
        reason: "Detect changed files and risky sharing without downloading full content by default.",
        status: "needed"
      },
      {
        scope: "https://www.googleapis.com/auth/drive",
        sensitivity: "restricted",
        reason: "Disable public sharing only after explicit admin approval.",
        status: "defer"
      },
      {
        scope: "https://www.googleapis.com/auth/gmail.metadata",
        sensitivity: "sensitive",
        reason: "Track Gmail history changes while minimizing message content access.",
        status: "needed"
      }
    ],
    verificationChecklist: [
      { item: "Run first pilots with allowlisted test users and explicit consent.", status: "next" },
      { item: "Publish scope-by-scope privacy explanation in onboarding.", status: "next" },
      { item: "Record OAuth demo video for verification if Marketplace launch is pursued.", status: "next" },
      { item: "Defer restricted Drive mutation scope until paid pilot proves need.", status: "done" }
    ],
    goToMarketDecision:
      "Use consented pilot installs first. Marketplace approval is a scale path, not a dependency for XPRIZE revenue proof."
  };
}

function buildPilotCrm(snapshot: Pick<DashboardSnapshot, "pilotRecords">): PilotCustomerRecord[] {
  return snapshot.pilotRecords.slice(0, 8);
}

function buildAiCostGuardrail(snapshot: Pick<DashboardSnapshot, "agentRuns">): AiCostGuardrail {
  const estimatedSpendUsd = Number(snapshot.agentRuns.reduce((total, run) => total + run.estimatedCostUsd, 0).toFixed(6));
  const monthlyBudgetUsd = sentinelConfig.geminiMonthlyBudgetUsd;

  return {
    monthlyBudgetUsd,
    estimatedSpendUsd,
    budgetUsedPercent: Number(((estimatedSpendUsd / monthlyBudgetUsd) * 100).toFixed(2)),
    modelAllowlist: sentinelConfig.geminiModelAllowlist,
    fallbackPolicy: "If Gemini is unavailable, queue semantic audits for retry and keep deterministic DLP active.",
    blockedConditions: [
      "Do not send unchanged-content events to Gemini.",
      "Do not send full message bodies when metadata and detector snippets are sufficient.",
      "Do not exceed tenant monthly budget without admin approval.",
      `Do not route more than ${sentinelConfig.geminiMaxContentBytesPerEvent} content bytes from a single event.`
    ]
  };
}

function buildComplianceCopyGuardrail(): ComplianceCopyGuardrail {
  const claimGuard = buildRuntimeClaimGuardResult();

  return {
    bannedClaims: bannedComplianceClaims,
    approvedPhrases: approvedCompliancePhrases,
    currentViolations: [...claimGuard.violations, ...claimGuard.warnings]
  };
}

function buildRoiEstimate(
  snapshot: Pick<
    DashboardSnapshot,
    "tenant" | "pilotRecords" | "remediations" | "questionnairePacks" | "trustPackets" | "scoreHistory"
  >
): FounderRoiEstimate {
  const pricePerMonthUsd = 199;
  const founderHourlyRateUsd = 150;
  const engineerHourlyRateUsd = 120;
  const qualifiedPilots = snapshot.pilotRecords.filter((pilot) => pilot.armsLength && !pilot.relatedParty);
  const qualifiedPilotCount = qualifiedPilots.length;
  const pilotMrrUsd = qualifiedPilots.reduce((total, pilot) => total + pilot.monthlyRevenueUsd, 0);
  const financialDocsReady = qualifiedPilots.filter((pilot) => pilot.proofStatus === "financial-doc-ready").length;
  const consentedTestimonials = qualifiedPilots.filter((pilot) => pilot.consentStatus === "consented").length;
  const questionnairePacksCompleted = snapshot.questionnairePacks.filter((pack) => pack.status !== "draft").length;
  const approvedQuestionnaireAnswers = snapshot.questionnairePacks.reduce((total, pack) => total + pack.approvedCount, 0);
  const remediationsApproved = snapshot.remediations.length;
  const trustPacketsCreated = snapshot.trustPackets.length;
  const riskReductionPoints = calculateRiskReductionPoints(snapshot.scoreHistory);
  const calibrationSource = getRoiCalibrationSource(qualifiedPilotCount, financialDocsReady);
  const securityReviewHoursSaved = roundOne(
    clamp(
      4 +
        questionnairePacksCompleted * 2 +
        approvedQuestionnaireAnswers * 0.15 +
        trustPacketsCreated +
        remediationsApproved * 0.75 +
        riskReductionPoints * 0.05 +
        Math.min(qualifiedPilotCount * 0.5, 3),
      4,
      20
    )
  );
  const averageSecurityReviewDelayDaysAvoided = roundOne(
    clamp(
      2 +
        Math.min(financialDocsReady * 0.75 + consentedTestimonials * 0.25, 2) +
        Math.min(questionnairePacksCompleted * 0.75, 2.5) +
        Math.min(remediationsApproved * 0.5, 2) +
        Math.min(trustPacketsCreated * 0.3, 1.5) +
        Math.min(riskReductionPoints / 12, 2),
      2,
      10
    )
  );
  const estimatedMonthlyValueUsd = Math.round(
    averageSecurityReviewDelayDaysAvoided * 2 * founderHourlyRateUsd + securityReviewHoursSaved * engineerHourlyRateUsd
  );
  const proofGaps = buildRoiProofGaps({
    qualifiedPilotCount,
    financialDocsReady,
    consentedTestimonials,
    remediationsApproved,
    questionnairePacksCompleted,
    trustPacketsCreated,
    scoreHistoryCount: snapshot.scoreHistory.length
  });

  return {
    pricePerMonthUsd,
    averageSecurityReviewDelayDaysAvoided,
    founderHourlyRateUsd,
    engineerHourlyRateUsd,
    securityReviewHoursSaved,
    estimatedMonthlyValueUsd,
    paybackMultiple: Number((estimatedMonthlyValueUsd / pricePerMonthUsd).toFixed(1)),
    calibrationSource,
    qualifiedPilotCount,
    pilotMrrUsd,
    remediationsApproved,
    questionnairePacksCompleted,
    trustPacketsCreated,
    riskReductionPoints,
    evidenceFactors: [
      {
        label: "Qualified pilot MRR",
        value: `$${pilotMrrUsd}/mo across ${qualifiedPilotCount} arms-length pilot(s)`,
        impact: "revenue"
      },
      {
        label: "Security-review delay avoided",
        value: `${averageSecurityReviewDelayDaysAvoided} day(s) estimated from evidence depth`,
        impact: "time_saved"
      },
      {
        label: "Questionnaire leverage",
        value: `${questionnairePacksCompleted} pack(s), ${approvedQuestionnaireAnswers} approved answer(s)`,
        impact: "time_saved"
      },
      {
        label: "Risk movement",
        value: `${riskReductionPoints} workspace-risk point(s) reduced from local score history`,
        impact: "risk_reduction"
      },
      {
        label: "Trust proof created",
        value: `${trustPacketsCreated} redacted Trust Packet(s), ${consentedTestimonials} consented testimonial(s)`,
        impact: "trust_proof"
      }
    ],
    proofGaps,
    disclaimer:
      "ROI is an estimate for buyer qualification and judge context. It is not a guaranteed savings, legal, audit, or certification claim."
  };
}

function getRoiCalibrationSource(qualifiedPilotCount: number, financialDocsReady: number): FounderRoiEstimate["calibrationSource"] {
  if (
    sentinelConfig.evidenceMode === "production" &&
    sentinelConfig.storageMode === "gcp-rest" &&
    qualifiedPilotCount > 0 &&
    financialDocsReady > 0
  ) {
    return "production-verified";
  }

  if (qualifiedPilotCount > 0) {
    return "pilot-adjusted";
  }

  return "seeded-demo";
}

function buildRoiProofGaps(input: {
  qualifiedPilotCount: number;
  financialDocsReady: number;
  consentedTestimonials: number;
  remediationsApproved: number;
  questionnairePacksCompleted: number;
  trustPacketsCreated: number;
  scoreHistoryCount: number;
}) {
  const gaps = [
    ...(sentinelConfig.evidenceMode !== "production"
      ? ["Switch SENTINEL_EVIDENCE_MODE=production before using ROI as submission proof."]
      : []),
    ...(sentinelConfig.storageMode !== "gcp-rest"
      ? ["Persist ROI source events to Firestore/BigQuery instead of memory mode."]
      : []),
    ...(input.qualifiedPilotCount === 0 ? ["Record at least one arms-length paid pilot."] : []),
    ...(input.financialDocsReady < input.qualifiedPilotCount
      ? [`Attach invoice/payment proof for ${input.qualifiedPilotCount - input.financialDocsReady} pilot(s).`]
      : []),
    ...(input.consentedTestimonials === 0 ? ["Collect at least one explicitly consented testimonial."] : []),
    ...(input.remediationsApproved === 0 ? ["Close at least one finding through human-approved remediation."] : []),
    ...(input.questionnairePacksCompleted === 0 ? ["Complete at least one customer questionnaire response pack."] : []),
    ...(input.trustPacketsCreated === 0 ? ["Create at least one redacted Trust Packet for a real prospect."] : []),
    ...(input.scoreHistoryCount < 2 ? ["Capture before/after score history to prove movement over time."] : [])
  ];

  return gaps.slice(0, 6);
}

function calculateRiskReductionPoints(scoreHistory: DashboardSnapshot["scoreHistory"]) {
  if (scoreHistory.length < 2) {
    return 0;
  }

  const newest = [...scoreHistory].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
  const highestRiskScore = Math.max(...scoreHistory.map((snapshot) => snapshot.workspaceRiskScore));

  return Math.max(0, highestRiskScore - newest.workspaceRiskScore);
}

function roundOne(value: number) {
  return Number(value.toFixed(1));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildJudgeNarrative(): JudgeNarrative {
  return {
    headline: "From risky Workspace sharing to trust evidence in under three minutes.",
    threeMinuteScript: [
      "Show a public Workspace file containing sensitive customer/security information.",
      "Run the hybrid scanner and prove low-risk events do not call Gemini.",
      "Show Gemini explaining risk, SOC2 readiness mapping, and blast radius.",
      "Approve remediation as a human admin and log the action.",
      "Open Evidence Room, Trust Center Lite, questionnaire draft, and strategy confidence."
    ],
    screenshotChecklist: [
      "Dashboard metrics",
      "Staged recommendation",
      "AI Operations Timeline",
      "Redacted Evidence Room export",
      "Trust Center Lite profile",
      "Questionnaire Assistant answer with citations",
      "Strategy Room loophole register"
    ],
    proofChecklist: [
      "Revenue by month",
      "Arms-length customer records",
      "Costs and CAC",
      "Gemini API logs",
      "Google Cloud deployment logs",
      "Customer testimonials with consent"
    ]
  };
}
