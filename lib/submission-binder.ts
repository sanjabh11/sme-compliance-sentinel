import {
  demoVideoClearanceSummary,
  hasDemoVideoClearance,
  hasJudgeProductAccess,
  judgeProductAccessSummary,
  sentinelConfig
} from "@/lib/config";
import { buildXPrizeSubmissionGate } from "@/lib/xprize-gate";
import { buildSubmissionComplianceCenter } from "@/lib/submission-compliance";
import { buildThirdPartyManifest } from "@/lib/license-manifest";
import { buildDevpostSubmissionPack } from "@/lib/devpost-submission";
import { hasLiveWorkspaceSyncEvidence } from "@/lib/workspace-sync";
import type {
  DashboardSnapshot,
  SubmissionEvidenceArtifact,
  SubmissionEvidenceKind,
  SubmissionEvidenceStatus,
  SubmissionPrivateEvidenceRequest,
  SubmissionTestingInstruction,
  XPrizeGateCheck,
  XPrizeSubmissionBinder
} from "@/lib/types";

type BinderSnapshot = Pick<
  DashboardSnapshot,
  | "tenant"
  | "connections"
  | "syncState"
  | "agentRuns"
  | "auditEvents"
  | "pilotRecords"
  | "aggregateCounters"
  | "findings"
  | "remediations"
  | "trustPackets"
  | "questionnairePacks"
  | "pilotProspects"
>;

const judgeResponseSlaHours = 48;

export function buildXPrizeSubmissionBinder(snapshot: BinderSnapshot): XPrizeSubmissionBinder {
  const gate = buildXPrizeSubmissionGate(snapshot);
  const artifactManifest = [...buildGateArtifacts(gate.checks), ...buildSupplementalArtifacts(snapshot)];

  return {
    generatedAt: new Date().toISOString(),
    category: gate.category,
    overallStatus: gate.overallStatus,
    factualWinConfidence: gate.factualWinConfidence,
    judgeResponseSlaHours,
    testingInstructions: buildTestingInstructions(),
    demoTimeline: buildDemoTimeline(snapshot),
    artifactManifest,
    artifactSummary: summarizeArtifacts(artifactManifest),
    privateEvidenceRequestQueue: buildPrivateEvidenceQueue(snapshot),
    claimBoundary: [
      "Use SOC2 readiness evidence and risk detection language only.",
      "Do not publish customer security findings, private invoices, secrets, or non-consented testimonials.",
      "Treat local mock data as demo evidence until production Google Cloud, Gemini API, Workspace sync, and real revenue records are attached.",
      "Antigravity can be mentioned only as optional development tooling if actually used; it is not an app requirement.",
      "Keep judge credentials in Devpost testing instructions or a private channel, never in the repository."
    ],
    ruleBasis: [
      ...gate.ruleBasis,
      "Submission packet must include product access, repository access, public demo video, revenue/cost/CAC evidence, real-user evidence, and production operation proof.",
      "Judging may rely on the submitted text, images, and video, so the binder keeps a short demo timeline and artifact manifest.",
      "Evidence requests from the organizer must be answerable within two business days."
    ],
    finalPreSubmitChecks: [
      "Run Claim Guard on Devpost copy, README, demo script, and exported judge packet.",
      "Run the XPRIZE Submission Gate and clear every blocker with production evidence.",
      "Verify the hosted product URL, repository URL, and video URL from a signed-out browser.",
      "Attach revenue by month, total costs, customer acquisition spend, active user breakdown, and related-party separation.",
      "Export a redacted judge packet and inspect it for customer/security leakage.",
      "Capture Gemini API logs, Google Cloud logs, dashboard screenshots, and a live Workspace sync/reconciliation trace."
    ]
  };
}

