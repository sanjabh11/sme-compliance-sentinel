#!/usr/bin/env node
/* global console, process, URL */

import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const officialRuleSources = ["https://xprize.devpost.com/rules", "https://www.geminixprize.com/rules"];
const deploymentContract = JSON.parse(
  readFileSync(new URL("../docs/deployment/cloudrun-deployment-contract.json", import.meta.url), "utf8")
);
const manualReviewEnv = [...new Set(deploymentContract.manualReviewEnv ?? [])];
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
    outDir: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (prohibitedCliPatterns.some((pattern) => pattern.test(arg))) {
      throw new Error("Raw secret CLI args are not supported. This packet only accepts non-secret output paths.");
    }

    if (arg === "--strict") {
      args.strict = true;
      continue;
    }

    if (arg === "--out-dir") {
      args.outDir = argv[index + 1] ?? "";
      if (!args.outDir) {
        throw new Error("--out-dir requires a non-secret output directory.");
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--out-dir=")) {
      args.outDir = arg.slice("--out-dir=".length);
      continue;
    }

    throw new Error(`Unsupported argument: ${arg}`);
  }

  return args;
}

function buildPacket() {
  const sourceRelease = runJson("scripts/verify-source-release.mjs");
  const provenance = runJson("scripts/verify-project-provenance.mjs");
  const licenseManifest = runJson("scripts/verify-license-manifest.mjs");
  const localSubmission = runJson("scripts/verify-local-submission.mjs");
  const objectiveSourceReady = sourceRelease.report?.overallStatus === "published" && objectiveProvenanceChecksPassed(provenance.report);
  const reviewGates = buildReviewGates({ sourceRelease, provenance, licenseManifest, localSubmission, objectiveSourceReady });
  const blocked = reviewGates.filter((gate) => gate.status === "blocked");
  const needsReview = reviewGates.filter((gate) => gate.status === "needs-review");
  const externalRequired = reviewGates.filter((gate) => gate.status === "external-required");

  return {
    generatedAt: new Date().toISOString(),
    overallStatus: blocked.length ? "blocked" : needsReview.length || externalRequired.length ? "ready-for-human-review" : "ready-to-apply-reviewed-flags",
    summary: {
      blocked: blocked.length,
      needsReview: needsReview.length,
      externalRequired: externalRequired.length,
      passed: reviewGates.filter((gate) => gate.status === "passed").length
    },
    sourceUrls: officialRuleSources,
    localSubmission: summarizeLocalSubmission(localSubmission.report),
    mechanicalEvidence: {
      sourceRelease: summarizeSourceRelease(sourceRelease.report),
      projectProvenance: summarizeProjectProvenance(provenance.report),
      licenseManifest: summarizeLicenseManifest(licenseManifest.report)
    },
    reviewGates,
    flagDecisionRegister: buildFlagDecisionRegister({ provenance, licenseManifest }),
    devpostDisclosureDraft: buildDevpostDisclosureDraft(provenance.report, licenseManifest.report),
    reviewerSignoffTemplate: {
      reviewerName: "",
      reviewerRole: "",
      reviewedAt: "",
      approvedEnvFlags: [],
      rejectedEnvFlags: [],
      privateNotesPath: "/secure/local/xprize-attestation-review-notes.md"
    },
    privateHandling: [
      "Write this packet only to a private operator path such as /secure/local/xprize-attestation.",
      "Do not commit reviewer notes, judge credentials, customer contact proof, invoices, OAuth tokens, API keys, raw Workspace content, or raw security findings.",
      "Set XPRIZE attestation flags only after the owner verifies the matching private evidence; this packet never sets flags automatically."
    ],
    nextActions: unique([
      ...reviewGates.filter((gate) => gate.status !== "passed").map((gate) => gate.fix),
      "After human review, rerun npm run verify:local-submission and keep the JSON output with the private judge packet."
    ]),
    disclaimer:
      "This packet prepares human review. It is not legal advice, audit assurance, certification evidence, organizer approval, or a guarantee of judging outcome."
  };
}

