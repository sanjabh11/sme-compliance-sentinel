import packageJson from "@/package.json";
import packageLock from "@/package-lock.json";
import { sentinelConfig } from "@/lib/config";
import type {
  ThirdPartyIntegrationReviewItem,
  ThirdPartyManifest,
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
    disclosureText: [
      "Built with Next.js, React, TypeScript, npm, Google Generative AI SDK, and Google Cloud/Workspace APIs.",
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
