import packageJson from "@/package.json";
import { sentinelConfig } from "@/lib/config";
import type {
  ProjectProvenanceCheck,
  ProjectProvenanceDisclosureItem,
  ProjectProvenanceGitSignals,
  ProjectProvenanceReport,
  SubmissionComplianceStatus
} from "@/lib/types";

export const xprizeHackathonStartAt = "2026-05-19T00:00:00.000Z";

const unavailableGitSignals: ProjectProvenanceGitSignals = {
  gitAvailable: false,
  commitCount: 0,
  trackedFileCount: 0,
  untrackedPaths: [],
  error: "Git history is not available in this runtime."
};

export function buildProjectProvenanceReport(
  git: ProjectProvenanceGitSignals = unavailableGitSignals,
  options: {
    projectCreatedAfterStartConfirmed?: boolean;
    repositoryUrl?: string;
  } = {}
): ProjectProvenanceReport {
  const projectCreatedAfterStartConfirmed =
    options.projectCreatedAfterStartConfirmed ?? sentinelConfig.projectCreatedAfterStartConfirmed;
  const repositoryUrl = options.repositoryUrl ?? sentinelConfig.repositoryUrl;
  const disclosureItems = buildDisclosureItems();
  const checks = buildChecks(git, { projectCreatedAfterStartConfirmed, repositoryUrl });
  const summary = summarize(checks);
  const overallStatus: SubmissionComplianceStatus = summary.blocked > 0 ? "blocked" : summary.warning > 0 ? "warning" : "passed";

  return {
    generatedAt: new Date().toISOString(),
    overallStatus,
    hackathonStartAt: xprizeHackathonStartAt,
    projectCreatedAfterStartConfirmed,
    repositoryUrl,
    git,
    checks,
    disclosureItems,
    draftDevpostDisclosure: buildDraftDevpostDisclosure(disclosureItems),
    blockers: checks.filter((check) => check.status === "blocked").map((check) => `${check.label}: ${check.fix}`),
    nextActions: buildNextActions(checks),
    privateHandling: [
      "Do not set XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED=true until repository history and pre-existing-work disclosure have been reviewed by a human owner.",
      "Keep private customer evidence, judge credentials, OAuth tokens, invoices, and security findings outside the source repository.",
      "Public Devpost wording should disclose frameworks and dependencies without exposing secret values or customer-identifying proof.",
      "If using a private repository, share it with the required judge/testing accounts before submission."
    ],
    disclaimer:
      "This provenance report is an engineering control surface, not a legal determination. It highlights evidence and disclosure gaps that must be reviewed before final submission."
  };
}

function buildChecks(
  git: ProjectProvenanceGitSignals,
  options: { projectCreatedAfterStartConfirmed: boolean; repositoryUrl: string }
): ProjectProvenanceCheck[] {
  const firstCommitMs = git.firstCommitAt ? Date.parse(git.firstCommitAt) : Number.NaN;
  const startMs = Date.parse(xprizeHackathonStartAt);
  const firstCommitAfterStart = Number.isFinite(firstCommitMs) && firstCommitMs >= startMs;
  const hasUntracked = git.untrackedPaths.length > 0;

  return [
    check(
      "git-history-present",
      "Git history exists",
      git.gitAvailable && git.commitCount > 0 ? "passed" : "blocked",
      git.gitAvailable
        ? `${git.commitCount} commit(s) found; ${git.error ?? "no git error"}`
        : git.error ?? "Git is unavailable.",
      "Create the first commit and push the repository before relying on creation-date proof for the May 19, 2026 hackathon start reference.",
      "engineering"
    ),
    check(
      "first-commit-after-start",
      "First commit is after hackathon start",
      firstCommitAfterStart ? "passed" : "blocked",
      git.firstCommitAt
        ? `First commit timestamp ${git.firstCommitAt}; hackathon start reference ${xprizeHackathonStartAt}.`
        : "No first commit timestamp is available.",
      "Verify the first commit is after the official hackathon start date and disclose any pre-existing work.",
      "founder"
    ),
    check(
      "source-tracked",
      "Source files are tracked for repository submission",
      git.trackedFileCount > 0 && !hasUntracked ? "passed" : "blocked",
      `${git.trackedFileCount} tracked file(s); ${git.untrackedPaths.length} untracked path(s).`,
      "Add all intended source files to Git, keep secrets/private evidence excluded, and confirm the repository contains the necessary source code.",
      "engineering"
    ),
    check(
      "repository-url",
      "Repository URL configured",
      options.repositoryUrl ? "passed" : "blocked",
      options.repositoryUrl || "XPRIZE_REPOSITORY_URL is not configured.",
      "Publish or privately share the repository and set XPRIZE_REPOSITORY_URL.",
      "engineering"
    ),
    check(
      "human-attestation",
      "Project-created-after-start human attestation",
      options.projectCreatedAfterStartConfirmed ? "passed" : "blocked",
      options.projectCreatedAfterStartConfirmed
        ? "XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED is true."
        : "XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED is false.",
      "Set XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED=true only after human review of git history and disclosure text.",
      "founder"
    ),
    check(
      "pre-existing-work-disclosure",
      "Pre-existing frameworks and dependencies disclosed",
      "warning",
      "Draft disclosure covers frameworks, runtime dependencies, development tools, Google APIs, and private-evidence exclusions.",
      "Human-review and paste the final disclosure into Devpost before submission.",
      "legal"
    )
  ];
}