function buildReviewGates({ sourceRelease, provenance, licenseManifest, localSubmission, objectiveSourceReady }) {
  const sourceUnparseable = [sourceRelease, provenance, licenseManifest, localSubmission].some((item) => !item.report);
  const sourceBlocked = sourceRelease.report?.overallStatus === "blocked" || !objectiveSourceReady;
  const licenseStatus = licenseManifest.report?.overallStatus ?? "unreadable";
  const localGateStatus = localSubmission.report?.overallStatus ?? "unreadable";

  return [
    reviewGate(
      "source-provenance-ready",
      "Source repository and creation-window evidence",
      sourceUnparseable || sourceBlocked ? "blocked" : "passed",
      `Source release ${sourceRelease.report?.overallStatus ?? "unreadable"}; provenance ${provenance.report?.overallStatus ?? "unreadable"}; first commit ${provenance.report?.git?.firstCommitAt ?? "missing"}; pushed HEAD ${provenance.report?.git?.remoteHeadCommit ?? "missing"}.`,
      "Commit, push/share, and clean the source repository before reviewing project-created-after-start attestation.",
      "engineering",
      ["repository URL", "root commit timestamp", "pushed HEAD", "tracked source file count"]
    ),
    reviewGate(
      "project-created-after-start-attestation",
      "Project-created-after-start and pre-existing-work disclosure",
      sourceBlocked ? "blocked" : provenance.report?.projectCreatedAfterStartConfirmed ? "passed" : "needs-review",
      `XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED=${provenance.report?.projectCreatedAfterStartConfirmed ? "true" : "false"}; disclosure draft has ${(provenance.report?.disclosureDraft ?? []).length} item(s).`,
      "Review first commit timing, generated/local boilerplate, frameworks, dependencies, and final Devpost disclosure before setting XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED=true.",
      "founder",
      ["first commit after official start", "framework/dependency disclosure", "generated boilerplate disclosure", "private evidence exclusions"]
    ),
    reviewGate(
      "third-party-license-api-review",
      "Third-party license, API terms, and OAuth review",
      licenseStatus === "blocked" ? "blocked" : licenseStatus === "passed" ? "passed" : "needs-review",
      `${licenseManifest.report?.summary?.totalPackages ?? 0} package(s); ${licenseManifest.report?.summary?.restrictedLicenseReviewCount ?? 0} restricted-review; ${licenseManifest.report?.summary?.unknownLicenseCount ?? 0} unknown-license; ${licenseManifest.report?.summary?.obligationReviewCount ?? 0} obligation-review; ${licenseManifest.report?.summary?.integrationsNeedingReview ?? 0} Google integration(s) needing review.`,
      "Record license basis, notices, Google API terms, OAuth consent screen review, IAM/billing boundaries, and data-use authorization before approval flags are set.",
      "legal",
      ["license manifest JSON", "notice obligations", "Google API terms review", "OAuth consent-screen scope review"]
    ),
    reviewGate(
      "demo-ip-redaction-review",
      "Demo video, screenshots, IP, and customer-data redaction",
      "needs-review",
      "Final public demo and screenshots still need human asset, trademark, copyrighted-material, and customer-data redaction review.",
      "Review final video, screenshots, icons, marks, copied text, music, and customer-identifying content before setting demo/IP clearance flags.",
      "marketing",
      ["under-three-minute public video", "owned or permitted assets", "no unconsented customer data", "public-safe screenshots"]
    ),
    reviewGate(
      "hosted-production-proof-boundary",
      "Hosted Cloud Run, Gemini, GCP persistence, Workspace sync, and judge access proof",
      "external-required",
      `Local submission status ${localGateStatus}; local reports cannot prove hosted product access, live Gemini calls, GCP persistence, Workspace OAuth, or judge access.`,
      "Deploy to Cloud Run, run hosted proof collection, import redacted proof into the Evidence Vault, and verify judge/free-access instructions before final submission.",
      "engineering",
      ["Cloud Run URL", "live Gemini provider log", "GCP write-through proof", "Workspace OAuth/sync proof", "judge access instructions"]
    ),
    reviewGate(
      "business-user-revenue-proof-boundary",
      "Paid pilot, revenue, cost, CAC, and active-user evidence",
      "external-required",
      "Local seeded data cannot prove arms-length revenue, real users, invoices, CAC, costs, or testimonials.",
      "Collect real paid-pilot proof, consent, invoices/payment exports, active-user logs, cost/CAC records, and testimonial permission before using business viability evidence.",
      "founder",
      ["arms-length invoices", "payment proof", "active-user logs", "cost/CAC records", "testimonial consent"]
    )
  ];
}

