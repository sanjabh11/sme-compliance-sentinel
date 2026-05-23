import {
  demoVideoClearanceSummary,
  hasDemoVideoClearance,
  hasJudgeProductAccess,
  judgeProductAccessSummary,
  sentinelConfig
} from "@/lib/config";
import { buildPersistenceReadiness } from "@/lib/persistence";
import { buildRuntimeClaimGuardResult } from "@/lib/claim-guard";
import { buildCloudCostControlCenter } from "@/lib/cloud-cost-controls";
import { hasLiveWorkspaceSyncEvidence } from "@/lib/workspace-sync";
import { buildProjectProvenanceReport } from "@/lib/project-provenance";
import type { DashboardSnapshot, XPrizeGateCheck, XPrizeGateStatus, XPrizeSubmissionGate } from "@/lib/types";

type GateSnapshot = Pick<
  DashboardSnapshot,
  "tenant" | "connections" | "syncState" | "agentRuns" | "auditEvents" | "pilotRecords" | "aggregateCounters" | "findings" | "remediations"
>;

export function buildXPrizeSubmissionGate(snapshot: GateSnapshot): XPrizeSubmissionGate {
  const checks = buildChecks(snapshot);
  const criterionScores = buildCriterionScores(checks);
  const blocked = checks.filter((check) => check.status === "blocked");
  const warnings = checks.filter((check) => check.status === "warning");
  const overallStatus: XPrizeGateStatus = blocked.length ? "blocked" : warnings.length ? "warning" : "passed";
  const factualWinConfidence = Math.min(
    95,
    Math.max(8, Math.round(Object.values(criterionScores).reduce((total, score) => total + score, 0) / Object.keys(criterionScores).length))
  );

  return {
    generatedAt: new Date().toISOString(),
    overallStatus,
    factualWinConfidence,
    category: snapshot.tenant.category,
    checks,
    criterionScores,
    blockingSummary: blocked.map((check) => `${check.label}: ${check.fix}`),
    nextBestActions: buildNextBestActions(checks),
    ruleBasis: [
      "Business Viability: real business, real users, real arms-length revenue, revenue by month, costs, CAC, and related-party separation.",
      "AI-Native Operations: AI live in production, key business decisions executed by AI, agent/API logs and dashboard screenshots.",
      "Category Impact: project must clearly fit and move the selected category.",
      "Technical requirements: at least one Google Cloud product; deployed LLM functionality must include at least one Gemini API call.",
      "Submission logistics: accessible product, repository, demo video, testing instructions, and evidence on request."
    ]
  };
}

