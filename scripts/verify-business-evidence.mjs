#!/usr/bin/env node
/* global console, process */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const officialRuleSources = ["https://xprize.devpost.com/rules", "https://www.geminixprize.com/rules"];
const months = ["May", "June", "July", "August"];
const requiredArtifactBuckets = [
  "invoices",
  "paymentRecords",
  "activeUserLogs",
  "costRecords",
  "cacReceipts",
  "relatedPartyReview"
];
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
    requiredPrivateArtifacts: requiredArtifactBuckets,
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

  const revenueByMonth = evidence.revenueByMonth ?? {};
  const monthValues = months.map((month) => Number(revenueByMonth[month]));
  const monthValuesValid = monthValues.every((value) => Number.isFinite(value) && value >= 0);
  const totalRevenueUsd = Number(evidence.totalRevenueUsd);
  const totalRevenueFromMonths = monthValues.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
  const invoiceProof = verifiedArtifacts(evidence, "invoices");
  const paymentProof = verifiedArtifacts(evidence, "paymentRecords");
  const activeUserProof = verifiedArtifacts(evidence, "activeUserLogs");
  const costProof = verifiedArtifacts(evidence, "costRecords");
  const cacProof = verifiedArtifacts(evidence, "cacReceipts");
  const relatedPartyProof = verifiedArtifacts(evidence, "relatedPartyReview");
  const testimonialProof = verifiedArtifacts(evidence, "testimonialConsents");
  const testimonials = Array.isArray(evidence.testimonials) ? evidence.testimonials : [];
  const testimonialConsentOk = testimonials.length === 0 || testimonials.every((item) => item?.consentConfirmed === true);
  const secretFinding = secretTextPatterns.some((pattern) => pattern.test(JSON.stringify(evidence)));

  return [
    check({
      id: "business-evidence-file",
      label: "Private business evidence file",
      status: secretFinding ? "blocked" : "ready",
      evidence: secretFinding ? "Secret-shaped text was detected in the private evidence JSON." : `Loaded ${evidencePath}.`,
      fix: secretFinding
        ? "Remove raw credentials, tokens, and unredacted secrets from the evidence JSON before using it as a judge packet source."
        : "No action.",
      ownerRole: "founder",
      requiredBeforeSubmit: true,
      privateHandling: "Keep the filled evidence file outside Git."
    }),
    check({
      id: "arms-length-revenue",
      label: "Arms-length revenue and payment proof",
      status:
        totalRevenueUsd > 0 &&
        Number(evidence.armsLengthCustomerCount) > 0 &&
        Number(evidence.paidPilotCount) > 0 &&
        invoiceProof.ready &&
        paymentProof.ready
          ? "ready"
          : "missing",
      evidence: `Revenue $${numberOrZero(totalRevenueUsd)}; arms-length customers ${numberOrZero(evidence.armsLengthCustomerCount)}; paid pilots ${numberOrZero(evidence.paidPilotCount)}; invoice proof ${invoiceProof.readyCount}; payment proof ${paymentProof.readyCount}.`,
      fix: "Attach arms-length invoice and payment proof before counting revenue.",
      ownerRole: "founder",
      requiredBeforeSubmit: true,
      privateHandling: "Keep invoice ids, payment exports, and customer names private or redacted."
    }),
    check({
      id: "monthly-revenue-breakdown",
      label: "May-August revenue by month",
      status:
        monthValuesValid && totalRevenueUsd === totalRevenueFromMonths && totalRevenueUsd > 0
          ? "ready"
          : "missing",
      evidence: `Monthly values valid ${monthValuesValid ? "yes" : "no"}; monthly sum $${totalRevenueFromMonths}; total revenue $${numberOrZero(totalRevenueUsd)}.`,
      fix: "Fill May, June, July, and August 2026 revenue values and make the month sum match total revenue.",
      ownerRole: "founder",
      requiredBeforeSubmit: true,
      privateHandling: "Publish only aggregate month totals unless customers consent to attribution."
    }),
    check({
      id: "costs-and-cac",
      label: "Costs and customer acquisition spend",
      status:
        Number.isFinite(Number(evidence.totalCostsUsd)) &&
        Number(evidence.totalCostsUsd) >= 0 &&
        Number.isFinite(Number(evidence.customerAcquisitionSpendUsd)) &&
        Number(evidence.customerAcquisitionSpendUsd) >= 0 &&
        Boolean(String(evidence.costDescription ?? "").trim()) &&
        costProof.ready &&
        cacProof.ready
          ? "ready"
          : "missing",
      evidence: `Costs $${numberOrZero(evidence.totalCostsUsd)}; CAC $${numberOrZero(evidence.customerAcquisitionSpendUsd)}; cost proof ${costProof.readyCount}; CAC proof ${cacProof.readyCount}.`,
      fix: "Attach hosting/AI/API/contractor cost proof and CAC proof or zero-spend attestation.",
      ownerRole: "founder",
      requiredBeforeSubmit: true,
      privateHandling: "Keep receipts and billing exports private; publish only aggregate costs."
    }),
    check({
      id: "real-user-evidence",
      label: "Real user evidence and breakdown",
      status: Number(evidence.activeUsers) > 0 && Array.isArray(evidence.userBreakdown) && evidence.userBreakdown.length > 0 && activeUserProof.ready ? "ready" : "missing",
      evidence: `Active users ${numberOrZero(evidence.activeUsers)}; user segments ${Array.isArray(evidence.userBreakdown) ? evidence.userBreakdown.length : 0}; user-log proof ${activeUserProof.readyCount}.`,
      fix: "Attach production analytics, Workspace install logs, or other active-user proof with a high-level user breakdown.",
      ownerRole: "sales",
      requiredBeforeSubmit: true,
      privateHandling: "Share high-level user categories publicly; keep contact details private."
    }),
    check({
      id: "testimonial-consent",
      label: "Testimonials and feedback consent",
      status:
        testimonials.length > 0 && testimonialConsentOk && testimonialProof.ready
          ? "ready"
          : testimonials.length === 0
            ? "needs-review"
            : "blocked",
      evidence: `Testimonials ${testimonials.length}; consent clean ${testimonialConsentOk ? "yes" : "no"}; consent proof ${testimonialProof.readyCount}.`,
      fix:
        testimonials.length === 0
          ? "If customer feedback exists, add only consented and redacted testimonials; otherwise record why no testimonials are included."
          : "Remove unconsented quotes or attach explicit consent proof before sharing testimonials.",
      ownerRole: "sales",
      requiredBeforeSubmit: testimonials.length > 0,
      privateHandling: "Never expose customer names, quotes, or contact details without explicit consent."
    }),
    check({
      id: "related-party-revenue",
      label: "Related-party revenue separation",
      status:
        Number.isFinite(Number(evidence.relatedPartyRevenueUsd)) &&
        String(evidence.relatedPartyNotes ?? "").trim() &&
        relatedPartyProof.ready
          ? "ready"
          : "missing",
      evidence: `Related-party revenue $${numberOrZero(evidence.relatedPartyRevenueUsd)}; review proof ${relatedPartyProof.readyCount}.`,
      fix: "Record related-party revenue separately, even if zero, and attach relationship review proof.",
      ownerRole: "founder",
      requiredBeforeSubmit: true,
      privateHandling: "Keep relationship details private; disclose only the required aggregate and relationship category."
    }),
    ...flagConsistencyChecks(evidence)
  ];
}

