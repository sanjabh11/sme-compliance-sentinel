#!/usr/bin/env node
/* global console, process */

import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));

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
const prohibitedCliPatterns = [
  /(^|-)token($|=)/iu,
  /(^|-)password($|=)/iu,
  /(^|-)secret($|=)/iu,
  /api[_-]?key=/iu,
  /authorization=/iu
];

function parseArgs(argv) {
  const args = {
    strict: false,
    outPath: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (prohibitedCliPatterns.some((pattern) => pattern.test(arg))) {
      throw new Error("Raw secret CLI args are not supported. This verifier only accepts non-secret output paths.");
    }

    if (arg === "--strict") {
      args.strict = true;
      continue;
    }

    if (arg === "--out") {
      args.outPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--out=")) {
      args.outPath = arg.slice("--out=".length);
    }
  }

  return args;
}

function buildReport() {
  const rootPackage = packageLock.packages?.[""] ?? {};
  const directRuntime = new Set(Object.keys(rootPackage.dependencies ?? packageJson.dependencies ?? {}));
  const directDev = new Set(Object.keys(rootPackage.devDependencies ?? packageJson.devDependencies ?? {}));
  const packages = Object.entries(packageLock.packages ?? {})
    .filter(([path]) => path.startsWith("node_modules/"))
    .map(([path, rawPackage]) => toReviewItem(path, rawPackage, directRuntime, directDev))
    .sort((a, b) => Number(b.direct) - Number(a.direct) || a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const integrations = buildIntegrationReview();
  const summary = summarize(packages, integrations, directRuntime, directDev);
  const envFlags = {
    thirdPartyReviewApproved: process.env.XPRIZE_THIRD_PARTY_REVIEW_APPROVED === "true",
    ipOwnershipReviewApproved: process.env.XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED === "true",
    demoAssetClearanceConfirmed: process.env.XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED === "true",
    projectCreatedAfterStartConfirmed: process.env.XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED === "true"
  };
  const checks = buildChecks({ packages, integrations, summary, envFlags });
  const blockers = checks.filter((item) => item.status === "blocked");
  const warnings = checks.filter((item) => item.status === "warning");
  const overallStatus = blockers.length ? "blocked" : warnings.length ? "warning" : "passed";

  return {
    generatedAt: new Date().toISOString(),
    overallStatus,
    packageManager: "npm",
    lockfileVersion: packageLock.lockfileVersion,
    sourceDigests: {
      packageJsonSha256: sha256(JSON.stringify(packageJson)),
      packageLockSha256: sha256(JSON.stringify(packageLock))
    },
    summary: {
      status: overallStatus,
      ...summary
    },
    envFlags,
    checks,
    blockers: blockers.map((item) => `${item.id}: ${item.fix}`),
    packages,
    integrations,
    disclosureText: [
      "Built with Next.js, React, TypeScript, npm, Google Generative AI SDK, and Google Cloud/Workspace APIs.",
      "Disclose frameworks, SDKs, APIs, generated boilerplate, and any starter material in the final Devpost submission.",
      "Keep customer private evidence, judge credentials, API keys, raw invoices, and Workspace content out of the repository."
    ],
    nextActions: buildNextActions({ summary, envFlags, checks }),
    privateHandling: [
      "Attach this JSON to the private judge packet after every dependency change.",
      "Keep detailed legal notes, OAuth consent screenshots, API terms review, and final demo/screenshot clearance records outside public source.",
      "Set XPRIZE_THIRD_PARTY_REVIEW_APPROVED and XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED only after human review."
    ],
    sourceUrls: ["https://xprize.devpost.com/rules", "https://www.geminixprize.com/rules"],
    disclaimer:
      "This verifier supports third-party and IP review. It is not legal advice and does not prove authorization until a human owner reviews the private evidence."
  };
}

function buildChecks({ summary, envFlags }) {
  const hasBlockingLicenses = summary.restrictedLicenseReviewCount > 0 || summary.unknownLicenseCount > 0;
  const hasLicenseReviewItems = summary.licenseNeedsReviewCount > 0 || summary.obligationReviewCount > 0;

  return [
    check(
      "source-digest-inventory",
      "passed",
      `${summary.totalPackages} package(s) indexed from package-lock.json; package.json and package-lock.json digests are recorded.`,
      "Regenerate this verifier after package.json or package-lock.json changes."
    ),
    check(
      "restricted-or-unknown-license-screen",
      hasBlockingLicenses ? "blocked" : "passed",
      `${summary.restrictedLicenseReviewCount} restricted-review package(s); ${summary.unknownLicenseCount} unknown-license package(s).`,
      hasBlockingLicenses
        ? "Replace, remove, or explicitly clear restricted/unknown-license packages before final submission."
        : "No blocking restricted or unknown package license item in the current lockfile."
    ),
    check(
      "notice-and-obligation-review",
      hasLicenseReviewItems ? "warning" : "passed",
      `${summary.obligationReviewCount} obligation-review package(s); ${summary.licenseNeedsReviewCount} additional license-review package(s).`,
      hasLicenseReviewItems
        ? "Record license basis, notices, and distribution obligations before final submission."
        : "Keep notice artifacts with the private review packet."
    ),
    check(
      "google-api-terms-review",
      envFlags.thirdPartyReviewApproved && summary.integrationsNeedingReview === 0 ? "passed" : "warning",
      `${summary.integrationCount} Google integration(s); ${summary.integrationsNeedingReview} planned or needing review; third-party approval flag ${envFlags.thirdPartyReviewApproved ? "true" : "false"}.`,
      "Confirm Google API terms, OAuth consent, billing, IAM, scopes, and data boundaries before setting XPRIZE_THIRD_PARTY_REVIEW_APPROVED=true."
    ),
    check(
      "approval-flag-boundary",
      envFlags.thirdPartyReviewApproved && hasBlockingLicenses ? "blocked" : "passed",
      `Third-party approval flag ${envFlags.thirdPartyReviewApproved ? "true" : "false"}; blocking license items ${hasBlockingLicenses ? "present" : "absent"}.`,
      "Do not keep XPRIZE_THIRD_PARTY_REVIEW_APPROVED=true while restricted or unknown license blockers remain."
    ),
    check(
      "demo-and-screenshot-asset-clearance",
      envFlags.ipOwnershipReviewApproved && envFlags.demoAssetClearanceConfirmed ? "passed" : "warning",
      `IP ownership review flag ${envFlags.ipOwnershipReviewApproved ? "true" : "false"}; demo asset clearance flag ${envFlags.demoAssetClearanceConfirmed ? "true" : "false"}.`,
      "Review final public demo, screenshots, icons, marks, music, copied text, and customer-data redaction before setting IP/demo clearance flags."
    ),
    check(
      "original-work-and-boilerplate-disclosure",
      envFlags.projectCreatedAfterStartConfirmed ? "passed" : "warning",
      `Project-created-after-start attestation ${envFlags.projectCreatedAfterStartConfirmed ? "true" : "false"}.`,
      "Human-review repository provenance, generated boilerplate, dependencies, and pre-existing material disclosure before setting the attestation."
    )
  ];
}

function buildNextActions({ summary, envFlags, checks }) {
  return [
    ...(summary.restrictedLicenseReviewCount > 0 ? ["Replace or clear restricted-license packages before final submission."] : []),
    ...(summary.unknownLicenseCount > 0 ? ["Manually inspect unknown-license packages and record the license basis."] : []),
    ...(summary.licenseNeedsReviewCount > 0 ? ["Record the license basis for packages outside the local allowlist."] : []),
    ...(summary.obligationReviewCount > 0 ? ["Review LGPL-style package obligations, notices, and distribution handling."] : []),
    ...(summary.integrationsNeedingReview > 0 ? ["Confirm Google API terms, OAuth consent, billing, IAM, scopes, and data boundaries."] : []),
    ...(envFlags.ipOwnershipReviewApproved && envFlags.demoAssetClearanceConfirmed
      ? []
      : ["Review final public demo and screenshots for third-party marks, copyrighted media, and customer-identifying data."]),
    ...(checks.some((item) => item.status === "blocked")
      ? []
      : ["Set approval flags only after a human owner approves this report and the private artifacts."])
  ];
}

function summarize(packages, integrations, directRuntime, directDev) {
  return {
    totalPackages: packages.length,
    productionPackages: packages.filter((item) => item.scope === "runtime").length,
    directRuntimeDependencies: directRuntime.size,
    directDevDependencies: directDev.size,
    unknownLicenseCount: packages.filter((item) => item.license === "UNKNOWN").length,
    licenseNeedsReviewCount: packages.filter((item) => item.reviewStatus === "needs-review").length,
    obligationReviewCount: packages.filter((item) => item.reviewStatus === "obligation-review").length,
    restrictedLicenseReviewCount: packages.filter((item) => item.reviewStatus === "restricted-review").length,
    integrationCount: integrations.length,
    integrationsNeedingReview: integrations.filter((item) => item.status !== "configured").length
  };
}

function buildIntegrationReview() {
  const gcpConfigured = Boolean(cleanEnv("GOOGLE_CLOUD_PROJECT")) && cleanEnv("SENTINEL_STORAGE_MODE") === "gcp-rest";
  const oauthConfigured = Boolean(cleanEnv("GOOGLE_OAUTH_CLIENT_ID") && process.env.GOOGLE_OAUTH_CLIENT_SECRET && cleanEnv("GOOGLE_OAUTH_REDIRECT_URI"));
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY);

  return [
    integration("Gemini API", "Semantic risk classification and evidence summaries for justified Tier 2 scans.", geminiConfigured),
    integration("Google Cloud", "Cloud Run app hosting, Firestore tenant state, BigQuery audit evidence, Secret Manager, and Pub/Sub events.", gcpConfigured),
    integration("Google Workspace APIs", "Drive/Gmail metadata, change notifications, reconciliation cursors, and human-approved remediation.", oauthConfigured),
    integration("Sensitive Data Protection", "Optional deterministic PII/secrets detection before Gemini semantic audit.", cleanEnv("SENSITIVE_DATA_PROTECTION_ENABLED") === "true")
  ];
}

