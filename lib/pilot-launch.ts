import {
  demoVideoClearanceSummary,
  hasDemoVideoClearance,
  hasJudgeProductAccess,
  judgeProductAccessSummary,
  sentinelConfig
} from "@/lib/config";
import type { DashboardSnapshot, PilotLaunchChecklistItem, PilotLaunchPlan, PilotLaunchStatus } from "@/lib/types";

type PilotLaunchSnapshot = Pick<
  DashboardSnapshot,
  | "tenant"
  | "connections"
  | "findings"
  | "agentRuns"
  | "remediations"
  | "pilotRecords"
  | "trustPackets"
  | "questionnairePacks"
> & {
  readiness: Pick<DashboardSnapshot["readiness"], "evidenceVault">;
};

export function buildPilotLaunchPlan(snapshot: PilotLaunchSnapshot): PilotLaunchPlan {
  const checklist = buildChecklist(snapshot);
  const score = calculateLaunchReadinessScore(checklist);
  const blockers = checklist
    .filter((item) => item.status === "blocked" || (item.requiredForDayOne && item.status === "external-required"))
    .map((item) => `${item.label}: ${item.fix}`)
    .slice(0, 8);

  return {
    generatedAt: new Date().toISOString(),
    offer: "$199 one-day Google Workspace risk scan plus SOC2 readiness evidence packet for seed-stage teams.",
    targetSegment: "Seed-stage B2B SaaS and founder-led services teams facing enterprise security reviews.",
    launchReadinessScore: score,
    status: overallStatus(checklist),
    checklist,
    oneDayTimeline: [
      {
        window: "T-24h",
        action: "Confirm buyer consent, target Workspace domain, allowed data sources, and private proof handling.",
        proof: "Signed pilot note, consent language, and Evidence Vault artifact slots.",
        ownerRole: "founder"
      },
      {
        window: "0:00-0:30",
        action: "Install Workspace OAuth for an allowlisted pilot user or run the mock demo if credentials are not ready.",
        proof: "OAuth launch plan, stored token path, Drive/Gmail cursor readiness.",
        ownerRole: "engineering"
      },
      {
        window: "0:30-2:00",
        action: "Run the hybrid scanner and prove low-risk events do not call Gemini.",
        proof: "Agent-run timeline, DLP counters, Gemini cost guardrails, and skipped-event audit logs.",
        ownerRole: "security"
      },
      {
        window: "2:00-4:00",
        action: "Review staged recommendations, approve safe fixes, and log remediation evidence.",
        proof: "HITL approval, RBAC decision, remediation record, and score snapshot.",
        ownerRole: "security"
      },
      {
        window: "4:00-6:00",
        action: "Generate buyer proof: evidence packet, Trust Packet, questionnaire response pack, and deal-impact report.",
        proof: "Redacted exports, Trust Packet access link, questionnaire pack, and ROI/deal-impact summary.",
        ownerRole: "sales"
      },
      {
        window: "6:00-8:00",
        action: "Collect commercial proof and judge artifacts without exposing private customer details.",
        proof: "Financial ledger, Evidence Vault artifacts, consent records, and submission binder.",
        ownerRole: "finance"
      }
    ],
    buyerObjections: [
      {
        objection: "We do not want AI changing Workspace permissions automatically.",
        response: "Sentinel stages recommendations and requires human approval before non-trivial remediation.",
        proofSurface: "Approval Operations, remediation playbooks, and audit log."
      },
      {
        objection: "We cannot send sensitive documents to an LLM indiscriminately.",
        response: "Tier 0 and deterministic scanning filter events before Gemini, with per-event byte caps and budget gates.",
        proofSurface: "Hybrid scanner counters and AI cost guardrail."
      },
      {
        objection: "This sounds like broad compliance automation we already know.",
        response: "The wedge is narrower: a one-day Google Workspace risk scan that turns exposed files into trust proof for active deals.",
        proofSurface: "Deal Impact Report, Trust Packet, and framework evidence pack."
      },
      {
        objection: "Can you prove this is real business traction?",
        response: "Revenue, user, cost, consent, and artifact proof are tracked privately and blocked from public export until ready.",
        proofSurface: "Financial evidence ledger, Evidence Vault, and Submission Binder."
      }
    ],
    blockers,
    nextActions: [
      "Pick one arms-length pilot and collect signed consent before touching live Workspace data.",
      "Configure Google OAuth and GCP persistence, then run one real scan from Cloud Run.",
      "Record before/after risk score, one approved remediation, and one Trust Packet access.",
      "Attach invoice/payment, active-user, cost/CAC, Gemini usage, and Cloud Run evidence in the Evidence Vault.",
      "Generate the final redacted packet, run Claim Guard, and update the submission binder."
    ],
    disclaimer:
      "This is a launch plan and sales workflow. It does not guarantee winning, revenue, legal compliance, audit assurance, or certification."
  };
}