function buildGateArtifacts(checks: XPrizeGateCheck[]): SubmissionEvidenceArtifact[] {
  return checks.map((check) => {
    const mapped = artifactMapping(check.id);

    return {
      id: `gate_${check.id}`,
      kind: mapped.kind,
      label: check.label,
      criterion: check.criterion,
      status: statusForCheck(check),
      source: mapped.source,
      evidence: check.evidence,
      fix: check.fix,
      redacted: mapped.redacted,
      ownerRole: mapped.ownerRole,
      requiredFor: mapped.requiredFor,
      privateHandling: mapped.privateHandling
    };
  });
}

function buildSupplementalArtifacts(snapshot: BinderSnapshot): SubmissionEvidenceArtifact[] {
  const latestTrustPacket = snapshot.trustPackets[0];
  const exportedQuestionnairePacks = snapshot.questionnairePacks.filter((pack) => pack.status === "exported");
  const submissionCompliance = buildSubmissionComplianceCenter(snapshot);
  const thirdPartyManifest = buildThirdPartyManifest();
  const devpostPack = buildDevpostSubmissionPack(snapshot);

  return [
    {
      id: "supplemental_devpost_submission_pack",
      kind: "devpost-pack",
      label: "Devpost copy, demo script, and screenshot pack",
      criterion: "Submission Logistics",
      status: devpostPack.overallStatus === "ready" ? "ready" : devpostPack.overallStatus === "needs-review" ? "mock-only" : "missing",
      source: "/api/xprize/devpost-pack",
      evidence: `${devpostPack.demoVideoScript.length} demo scene(s), ${devpostPack.screenshotChecklist.length} screenshot target(s), ${devpostPack.blockers.length} blocker(s).`,
      fix: devpostPack.nextActions[0] ?? "Generate and human-review the final Devpost copy, demo script, screenshots, and testing instructions.",
      redacted: false,
      ownerRole: "sales",
      requiredFor: "Devpost text, public demo plan, screenshots, testing instructions, and private evidence-response readiness.",
      privateHandling: "Use the generated public copy only after final human review; keep credentials and private customer proof outside public fields."
    },
    {
      id: "supplemental_license_manifest",
      kind: "license-manifest",
      label: "Dependency license and third-party API manifest",
      criterion: "Submission Logistics",
      status: thirdPartyManifest.summary.status === "passed" ? "ready" : thirdPartyManifest.summary.status === "warning" ? "mock-only" : "missing",
      source: "/api/xprize/license-manifest",
      evidence: `${thirdPartyManifest.summary.totalPackages} package(s), ${thirdPartyManifest.summary.unknownLicenseCount} unknown license(s), ${thirdPartyManifest.summary.restrictedLicenseReviewCount} restricted-review package(s), ${thirdPartyManifest.summary.obligationReviewCount} obligation-review package(s), ${thirdPartyManifest.summary.licenseNeedsReviewCount} license-review package(s), ${thirdPartyManifest.summary.integrationsNeedingReview} integration(s) needing review.`,
      fix: thirdPartyManifest.nextActions[0] ?? "Review and approve third-party dependency and API-use disclosure before final submission.",
      redacted: false,
      ownerRole: "legal",
      requiredFor: "Third-party SDK/API authorization, open-source disclosure, and repository review.",
      privateHandling: "Include the manifest in judge materials only after removing secrets and private customer evidence."
    },
    {
      id: "supplemental_submission_compliance",
      kind: "claim-guard",
      label: "Submission, IP, license, and demo clearance gate",
      criterion: "Submission Logistics",
      status: submissionCompliance.overallStatus === "passed" ? "ready" : submissionCompliance.overallStatus === "warning" ? "mock-only" : "missing",
      source: "/api/xprize/submission-compliance",
      evidence: `${submissionCompliance.summary.passed} passed, ${submissionCompliance.summary.warning} warning, ${submissionCompliance.summary.blocked} blocked compliance check(s).`,
      fix: submissionCompliance.nextActions[0] ?? "Run the final submission compliance gate immediately before Devpost upload.",
      redacted: false,
      ownerRole: "legal",
      requiredFor: "Submission logistics, IP ownership, demo-video clearance, and evidence-response readiness.",
      privateHandling: "Publish only status and checklist; keep customer documents, credentials, and private proof outside the repository."
    },
    {
      id: "supplemental_trust_packet",
      kind: "trust-packet",
      label: "Redacted Trust Packet",
      criterion: "Business Viability",
      status: latestTrustPacket ? "ready" : "missing",
      source: "/api/trust-center/packets",
      evidence: latestTrustPacket
        ? `Latest packet expires ${latestTrustPacket.expiresAt}; approved documents ${latestTrustPacket.approvedDocuments.length}.`
        : "No Trust Packet has been generated in the current state.",
      fix: "Create a time-limited packet for each consented prospect and verify private findings are excluded.",
      redacted: true,
      ownerRole: "sales",
      requiredFor: "Prospect trust proof and user evidence support.",
      privateHandling: "Share only tokenized, expiring links with prospect aliases and approved document summaries."
    },
    {
      id: "supplemental_questionnaire_pack",
      kind: "questionnaire-pack",
      label: "Security questionnaire response pack",
      criterion: "Category Impact",
      status: exportedQuestionnairePacks.length > 0 ? "ready" : snapshot.questionnairePacks.length > 0 ? "mock-only" : "missing",
      source: "/api/questionnaire/packs",
      evidence:
        exportedQuestionnairePacks.length > 0
          ? `${exportedQuestionnairePacks.length} exported questionnaire response pack(s).`
          : `${snapshot.questionnairePacks.length} draft questionnaire response pack(s).`,
      fix: "Export a customer-specific response pack after human approval and include it as redacted category-impact evidence.",
      redacted: true,
      ownerRole: "security",
      requiredFor: "AI-native operations and sales-review acceleration proof.",
      privateHandling: "Remove customer names and unanswered private controls before sharing with judges or prospects."
    }
  ];
}