function integration(name, purpose, configured) {
  return {
    name,
    provider: name === "Sensitive Data Protection" ? "Google Cloud" : "Google",
    purpose,
    status: configured ? "configured" : "planned",
    authorizationBasis: "Review Google service terms, billing/IAM, OAuth consent where applicable, and private evidence before final submission.",
    dataBoundary: "Use tenant-scoped records, redacted evidence, and least-privilege access; do not expose raw secrets or customer-private content publicly."
  };
}

function toReviewItem(path, pkg, directRuntime, directDev) {
  const name = parsePackageName(path);
  const license = normalizeLicense(pkg.license);
  const direct = directRuntime.has(name) || directDev.has(name);
  const scope = pkg.optional ? "optional" : pkg.dev && !directRuntime.has(name) ? "development" : "runtime";
  const reviewStatus = reviewStatusForPackage(license);

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

function reviewStatusForPackage(license) {
  if (license === "UNKNOWN") {
    return "needs-review";
  }

  if (restrictedLicensePatterns.some((pattern) => pattern.test(license))) {
    return "restricted-review";
  }

  if (obligationLicensePatterns.some((pattern) => pattern.test(license))) {
    return "obligation-review";
  }

  if (permissiveLicensePatterns.some((pattern) => pattern.test(license))) {
    return "cleared-for-review";
  }

  return "needs-review";
}

function notesForPackage(input) {
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

function parsePackageName(path) {
  const withoutPrefix = path.split("node_modules/").pop() ?? path;
  const parts = withoutPrefix.split("/");

  return parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0] ?? withoutPrefix;
}

function normalizeLicense(license) {
  if (typeof license === "string" && license.trim()) {
    return license.trim();
  }

  if (Array.isArray(license)) {
    return license.map((item) => normalizeLicense(item)).join(" OR ");
  }

  if (license && typeof license === "object" && typeof license.type === "string") {
    return license.type;
  }

  return "UNKNOWN";
}

function check(id, status, evidence, fix) {
  return { id, status, evidence, fix };
}

function cleanEnv(name) {
  const value = process.env[name]?.trim();
  return value && !/^(PROJECT_ID|PROJECT_NUMBER|YOUR|RELEASE_ID|SOURCE_)/u.test(value) ? value : "";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function writeJson(path, value) {
  const absolutePath = resolve(path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

try {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport();

  if (args.outPath) {
    writeJson(args.outPath, report);
  }

  console.log(JSON.stringify(report, null, 2));

  if (args.strict && report.overallStatus !== "passed") {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