function buildChecklist(snapshot: PilotLaunchSnapshot): PilotLaunchChecklistItem[] {
  const highRiskFindings = snapshot.findings.length;
  const hasAgentRun = snapshot.agentRuns.length > 0;
  const hasRemediation = snapshot.remediations.length > 0;
  const hasTrustPacket = snapshot.trustPackets.length > 0;
  const exportedQuestionnaires = snapshot.questionnairePacks.filter((pack) => pack.status === "exported").length;
  const financialVault = snapshot.readiness.evidenceVault;
  const hasVerifiedVaultArtifact = financialVault.summary.verified > 0;
  const hasQualifiedPilot = snapshot.pilotRecords.some((pilot) => pilot.armsLength && !pilot.relatedParty && pilot.monthlyRevenueUsd > 0);
  const hasFinancialDocs = snapshot.pilotRecords.some((pilot) => pilot.armsLength && !pilot.relatedParty && pilot.proofStatus === "financial-doc-ready");
  const liveWorkspace = snapshot.connections.some((connection) => connection.mode === "oauth" || connection.mode === "domain-wide-delegation");

  return [
    item({
      id: "offer-niche",
      stage: "offer",
      label: "Narrow paid pilot offer",
      status: "ready",
      ownerRole: "founder",
      evidence: "Offer is defined as a one-day Workspace risk scan for seed-stage teams.",
      fix: "Keep sales copy focused on the Workspace-to-trust-proof wedge.",
      requiredForDayOne: true
    }),
    item({
      id: "consent-record",
      stage: "consent",
      label: "Pilot consent and privacy boundary",
      status: sentinelConfig.evidenceMode === "production" && hasQualifiedPilot ? "external-required" : "mock-only",
      ownerRole: "legal",
      evidence: `${snapshot.pilotRecords.length} pilot record(s) exist; production consent still needs real customer backup.`,
      fix: "Collect signed consent before scanning live customer data.",
      requiredForDayOne: true
    }),
    item({
      id: "workspace-oauth",
      stage: "workspace",
      label: "Live Workspace OAuth install",
      status: liveWorkspace ? "ready" : "external-required",
      ownerRole: "engineering",
      evidence: liveWorkspace ? "A live Workspace connection exists." : "Only mock Workspace connection is present.",
      fix: "Configure Google OAuth credentials and install for an allowlisted pilot.",
      requiredForDayOne: true
    }),
    item({
      id: "gcp-persistence",
      stage: "workspace",
      label: "Durable GCP persistence",
      status: sentinelConfig.storageMode === "gcp-rest" ? "ready" : "external-required",
      ownerRole: "engineering",
      evidence: `Storage mode is ${sentinelConfig.storageMode}.`,
      fix: "Deploy on Cloud Run and verify Firestore/BigQuery/Secret Manager write-through.",
      requiredForDayOne: true
    }),
    item({
      id: "hybrid-scan-proof",
      stage: "scan",
      label: "Hybrid scan proof",
      status: highRiskFindings && hasAgentRun ? "ready" : "mock-only",
      ownerRole: "security",
      evidence: `${highRiskFindings} finding(s), ${snapshot.agentRuns.length} agent run(s).`,
      fix: "Run a high-risk event and preserve skipped low-risk proof plus agent-run timeline.",
      requiredForDayOne: true
    }),
    item({
      id: "hitl-remediation",
      stage: "remediation",
      label: "Human-approved remediation proof",
      status: hasRemediation ? "ready" : "mock-only",
      ownerRole: "security",
      evidence: `${snapshot.remediations.length} remediation record(s) exist.`,
      fix: "Approve and remediate one staged recommendation during the pilot.",
      requiredForDayOne: true
    }),
    item({
      id: "trust-packet-proof",
      stage: "trust-proof",
      label: "Trust Packet proof",
      status: hasTrustPacket ? "ready" : "mock-only",
      ownerRole: "sales",
      evidence: `${snapshot.trustPackets.length} Trust Packet(s) created.`,
      fix: "Generate one redacted Trust Packet for a real prospect or judge flow.",
      requiredForDayOne: false
    }),
    item({
      id: "questionnaire-proof",
      stage: "trust-proof",
      label: "Questionnaire response proof",
      status: exportedQuestionnaires > 0 ? "ready" : "mock-only",
      ownerRole: "sales",
      evidence: `${exportedQuestionnaires} exported questionnaire pack(s).`,
      fix: "Export one customer-specific response pack after human approval.",
      requiredForDayOne: false
    }),
    item({
      id: "financial-proof",
      stage: "commercial-proof",
      label: "Invoice and payment evidence",
      status: hasFinancialDocs ? "mock-only" : "blocked",
      ownerRole: "finance",
      evidence: hasFinancialDocs ? "At least one pilot is marked financial-doc-ready locally." : "No counted pilot has invoice/payment evidence ready.",
      fix: "Attach real invoice/payment proof and mark the related Evidence Vault artifact redacted with checksum.",
      requiredForDayOne: true
    }),
    item({
      id: "vault-proof",
      stage: "commercial-proof",
      label: "Verified Evidence Vault artifact",
      status: hasVerifiedVaultArtifact ? "ready" : "blocked",
      ownerRole: "finance",
      evidence: `${financialVault.summary.verified} verified artifact(s), ${financialVault.summary.missing} missing artifact(s).`,
      fix: "Register at least one real private artifact with redaction complete and SHA-256 checksum.",
      requiredForDayOne: true
    }),
    item({
      id: "submission-assets",
      stage: "submission",
      label: "Hosted URL, repo, demo video, and judge access",
      status: hasJudgeProductAccess() && sentinelConfig.repositoryUrl && hasDemoVideoClearance() ? "ready" : "external-required",
      ownerRole: "founder",
      evidence: `${judgeProductAccessSummary()} Repo ${sentinelConfig.repositoryUrl ? "configured" : "missing"}; demo video ${demoVideoClearanceSummary()}`,
      fix: "Publish the hosted app, repository URL, and under-three-minute demo video; configure judge access and all video clearance confirmations before submission.",
      requiredForDayOne: false
    })
  ];
}

function item(input: PilotLaunchChecklistItem): PilotLaunchChecklistItem {
  return input;
}

function calculateLaunchReadinessScore(checklist: PilotLaunchChecklistItem[]) {
  const weightByStatus: Record<PilotLaunchStatus, number> = {
    ready: 1,
    "mock-only": 0.45,
    "external-required": 0.25,
    blocked: 0
  };
  const totalWeight = checklist.reduce((total, item) => total + (item.requiredForDayOne ? 1.5 : 1), 0);
  const score = checklist.reduce(
    (total, item) => total + weightByStatus[item.status] * (item.requiredForDayOne ? 1.5 : 1),
    0
  );

  return Math.round((score / totalWeight) * 100);
}

function overallStatus(checklist: PilotLaunchChecklistItem[]): PilotLaunchStatus {
  if (checklist.some((item) => item.requiredForDayOne && item.status === "blocked")) {
    return "blocked";
  }

  if (checklist.some((item) => item.requiredForDayOne && item.status === "external-required")) {
    return "external-required";
  }

  if (checklist.some((item) => item.status === "mock-only")) {
    return "mock-only";
  }

  return "ready";
}