function flagConsistencyChecks(evidence) {
  const evidenceReady = evidence ? hasMinimumBusinessEvidence(evidence) : false;

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
    })
  ];
}

function hasMinimumBusinessEvidence(evidence) {
  const revenueByMonth = evidence.revenueByMonth ?? {};
  const monthValues = months.map((month) => Number(revenueByMonth[month]));
  const totalRevenueUsd = Number(evidence.totalRevenueUsd);

  return (
    totalRevenueUsd > 0 &&
    monthValues.every((value) => Number.isFinite(value) && value >= 0) &&
    monthValues.reduce((total, value) => total + value, 0) === totalRevenueUsd &&
    Number(evidence.armsLengthCustomerCount) > 0 &&
    Number(evidence.paidPilotCount) > 0 &&
    Number(evidence.activeUsers) > 0 &&
    Boolean(String(evidence.relatedPartyNotes ?? "").trim()) &&
    requiredArtifactBuckets.every((bucket) => verifiedArtifacts(evidence, bucket).ready)
  );
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
    artifactBucketsReady: requiredArtifactBuckets.filter((bucket) => verifiedArtifacts(evidence, bucket).ready).length
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
    return JSON.parse(readFileSync(resolve(path), "utf8"));
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
    testimonials: [{ customerAlias: "", quoteRedacted: "", consentConfirmed: false }],
    artifacts: Object.fromEntries(
      [...requiredArtifactBuckets, "testimonialConsents"].map((bucket) => [
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

function check(input) {
  return input;
}

function writeJson(path, value) {
  const absolutePath = resolve(path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
