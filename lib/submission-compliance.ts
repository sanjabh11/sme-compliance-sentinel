import {
  demoVideoClearanceSummary,
  hasDemoVideoClearance,
  hasJudgeProductAccess,
  judgeProductAccessSummary,
  sentinelConfig
} from "@/lib/config";
import { buildThirdPartyManifest } from "@/lib/license-manifest";
import { buildProjectProvenanceReport } from "@/lib/project-provenance";
import type {
  DashboardSnapshot,
  SubmissionComplianceCenter,
  SubmissionComplianceCheck,
  SubmissionComplianceStatus,
  SubmissionDemoAssetItem
} from "@/lib/types";

type SubmissionComplianceSnapshot = Pick<
  DashboardSnapshot,
  "agentRuns" | "auditEvents" | "pilotRecords" | "trustPackets" | "questionnairePacks"
>;

export function buildSubmissionComplianceCenter(snapshot: SubmissionComplianceSnapshot): SubmissionComplianceCenter {
  const thirdPartyManifest = buildThirdPartyManifest();
  const projectProvenance = buildProjectProvenanceReport();
  const checks = buildChecks(snapshot, thirdPartyManifest, projectProvenance);
  const summary = summarizeChecks(checks);
  const overallStatus: SubmissionComplianceStatus = summary.blocked > 0 ? "blocked" : summary.warning > 0 ? "warning" : "passed";

  return {
    generatedAt: new Date().toISOString(),
    overallStatus,
    summary,
    thirdPartyManifestSummary: thirdPartyManifest.summary,
    projectProvenance,
    checks,
    demoAssetChecklist: buildDemoAssetChecklist(snapshot),
    repositoryDisclosure: buildRepositoryDisclosure(),
    nextActions: checks
      .filter((check) => check.status !== "passed")
      .slice(0, 6)
      .map((check) => check.fix),
    disclaimer:
      "This is a submission-readiness control surface. It does not replace legal review, Devpost review, or customer consent checks."
  };
}