function buildFlagDecisionRegister({ provenance, licenseManifest }) {
  return manualReviewEnv.map((envFlag) =>
    flagDecision(envFlag, currentFlagValue(envFlag, { provenance, licenseManifest }), ownerRoleForFlag(envFlag), setWhenForFlag(envFlag))
  );
}

function currentFlagValue(envFlag, { provenance, licenseManifest }) {
  const licenseEnvFlags = licenseManifest.report?.envFlags ?? {};

  if (envFlag === "XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED") {
    return Boolean(provenance.report?.projectCreatedAfterStartConfirmed);
  }

  if (envFlag === "XPRIZE_THIRD_PARTY_REVIEW_APPROVED") {
    return Boolean(licenseEnvFlags.thirdPartyReviewApproved);
  }

  if (envFlag === "XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED") {
    return Boolean(licenseEnvFlags.ipOwnershipReviewApproved);
  }

  if (envFlag === "XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED") {
    return Boolean(licenseEnvFlags.demoAssetClearanceConfirmed);
  }

  return process.env[envFlag] === "true";
}

function ownerRoleForFlag(envFlag) {
  if (envFlag.includes("LICENSE") || envFlag.includes("IP_OWNERSHIP") || envFlag.includes("THIRD_PARTY")) {
    return "legal";
  }

  if (envFlag.includes("DEMO_VIDEO")) {
    return "marketing";
  }

  if (
    envFlag.includes("REPOSITORY") ||
    envFlag.includes("SOURCE_CODE") ||
    envFlag.includes("WORKING_PROJECT") ||
    envFlag.includes("GOOGLE_CLOUD") ||
    envFlag.includes("GEMINI") ||
    envFlag.includes("AI_NATIVE") ||
    envFlag.includes("PRODUCT_RUNNING") ||
    envFlag.includes("AGENT_EXECUTION") ||
    envFlag.includes("OAUTH") ||
    envFlag.includes("QUOTA")
  ) {
    return "engineering";
  }

  if (envFlag.includes("REVENUE") || envFlag.includes("COST") || envFlag.includes("CAC") || envFlag.includes("USER") || envFlag.includes("TESTIMONIAL")) {
    return "founder";
  }

  if (envFlag.includes("ELIGIBILITY") || envFlag.includes("REPRESENTATIVE") || envFlag.includes("ORGANIZATION") || envFlag.includes("CORPORATE") || envFlag.includes("PROMOTION")) {
    return "founder/legal";
  }

  return "founder";
}

