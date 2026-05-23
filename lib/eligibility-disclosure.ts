import { sentinelConfig } from "@/lib/config";
import { buildThirdPartyManifest } from "@/lib/license-manifest";
import { buildProjectProvenanceReport } from "@/lib/project-provenance";
import type {
  EligibilityDisclosureCheck,
  EligibilityDisclosurePacket,
  EligibilityDisclosureSection,
  EligibilityReviewerAttestation,
  ProjectProvenanceReport,
  ThirdPartyManifest
} from "@/lib/types";

interface EligibilityDisclosureInput {
  projectProvenance?: ProjectProvenanceReport;
  thirdPartyManifest?: ThirdPartyManifest;
  generatedAt?: string;
}

export function buildEligibilityDisclosurePacket(input: EligibilityDisclosureInput = {}): EligibilityDisclosurePacket {
  const projectProvenance = input.projectProvenance ?? buildProjectProvenanceReport();
  const thirdPartyManifest = input.thirdPartyManifest ?? buildThirdPartyManifest();
  const sections = buildDisclosureSections(projectProvenance, thirdPartyManifest);
  const attestations = buildReviewerAttestations();
  const checks = buildChecks(projectProvenance, thirdPartyManifest, attestations);
  const blockers = checks
    .filter((check) => check.status === "blocked")
    .map((check) => `${check.label}: ${check.fix}`);
  const reviewActions = checks
    .filter((check) => check.status !== "passed")
    .map((check) => check.fix);

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    overallStatus: blockers.length ? "blocked" : "ready-for-review",
    repositoryUrl: projectProvenance.repositoryUrl,
    repositoryUrlSource: projectProvenance.repositoryUrlSource,
    provenanceSummary: {
      hackathonStartAt: projectProvenance.hackathonStartAt,
      firstCommitAt: projectProvenance.git.firstCommitAt,
      headCommit: projectProvenance.git.headCommit,
      remoteHeadCommit: projectProvenance.git.remoteHeadCommit,
      commitCount: projectProvenance.git.commitCount,
      trackedFileCount: projectProvenance.git.trackedFileCount,
      untrackedPathCount: projectProvenance.git.untrackedPaths.length
    },
    disclosureSections: sections,
    checks,
    blockers,
    nextActions: reviewActions.length
      ? reviewActions.slice(0, 8)
      : ["Export this packet with the final Devpost submission evidence and retain private reviewer notes outside the repository."],
    reviewerAttestations: attestations,
    privateHandling: [
      "Do not commit judge credentials, customer files, invoices, OAuth tokens, API keys, raw security findings, or private reviewer notes.",
      "Keep final eligibility confirmations in environment variables and private Devpost testing/evidence fields after human review.",
      "Use the public repository only for source, synthetic demo data, rule-safe documentation, and redacted product evidence.",
      "If a private repository is used later, share it with the judging/testing accounts before the submission deadline."
    ],
    sourceUrls: [
      "https://www.geminixprize.com/rules",
      "https://xprize.devpost.com/rules",
      "https://ai.google.dev/gemini-api/docs/models"
    ],
    disclaimer:
      "This packet is a review workflow for XPRIZE submission readiness. It does not replace organizer review, legal review, or final human attestations."
  };
}