function buildChecks(
  snapshot: SubmissionComplianceSnapshot,
  thirdPartyManifest: ReturnType<typeof buildThirdPartyManifest>,
  projectProvenance: ReturnType<typeof buildProjectProvenanceReport>
): SubmissionComplianceCheck[] {
  const hasRepo = Boolean(sentinelConfig.repositoryUrl);
  const demoVideoCleared = hasDemoVideoClearance();
  const hasEvidenceExport = snapshot.auditEvents.some((event) => event.type === "evidence_exported");
  const hasGeminiRun = snapshot.agentRuns.some((run) => run.provider === "gemini-api");
  const productionEvidence = sentinelConfig.evidenceMode === "production";
  const hasFinancialProof =
    productionEvidence &&
    snapshot.pilotRecords.some((pilot) => pilot.armsLength && !pilot.relatedParty && pilot.proofStatus === "financial-doc-ready");

  return [
    {
      id: "new-project-provenance",
      label: "New-project and pre-existing-work disclosure",
      ruleArea: "Project Eligibility",
      status: projectProvenance.overallStatus,
      evidence: `${projectProvenance.git.commitCount} commit(s), ${projectProvenance.git.trackedFileCount} tracked file(s), ${projectProvenance.git.untrackedPaths.length} untracked path(s). ${projectProvenance.git.firstCommitAt ? `First commit ${projectProvenance.git.firstCommitAt}.` : "First commit unavailable."}`,
      fix:
        projectProvenance.nextActions[0] ??
        "Add final Devpost text that the project was created after the official start date only after checking repository history.",
      ownerRole: "founder",
      requiredBeforeSubmit: true
    },
    {
      id: "repository-access",
      label: "Repository access and source completeness",
      ruleArea: "Testing Access",
      status: hasRepo ? "passed" : "blocked",
      evidence: hasRepo ? sentinelConfig.repositoryUrl : "XPRIZE_REPOSITORY_URL is not configured.",
      fix: "Publish the repository or share a private repository with the required judge/testing accounts, then set XPRIZE_REPOSITORY_URL.",
      ownerRole: "engineering",
      requiredBeforeSubmit: true
    },
    {
      id: "product-access",
      label: "Working product URL and judge access",
      ruleArea: "Testing Access",
      status: hasJudgeProductAccess() ? "passed" : "blocked",
      evidence: judgeProductAccessSummary(),
      fix: "Deploy the app, verify it from a signed-out browser, keep credentials only in Devpost testing instructions or a private channel, and confirm free judge access remains available through the judging period.",
      ownerRole: "engineering",
      requiredBeforeSubmit: true
    },
    {
      id: "general-eligibility",
      label: "General eligibility and conflict attestation",
      ruleArea: "Project Eligibility",
      status:
        sentinelConfig.xprizeGeneralEligibilityConfirmed &&
        sentinelConfig.xprizeNoPromotionEntityConflictConfirmed
          ? "passed"
          : "blocked",
      evidence: `General eligibility ${sentinelConfig.xprizeGeneralEligibilityConfirmed ? "confirmed" : "missing"}; promotion-entity conflict check ${sentinelConfig.xprizeNoPromotionEntityConflictConfirmed ? "confirmed" : "missing"}.`,
      fix: "Confirm entrant eligibility, allowed jurisdiction, age/authority to enter, and no employee/contractor/family conflict with promotion entities; set XPRIZE_GENERAL_ELIGIBILITY_CONFIRMED and XPRIZE_NO_PROMOTION_ENTITY_CONFLICT_CONFIRMED only after human review.",
      ownerRole: "legal",
      requiredBeforeSubmit: true
    },
    {
      id: "demo-video-clearance",
      label: "Demo video length, visibility, and asset clearance",
      ruleArea: "Demo Video",
      status: demoVideoCleared ? "passed" : "blocked",
      evidence: demoVideoClearanceSummary(),
      fix: "Record a public under-three-minute video in English or with English subtitles, using only owned/permitted UI footage, no copyrighted music, and no customer-identifying security data; set all demo-video clearance env flags only after human review.",
      ownerRole: "sales",
      requiredBeforeSubmit: true
    },
    {
      id: "third-party-license-manifest",
      label: "Third-party SDK/API and open-source license manifest",
      ruleArea: "Third-Party Use",
      status:
        thirdPartyManifest.summary.status === "blocked"
          ? "blocked"
          : sentinelConfig.thirdPartyReviewApproved && thirdPartyManifest.summary.status === "passed"
            ? "passed"
            : "warning",
      evidence: `${thirdPartyManifest.summary.totalPackages} package(s), ${thirdPartyManifest.summary.unknownLicenseCount} unknown license(s), ${thirdPartyManifest.summary.restrictedLicenseReviewCount} restricted-review package(s), ${thirdPartyManifest.summary.obligationReviewCount} obligation-review package(s), ${thirdPartyManifest.summary.licenseNeedsReviewCount} license-review package(s), ${thirdPartyManifest.summary.integrationsNeedingReview} integration(s) still need review.`,
      fix:
        thirdPartyManifest.blockers[0] ??
        "Review /api/xprize/license-manifest, cite Google API terms, and set XPRIZE_THIRD_PARTY_REVIEW_APPROVED=true only after human approval.",
      ownerRole: "legal",
      requiredBeforeSubmit: true
    },
    {
      id: "submission-ip-ownership",
      label: "Original work and IP ownership review",
      ruleArea: "IP Ownership",
      status: "warning",
      evidence: "No third-party media assets are required by the current dashboard, but final demo and screenshots still need IP review.",
      fix: "Review screenshots, demo video, icons, logos, copy, and imported templates before upload; remove unlicensed third-party marks or assets.",
      ownerRole: "legal",
      requiredBeforeSubmit: true
    },
    {
      id: "private-evidence-response",
      label: "Two-business-day evidence response packet",
      ruleArea: "Evidence Response",
      status: hasFinancialProof && hasGeminiRun && hasEvidenceExport ? "passed" : "blocked",
      evidence: `Financial proof ${hasFinancialProof ? "ready" : "missing"}; Gemini API log ${hasGeminiRun ? "ready" : "missing"}; judge export ${hasEvidenceExport ? "ready" : "missing"}.`,
      fix: "Prepare private invoice/payment records, Gemini API metadata, Cloud/Gemini logs, customer contact proof, and redacted judge export for organizer requests.",
      ownerRole: "founder",
      requiredBeforeSubmit: true
    },
    {
      id: "customer-consent-and-redaction",
      label: "Customer consent and public redaction boundary",
      ruleArea: "Evidence Response",
      status: snapshot.trustPackets.length > 0 || snapshot.questionnairePacks.length > 0 ? "warning" : "blocked",
      evidence: `${snapshot.trustPackets.length} Trust Packet(s), ${snapshot.questionnairePacks.length} questionnaire pack(s). Consent/redaction still needs production customer proof.`,
      fix: "Collect explicit consent for testimonials/user evidence and keep customer names, private findings, invoices, and security details out of public materials.",
      ownerRole: "sales",
      requiredBeforeSubmit: true
    },
    {
      id: "organization-corporate-id",
      label: "Entrant type and organization corporate ID",
      ruleArea: "Project Eligibility",
      status: resolveEntrantIdentityStatus(),
      evidence:
        sentinelConfig.xprizeEntrantType === "organization"
          ? `Entrant type=organization; corporate ID proof ${sentinelConfig.xprizeCorporateIdConfigured ? "configured" : "missing"}.`
          : sentinelConfig.xprizeEntrantType === "team"
            ? `Entrant type=team; representative authorization ${sentinelConfig.xprizeRepresentativeAuthorized ? "confirmed" : "missing"}.`
          : sentinelConfig.xprizeEntrantType === "unconfirmed"
            ? "Entrant type is unconfirmed; corporate ID applicability cannot be determined."
            : `Entrant type=${sentinelConfig.xprizeEntrantType}; corporate ID not required for this entrant type.`,
      fix:
        sentinelConfig.xprizeEntrantType === "organization"
          ? "Add corporate ID, confirm authorized representative, confirm fewer than 25 employees, and set organization eligibility env flags only after human verification."
          : "Set XPRIZE_ENTRANT_TYPE to individual, team, or organization. If team or organization, verify representative authority privately before submission.",
      ownerRole: "founder",
      requiredBeforeSubmit: true
    }
  ];
}