function setWhenForFlag(envFlag) {
  const guidance = {
    XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED:
      "Set true only after source provenance and pre-existing-work disclosure are human-reviewed.",
    XPRIZE_SOURCE_CODE_COMPLETE_CONFIRMED:
      "Set true only after the pushed judge-accessible repository contains all necessary source code and excludes private evidence.",
    XPRIZE_REPOSITORY_ACCESS_CONFIGURED:
      "Set true only after the public or private-shared repository is accessible to the required judging/testing accounts.",
    XPRIZE_GENERAL_ELIGIBILITY_CONFIRMED:
      "Set true only after entrant age, geography, role, and conflict restrictions are reviewed against the official rules.",
    XPRIZE_REPRESENTATIVE_AUTHORIZED:
      "Set true only after the team or organization representative is authorized to submit and receive official communications.",
    XPRIZE_ORGANIZATION_UNDER_25_CONFIRMED:
      "Set true only after the organization employee count is reviewed, if entering as an organization.",
    XPRIZE_CORPORATE_ID_CONFIGURED:
      "Set true only after the organization corporate id is available for the private submission packet, if applicable.",
    XPRIZE_NO_PROMOTION_ENTITY_CONFLICT_CONFIRMED:
      "Set true only after the entrant and contributors are reviewed for promotion-entity, judge, sponsor, administrator, and conflict restrictions.",
    XPRIZE_THIRD_PARTY_REVIEW_APPROVED:
      "Set true only after dependency licenses, notices, Google API terms, OAuth consent, billing/IAM, and data boundaries are reviewed.",
    XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED:
      "Set true only after source ownership, generated content, trademarks, screenshots, and final public assets are reviewed.",
    XPRIZE_DEMO_VIDEO_UNDER_3_MIN_CONFIRMED:
      "Set true only after the final public demo video duration is reviewed and stays under three minutes.",
    XPRIZE_DEMO_VIDEO_PUBLICLY_ACCESSIBLE_CONFIRMED:
      "Set true only after the final demo video is publicly visible on an allowed host.",
    XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED:
      "Set true only after the public demo video and screenshots have permission and redaction review.",
    XPRIZE_DEMO_VIDEO_CUSTOMER_DATA_REDACTED_CONFIRMED:
      "Set true only after all customer names, files, findings, invoices, emails, and contact data are removed or consented for the public demo.",
    XPRIZE_DEMO_VIDEO_ENGLISH_OR_SUBTITLED_CONFIRMED:
      "Set true only after the final demo video and submission materials are in English or have English translation/subtitles.",
    XPRIZE_WORKING_PROJECT_ACCESS_CONFIGURED:
      "Set true only after the hosted project URL is reachable by judges with documented private testing instructions.",
    XPRIZE_TESTING_INSTRUCTIONS_CONFIGURED:
      "Set true only after private Devpost testing instructions include URL, test path, credential handling, expected workflow, and support process.",
    XPRIZE_JUDGE_ACCESS_CONFIGURED:
      "Set true only after judge access is configured and verified from a judge-like session.",
    XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED:
      "Set true only after the product is confirmed free of charge and unrestricted for judging through the official judging-period end.",
    XPRIZE_EVIDENCE_RESPONSE_PRIVATE_CONTACT_CONFIGURED:
      "Set true only after a private owner/contact can respond to organizer evidence requests within the required review window.",
    XPRIZE_EVIDENCE_RESPONSE_READY:
      "Set true only after source, repository, hosted access, testing instructions, demo, third-party, IP, and private-response evidence are all reviewed.",
    XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED:
      "Set true only after hosted Google Cloud product evidence is collected and stored privately.",
    XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED:
      "Set true only after a deployed Gemini API call is logged as provider=gemini-api in private proof.",
    XPRIZE_AI_NATIVE_OPERATIONS_EVIDENCE_CONFIGURED:
      "Set true only after deployed AI-native operating logs show production decisions or workflow execution, not local mock behavior.",
    XPRIZE_PRODUCT_RUNNING_EVIDENCE_CONFIGURED:
      "Set true only after hosted screenshots, logs, and verification output show the product running continuously enough for judge review.",
    XPRIZE_AGENT_EXECUTION_LOGS_CONFIGURED:
      "Set true only after production agent-run logs are redacted, stored, and tied to the hosted release.",
    XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED:
      "Set true only after revenue, monthly revenue, cost, and real-user proof have all been reviewed.",
    XPRIZE_CATEGORY_IMPACT_EVIDENCE_CONFIGURED:
      "Set true only after Small Business Services impact is supported by real users, buyer value, and business proof.",
    XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED:
      "Set true only after arms-length revenue proof is collected, redacted, and tied to the hackathon window.",
    XPRIZE_REVENUE_BY_MONTH_EVIDENCE_CONFIGURED:
      "Set true only after May, June, July, and August 2026 monthly revenue breakdown evidence is collected.",
    XPRIZE_TOTAL_COSTS_EVIDENCE_CONFIGURED:
      "Set true only after hosting, AI API usage, contractor, and other operating costs are documented.",
    XPRIZE_CAC_SPEND_EVIDENCE_CONFIGURED:
      "Set true only after marketing and customer-acquisition spend is documented, even if the amount is zero.",
    XPRIZE_REAL_USER_EVIDENCE_CONFIGURED:
      "Set true only after active-user counts, user breakdown, and usage evidence are collected from real users.",
    XPRIZE_TESTIMONIAL_CONSENT_CONFIRMED:
      "Set true only after testimonial and feedback sharing permission is captured for every quoted customer.",
    XPRIZE_RELATED_PARTY_REVENUE_REVIEWED:
      "Set true only after related-party revenue is separately reviewed and disclosed.",
    GOOGLE_OAUTH_SCOPE_REVIEW_CONFIRMED:
      "Set true only after OAuth consent screen configuration, requested/deferred scopes, pilot consent copy, and data-use boundaries are reviewed.",
    SENTINEL_GEMINI_QUOTA_EVIDENCE_CONFIRMED:
      "Set true only after Gemini API key restrictions, quota settings, budget controls, and usage evidence are privately reviewed."
  };

  return guidance[envFlag] ?? "Set true only after the matching private proof exists and the responsible owner has reviewed it.";
}