function buildDisclosureSections(
  projectProvenance: ProjectProvenanceReport,
  thirdPartyManifest: ThirdPartyManifest
): EligibilityDisclosureSection[] {
  return [
    {
      id: "source-provenance",
      title: "Source Repository And Creation Window",
      summary: `${projectProvenance.git.commitCount} commit(s), first commit ${projectProvenance.git.firstCommitAt ?? "unavailable"}, repository ${projectProvenance.repositoryUrl || "missing"}.`,
      disclosureText: [
        `Hackathon start reference used by the app: ${projectProvenance.hackathonStartAt}.`,
        `Repository evidence: ${projectProvenance.repositoryUrl || "not configured"} (${projectProvenance.repositoryUrlSource}).`,
        `Head commit: ${projectProvenance.git.headCommit ?? "unavailable"}; upstream commit: ${projectProvenance.git.remoteHeadCommit ?? "unavailable"}.`,
        "State that the project was created after the official start only after a human reviewer checks repository history and any pre-existing materials."
      ],
      publicSafe: true,
      privateHandling: "Public-safe except private reviewer notes; do not include credentials or private source mirrors.",
      ownerRole: "founder"
    },
    {
      id: "pre-existing-work",
      title: "Pre-Existing Work And Dependencies",
      summary: "Frameworks, package dependencies, generated boilerplate, and development tooling need final Devpost disclosure.",
      disclosureText: projectProvenance.draftDevpostDisclosure,
      publicSafe: true,
      privateHandling: "Keep human reviewer notes private; disclose dependency classes without exposing secret values or customer evidence.",
      ownerRole: "legal"
    },
    {
      id: "third-party-authorization",
      title: "Third-Party SDK/API Authorization",
      summary: `${thirdPartyManifest.summary.totalPackages} packages, ${thirdPartyManifest.summary.unknownLicenseCount} unknown license(s), ${thirdPartyManifest.summary.obligationReviewCount} obligation-review package(s), ${thirdPartyManifest.summary.integrationsNeedingReview} Google integration(s) still need review.`,
      disclosureText: [
        ...thirdPartyManifest.disclosureText,
        ...thirdPartyManifest.integrations.map(
          (item) => `${item.name}: ${item.status}; ${item.authorizationBasis}; data boundary: ${item.dataBoundary}`
        )
      ],
      publicSafe: false,
      privateHandling: "Publish only high-level SDK/API disclosure; keep API keys, project IDs, billing data, and OAuth client secrets private.",
      ownerRole: "legal"
    },
    {
      id: "google-stack-and-gemini",
      title: "Google Stack And Gemini Proof",
      summary: "The app must prove deployed Google Cloud use and at least one Gemini API call in production when final evidence is available.",
      disclosureText: [
        "Production architecture uses Cloud Run, Firestore, BigQuery, Secret Manager, Pub/Sub, Sensitive Data Protection, Google Workspace APIs, and Gemini API.",
        `Current Gemini model configuration defaults to ${sentinelConfig.geminiModel}; verify model availability against current Gemini docs before submission.`,
        "Keep raw prompts, raw Workspace content, and secrets out of public source and public demo materials."
      ],
      publicSafe: true,
      privateHandling: "Attach deployed Cloud/Gemini logs privately after production launch; redact tokens, project numbers, billing IDs, and customer identifiers.",
      ownerRole: "engineering"
    },
    {
      id: "testing-access",
      title: "Judge Testing Access",
      summary: "Working product URL, testing instructions, and free judging-period access remain private operational evidence until configured.",
      disclosureText: [
        sentinelConfig.productUrl ? `Product URL configured: ${sentinelConfig.productUrl}.` : "Product URL is not configured.",
        `Judge access configured: ${sentinelConfig.judgeAccessConfigured ? "yes" : "no"}.`,
        `Free judging-period access confirmed: ${sentinelConfig.xprizeFreeJudgeAccessThroughJudgingConfirmed ? "yes" : "no"}.`,
        "Provide credentials only in Devpost testing instructions or a private organizer-approved channel."
      ],
      publicSafe: false,
      privateHandling: "Never commit judge credentials; do not expose temporary passwords, magic links, or customer tenant access in source.",
      ownerRole: "engineering"
    },
    {
      id: "claim-and-private-evidence-boundary",
      title: "Claims And Private Evidence Boundary",
      summary: "Use readiness and risk-detection language; keep revenue, customer, OAuth, invoice, and security-finding proof private unless consented.",
      disclosureText: [
        "Use SOC2 readiness evidence, risk detection, staged remediation, human-approved workflow, and redacted judge evidence language.",
        "Do not claim certification, compliance guarantees, legal or audit services, guaranteed revenue, or guaranteed competition outcomes.",
        "Customer testimonials, invoices, payment proof, and active-user evidence need explicit consent and private redaction handling."
      ],
      publicSafe: true,
      privateHandling: "Store raw customer evidence and consent records outside the public repository; show aggregates or redacted proof in public materials.",
      ownerRole: "sales"
    }
  ];
}