function buildTestingInstructions(): SubmissionTestingInstruction[] {
  return [
    {
      label: "Working product URL",
      value: hasJudgeProductAccess() ? sentinelConfig.productUrl : judgeProductAccessSummary(),
      status: hasJudgeProductAccess() ? "ready" : "missing"
    },
    {
      label: "Repository URL",
      value: sentinelConfig.repositoryUrl || "Missing XPRIZE_REPOSITORY_URL.",
      status: sentinelConfig.repositoryUrl ? "ready" : "missing"
    },
    {
      label: "Public demo video",
      value: hasDemoVideoClearance() ? sentinelConfig.demoVideoUrl : demoVideoClearanceSummary(),
      status: hasDemoVideoClearance() ? "ready" : "missing"
    },
    {
      label: "Judge access instructions",
      value: sentinelConfig.judgeTestingInstructions,
      status: sentinelConfig.judgeAccessConfigured ? "private-on-request" : "missing"
    }
  ];
}

function buildDemoTimeline(snapshot: BinderSnapshot) {
  const latestFinding = snapshot.findings[0];
  const latestRun = snapshot.agentRuns[0];

  return [
    {
      timestamp: "0:00-0:20",
      scene: "State the Small Business Services wedge: one-day Google Workspace risk scan for startups facing enterprise security reviews.",
      proof: `Current category is ${snapshot.tenant.category}.`
    },
    {
      timestamp: "0:20-0:45",
      scene: "Trigger a Workspace event and show Tier 0/Tier 1 filtering before any semantic model call.",
      proof: `${snapshot.aggregateCounters.filesInspected} file(s) inspected; ${snapshot.aggregateCounters.bytesScannedByDlp} byte(s) scanned by deterministic DLP.`
    },
    {
      timestamp: "0:45-1:15",
      scene: "Show the Gemini semantic audit only when guardrails allow it.",
      proof: latestRun
        ? `${latestRun.provider} run on ${latestRun.model}; estimated cost $${latestRun.estimatedCostUsd.toFixed(4)}.`
        : "No semantic agent run is recorded yet."
    },
    {
      timestamp: "1:15-1:45",
      scene: "Approve a staged recommendation and show remediation audit evidence.",
      proof: latestFinding
        ? `${latestFinding.status} finding with approver ${latestFinding.approval.requiredRole}; ${snapshot.remediations.length} remediation record(s).`
        : "No finding is recorded yet."
    },
    {
      timestamp: "1:45-2:15",
      scene: "Generate trust proof: Evidence Room, Trust Packet, and questionnaire response pack.",
      proof: `${snapshot.trustPackets.length} Trust Packet(s); ${snapshot.questionnairePacks.length} questionnaire pack(s).`
    },
    {
      timestamp: "2:15-2:50",
      scene: "Open the XPRIZE binder and show unresolved production evidence honestly.",
      proof: `${snapshot.auditEvents.length} audit event(s); evidence mode is ${sentinelConfig.evidenceMode}.`
    }
  ];
}