function buildDevpostDisclosureDraft(provenance, licenseManifest) {
  return {
    publicSafeDraft: [
      ...(provenance?.disclosureDraft ?? []),
      ...(licenseManifest?.disclosureText ?? []),
      "SME Workspace Sentinel is submitted under Small Business Services as a Google Workspace risk desk for small businesses. It uses AI to triage Workspace exposure, stage human-approved remediation, and assemble private business evidence."
    ],
    privateOnlyNotes: [
      "Keep raw customer security findings, OAuth tokens, API keys, invoices, payment exports, judge credentials, and reviewer notes out of public Devpost fields.",
      "Do not claim SOC2 compliance, certification, legal advice, audit assurance, guaranteed compliance, or guaranteed competition outcome."
    ]
  };
}

function summarizeLocalSubmission(report) {
  return {
    overallStatus: report?.overallStatus ?? "unreadable",
    summary: report?.summary ?? { passed: 0, warning: 0, blocked: 1, externalRequired: 0 },
    remainingBlockers: report?.remainingBlockers ?? ["Local submission report is unavailable."],
    stopConditions: report?.stopConditions ?? []
  };
}

function summarizeSourceRelease(report) {
  return {
    overallStatus: report?.overallStatus ?? "unreadable",
    commitCount: report?.commitCount ?? 0,
    trackedFileCount: report?.trackedFileCount ?? 0,
    untrackedFileCount: report?.untrackedFileCount ?? 0,
    secretFindingCount: report?.secretFindings?.length ?? 0,
    claimFindingCount: report?.claimFindings?.length ?? 0
  };
}

function summarizeProjectProvenance(report) {
  return {
    overallStatus: report?.overallStatus ?? "unreadable",
    repositoryUrl: report?.repositoryUrl ?? "",
    firstCommitAt: report?.git?.firstCommitAt ?? "",
    headCommit: report?.git?.headCommit ?? "",
    remoteHeadCommit: report?.git?.remoteHeadCommit ?? "",
    projectCreatedAfterStartConfirmed: Boolean(report?.projectCreatedAfterStartConfirmed),
    checks: (report?.checks ?? []).map((check) => ({ id: check.id, status: check.status, evidence: check.evidence }))
  };
}

function summarizeLicenseManifest(report) {
  return {
    overallStatus: report?.overallStatus ?? "unreadable",
    sourceDigests: report?.sourceDigests ?? {},
    summary: report?.summary ?? {},
    checks: (report?.checks ?? []).map((check) => ({ id: check.id, status: check.status, evidence: check.evidence }))
  };
}

function objectiveProvenanceChecksPassed(report) {
  const requiredIds = new Set(["git-history-present", "first-commit-after-start", "source-tracked", "repository-url", "repository-pushed"]);
  return (report?.checks ?? []).filter((check) => requiredIds.has(check.id)).every((check) => check.status === "passed");
}