function buildChecks(
  projectProvenance: ProjectProvenanceReport,
  thirdPartyManifest: ThirdPartyManifest,
  attestations: EligibilityReviewerAttestation[]
): EligibilityDisclosureCheck[] {
  const provenanceById = new Map(projectProvenance.checks.map((check) => [check.id, check]));
  const sourceChecks = [
    provenanceById.get("git-history-present"),
    provenanceById.get("first-commit-after-start"),
    provenanceById.get("source-tracked"),
    provenanceById.get("repository-url"),
    provenanceById.get("repository-pushed")
  ].filter(Boolean);
  const sourceReady = sourceChecks.every((check) => check?.status === "passed");
  const thirdPartyBlocked = thirdPartyManifest.summary.status === "blocked";
  const thirdPartyCleared = thirdPartyManifest.summary.status === "passed" && sentinelConfig.thirdPartyReviewApproved;

  return [
    packetCheck(
      "source-repository-ready",
      "Repository source evidence is ready for human review",
      sourceReady ? "passed" : "blocked",
      `${projectProvenance.git.commitCount} commit(s), ${projectProvenance.git.trackedFileCount} tracked file(s), ${projectProvenance.git.untrackedPaths.length} untracked path(s), repository ${projectProvenance.repositoryUrl || "missing"}.`,
      "Commit, push/share, and clean the source repository before relying on it as submission evidence.",
      "engineering"
    ),
    packetCheck(
      "project-created-after-start-review",
      "Project-created-after-start attestation is human-reviewed",
      sentinelConfig.projectCreatedAfterStartConfirmed ? "passed" : "needs-review",
      sentinelConfig.projectCreatedAfterStartConfirmed
        ? "XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED is true."
        : "XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED is false; objective git evidence still needs human review.",
      "Review first commit timing, any pre-existing work, and final Devpost disclosure before setting XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED=true.",
      "founder"
    ),
    packetCheck(
      "pre-existing-work-disclosure-review",
      "Pre-existing work and dependency disclosure is reviewed",
      "needs-review",
      "The app generated disclosure text for frameworks, dependencies, Google APIs, and private-evidence exclusions.",
      "Paste a human-reviewed disclosure into Devpost and retain reviewer notes privately.",
      "legal"
    ),
    packetCheck(
      "third-party-api-license-review",
      "Third-party API and license review is cleared",
      thirdPartyBlocked ? "blocked" : thirdPartyCleared ? "passed" : "needs-review",
      `${thirdPartyManifest.summary.totalPackages} package(s), ${thirdPartyManifest.summary.unknownLicenseCount} unknown license(s), ${thirdPartyManifest.summary.restrictedLicenseReviewCount} restricted-review package(s), ${thirdPartyManifest.summary.obligationReviewCount} obligation-review package(s), ${thirdPartyManifest.summary.licenseNeedsReviewCount} license-review package(s), ${thirdPartyManifest.summary.integrationsNeedingReview} integration(s) needing review.`,
      thirdPartyManifest.blockers[0] ??
        "Review dependency licenses, Google API terms, OAuth consent, and Cloud IAM before setting XPRIZE_THIRD_PARTY_REVIEW_APPROVED=true.",
      "legal"
    ),
    packetCheck(
      "entrant-eligibility-review",
      "Entrant identity and eligibility attestations are reviewed",
      resolveEntrantReviewStatus(),
      `Entrant type ${sentinelConfig.xprizeEntrantType}; general eligibility ${sentinelConfig.xprizeGeneralEligibilityConfirmed ? "confirmed" : "missing"}; promotion-entity conflict ${sentinelConfig.xprizeNoPromotionEntityConflictConfirmed ? "confirmed" : "missing"}.`,
      "Confirm entrant type, authority, organization size/corporate ID when applicable, jurisdiction/age/eligibility, and promotion-entity conflict status before setting final flags.",
      "founder"
    ),
    packetCheck(
      "testing-access-boundary",
      "Judge testing access instructions stay private",
      sentinelConfig.productUrl && sentinelConfig.judgeAccessConfigured && sentinelConfig.xprizeFreeJudgeAccessThroughJudgingConfirmed
        ? "passed"
        : "needs-review",
      `Product URL ${sentinelConfig.productUrl ? "configured" : "missing"}; judge access ${sentinelConfig.judgeAccessConfigured ? "configured" : "missing"}; free judging-period access ${sentinelConfig.xprizeFreeJudgeAccessThroughJudgingConfirmed ? "confirmed" : "missing"}.`,
      "Provide product URL and judge credentials through Devpost testing instructions or a private organizer-approved channel, not in the repository.",
      "engineering"
    ),
    packetCheck(
      "private-evidence-boundary",
      "Private evidence is excluded from public source",
      projectProvenance.git.untrackedPaths.some((path) => path.includes("invoice") || path.includes("secret") || path.includes("credential"))
        ? "blocked"
        : "passed",
      "Repository guidance excludes customer files, raw findings, OAuth tokens, API keys, judge credentials, invoices, and payment exports.",
      "Remove any private evidence from source control and register it in the private evidence vault instead.",
      "security"
    ),
    packetCheck(
      "reviewer-attestation-register",
      "Required reviewer attestation flags are tracked",
      attestations.some((item) => !item.currentValue) ? "needs-review" : "passed",
      `${attestations.filter((item) => item.currentValue).length}/${attestations.length} attestation flag(s) currently true.`,
      "Complete human review first, then set only the flags that are factually supported by private evidence.",
      "founder"
    )
  ];
}