function buildPrivateEvidenceQueue(snapshot: BinderSnapshot): SubmissionPrivateEvidenceRequest[] {
  const productionEvidence = sentinelConfig.evidenceMode === "production";
  const financialProofReady = productionEvidence
    ? snapshot.pilotRecords.some((pilot) => pilot.armsLength && !pilot.relatedParty && pilot.monthlyRevenueUsd > 0 && pilot.proofStatus === "financial-doc-ready")
    : false;
  const userProofReady = productionEvidence && snapshot.tenant.evidence.activeUsers > 0;
  const consentedFeedbackReady =
    productionEvidence && snapshot.pilotRecords.some((pilot) => pilot.consentStatus === "consented" && pilot.testimonialQuote);
  const geminiProofReady = snapshot.agentRuns.some((run) => run.provider === "gemini-api");
  const cloudProofReady = sentinelConfig.storageMode === "gcp-rest" && Boolean(sentinelConfig.googleCloudProject);
  const workspaceProofReady =
    snapshot.connections.some((connection) => connection.mode === "oauth" || connection.mode === "domain-wide-delegation") &&
    hasLiveWorkspaceSyncEvidence(snapshot.syncState);

  return [
    {
      id: "financial-documentation",
      label: "Revenue, cost, and CAC documentation",
      ownerRole: "founder",
      responseSlaHours: judgeResponseSlaHours,
      status: financialProofReady ? "private-on-request" : "missing",
      handling: "Use the financial evidence ledger and Evidence Vault to track invoices, payment records, cost proof, CAC spend, checksums, redaction state, and related-party notes for judge requests."
    },
    {
      id: "customer-user-proof",
      label: "Real user and customer relationship proof",
      ownerRole: "sales",
      responseSlaHours: judgeResponseSlaHours,
      status: userProofReady && consentedFeedbackReady ? "private-on-request" : "missing",
      handling: "Prepare consented customer references, user counts, and high-level customer segment breakdown."
    },
    {
      id: "production-ai-logs",
      label: "Gemini API and agent execution logs",
      ownerRole: "engineering",
      responseSlaHours: judgeResponseSlaHours,
      status: geminiProofReady ? "private-on-request" : "mock-only",
      handling: "Export redacted Gemini request metadata, model names, costs, and agent-run timeline from production only."
    },
    {
      id: "google-cloud-proof",
      label: "Google Cloud production proof",
      ownerRole: "engineering",
      responseSlaHours: judgeResponseSlaHours,
      status: cloudProofReady ? "private-on-request" : "missing",
      handling: "Prepare Cloud Run revision, Firestore tenant path, BigQuery audit rows, Secret Manager token path, and IAM screenshots/logs."
    },
    {
      id: "cloud-cost-control-proof",
      label: "Cloud Billing budget, quota, and API-key restriction proof",
      ownerRole: "engineering",
      responseSlaHours: judgeResponseSlaHours,
      status:
        sentinelConfig.cloudCostControlsMode === "production" &&
        Boolean(sentinelConfig.googleCloudBudgetId) &&
        Boolean(sentinelConfig.geminiApiKeyId)
          ? "private-on-request"
          : "missing",
      handling: "Prepare Cloud Billing budget screenshots, Pub/Sub alert test logs, quota screenshots, and API key restriction evidence."
    },
    {
      id: "workspace-sync-proof",
      label: "Workspace OAuth and sync proof",
      ownerRole: "security",
      responseSlaHours: judgeResponseSlaHours,
      status: workspaceProofReady ? "private-on-request" : "missing",
      handling: "Keep consent screenshots, Drive page-token state, Gmail historyId state, channel renewal records, and reconciliation logs."
    }
  ];
}

