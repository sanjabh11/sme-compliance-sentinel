import { createHash } from "node:crypto";
import packageJson from "@/package.json";
import packageLock from "@/package-lock.json";
import { sentinelConfig } from "@/lib/config";
import type {
  ThirdPartyClearanceChecklistItem,
  ThirdPartyIntegrationReviewItem,
  ThirdPartyManifest,
  ThirdPartyManifestReviewPacket,
  ThirdPartyManifestStatus,
  ThirdPartyPackageReviewItem
} from "@/lib/types";

interface LockPackage {
  version?: string;
  resolved?: string;
  license?: unknown;
  dev?: boolean;
  optional?: boolean;
}

const permissiveLicensePatterns = [
  /\bMIT\b/u,
  /\bApache-2\.0\b/u,
  /\bBSD-2-Clause\b/u,
  /\bBSD-3-Clause\b/u,
  /\bISC\b/u,
  /\b0BSD\b/u,
  /\bCC0-1\.0\b/u
];

const restrictedLicensePatterns = [/\bAGPL\b/iu, /\bGPL\b/iu, /\bSSPL\b/iu, /\bUNLICENSED\b/iu];
const obligationLicensePatterns = [/\bLGPL\b/iu];

export function buildThirdPartyManifest(generatedAt = new Date().toISOString()): ThirdPartyManifest {
  const rootPackage = packageLock.packages[""] as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const directRuntime = new Set(Object.keys(rootPackage.dependencies ?? packageJson.dependencies ?? {}));
  const directDev = new Set(Object.keys(rootPackage.devDependencies ?? packageJson.devDependencies ?? {}));
  const packages = Object.entries(packageLock.packages)
    .filter(([path]) => path.startsWith("node_modules/"))
    .map(([path, rawPackage]) => toReviewItem(path, rawPackage as LockPackage, directRuntime, directDev))
    .sort((a, b) => Number(b.direct) - Number(a.direct) || a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const integrations = buildIntegrationReview();
  const unknownLicenseCount = packages.filter((item) => item.license === "UNKNOWN").length;
  const licenseNeedsReviewCount = packages.filter((item) => item.reviewStatus === "needs-review").length;
  const obligationReviewCount = packages.filter((item) => item.reviewStatus === "obligation-review").length;
  const restrictedLicenseReviewCount = packages.filter((item) => item.reviewStatus === "restricted-review").length;
  const integrationsNeedingReview = integrations.filter((item) => item.status !== "configured").length;
  const status: ThirdPartyManifestStatus =
    restrictedLicenseReviewCount > 0 || unknownLicenseCount > 0
      ? "blocked"
      : licenseNeedsReviewCount > 0 || obligationReviewCount > 0 || integrationsNeedingReview > 0
        ? "warning"
        : "passed";

  return {
    generatedAt,
    packageManager: "npm",
    lockfileVersion: packageLock.lockfileVersion,
    summary: {
      status,
      totalPackages: packages.length,
      productionPackages: packages.filter((item) => item.scope === "runtime").length,
      directRuntimeDependencies: directRuntime.size,
      directDevDependencies: directDev.size,
      unknownLicenseCount,
      licenseNeedsReviewCount,
      obligationReviewCount,
      restrictedLicenseReviewCount,
      integrationsNeedingReview
    },
    packages,
    integrations,
    reviewPacket: buildReviewPacket({
      packages,
      integrations,
      restrictedLicenseReviewCount,
      unknownLicenseCount,
      licenseNeedsReviewCount,
      obligationReviewCount,
      integrationsNeedingReview
    }),
    disclosureText: [
      "Built with Next.js, React, TypeScript, npm, Google GenAI SDK, and Google Cloud/Workspace APIs.",
      "The final Devpost description should disclose these frameworks, SDKs, APIs, and any starter boilerplate used.",
      "No customer private evidence, judge credentials, API keys, raw invoices, or Workspace content belongs in the repository.",
      "This manifest is generated from package.json and package-lock.json; final submission still needs human license and API-terms review."
    ],
    blockers: buildBlockers({ restrictedLicenseReviewCount, unknownLicenseCount }),
    nextActions: buildNextActions({
      restrictedLicenseReviewCount,
      unknownLicenseCount,
      licenseNeedsReviewCount,
      obligationReviewCount,
      integrationsNeedingReview
    }),
    disclaimer:
      "This manifest supports submission review. It is not legal advice and does not by itself prove authorization to use every third-party service."
  };
}

function buildReviewPacket(input: {
  packages: ThirdPartyPackageReviewItem[];
  integrations: ThirdPartyIntegrationReviewItem[];
  restrictedLicenseReviewCount: number;
  unknownLicenseCount: number;
  licenseNeedsReviewCount: number;
  obligationReviewCount: number;
  integrationsNeedingReview: number;
}): ThirdPartyManifestReviewPacket {
  const hasBlockingLicenseItems = input.restrictedLicenseReviewCount > 0 || input.unknownLicenseCount > 0;
  const hasLicenseReviewItems = input.licenseNeedsReviewCount > 0 || input.obligationReviewCount > 0;
  const packageDigestEvidence = `${input.packages.length} package(s) indexed from package-lock.json; package.json and package-lock.json hashes are recorded.`;

  return {
    sourceDigests: {
      packageJsonSha256: digestJson(packageJson),
      packageLockSha256: digestJson(packageLock)
    },
    approvalEnvFlags: ["XPRIZE_THIRD_PARTY_REVIEW_APPROVED", "XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED"],
    approvalBoundary:
      "These flags are human attestations only. They must stay false until the package/license inventory, Google API terms, OAuth consent screen, repository licensing, demo assets, screenshots, copy, and generated/pre-existing-work disclosures have been reviewed against the final submitted artifacts.",
    requiredPrivateArtifacts: [
      "Dependency license review notes for package.json and package-lock.json digests in this packet.",
      "LGPL/notice/distribution obligation notes for any obligation-review packages.",
      "Google API, Gemini API, Google Cloud, Workspace OAuth, and Sensitive Data Protection terms review notes.",
      "OAuth consent-screen screenshot or export showing requested and deferred scopes.",
      "Demo video and screenshot asset-clearance log covering trademarks, music, customer data, and third-party marks.",
      "Repository license/access decision and Devpost third-party/pre-existing-work disclosure text."
    ],
    ruleTraceability: buildRuleTraceability(input),
    clearanceChecklist: [
      checklistItem({
        id: "source-digest-inventory",
        label: "Package inventory is hash-bound",
        ruleArea: "third-party-use",
        status: "passed",
        evidence: packageDigestEvidence,
        requiredPrivateArtifact: "Attach this manifest JSON to the private judge packet after every dependency change.",
        ownerRole: "engineering",
        fix: "Regenerate /api/xprize/license-manifest after package.json or package-lock.json changes."
      }),
      checklistItem({
        id: "restricted-or-unknown-license-screen",
        label: "Restricted and unknown license screen",
        ruleArea: "third-party-use",
        status: hasBlockingLicenseItems ? "blocked" : "passed",
        evidence: `${input.restrictedLicenseReviewCount} restricted-review package(s); ${input.unknownLicenseCount} unknown-license package(s).`,
        requiredPrivateArtifact: "Legal/engineering notes resolving every restricted or unknown license item.",
        ownerRole: "legal",
        fix: hasBlockingLicenseItems
          ? "Replace, remove, or explicitly clear restricted/unknown-license packages before setting review approval flags."
          : "No blocking restricted or unknown package license item in the current lockfile."
      }),
      checklistItem({
        id: "notice-and-obligation-review",
        label: "Notice and distribution obligation review",
        ruleArea: "repository-licensing",
        status: hasLicenseReviewItems ? "needs-review" : "passed",
        evidence: `${input.obligationReviewCount} obligation-review package(s); ${input.licenseNeedsReviewCount} additional license-review package(s).`,
        requiredPrivateArtifact: "Notice/distribution checklist and copied license notices for final repository or deployment bundle.",
        ownerRole: "legal",
        fix: hasLicenseReviewItems
          ? "Record license basis, notices, and distribution obligations before final submission."
          : "Keep notice artifacts with the private review packet."
      }),
      checklistItem({
        id: "google-api-terms-review",
        label: "Google API and OAuth terms review",
        ruleArea: "third-party-use",
        status: input.integrationsNeedingReview > 0 || !sentinelConfig.thirdPartyReviewApproved ? "needs-review" : "passed",
        evidence: `${input.integrations.length} Google integration(s); ${input.integrationsNeedingReview} still planned or needing review.`,
        requiredPrivateArtifact: "Review notes for Gemini API, Google Cloud, Workspace OAuth, Sensitive Data Protection, Cloud IAM, and API-key restrictions.",
        ownerRole: "legal",
        fix: "Confirm terms, scopes, billing, IAM, OAuth consent-screen wording, and data boundaries before setting XPRIZE_THIRD_PARTY_REVIEW_APPROVED=true."
      }),
      checklistItem({
        id: "oauth-scope-consent-screen-review",
        label: "OAuth consent screen and scope boundary",
        ruleArea: "third-party-use",
        status: sentinelConfig.thirdPartyReviewApproved ? "passed" : "needs-review",
        evidence: "The app requests metadata-only Drive/Gmail pilot scopes and keeps restricted Drive mutation scope deferred in the Cloud Run contract.",
        requiredPrivateArtifact: "OAuth consent-screen screenshot/export plus signed pilot consent packet showing requested and deferred scopes.",
        ownerRole: "legal",
        fix: "Keep restricted mutation scope deferred until explicit customer consent and OAuth review justify requesting it."
      }),
      checklistItem({
        id: "demo-and-screenshot-asset-clearance",
        label: "Demo and screenshot asset clearance",
        ruleArea: "demo-assets",
        status:
          sentinelConfig.demoVideoAssetClearanceConfirmed && sentinelConfig.xprizeIpOwnershipReviewApproved
            ? "passed"
            : "needs-review",
        evidence: `Demo asset clearance flag is ${sentinelConfig.demoVideoAssetClearanceConfirmed ? "confirmed" : "not confirmed"}; IP ownership review flag is ${sentinelConfig.xprizeIpOwnershipReviewApproved ? "confirmed" : "not confirmed"}.`,
        requiredPrivateArtifact: "Final demo-video/screenshot review log with third-party marks, copyrighted media, and customer-identifying data removed or licensed.",
        ownerRole: "sales",
        fix: "Review final public video and screenshots before upload; do not rely on local UI screenshots as asset clearance."
      }),
      checklistItem({
        id: "original-work-and-boilerplate-disclosure",
        label: "Original work and boilerplate disclosure",
        ruleArea: "new-project-disclosure",
        status: sentinelConfig.projectCreatedAfterStartConfirmed ? "passed" : "needs-review",
        evidence: "Project provenance and source-release guards exist, but generated/local boilerplate and dependency use still require human disclosure review.",
        requiredPrivateArtifact: "Devpost disclosure text for frameworks, templates, generated code, and any pre-existing boilerplate.",
        ownerRole: "founder",
        fix: "Keep XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED=false until the final disclosure is reviewed."
      })
    ]
  };
}

function checklistItem(input: ThirdPartyClearanceChecklistItem): ThirdPartyClearanceChecklistItem {
  return input;
}

function buildRuleTraceability(input: {
  packages: ThirdPartyPackageReviewItem[];
  integrations: ThirdPartyIntegrationReviewItem[];
  restrictedLicenseReviewCount: number;
  unknownLicenseCount: number;
  obligationReviewCount: number;
  licenseNeedsReviewCount: number;
}): ThirdPartyManifestReviewPacket["ruleTraceability"] {
  return [
    {
      ruleArea: "third-party-use",
      source: "Build with Gemini XPRIZE rules, Third Party Integrations",
      requirement: "Third-party SDKs, APIs, and data require authorization under applicable terms and licensing requirements.",
      manifestEvidence: `${input.packages.length} npm package(s) plus ${input.integrations.length} Google API integration(s) are inventoried for review.`
    },
    {
      ruleArea: "ip-ownership",
      source: "Build with Gemini XPRIZE rules, Submission Ownership and Intellectual Property",
      requirement: "Submission materials must be original or owned/authorized and must not violate third-party IP or privacy rights.",
      manifestEvidence: `${input.restrictedLicenseReviewCount} restricted-review, ${input.unknownLicenseCount} unknown-license, ${input.obligationReviewCount} obligation-review, and ${input.licenseNeedsReviewCount} additional license-review package(s) are separated for human review.`
    },
    {
      ruleArea: "demo-assets",
      source: "Build with Gemini XPRIZE rules, Demonstration Video",
      requirement: "Demo video must use permitted assets and avoid unlicensed third-party trademarks, copyrighted music, or copyrighted material.",
      manifestEvidence: "The review packet requires a final demo-video and screenshot asset-clearance log before IP approval flags are set."
    },
    {
      ruleArea: "repository-licensing",
      source: "Build with Gemini XPRIZE rules, Repository Access",
      requirement: "A public repository needs relevant licensing; a private repository must be shared with the required judging/testing accounts.",
      manifestEvidence: "Repository URL and access-mode checks are handled separately, while this packet identifies package-license and notice obligations for the source release."
    }
  ];
}

function digestJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toReviewItem(
  path: string,
  pkg: LockPackage,
  directRuntime: Set<string>,
  directDev: Set<string>
): ThirdPartyPackageReviewItem {
  const name = parsePackageName(path);
  const license = normalizeLicense(pkg.license);
  const direct = directRuntime.has(name) || directDev.has(name);
  const scope: ThirdPartyPackageReviewItem["scope"] = pkg.optional ? "optional" : pkg.dev && !directRuntime.has(name) ? "development" : "runtime";
  const reviewStatus = reviewStatusForPackage({ license, scope });

  return {
    name,
    version: pkg.version ?? "unknown",
    license,
    scope,
    direct,
    source: pkg.resolved ?? "package-lock.json",
    reviewStatus,
    notes: notesForPackage({ direct, scope, reviewStatus })
  };
}

function buildIntegrationReview(): ThirdPartyIntegrationReviewItem[] {
  const gcpConfigured = Boolean(sentinelConfig.googleCloudProject) && sentinelConfig.storageMode === "gcp-rest";
  const oauthConfigured = Boolean(sentinelConfig.oauthClientId && sentinelConfig.oauthClientSecretConfigured && sentinelConfig.oauthRedirectUri);
  const geminiConfigured = process.env.GEMINI_API_KEY ? true : false;

  return [
    {
      name: "Gemini API",
      provider: "Google",
      purpose: "Semantic risk classification and evidence summaries for justified Tier 2 scans.",
      status: geminiConfigured ? "configured" : "planned",
      authorizationBasis: "Gemini API key and Google AI/Gemini API terms; deployed use must be proven with API metadata.",
      dataBoundary: "Only Tier 2 selected snippets under byte and budget guardrails should be routed to Gemini."
    },
    {
      name: "Google Cloud",
      provider: "Google",
      purpose: "Cloud Run app hosting, Firestore tenant state, BigQuery audit evidence, Secret Manager OAuth tokens, Pub/Sub events.",
      status: gcpConfigured ? "configured" : "planned",
      authorizationBasis: "Google Cloud project, billing, IAM, and service-account permissions.",
      dataBoundary: "Tenant-scoped records, append-only audit rows, and redacted private evidence metadata."
    },
    {
      name: "Google Workspace APIs",
      provider: "Google",
      purpose: "Drive/Gmail metadata, change notifications, reconciliation cursors, and human-approved remediation.",
      status: oauthConfigured ? "configured" : "planned",
      authorizationBasis: "OAuth consent for pilot users; restricted mutation scope remains deferred until needed.",
      dataBoundary: "Metadata-first scanning with explicit consent before live customer Workspace access."
    },
    {
      name: "Sensitive Data Protection",
      provider: "Google Cloud",
      purpose: "Optional deterministic PII/secrets detection before Gemini semantic audit.",
      status: sentinelConfig.sensitiveDataProtectionEnabled ? "configured" : "planned",
      authorizationBasis: "Google Cloud API enablement and service-account IAM.",
      dataBoundary: "PII/secrets findings are converted to staged recommendations and redacted evidence counters."
    }
  ];
}

function parsePackageName(path: string) {
  const withoutPrefix = path.split("node_modules/").pop() ?? path;
  const parts = withoutPrefix.split("/");

  if (parts[0]?.startsWith("@")) {
    return `${parts[0]}/${parts[1]}`;
  }

  return parts[0] ?? withoutPrefix;
}

function normalizeLicense(license: unknown): string {
  if (typeof license === "string" && license.trim()) {
    return license.trim();
  }

  if (Array.isArray(license)) {
    return license.map((item): string => normalizeLicense(item)).join(" OR ");
  }

  if (license && typeof license === "object" && "type" in license && typeof license.type === "string") {
    return license.type;
  }

  return "UNKNOWN";
}

function reviewStatusForPackage(input: {
  license: string;
  scope: ThirdPartyPackageReviewItem["scope"];
}): ThirdPartyPackageReviewItem["reviewStatus"] {
  const { license } = input;

  if (license === "UNKNOWN") {
    return "needs-review";
  }

  const hasPermissiveOption = permissiveLicensePatterns.some((pattern) => pattern.test(license));
  const hasRestrictedOption = restrictedLicensePatterns.some((pattern) => pattern.test(license));
  const hasObligationOption = obligationLicensePatterns.some((pattern) => pattern.test(license));

  if (hasRestrictedOption) {
    return "restricted-review";
  }

  if (hasObligationOption) {
    return "obligation-review";
  }

  if (hasPermissiveOption) {
    return "cleared-for-review";
  }

  return "needs-review";
}

function notesForPackage(input: {
  direct: boolean;
  scope: ThirdPartyPackageReviewItem["scope"];
  reviewStatus: ThirdPartyPackageReviewItem["reviewStatus"];
}) {
  if (input.reviewStatus === "restricted-review") {
    return "Potentially incompatible or unavailable license marker; replace, remove, or obtain explicit legal clearance before submission.";
  }

  if (input.reviewStatus === "obligation-review") {
    return input.scope === "optional"
      ? "Optional transitive package with LGPL-style obligations; review notices and distribution obligations before final submission."
      : "Dependency carries LGPL-style obligations; review notices, linking, and distribution duties before final submission.";
  }

  if (input.reviewStatus === "needs-review") {
    return "License expression is present but not in the local allowlist; human review should record the use basis.";
  }

  if (input.direct) {
    return input.scope === "runtime" ? "Direct runtime dependency to disclose in Devpost." : "Direct development dependency to disclose if relevant.";
  }

  return "Transitive dependency captured from package-lock.json.";
}

function buildBlockers(input: {
  restrictedLicenseReviewCount: number;
  unknownLicenseCount: number;
}) {
  return [
    ...(input.restrictedLicenseReviewCount > 0
      ? [`${input.restrictedLicenseReviewCount} package(s) have restricted-license review status.`]
      : []),
    ...(input.unknownLicenseCount > 0 ? [`${input.unknownLicenseCount} package(s) have unknown license metadata.`] : [])
  ];
}

function buildNextActions(input: {
  restrictedLicenseReviewCount: number;
  unknownLicenseCount: number;
  licenseNeedsReviewCount: number;
  obligationReviewCount: number;
  integrationsNeedingReview: number;
}) {
  return [
    ...(input.restrictedLicenseReviewCount > 0 ? ["Replace or clear restricted-license packages before final submission."] : []),
    ...(input.unknownLicenseCount > 0 ? ["Manually inspect unknown-license packages and record the license basis."] : []),
    ...(input.licenseNeedsReviewCount > 0 ? ["Record the license basis for packages that are outside the local allowlist."] : []),
    ...(input.obligationReviewCount > 0
      ? ["Review LGPL-style package obligations, notices, and distribution handling before final submission."]
      : []),
    ...(input.integrationsNeedingReview > 0 ? ["Confirm Google API terms, OAuth consent, and Cloud IAM before production launch."] : []),
    "Paste the disclosure text into the final Devpost description and keep secrets/private customer evidence out of the repository.",
    "Set XPRIZE_THIRD_PARTY_REVIEW_APPROVED=true only after a human owner approves this manifest."
  ];
}