function resolveEntrantReviewStatus(): EligibilityDisclosureCheck["status"] {
  if (sentinelConfig.xprizeEntrantType === "unconfirmed") {
    return "needs-review";
  }

  const baseConfirmed =
    sentinelConfig.xprizeGeneralEligibilityConfirmed && sentinelConfig.xprizeNoPromotionEntityConflictConfirmed;

  if (sentinelConfig.xprizeEntrantType === "individual") {
    return baseConfirmed ? "passed" : "needs-review";
  }

  if (sentinelConfig.xprizeEntrantType === "team") {
    return baseConfirmed && sentinelConfig.xprizeRepresentativeAuthorized ? "passed" : "needs-review";
  }

  return baseConfirmed &&
    sentinelConfig.xprizeRepresentativeAuthorized &&
    sentinelConfig.xprizeCorporateIdConfigured &&
    sentinelConfig.xprizeOrganizationUnder25Confirmed
    ? "passed"
    : "needs-review";
}

function buildReviewerAttestations(): EligibilityReviewerAttestation[] {
  return [
    attestation(
      "project-created-after-start",
      "Project created after hackathon start and pre-existing work disclosed",
      "XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED",
      sentinelConfig.projectCreatedAfterStartConfirmed,
      "founder",
      "Set true only after reviewing git history, starter materials, generated boilerplate, and Devpost disclosure text."
    ),
    attestation(
      "third-party-review",
      "Third-party licenses, SDKs, APIs, and OAuth use reviewed",
      "XPRIZE_THIRD_PARTY_REVIEW_APPROVED",
      sentinelConfig.thirdPartyReviewApproved,
      "legal",
      "Set true only after dependency license review and Google API/OAuth terms review are complete."
    ),
    attestation(
      "general-eligibility",
      "General entrant eligibility confirmed",
      "XPRIZE_GENERAL_ELIGIBILITY_CONFIRMED",
      sentinelConfig.xprizeGeneralEligibilityConfirmed,
      "legal",
      "Set true only after confirming the entrant is eligible under the official rules."
    ),
    attestation(
      "representative-authority",
      "Team or organization representative is authorized",
      "XPRIZE_REPRESENTATIVE_AUTHORIZED",
      sentinelConfig.xprizeRepresentativeAuthorized,
      "founder",
      "Set true only when the submitting representative is authorized for a team or organization."
    ),
    attestation(
      "organization-corporate-id",
      "Organization corporate ID proof is configured when applicable",
      "XPRIZE_CORPORATE_ID_CONFIGURED",
      sentinelConfig.xprizeCorporateIdConfigured,
      "founder",
      "Set true only for an organization entry with private corporate ID evidence ready for organizer review."
    ),
    attestation(
      "organization-under-25",
      "Organization employee-count eligibility confirmed when applicable",
      "XPRIZE_ORGANIZATION_UNDER_25_CONFIRMED",
      sentinelConfig.xprizeOrganizationUnder25Confirmed,
      "founder",
      "Set true only after privately confirming the organization-size requirement when entering as an organization."
    ),
    attestation(
      "promotion-entity-conflict",
      "No promotion-entity conflict confirmed",
      "XPRIZE_NO_PROMOTION_ENTITY_CONFLICT_CONFIRMED",
      sentinelConfig.xprizeNoPromotionEntityConflictConfirmed,
      "legal",
      "Set true only after checking employee, contractor, immediate-family, and promotion-entity conflict restrictions."
    ),
    attestation(
      "free-judge-access",
      "Free product access remains available during judging",
      "XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED",
      sentinelConfig.xprizeFreeJudgeAccessThroughJudgingConfirmed,
      "engineering",
      "Set true only after hosted access and private judge testing instructions are ready."
    )
  ];
}

function packetCheck(
  id: string,
  label: string,
  status: EligibilityDisclosureCheck["status"],
  evidence: string,
  fix: string,
  ownerRole: EligibilityDisclosureCheck["ownerRole"]
): EligibilityDisclosureCheck {
  return {
    id,
    label,
    status,
    evidence,
    fix,
    ownerRole,
    requiredBeforeAttestation: true
  };
}

function attestation(
  id: string,
  label: string,
  envFlag: string,
  currentValue: boolean,
  ownerRole: EligibilityReviewerAttestation["ownerRole"],
  instruction: string
): EligibilityReviewerAttestation {
  return {
    id,
    label,
    envFlag,
    currentValue,
    ownerRole,
    instruction
  };
}