function check(
  id: string,
  label: string,
  status: SubmissionComplianceStatus,
  evidence: string,
  fix: string,
  ownerRole: ProjectProvenanceCheck["ownerRole"]
): ProjectProvenanceCheck {
  return {
    id,
    label,
    status,
    evidence,
    fix,
    ownerRole,
    requiredBeforeSubmit: true
  };
}

function buildDisclosureItems(): ProjectProvenanceDisclosureItem[] {
  const dependencies = Object.keys(packageJson.dependencies ?? {}).sort();
  const devDependencies = Object.keys(packageJson.devDependencies ?? {}).sort();

  return [
    disclosure(
      "frameworks",
      "Application framework",
      "The product is implemented as a Next.js, React, and TypeScript web app."
    ),
    disclosure(
      "runtime-dependencies",
      "Runtime dependencies",
      `Runtime dependencies: ${dependencies.join(", ")}.`
    ),
    disclosure(
      "development-tooling",
      "Development and verification tooling",
      `Development package dependencies: ${devDependencies.join(", ")}.`
    ),
    disclosure(
      "google-apis",
      "Google API and cloud services",
      "The production architecture uses Gemini API, Google Cloud Run, Firestore, BigQuery, Secret Manager, Pub/Sub, Sensitive Data Protection, Google Drive API, and Gmail API."
    ),
    disclosure(
      "private-evidence-excluded",
      "Private evidence excluded from repository",
      "The source repository must not contain customer files, raw findings, OAuth tokens, API keys, judge credentials, invoices, payment exports, or private customer contact proof."
    )
  ];
}

function disclosure(id: string, label: string, disclosureText: string): ProjectProvenanceDisclosureItem {
  return {
    id,
    label,
    disclosure: disclosureText,
    publicSafe: true,
    needsHumanReview: true
  };
}

function buildDraftDevpostDisclosure(items: ProjectProvenanceDisclosureItem[]) {
  return [
    "Before final submission, verify the repository history and state the project was created after the official hackathon start date only if the first commit and supporting records prove it.",
    ...items.map((item) => item.disclosure),
    "Any seeded demo data is synthetic and used only to demonstrate product behavior before private pilot evidence is collected."
  ];
}

function summarize(checks: ProjectProvenanceCheck[]) {
  return checks.reduce<Record<SubmissionComplianceStatus, number>>(
    (summary, check) => {
      summary[check.status] += 1;
      return summary;
    },
    { passed: 0, warning: 0, blocked: 0 }
  );
}

function buildNextActions(checks: ProjectProvenanceCheck[]) {
  return checks
    .filter((check) => check.status !== "passed")
    .map((check) => check.fix)
    .slice(0, 6);
}