function buildChecks(snapshot: GateSnapshot): XPrizeGateCheck[] {
  const persistence = buildPersistenceReadiness();
  const claimGuard = buildRuntimeClaimGuardResult();
  const costControls = buildCloudCostControlCenter({ agentRuns: snapshot.agentRuns });
  const projectProvenance = buildProjectProvenanceReport();
  const paidArmsLengthPilots = snapshot.pilotRecords.filter(
    (pilot) => pilot.armsLength && !pilot.relatedParty && pilot.monthlyRevenueUsd > 0
  );
  const productionEvidence = sentinelConfig.evidenceMode === "production";
  const realFinancialProof = productionEvidence
    ? paidArmsLengthPilots.filter((pilot) => pilot.proofStatus === "financial-doc-ready").length
    : 0;
  const consentedFeedback = productionEvidence
    ? snapshot.pilotRecords.filter((pilot) => pilot.consentStatus === "consented" && pilot.testimonialQuote).length
    : 0;
  const geminiRuns = snapshot.agentRuns.filter((run) => run.provider === "gemini-api").length;
  const mockGeminiRuns = snapshot.agentRuns.filter((run) => run.provider === "mock-gemini").length;
  const hasLiveWorkspaceConnection = snapshot.connections.some((connection) => connection.mode === "oauth" || connection.mode === "domain-wide-delegation");
  const syncIsLive = hasLiveWorkspaceSyncEvidence(snapshot.syncState);

  return [
    {
      id: "new-project-provenance",
      label: "New project and pre-existing work disclosure",
      criterion: "Submission Logistics",
      status: projectProvenance.overallStatus,
      evidence: `${projectProvenance.git.commitCount} commit(s), first commit ${projectProvenance.git.firstCommitAt ?? "unavailable"}, ${projectProvenance.git.untrackedPaths.length} untracked path(s); env confirmation ${projectProvenance.projectCreatedAfterStartConfirmed ? "set" : "missing"}.`,
      fix:
        projectProvenance.nextActions[0] ??
        "Verify repository history against the hackathon start date, disclose all pre-existing frameworks/templates/dependencies, and set XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED=true only after human review."
    },
    {
      id: "entrant-identity",
      label: "Entrant type and corporate ID applicability",
      criterion: "Submission Logistics",
      status: resolveEntrantIdentityGateStatus(),
      evidence:
        sentinelConfig.xprizeEntrantType === "organization"
          ? `Entrant type=organization; corporate ID proof ${sentinelConfig.xprizeCorporateIdConfigured ? "configured" : "missing"}; representative authorization ${sentinelConfig.xprizeRepresentativeAuthorized ? "confirmed" : "missing"}; under-25 employee status ${sentinelConfig.xprizeOrganizationUnder25Confirmed ? "confirmed" : "missing"}.`
          : sentinelConfig.xprizeEntrantType === "team"
            ? `Entrant type=team; representative authorization ${sentinelConfig.xprizeRepresentativeAuthorized ? "confirmed" : "missing"}.`
          : sentinelConfig.xprizeEntrantType === "unconfirmed"
            ? "XPRIZE_ENTRANT_TYPE is not set."
            : `Entrant type=${sentinelConfig.xprizeEntrantType}; corporate ID not required for this entrant type.`,
      fix: "Set XPRIZE_ENTRANT_TYPE to individual, team, or organization. If entering as a team, verify representative authority. If entering as an organization, verify corporate ID proof, representative authority, and fewer-than-25-employee status privately."
    },
    {
      id: "general-eligibility",
      label: "General eligibility and promotion-entity conflict check",
      criterion: "Submission Logistics",
      status:
        sentinelConfig.xprizeGeneralEligibilityConfirmed &&
        sentinelConfig.xprizeNoPromotionEntityConflictConfirmed
          ? "passed"
          : "blocked",
      evidence: `General eligibility ${sentinelConfig.xprizeGeneralEligibilityConfirmed ? "confirmed" : "missing"}; promotion-entity conflict check ${sentinelConfig.xprizeNoPromotionEntityConflictConfirmed ? "confirmed" : "missing"}.`,
      fix: "Complete human eligibility review for entrant authority, eligible jurisdiction, and no promotion-entity employee/contractor/family conflict; set the eligibility env flags only after review."
    },
    {
      id: "category-small-business",
      label: "Category fit",
      criterion: "Category Impact",
      status: snapshot.tenant.category === "Small Business Services" ? "passed" : "blocked",
      evidence: `Selected category: ${snapshot.tenant.category}. USP: ${snapshot.tenant.positioning}`,
      fix: "Keep positioning focused on small businesses using Google Workspace to win enterprise trust reviews."
    },
    {
      id: "google-cloud-product",
      label: "Google Cloud product in production path",
      criterion: "AI-Native Operations",
      status: persistence.configured ? "passed" : "blocked",
      evidence: persistence.configured
        ? `Configured project ${persistence.projectId}; persistence targets Firestore, BigQuery audit table ${persistence.bigQueryAuditTable}, BigQuery agent-run table ${persistence.bigQueryAgentRunsTable}, and Secret Manager.`
        : `Not configured: ${persistence.missingEnv.join(", ") || "storage mode is memory"}.`,
      fix: "Deploy to Cloud Run and configure Firestore, BigQuery audit and agent-run tables, Secret Manager, and service-account IAM."
    },
    {
      id: "gemini-api-production",
      label: "Deployed Gemini API call",
      criterion: "AI-Native Operations",
      status: geminiRuns > 0 ? "passed" : mockGeminiRuns > 0 ? "warning" : "blocked",
      evidence:
        geminiRuns > 0
          ? `${geminiRuns} Gemini API run(s) recorded.`
          : mockGeminiRuns > 0
            ? `${mockGeminiRuns} mock Gemini run(s) recorded; no live Gemini API proof yet.`
            : "No semantic agent run has been recorded yet.",
      fix: "Run a deployed high-risk scan with GEMINI_API_KEY configured and preserve the agent/API log."
    },
    {
      id: "workspace-production-sync",
      label: "Live Workspace sync and reconciliation",
      criterion: "AI-Native Operations",
      status: hasLiveWorkspaceConnection && syncIsLive ? "passed" : "blocked",
      evidence: `Connection mode(s): ${snapshot.connections.map((connection) => connection.mode).join(", ")}; sync mode: ${snapshot.syncState.mode}.`,
      fix: "Complete OAuth install, store refresh token in Secret Manager, initialize Drive/Gmail cursors, and run scheduled reconciliation."
    },
    {
      id: "ai-business-operations",
      label: "AI-native operations evidence",
      criterion: "AI-Native Operations",
      status:
        persistence.configured && geminiRuns > 0 && snapshot.auditEvents.length > 3
          ? "passed"
          : snapshot.agentRuns.length > 0 && snapshot.auditEvents.length > 3
            ? "warning"
            : "blocked",
      evidence: `${snapshot.agentRuns.length} agent run(s), ${geminiRuns} live Gemini run(s), ${mockGeminiRuns} mock Gemini run(s), ${snapshot.auditEvents.length} audit event(s), ${snapshot.remediations.length} remediation record(s). Durable agent-run table: ${persistence.bigQueryAgentRunsTable}.`,
      fix: "Record a full production loop: event, deterministic scan, live Gemini audit, staged recommendation, approval, remediation, export, and BigQuery agent-run write-through."
    },
    {
      id: "revenue-arms-length",
      label: "Arms-length revenue evidence",
      criterion: "Business Viability",
      status: productionEvidence && realFinancialProof > 0 ? "passed" : "blocked",
      evidence: productionEvidence
        ? `${realFinancialProof} arms-length pilot(s) have financial-doc-ready proof.`
        : "Current pilot revenue is marked as mock evidence mode and cannot prove revenue.",
      fix: "Set SENTINEL_EVIDENCE_MODE=production only after replacing seed records with real paid customer invoices."
    },
    {
      id: "revenue-by-month-costs-cac",
      label: "Revenue, costs, and CAC by month",
      criterion: "Business Viability",
      status:
        productionEvidence &&
        Object.values(snapshot.tenant.evidence.revenueByMonth).some((amount) => amount > 0) &&
        snapshot.tenant.evidence.totalCostsUsd >= 0 &&
        snapshot.tenant.evidence.customerAcquisitionSpendUsd >= 0
          ? "passed"
          : "blocked",
      evidence: `Revenue by month: ${JSON.stringify(snapshot.tenant.evidence.revenueByMonth)}; costs: $${snapshot.tenant.evidence.totalCostsUsd}; CAC: $${snapshot.tenant.evidence.customerAcquisitionSpendUsd}.`,
      fix: "Attach real financial documentation for May-August 2026, costs, and customer acquisition spend."
    },
    {
      id: "cloud-cost-controls",
      label: "Cloud cost controls and Gemini key restrictions",
      criterion: "Business Viability",
      status: costControls.status === "ready" ? "passed" : "blocked",
      evidence: `Cost-control mode=${costControls.mode}; budget endpoint=${costControls.budgetPlan.endpoint}; key restriction mode=${costControls.apiKeyRestrictionPlan.clientRestrictionMode}.`,
      fix: "Create the Cloud Billing budget, connect Pub/Sub alerts, restrict the Gemini API key, capture quota evidence, and verify in production mode."
    },
    {
      id: "user-feedback-consent",
      label: "Real users and consented feedback",
      criterion: "Business Viability",
      status: productionEvidence && snapshot.tenant.evidence.activeUsers > 0 && consentedFeedback > 0 ? "passed" : "blocked",
      evidence: productionEvidence
        ? `${snapshot.tenant.evidence.activeUsers} active user(s), ${consentedFeedback} consented feedback item(s).`
        : "Current user/testimonial records are not production evidence.",
      fix: "Collect user counts, customer breakdown, and consented testimonials from real pilots."
    },
    {
      id: "related-party-separation",
      label: "Related-party revenue separation",
      criterion: "Business Viability",
      status: snapshot.pilotRecords.every((pilot) => typeof pilot.relatedParty === "boolean") ? "passed" : "blocked",
      evidence: `${snapshot.pilotRecords.filter((pilot) => pilot.relatedParty).length} related-party pilot(s) flagged out of ${snapshot.pilotRecords.length}.`,
      fix: "Keep related-party revenue separated from arms-length totals in every judge export."
    },
    {
      id: "claim-guard",
      label: "Claim and compliance copy guard",
      criterion: "Safety",
      status: claimGuard.status === "passed" ? "passed" : claimGuard.status === "warning" ? "warning" : "blocked",
      evidence: `${claimGuard.violations.length} violation(s), ${claimGuard.warnings.length} warning(s).`,
      fix: "Run Claim Guard before every hosted release, judge export, and demo script update."
    },
    {
      id: "human-approval",
      label: "Human-in-the-loop remediation",
      criterion: "Safety",
      status: snapshot.tenant.settings.requireHumanApproval ? "passed" : "blocked",
      evidence: `requireHumanApproval=${snapshot.tenant.settings.requireHumanApproval}; safe auto actions=${snapshot.tenant.settings.safeAutoActions.length}.`,
      fix: "Keep non-trivial security remediation staged until admin approval."
    },
    {
      id: "redacted-judge-export",
      label: "Redacted judge evidence export",
      criterion: "Submission Logistics",
      status: snapshot.auditEvents.some((event) => event.type === "evidence_exported") ? "passed" : "warning",
      evidence: `${snapshot.auditEvents.filter((event) => event.type === "evidence_exported").length} evidence export event(s) recorded.`,
      fix: "Generate the redacted judge export immediately before submission and inspect it for customer/security leakage."
    },
    {
      id: "product-url",
      label: "Working product URL",
      criterion: "Submission Logistics",
      status: hasJudgeProductAccess() ? "passed" : "blocked",
      evidence: judgeProductAccessSummary(),
      fix: "Deploy the app, set NEXT_PUBLIC_PRODUCT_URL to the hosted judge-accessible URL, and confirm free access remains available through the judging period."
    },
    {
      id: "repository-url",
      label: "Repository URL",
      criterion: "Submission Logistics",
      status: sentinelConfig.repositoryUrl ? "passed" : "blocked",
      evidence: sentinelConfig.repositoryUrl || "XPRIZE_REPOSITORY_URL is not configured.",
      fix: "Publish or share the repository as required by Devpost and set XPRIZE_REPOSITORY_URL."
    },
    {
      id: "demo-video",
      label: "Under-three-minute demo video",
      criterion: "Submission Logistics",
      status: hasDemoVideoClearance() ? "passed" : "blocked",
      evidence: demoVideoClearanceSummary(),
      fix: "Record a concise public under-three-minute demo showing the functioning project and Google/Gemini proof, then confirm asset clearance and customer-data redaction before setting the demo-video clearance flags."
    }
  ];
}

