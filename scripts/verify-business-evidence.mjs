#!/usr/bin/env node
/* global console, process */

import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const officialRuleSources = ["https://xprize.devpost.com/rules", "https://www.geminixprize.com/rules"];
const months = ["May", "June", "July", "August"];
const coreBusinessArtifactBuckets = [
  "invoices",
  "paymentRecords",
  "activeUserLogs",
  "costRecords",
  "cacReceipts",
  "relatedPartyReview"
];
const conditionalBusinessArtifactBuckets = ["testimonialConsents"];
const privateArtifactBuckets = [...coreBusinessArtifactBuckets, ...conditionalBusinessArtifactBuckets];
const prohibitedCliPatterns = [
  /(^|-)token($|=)/iu,
  /(^|-)password($|=)/iu,
  /(^|-)secret($|=)/iu,
  /api[_-]?key=/iu,
  /authorization=/iu
];
const secretTextPatterns = [
  /\bpassword\s*[:=]/iu,
  /\btoken\s*[:=]/iu,
  /\bapi[_-]?key\s*[:=]/iu,
  /\bauthorization\s*[:=]/iu,
  /\bbearer\s+[a-z0-9._~+/=-]{12,}/iu
];
const evidenceFlags = [
  "XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED",
  "XPRIZE_REVENUE_BY_MONTH_EVIDENCE_CONFIGURED",
  "XPRIZE_TOTAL_COSTS_EVIDENCE_CONFIGURED",
  "XPRIZE_CAC_SPEND_EVIDENCE_CONFIGURED",
  "XPRIZE_REAL_USER_EVIDENCE_CONFIGURED",
  "XPRIZE_TESTIMONIAL_CONSENT_CONFIRMED",
  "XPRIZE_RELATED_PARTY_REVENUE_REVIEWED",
  "XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED"
];