function resolveEntrantIdentityStatus(): SubmissionComplianceStatus {
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

function buildDemoAssetChecklist(snapshot: SubmissionComplianceSnapshot): SubmissionDemoAssetItem[] {
  const latestRun = snapshot.agentRuns[0];

  return [
    {
      timestamp: "0:00-0:20",
      scene: "State the Small Business Services wedge and buyer problem.",
      requiredProof: "Category and USP visible in the dashboard.",
      assetRisk: "No third-party logos except product UI and allowed platform names.",
      clearanceAction: "Use plain screen capture; avoid copyrighted music and unrelated brand assets."
    },
    {
      timestamp: "0:20-1:10",
      scene: "Run mock or production Workspace event through the hybrid scanner.",
      requiredProof: latestRun ? `${latestRun.provider} run on ${latestRun.model}.` : "Agent run must be captured before final video.",
      assetRisk: "Customer file names, domains, and content can leak.",
      clearanceAction: "Use seeded demo data or redacted production data with customer consent."
    },
    {
      timestamp: "1:10-1:45",
      scene: "Approve staged remediation and show audit/evidence trail.",
      requiredProof: "HITL approval, remediation record, and audit log visible.",
      assetRisk: "Security findings may identify a real customer.",
      clearanceAction: "Blur private identifiers or use the local redacted demo tenant."
    },
    {
      timestamp: "1:45-2:25",
      scene: "Show Trust Packet, prospect pipeline, financial ledger, Evidence Vault, and submission gate.",
      requiredProof: "Commercial evidence blockers and private handling visible.",
      assetRisk: "Invoices, customer names, or testimonials can be exposed without consent.",
      clearanceAction: "Show aggregate/redacted rows only; keep raw private artifacts out of the recording."
    },
    {
      timestamp: "2:25-2:55",
      scene: "Show Google Cloud/Gemini proof and final next action.",
      requiredProof: "Cloud Run/Gemini logs after production deployment.",
      assetRisk: "Secrets, project numbers, billing IDs, and API keys can leak.",
      clearanceAction: "Use logs with tokens redacted and avoid showing secret manager values."
    }
  ];
}

function buildRepositoryDisclosure() {
  return [
    "Repository must include all necessary source code for judging and testing.",
    "Disclose pre-existing frameworks, templates, boilerplate, and open-source dependencies in the Devpost description.",
    "Keep secrets, customer private evidence, judge credentials, and raw invoices outside the repository.",
    "If the repository is private, share it with the required judging/testing accounts before the submission deadline.",
    "Final screenshots and video should avoid unlicensed third-party marks, copyrighted music, and customer-identifying security data."
  ];
}

function summarizeChecks(checks: SubmissionComplianceCheck[]) {
  return checks.reduce<Record<SubmissionComplianceStatus, number>>(
    (summary, check) => {
      summary[check.status] += 1;
      return summary;
    },
    { passed: 0, warning: 0, blocked: 0 }
  );
}