function resolveEntrantIdentityGateStatus(): XPrizeGateStatus {
  if (sentinelConfig.xprizeEntrantType === "unconfirmed") {
    return "blocked";
  }

  if (sentinelConfig.xprizeEntrantType === "team" && !sentinelConfig.xprizeRepresentativeAuthorized) {
    return "blocked";
  }

  if (
    sentinelConfig.xprizeEntrantType === "organization" &&
    (!sentinelConfig.xprizeCorporateIdConfigured ||
      !sentinelConfig.xprizeRepresentativeAuthorized ||
      !sentinelConfig.xprizeOrganizationUnder25Confirmed)
  ) {
    return "blocked";
  }

  return "passed";
}

function buildCriterionScores(checks: XPrizeGateCheck[]): XPrizeSubmissionGate["criterionScores"] {
  const criteria: XPrizeGateCheck["criterion"][] = [
    "Business Viability",
    "AI-Native Operations",
    "Category Impact",
    "Submission Logistics",
    "Safety"
  ];

  return Object.fromEntries(
    criteria.map((criterion) => {
      const relevant = checks.filter((check) => check.criterion === criterion);
      const score =
        relevant.length === 0
          ? 0
          : Math.round(
              relevant.reduce((total, check) => total + statusScore(check.status), 0) / relevant.length
            );

      return [criterion, score];
    })
  ) as XPrizeSubmissionGate["criterionScores"];
}

function statusScore(status: XPrizeGateStatus) {
  if (status === "passed") {
    return 100;
  }

  if (status === "warning") {
    return 55;
  }

  return 0;
}

function buildNextBestActions(checks: XPrizeGateCheck[]) {
  return checks
    .filter((check) => check.status === "blocked")
    .slice(0, 5)
    .map((check) => check.fix);
}