function parseArgs(argv) {
  const args = {
    strict: false,
    outPath: "",
    evidencePath: "",
    writeTemplatePath: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (prohibitedCliPatterns.some((pattern) => pattern.test(arg))) {
      throw new Error("Raw secret CLI args are not supported. Use private evidence files, not credential arguments.");
    }

    if (arg === "--strict") {
      args.strict = true;
      continue;
    }

    if (arg === "--out" || arg === "--evidence" || arg === "--write-template") {
      const value = argv[index + 1] ?? "";
      if (!value) {
        throw new Error(`${arg} requires a non-secret path.`);
      }
      if (arg === "--out") {
        args.outPath = value;
      } else if (arg === "--evidence") {
        args.evidencePath = value;
      } else {
        args.writeTemplatePath = value;
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--out=")) {
      args.outPath = arg.slice("--out=".length);
      continue;
    }

    if (arg.startsWith("--evidence=")) {
      args.evidencePath = arg.slice("--evidence=".length);
      continue;
    }

    if (arg.startsWith("--write-template=")) {
      args.writeTemplatePath = arg.slice("--write-template=".length);
      continue;
    }

    throw new Error(`Unsupported argument: ${arg}`);
  }

  return args;
}

function buildReport(evidencePath) {
  const evidence = evidencePath ? readEvidence(evidencePath) : undefined;
  const checks = buildChecks(evidence, evidencePath);
  const blockers = checks
    .filter((check) => check.requiredBeforeSubmit && (check.status === "missing" || check.status === "blocked"))
    .map((check) => `${check.label}: ${check.fix}`);
  const reviewItems = checks.filter((check) => check.status === "needs-review");
  const overallStatus = blockers.length > 0 ? "blocked" : reviewItems.length > 0 ? "needs-review" : "ready";

  return {
    generatedAt: new Date().toISOString(),
    overallStatus,
    evidencePath: evidencePath || "missing",
    period: {
      months,
      ruleWindow: "May 19, 2026 through August 17, 2026"
    },
    summary: summarizeEvidence(evidence),
    checks,
    blockers,
    nextActions: buildNextActions(checks, blockers),
    requiredPrivateArtifacts: evidence ? requiredArtifactBucketsForEvidence(evidence) : coreBusinessArtifactBuckets,
    conditionalPrivateArtifacts: conditionalBusinessArtifactBuckets.map((bucket) => ({
      bucket,
      requiredWhen: bucket === "testimonialConsents" ? "Testimonials or customer quotes are included in the judge packet." : "Condition applies."
    })),
    privateArtifactInventory: privateArtifactBuckets,
    stopConditions: [
      "This verifier does not create customers, revenue, invoices, payments, users, testimonials, or cost proof.",
      "Do not set revenue, cost, CAC, real-user, testimonial, related-party, or business-model flags until private evidence exists.",
      "Do not commit invoices, payment exports, customer contact data, raw testimonials, or private financial artifacts."
    ],
    sourceUrls: officialRuleSources,
    disclaimer:
      "This packet verifies private business-evidence readiness signals. It is not financial advice, accounting assurance, organizer approval, or a guarantee of judging outcome."
  };
}

function buildChecks(evidence, evidencePath) {
  if (!evidence) {
    return [
      check({
        id: "business-evidence-file",
        label: "Private business evidence file",
        status: "missing",
        evidence: "No --evidence path was provided.",
        fix: "Run npm run verify:business-evidence -- --write-template /secure/local/business-evidence-template.json, fill it from private records, then rerun with --evidence.",
        ownerRole: "founder",
        requiredBeforeSubmit: true,
        privateHandling: "Keep the filled evidence file outside Git."
      }),
      ...flagConsistencyChecks(undefined)
    ];
  }

  const analysis = analyzeBusinessEvidence(evidence);

  return [
    check({
      id: "business-evidence-file",
      label: "Private business evidence file",
      status: analysis.secretFinding ? "blocked" : "ready",
      evidence: analysis.secretFinding ? "Secret-shaped text was detected in the private evidence JSON." : `Loaded ${evidencePath}.`,
      fix: analysis.secretFinding
        ? "Remove raw credentials, tokens, and unredacted secrets from the evidence JSON before using it as a judge packet source."
        : "No action.",
      ownerRole: "founder",
      requiredBeforeSubmit: true,
      privateHandling: "Keep the filled evidence file outside Git."
    }),
    check({
      id: "arms-length-revenue",
      label: "Arms-length revenue and payment proof",
      status: analysis.readiness.armsLengthRevenue ? "ready" : "missing",
      evidence: `Revenue $${numberOrZero(analysis.totalRevenueUsd)}; arms-length customers ${numberOrZero(evidence.armsLengthCustomerCount)}; paid pilots ${numberOrZero(evidence.paidPilotCount)}; invoice proof ${analysis.invoiceProof.readyCount}; payment proof ${analysis.paymentProof.readyCount}.`,
      fix: "Attach arms-length invoice and payment proof before counting revenue.",
      ownerRole: "founder",
      requiredBeforeSubmit: true,
      privateHandling: "Keep invoice ids, payment exports, and customer names private or redacted."
    }),
    check({
      id: "monthly-revenue-breakdown",
      label: "May-August revenue by month",
      status: analysis.readiness.monthlyRevenue ? "ready" : "missing",
      evidence: `Monthly values valid ${analysis.monthValuesValid ? "yes" : "no"}; monthly sum $${analysis.totalRevenueFromMonths}; total revenue $${numberOrZero(analysis.totalRevenueUsd)}.`,
      fix: "Fill May, June, July, and August 2026 revenue values and make the month sum match total revenue.",
      ownerRole: "founder",
      requiredBeforeSubmit: true,
      privateHandling: "Publish only aggregate month totals unless customers consent to attribution."
    }),
    check({
      id: "costs-and-cac",
      label: "Costs and customer acquisition spend",
      status: analysis.readiness.totalCosts && analysis.readiness.cacSpend ? "ready" : "missing",
      evidence: `Costs $${numberOrZero(evidence.totalCostsUsd)}; CAC $${numberOrZero(evidence.customerAcquisitionSpendUsd)}; cost proof ${analysis.costProof.readyCount}; CAC proof ${analysis.cacProof.readyCount}.`,
      fix: "Attach hosting/AI/API/contractor cost proof and CAC proof or zero-spend attestation.",
      ownerRole: "founder",
      requiredBeforeSubmit: true,
      privateHandling: "Keep receipts and billing exports private; publish only aggregate costs."
    }),
    check({
      id: "real-user-evidence",
      label: "Real user evidence and breakdown",
      status: analysis.readiness.realUsers ? "ready" : "missing",
      evidence: `Active users ${numberOrZero(evidence.activeUsers)}; user segments ${Array.isArray(evidence.userBreakdown) ? evidence.userBreakdown.length : 0}; user-log proof ${analysis.activeUserProof.readyCount}.`,
      fix: "Attach production analytics, Workspace install logs, or other active-user proof with a high-level user breakdown.",
      ownerRole: "sales",
      requiredBeforeSubmit: true,
      privateHandling: "Share high-level user categories publicly; keep contact details private."
    }),
    check({
      id: "testimonial-consent",
      label: "Testimonials and feedback consent",
      status:
        analysis.testimonials.length > 0 && analysis.readiness.testimonialClaim
          ? "ready"
          : analysis.testimonials.length === 0
            ? "needs-review"
            : "blocked",
      evidence: `Testimonials ${analysis.testimonials.length}; consent clean ${analysis.testimonialConsentOk ? "yes" : "no"}; consent proof ${analysis.testimonialProof.readyCount}.`,
      fix:
        analysis.testimonials.length === 0
          ? "If customer feedback exists, add only consented and redacted testimonials; otherwise record why no testimonials are included."
          : "Remove unconsented quotes or attach explicit consent proof before sharing testimonials.",
      ownerRole: "sales",
      requiredBeforeSubmit: analysis.testimonials.length > 0,
      privateHandling: "Never expose customer names, quotes, or contact details without explicit consent."
    }),
    check({
      id: "related-party-revenue",
      label: "Related-party revenue separation",
      status: analysis.readiness.relatedParty ? "ready" : "missing",
      evidence: `Related-party revenue $${numberOrZero(evidence.relatedPartyRevenueUsd)}; review proof ${analysis.relatedPartyProof.readyCount}.`,
      fix: "Record related-party revenue separately, even if zero, and attach relationship review proof.",
      ownerRole: "founder",
      requiredBeforeSubmit: true,
      privateHandling: "Keep relationship details private; disclose only the required aggregate and relationship category."
    }),
    ...flagConsistencyChecks(evidence)
  ];
}

function flagConsistencyChecks(evidence) {
  const analysis = analyzeBusinessEvidence(evidence);
  const evidenceReady = analysis.readiness.minimumBusinessEvidence;
  const dependencyGaps = evidenceFlagDependencyGaps(analysis);

  return [
    check({
      id: "business-evidence-flag-boundary",
      label: "Business evidence flag boundary",
      status: evidenceFlags.some((name) => process.env[name] === "true") && !evidenceReady ? "blocked" : "ready",
      evidence: evidenceFlags
        .map((name) => `${name}=${process.env[name] === "true" ? "true" : "false"}`)
        .join("; "),
      fix: "Keep business evidence flags false until the private evidence file proves revenue, monthly revenue, costs, CAC, users, related-party review, and consent boundaries.",
      ownerRole: "founder",
      requiredBeforeSubmit: true,
      privateHandling: "Flags are deployment claims; the private evidence file and artifacts are the proof."
    }),
    check({
      id: "business-evidence-flag-dependencies",
      label: "Business evidence flag dependency review",
      status: dependencyGaps.length > 0 ? "blocked" : "ready",
      evidence:
        dependencyGaps.length > 0
          ? `Claimed flags with missing dependencies: ${dependencyGaps.map((gap) => gap.name).join(", ")}.`
          : "No claimed business-evidence flag is missing its specific private proof dependency.",
      fix:
        dependencyGaps.length > 0
          ? unique(dependencyGaps.map((gap) => gap.fix)).join(" ")
          : "No action.",
      ownerRole: "founder",
      requiredBeforeSubmit: dependencyGaps.length > 0,
      privateHandling: "Review each flag independently; do not let a broad business-model claim substitute for consent, cost, user, or revenue proof."
    })
  ];
}

function analyzeBusinessEvidence(evidence) {
  const revenueByMonth = evidence?.revenueByMonth ?? {};
  const monthValues = months.map((month) => Number(revenueByMonth[month]));
  const totalRevenueUsd = Number(evidence?.totalRevenueUsd);
  const monthValuesValid = monthValues.every((value) => Number.isFinite(value) && value >= 0);
  const totalRevenueFromMonths = monthValues.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
  const invoiceProof = verifiedArtifacts(evidence, "invoices");
  const paymentProof = verifiedArtifacts(evidence, "paymentRecords");
  const activeUserProof = verifiedArtifacts(evidence, "activeUserLogs");
  const costProof = verifiedArtifacts(evidence, "costRecords");
  const cacProof = verifiedArtifacts(evidence, "cacReceipts");
  const relatedPartyProof = verifiedArtifacts(evidence, "relatedPartyReview");
  const testimonialProof = verifiedArtifacts(evidence, "testimonialConsents");
  const testimonials = Array.isArray(evidence?.testimonials) ? evidence.testimonials : [];
  const testimonialConsentOk = testimonials.length === 0 || testimonials.every((item) => item?.consentConfirmed === true);
  const requiredBuckets = requiredArtifactBucketsForEvidence(evidence);
  const secretFinding = evidence ? secretTextPatterns.some((pattern) => pattern.test(JSON.stringify(evidence))) : false;
  const armsLengthRevenue =
    totalRevenueUsd > 0 &&
    Number(evidence?.armsLengthCustomerCount) > 0 &&
    Number(evidence?.paidPilotCount) > 0 &&
    invoiceProof.ready &&
    paymentProof.ready;
  const monthlyRevenue = monthValuesValid && totalRevenueUsd === totalRevenueFromMonths && totalRevenueUsd > 0;
  const totalCosts =
    Number.isFinite(Number(evidence?.totalCostsUsd)) &&
    Number(evidence?.totalCostsUsd) >= 0 &&
    Boolean(String(evidence?.costDescription ?? "").trim()) &&
    costProof.ready;
  const cacSpend =
    Number.isFinite(Number(evidence?.customerAcquisitionSpendUsd)) &&
    Number(evidence?.customerAcquisitionSpendUsd) >= 0 &&
    cacProof.ready;
  const realUsers =
    Number(evidence?.activeUsers) > 0 &&
    Array.isArray(evidence?.userBreakdown) &&
    evidence.userBreakdown.length > 0 &&
    activeUserProof.ready;
  const testimonialClaim = testimonials.length > 0 && testimonialConsentOk && testimonialProof.ready;
  const testimonialBoundary = testimonials.length === 0 || testimonialClaim;
  const relatedParty =
    Number.isFinite(Number(evidence?.relatedPartyRevenueUsd)) &&
    Boolean(String(evidence?.relatedPartyNotes ?? "").trim()) &&
    relatedPartyProof.ready;
  const artifactBucketsReady = requiredBuckets.every((bucket) => verifiedArtifacts(evidence, bucket).ready);
  const minimumBusinessEvidence =
    armsLengthRevenue &&
    monthlyRevenue &&
    totalCosts &&
    cacSpend &&
    realUsers &&
    relatedParty &&
    testimonialBoundary &&
    artifactBucketsReady;

  return {
    totalRevenueUsd,
    totalRevenueFromMonths,
    monthValuesValid,
    invoiceProof,
    paymentProof,
    activeUserProof,
    costProof,
    cacProof,
    relatedPartyProof,
    testimonialProof,
    testimonials,
    testimonialConsentOk,
    requiredBuckets,
    secretFinding,
    readiness: {
      armsLengthRevenue,
      monthlyRevenue,
      totalCosts,
      cacSpend,
      realUsers,
      testimonialBoundary,
      testimonialClaim,
      relatedParty,
      artifactBucketsReady,
      minimumBusinessEvidence
    }
  };
}

function evidenceFlagDependencyGaps(analysis) {
  const rules = [
    {
      name: "XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED",
      ready: analysis.readiness.armsLengthRevenue,
      fix: "Attach arms-length invoice and payment proof before setting total-revenue evidence."
    },
    {
      name: "XPRIZE_REVENUE_BY_MONTH_EVIDENCE_CONFIGURED",
      ready: analysis.readiness.monthlyRevenue,
      fix: "Fill a matching May-August revenue breakdown before setting month-by-month revenue evidence."
    },
    {
      name: "XPRIZE_TOTAL_COSTS_EVIDENCE_CONFIGURED",
      ready: analysis.readiness.totalCosts,
      fix: "Attach cost records and cost description before setting total-cost evidence."
    },
    {
      name: "XPRIZE_CAC_SPEND_EVIDENCE_CONFIGURED",
      ready: analysis.readiness.cacSpend,
      fix: "Attach CAC receipts or a zero-spend attestation before setting CAC evidence."
    },
    {
      name: "XPRIZE_REAL_USER_EVIDENCE_CONFIGURED",
      ready: analysis.readiness.realUsers,
      fix: "Attach active-user logs and user breakdown before setting real-user evidence."
    },
    {
      name: "XPRIZE_TESTIMONIAL_CONSENT_CONFIRMED",
      ready: analysis.readiness.testimonialClaim,
      fix: "Attach explicit testimonial consent proof before setting testimonial-consent evidence."
    },
    {
      name: "XPRIZE_RELATED_PARTY_REVENUE_REVIEWED",
      ready: analysis.readiness.relatedParty,
      fix: "Attach related-party review proof before setting related-party evidence."
    },
    {
      name: "XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED",
      ready: analysis.readiness.minimumBusinessEvidence,
      fix: "Keep the business-model flag false until revenue, cost, CAC, user, related-party, and testimonial boundaries are all proven."
    }
  ];

  return rules.filter((rule) => process.env[rule.name] === "true" && !rule.ready);
}

function requiredArtifactBucketsForEvidence(evidence) {
  const testimonials = Array.isArray(evidence?.testimonials) ? evidence.testimonials : [];
  return testimonials.length > 0 ? privateArtifactBuckets : coreBusinessArtifactBuckets;
}

function summarizeEvidence(evidence) {
  if (!evidence) {
    return {
      totalRevenueUsd: 0,
      activeUsers: 0,
      paidPilotCount: 0,
      artifactBucketsReady: 0
    };
  }

  return {
    totalRevenueUsd: numberOrZero(evidence.totalRevenueUsd),
    revenueByMonth: months.reduce((accumulator, month) => {
      accumulator[month] = numberOrZero(evidence.revenueByMonth?.[month]);
      return accumulator;
    }, {}),
    totalCostsUsd: numberOrZero(evidence.totalCostsUsd),
    customerAcquisitionSpendUsd: numberOrZero(evidence.customerAcquisitionSpendUsd),
    activeUsers: numberOrZero(evidence.activeUsers),
    paidPilotCount: numberOrZero(evidence.paidPilotCount),
    armsLengthCustomerCount: numberOrZero(evidence.armsLengthCustomerCount),
    relatedPartyRevenueUsd: numberOrZero(evidence.relatedPartyRevenueUsd),
    artifactBucketsReady: requiredArtifactBucketsForEvidence(evidence).filter((bucket) => verifiedArtifacts(evidence, bucket).ready).length,
    artifactBucketsTracked: privateArtifactBuckets.length
  };
}

function verifiedArtifacts(evidence, bucket) {
  const artifacts = evidence?.artifacts?.[bucket];
  const items = Array.isArray(artifacts) ? artifacts : [];
  const readyCount = items.filter(
    (item) =>
      item?.status === "verified" &&
      item?.redacted === true &&
      typeof item?.sha256 === "string" &&
      /^[a-f0-9]{64}$/iu.test(item.sha256) &&
      typeof item?.privatePath === "string" &&
      item.privatePath.length > 0
  ).length;

  return {
    ready: readyCount > 0,
    readyCount
  };
}

function readEvidence(path) {
  try {
    return JSON.parse(readRegularTextFile(path, "Private business evidence file"));
  } catch (error) {
    throw new Error(`Unable to read private evidence file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function buildTemplate() {
  return {
    schema: "sme-sentinel-business-evidence-v1",
    period: {
      startDate: "2026-05-19",
      endDate: "2026-08-17",
      months
    },
    totalRevenueUsd: 0,
    revenueByMonth: { May: 0, June: 0, July: 0, August: 0 },
    totalCostsUsd: 0,
    costDescription: "",
    customerAcquisitionSpendUsd: 0,
    armsLengthCustomerCount: 0,
    paidPilotCount: 0,
    activeUsers: 0,
    userBreakdown: [{ segment: "", count: 0 }],
    relatedPartyRevenueUsd: 0,
    relatedPartyNotes: "",
    testimonials: [],
    artifacts: Object.fromEntries(
      privateArtifactBuckets.map((bucket) => [
        bucket,
        [{ id: "", status: "missing", redacted: false, sha256: "", privatePath: "", owner: "", reviewedAt: "" }]
      ])
    ),
    reviewer: { name: "", role: "", reviewedAt: "" },
    privateHandling: [
      "Do not commit this filled file.",
      "Use aliases and aggregate user categories in this JSON; keep raw invoices, payment exports, receipts, customer contacts, and testimonials in private storage.",
      "Every verified artifact should be redacted and include a SHA-256 checksum."
    ]
  };
}

function buildNextActions(checks, blockers) {
  if (blockers.length > 0) {
    return checks
      .filter((check) => check.status === "missing" || check.status === "blocked")
      .slice(0, 8)
      .map((check) => check.fix);
  }

  return [
    "Store the private business-evidence packet with the judge binder.",
    "Set XPRIZE business evidence flags only after founder/legal review.",
    "Rerun npm run verify:local-submission and hosted proof collection after Cloud Run deployment."
  ];
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function unique(values) {
  return Array.from(new Set(values));
}

function check(input) {
  return input;
}

function writeJson(path, value) {
  const absolutePath = resolve(path);
  const parentDirectory = dirname(absolutePath);
  assertDirectoryPathSafe(parentDirectory, "Private business evidence output parent directory");
  mkdirSync(parentDirectory, { recursive: true });
  assertDirectoryExistsSafe(parentDirectory, "Private business evidence output parent directory");
  writeTextFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "Private business evidence output file");
}

function readRegularTextFile(path, label) {
  const absolutePath = resolve(path);
  assertRegularFileIfExists(absolutePath, label);
  return readFileSync(absolutePath, "utf8");
}

function writeTextFile(path, content, label) {
  const absolutePath = resolve(path);
  const parentDirectory = dirname(absolutePath);
  const tempPath = join(parentDirectory, `.${basename(absolutePath)}.${randomUUID()}.tmp`);
  const parentIdentity = assertWritableTextFilePath(absolutePath, label);

  try {
    writeFileSync(tempPath, content, { encoding: "utf8", flag: "wx" });
    assertSameDirectoryIdentity(parentDirectory, parentIdentity, `${label} parent directory`);
    renameSync(tempPath, absolutePath);
    assertSameDirectoryIdentity(parentDirectory, parentIdentity, `${label} parent directory`);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function assertDirectoryPathSafe(path, label) {
  const directories = [];
  let cursor = resolve(path);

  while (true) {
    directories.push(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  for (const directory of directories.reverse()) {
    let fileStat;

    try {
      fileStat = lstatSync(directory);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    if (fileStat.isSymbolicLink()) {
      if (isAllowedSystemDirectorySymlink(directory)) {
        continue;
      }

      throw new Error(`${label} ${directory} is a symbolic link; use a regular private directory before verification.`);
    }

    if (!fileStat.isDirectory()) {
      throw new Error(`${label} ${directory} is not a directory; use a regular private directory before verification.`);
    }
  }
}

function assertDirectoryExistsSafe(path, label) {
  const absolutePath = resolve(path);
  const fileStat = readDirectoryStat(absolutePath, label);

  if (!fileStat.isDirectory()) {
    throw new Error(`${label} ${absolutePath} is not a directory; use a regular private directory before verification.`);
  }
}

function assertWritableTextFilePath(path, label) {
  const absolutePath = resolve(path);
  const parentDirectory = dirname(absolutePath);

  assertDirectoryPathSafe(parentDirectory, `${label} parent directory`);
  assertRegularFileIfExists(absolutePath, label);

  return readDirectoryIdentity(parentDirectory, `${label} parent directory`);
}

function assertSameDirectoryIdentity(path, expected, label) {
  const actual = readDirectoryIdentity(path, label);

  if (actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new Error(`${label} ${resolve(path)} changed while writing; regenerate the private business evidence packet in a stable private directory.`);
  }
}

function readDirectoryIdentity(path, label) {
  const fileStat = readDirectoryStat(resolve(path), label);

  return {
    dev: fileStat.dev,
    ino: fileStat.ino
  };
}

function readDirectoryStat(path, label) {
  const absolutePath = resolve(path);
  const fileStat = lstatSync(absolutePath);

  if (fileStat.isSymbolicLink()) {
    if (isAllowedSystemDirectorySymlink(absolutePath)) {
      return statSync(absolutePath);
    }

    throw new Error(`${label} ${absolutePath} is a symbolic link; use a regular private directory before verification.`);
  }

  return fileStat;
}

function assertRegularFileIfExists(path, label) {
  let fileStat;

  try {
    fileStat = lstatSync(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  if (fileStat.isSymbolicLink()) {
    throw new Error(`${label} ${path} is a symbolic link; use a regular private file path before verification.`);
  }

  if (!fileStat.isFile()) {
    throw new Error(`${label} ${path} is not a regular file; use a regular private file path before verification.`);
  }
}

function isAllowedSystemDirectorySymlink(path) {
  if (process.platform !== "darwin") {
    return false;
  }

  const absolutePath = resolve(path);
  const allowedAliases = {
    "/etc": "/private/etc",
    "/tmp": "/private/tmp",
    "/var": "/private/var"
  };
  const expectedTarget = allowedAliases[absolutePath];

  if (!expectedTarget) {
    return false;
  }

  const target = readlinkSync(absolutePath);
  return resolve(dirname(absolutePath), target) === expectedTarget;
}

try {
  const args = parseArgs(process.argv.slice(2));

  if (args.writeTemplatePath) {
    writeJson(args.writeTemplatePath, buildTemplate());
  }

  const report = buildReport(args.evidencePath);

  if (args.outPath) {
    writeJson(args.outPath, report);
  }

  console.log(JSON.stringify(report, null, 2));

  if (args.strict && report.overallStatus !== "ready") {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