function statusForCheck(check: XPrizeGateCheck): SubmissionEvidenceStatus {
  if (check.status === "passed") {
    return privateCheckIds.has(check.id) ? "private-on-request" : "verified";
  }

  if (check.evidence.toLowerCase().includes("mock")) {
    return "mock-only";
  }

  return "missing";
}

function summarizeArtifacts(artifacts: SubmissionEvidenceArtifact[]) {
  const summary: Record<SubmissionEvidenceStatus, number> = {
    missing: 0,
    "mock-only": 0,
    ready: 0,
    "private-on-request": 0,
    verified: 0
  };

  for (const artifact of artifacts) {
    summary[artifact.status] += 1;
  }

  return summary;
}

const privateCheckIds = new Set([
  "revenue-arms-length",
  "revenue-by-month-costs-cac",
  "user-feedback-consent",
  "related-party-separation",
  "workspace-production-sync",
  "gemini-api-production",
  "google-cloud-product",
  "cloud-cost-controls"
]);

function artifactMapping(id: string): Pick<
  SubmissionEvidenceArtifact,
  "kind" | "source" | "redacted" | "ownerRole" | "requiredFor" | "privateHandling"
> {
  const mapping: Record<
    string,
    Pick<SubmissionEvidenceArtifact, "kind" | "source" | "redacted" | "ownerRole" | "requiredFor" | "privateHandling">
  > = {
    "category-small-business": {
      kind: "screenshot",
      source: "Readiness Command Center and strategy narrative",
      redacted: false,
      ownerRole: "sales",
      requiredFor: "Category selection and category impact explanation.",
      privateHandling: "Use public product copy only."
    },
    "google-cloud-product": {
      kind: "gcp-log",
      source: "Cloud Run, Firestore, BigQuery, Secret Manager, and persistence verifier",
      redacted: true,
      ownerRole: "engineering",
      requiredFor: "Required Google Cloud product proof.",
      privateHandling: "Share project ids, logs, and IAM evidence with secrets redacted."
    },
    "gemini-api-production": {
      kind: "gemini-log",
      source: "Agent runs and Gemini API metadata",
      redacted: true,
      ownerRole: "engineering",
      requiredFor: "Required deployed Gemini API call proof.",
      privateHandling: "Share metadata, model id, timestamps, and cost estimates without prompt secrets."
    },
    "workspace-production-sync": {
      kind: "workspace-sync",
      source: "Workspace OAuth, Drive changes, Gmail history, and sync reconciliation",
      redacted: true,
      ownerRole: "security",
      requiredFor: "Production AI-native operations proof.",
      privateHandling: "Share tenant aliases, cursor state, and reconciliation logs without customer content."
    },
    "ai-business-operations": {
      kind: "gemini-log",
      source: "Agent-run timeline and audit events",
      redacted: true,
      ownerRole: "engineering",
      requiredFor: "AI-native operations criterion.",
      privateHandling: "Share redacted logs and dashboard screenshots."
    },
    "revenue-arms-length": {
      kind: "financial-record",
      source: "Private Evidence Room and pilot CRM",
      redacted: true,
      ownerRole: "founder",
      requiredFor: "Business viability revenue proof.",
      privateHandling: "Share invoices and customer payment records only through private judge evidence requests."
    },
    "revenue-by-month-costs-cac": {
      kind: "financial-record",
      source: "Evidence Room revenue by month, cost, and CAC fields",
      redacted: true,
      ownerRole: "founder",
      requiredFor: "Business viability financial disclosure.",
      privateHandling: "Keep source documents private; expose only aggregate or redacted summaries in app screenshots."
    },
    "cloud-cost-controls": {
      kind: "gcp-log",
      source: "/api/production/cost-controls",
      redacted: true,
      ownerRole: "engineering",
      requiredFor: "Business viability cost-control and API-key safety proof.",
      privateHandling: "Share billing budget ids, quota screenshots, and key restriction screenshots privately with secrets redacted."
    },
    "user-feedback-consent": {
      kind: "customer-testimonial",
      source: "Pilot CRM and testimonial consent fields",
      redacted: true,
      ownerRole: "sales",
      requiredFor: "Real-user and testimonial evidence.",
      privateHandling: "Share testimonials only when customer consent is explicit."
    },
    "related-party-separation": {
      kind: "financial-record",
      source: "Pilot CRM related-party fields",
      redacted: true,
      ownerRole: "founder",
      requiredFor: "Related-party revenue separation.",
      privateHandling: "Keep related-party notes private and separate from arms-length totals."
    },
    "claim-guard": {
      kind: "claim-guard",
      source: "/api/compliance/claims",
      redacted: false,
      ownerRole: "legal",
      requiredFor: "Safety and submission-copy boundaries.",
      privateHandling: "Publish pass/fail status; keep internal review notes private if they mention customers."
    },
    "human-approval": {
      kind: "screenshot",
      source: "Findings dashboard and approval audit events",
      redacted: true,
      ownerRole: "security",
      requiredFor: "Safety and trust in remediation.",
      privateHandling: "Show workflow screenshots with file names and customer domains redacted."
    },
    "redacted-judge-export": {
      kind: "redacted-export",
      source: "/api/evidence/export?redacted=true",
      redacted: true,
      ownerRole: "founder",
      requiredFor: "Submission logistics and evidence packet.",
      privateHandling: "Inspect the export before upload; remove customer names, security findings, and private invoices."
    },
    "product-url": {
      kind: "product-url",
      source: "NEXT_PUBLIC_PRODUCT_URL",
      redacted: false,
      ownerRole: "engineering",
      requiredFor: "Working product access for testing.",
      privateHandling: "If login is needed, keep credentials only in Devpost testing instructions."
    },
    "repository-url": {
      kind: "repository",
      source: "XPRIZE_REPOSITORY_URL",
      redacted: false,
      ownerRole: "engineering",
      requiredFor: "Source repository access for judging.",
      privateHandling: "Private repositories must be shared with the required judge/testing accounts."
    },
    "demo-video": {
      kind: "demo-video",
      source: "XPRIZE_DEMO_VIDEO_URL",
      redacted: false,
      ownerRole: "sales",
      requiredFor: "Public under-three-minute demo video.",
      privateHandling: "Use only owned or permitted assets and remove customer-identifying screen content."
    }
  };

  return mapping[id] ?? {
    kind: fallbackKind(id),
    source: "XPRIZE Submission Gate",
    redacted: true,
    ownerRole: "founder",
    requiredFor: "Rule evidence support.",
    privateHandling: "Review before sharing and redact customer/security details."
  };
}

function fallbackKind(id: string): SubmissionEvidenceKind {
  if (id.includes("revenue")) {
    return "financial-record";
  }

  if (id.includes("user") || id.includes("feedback")) {
    return "user-proof";
  }

  return "screenshot";
}