function reviewGate(id, label, status, evidence, fix, ownerRole, requiredEvidence) {
  return {
    id,
    label,
    status,
    evidence,
    fix,
    ownerRole,
    requiredEvidence
  };
}

function flagDecision(envFlag, currentValue, ownerRole, setWhen) {
  return {
    envFlag,
    currentValue,
    ownerRole,
    recommendedAction: currentValue ? "re-verify-private-evidence-before-submission" : "keep-false-until-reviewed",
    setWhen
  };
}

function runJson(script) {
  try {
    const stdout = execFileSync(process.execPath, [script], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    return {
      report: parseJson(stdout),
      stdout,
      stderr: "",
      exitCode: 0
    };
  } catch (error) {
    const stdout = toText(error?.stdout);
    const stderr = toText(error?.stderr);

    return {
      report: parseJson(stdout),
      stdout,
      stderr,
      exitCode: typeof error?.status === "number" ? error.status : 1
    };
  }
}

function parseJson(output) {
  const trimmed = output.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function renderMarkdown(packet) {
  const lines = [
    "# XPRIZE Human Attestation Packet",
    "",
    `Generated: ${packet.generatedAt}`,
    `Overall status: ${packet.overallStatus}`,
    "",
    "## Purpose",
    "",
    "This private packet helps a human owner review source provenance, pre-existing-work disclosure, third-party/API authorization, IP/demo clearance, hosted proof, and business evidence before setting XPRIZE attestation flags.",
    "",
    "## Review Gates",
    "",
    "| Gate | Status | Owner | Evidence | Required Action |",
    "|---|---:|---|---|---|",
    ...packet.reviewGates.map((gate) => `| ${gate.label} | ${gate.status} | ${gate.ownerRole} | ${escapeTable(gate.evidence)} | ${escapeTable(gate.fix)} |`),
    "",
    "## Flag Decision Register",
    "",
    "| Env Flag | Current | Owner | Recommended Action | Set When |",
    "|---|---:|---|---|---|",
    ...packet.flagDecisionRegister.map(
      (flag) =>
        `| ${flag.envFlag} | ${flag.currentValue ? "true" : "false"} | ${flag.ownerRole} | ${flag.recommendedAction} | ${escapeTable(flag.setWhen)} |`
    ),
    "",
    "## Public-Safe Disclosure Draft",
    "",
    ...packet.devpostDisclosureDraft.publicSafeDraft.map((item) => `- ${item}`),
    "",
    "## Private-Only Notes",
    "",
    ...packet.devpostDisclosureDraft.privateOnlyNotes.map((item) => `- ${item}`),
    "",
    "## Reviewer Signoff Template",
    "",
    "- Reviewer name:",
    "- Reviewer role:",
    "- Reviewed at:",
    "- Approved env flags:",
    "- Rejected env flags:",
    "- Private notes path:",
    "",
    "## Sources",
    "",
    ...packet.sourceUrls.map((url) => `- ${url}`),
    "",
    `Disclaimer: ${packet.disclaimer}`,
    ""
  ];

  return `${lines.join("\n")}\n`;
}

function escapeTable(value) {
  return String(value).replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");
}

function writePacket(outDir, packet) {
  const absoluteDir = resolve(outDir);
  mkdirSync(absoluteDir, { recursive: true });
  const jsonPath = join(absoluteDir, "xprize-human-attestation-packet.json");
  const markdownPath = join(absoluteDir, "xprize-human-attestation-packet.md");
  writeFileSync(jsonPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderMarkdown(packet), "utf8");
  return { jsonPath, markdownPath };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function toText(value) {
  if (!value) {
    return "";
  }

  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
}

try {
  const args = parseArgs(process.argv.slice(2));
  const packet = buildPacket();
  const outputFiles = args.outDir ? writePacket(args.outDir, packet) : undefined;
  const output = outputFiles ? { ...packet, outputFiles } : packet;

  console.log(JSON.stringify(output, null, 2));

  if (args.strict && output.overallStatus !== "ready-to-apply-reviewed-flags") {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
