#!/usr/bin/env node
/* global console, process */

import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { URL } from "node:url";

const officialRuleSources = ["https://xprize.devpost.com/rules", "https://www.geminixprize.com/rules"];
const requiredJudgingPeriodEndAt = "2026-09-15T17:00:00-07:00";
const requiredEvidenceResponseSlaBusinessDays = 2;
const prohibitedCliPatterns = [
  /(^|-)token($|=)/iu,
  /(^|-)password($|=)/iu,
  /(^|-)secret($|=)/iu,
  /api[_-]?key=/iu,
  /authorization=/iu
];
const secretTextPatterns = [
  /\bpassword\s*[:=]/iu,
  /\bpasscode\s*[:=]/iu,
  /\btoken\s*[:=]/iu,
  /\bapi[_-]?key\s*[:=]/iu,
  /\bauthorization\s*[:=]/iu,
  /\bbearer\s+[a-z0-9._~+/=-]{12,}/iu,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\s*[:=]\s*\S+/iu
];

function parseArgs(argv) {
  const args = {
    strict: false,
    outPath: "",
    productUrl: ""
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
      if (!args.outPath) {
        throw new Error("--out requires a non-secret output path.");
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--out=")) {
      args.outPath = arg.slice("--out=".length);
      continue;
    }

    if (arg === "--url" || arg === "--product-url") {
      args.productUrl = normalizeProductUrl(argv[index + 1] ?? "", arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--url=")) {
      args.productUrl = normalizeProductUrl(arg.slice("--url=".length), "--url");
      continue;
    }

    if (arg.startsWith("--product-url=")) {
      args.productUrl = normalizeProductUrl(arg.slice("--product-url=".length), "--product-url");
      continue;
    }

    throw new Error(`Unsupported argument: ${arg}`);
  }

  return args;
}

function buildReport(args = { productUrl: "" }) {
  const packageJson = readPackageJson();
  const productUrl = resolveProductUrl(args.productUrl);
  const repositoryUrl = env("XPRIZE_REPOSITORY_URL") || packageJson.repository?.url || "";
  const demoVideoUrl = env("XPRIZE_DEMO_VIDEO_URL");
  const testingInstructions = env("XPRIZE_TESTING_INSTRUCTIONS");
  const testingInstructionsConfigured = flag("XPRIZE_TESTING_INSTRUCTIONS_CONFIGURED");
  const testingInstructionsContainSecret = secretTextPatterns.some((pattern) => pattern.test(testingInstructions));
  const checks = buildChecks({
    productUrl,
    repositoryUrl,
    demoVideoUrl,
    testingInstructionsConfigured,
    testingInstructionsContainSecret
  });
  const blockers = checks
    .filter((check) => check.requiredBeforeSubmit && (check.status === "missing" || check.status === "blocked"))
    .map((check) => `${check.label}: ${check.fix}`);
  const overallStatus = blockers.length > 0 ? "blocked" : "ready";

  return {
    generatedAt: new Date().toISOString(),
    overallStatus,
    productUrl: productUrl || "missing",
    repositoryUrl: repositoryUrl || "missing",
    demoVideoUrl: demoVideoUrl || "missing",
    testingInstructionsSummary: testingInstructionsConfigured
      ? "Private testing instructions are marked configured; this report intentionally withholds their contents."
      : "Private testing instructions are not configured.",
    accessChecks: checks,
    smokeCommands: buildSmokeCommands(productUrl),
    evidenceResponsePlan: buildEvidenceResponsePlan(),
    privateCredentialRules: [
      "Do not commit judge usernames, passwords, magic links, admin tokens, OAuth secrets, or customer data.",
      "Provide judge credentials only in Devpost private testing instructions or an approved private channel.",
      "Use a dedicated judge test tenant with seeded or consented data; do not expose live customer findings in the public walkthrough.",
      "Keep the product free and reachable for judges through the judging period before setting the free-access confirmation flag.",
      "If a private login is required, include credential expiry, reset contact, and support response owner outside the repository."
    ],
    blockers,
    nextActions: buildNextActions(checks, blockers),
    stopConditions: [
      "This verifier does not create hosted access, credentials, a demo video, or revenue/user proof.",
      "Do not set judge-access, free-access, demo, or evidence-response flags until the matching private proof is reviewed.",
      "Do not paste judge credentials or support contacts into source, public README, public screenshots, public video, or this JSON packet."
    ],
    sourceUrls: officialRuleSources,
    disclaimer:
      "This packet verifies judge-access readiness signals in local configuration. It is not hosted proof, legal advice, organizer approval, or a guarantee of judging outcome."
  };
}

function buildChecks(input) {
  const productUrlReady = isHttpsUrl(input.productUrl) && flag("XPRIZE_WORKING_PROJECT_ACCESS_CONFIGURED");
  const judgeAccessReady = productUrlReady && flag("XPRIZE_JUDGE_ACCESS_CONFIGURED");
  const freeAccessReady =
    judgeAccessReady &&
    flag("XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED") &&
    env("XPRIZE_JUDGING_PERIOD_END_AT") === requiredJudgingPeriodEndAt;
  const repositoryReady =
    Boolean(input.repositoryUrl) && flag("XPRIZE_REPOSITORY_ACCESS_CONFIGURED") && flag("XPRIZE_SOURCE_CODE_COMPLETE_CONFIRMED");
  const demoReady =
    isAllowedDemoUrl(input.demoVideoUrl) &&
    flag("XPRIZE_DEMO_VIDEO_UNDER_3_MIN_CONFIRMED") &&
    flag("XPRIZE_DEMO_VIDEO_PUBLICLY_ACCESSIBLE_CONFIRMED") &&
    flag("XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED") &&
    flag("XPRIZE_DEMO_VIDEO_CUSTOMER_DATA_REDACTED_CONFIRMED") &&
    flag("XPRIZE_DEMO_VIDEO_ENGLISH_OR_SUBTITLED_CONFIRMED");
  const responseReady =
    Number(env("XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS")) > 0 &&
    Number(env("XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS")) <= requiredEvidenceResponseSlaBusinessDays &&
    flag("XPRIZE_EVIDENCE_RESPONSE_PRIVATE_CONTACT_CONFIGURED");

  return [
    check({
      id: "hosted-product-url",
      label: "Hosted product URL",
      status: productUrlReady ? "ready" : "missing",
      evidence: `Product URL ${input.productUrl ? "configured" : "missing"}; HTTPS ${isHttpsUrl(input.productUrl) ? "confirmed" : "missing"}; working project access ${flag("XPRIZE_WORKING_PROJECT_ACCESS_CONFIGURED") ? "confirmed" : "missing"}.`,
      fix: "Deploy the Cloud Run URL, verify it from a signed-out or judge-like browser, and set XPRIZE_WORKING_PROJECT_ACCESS_CONFIGURED=true only after private proof exists.",
      ownerRole: "engineering",
      requiredBeforeSubmit: true,
      privateHandling: "Store screenshots or browser-smoke JSON privately; do not include judge credentials in source."
    }),
    check({
      id: "private-testing-instructions",
      label: "Private judge testing instructions",
      status: input.testingInstructionsContainSecret ? "blocked" : input.testingInstructionsConfigured ? "private-on-request" : "missing",
      evidence: input.testingInstructionsContainSecret
        ? "Secret-shaped text was detected in XPRIZE_TESTING_INSTRUCTIONS."
        : input.testingInstructionsConfigured
          ? "Private testing instructions are configured and withheld from this packet."
          : "XPRIZE_TESTING_INSTRUCTIONS_CONFIGURED is not confirmed.",
      fix: input.testingInstructionsContainSecret
        ? "Move credentials and support contacts out of environment/source text and into Devpost private testing instructions or an approved private channel."
        : "Prepare private Devpost testing instructions with URL, test-account path, expected workflow, credential handling, and support process.",
      ownerRole: "founder",
      requiredBeforeSubmit: true,
      privateHandling: "This packet must not contain real usernames, passwords, magic links, admin tokens, customer findings, or private contacts."
    }),
    check({
      id: "judge-access-window",
      label: "Judge access and free judging-period window",
      status: freeAccessReady ? "ready" : "missing",
      evidence: `Judge access ${flag("XPRIZE_JUDGE_ACCESS_CONFIGURED") ? "configured" : "missing"}; free access ${flag("XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED") ? "confirmed" : "missing"}; judging-period end ${env("XPRIZE_JUDGING_PERIOD_END_AT") || "missing"}.`,
      fix: "Configure hosted judge access and confirm the product remains free through the official judging-period end before setting judge/free-access flags.",
      ownerRole: "founder",
      requiredBeforeSubmit: true,
      privateHandling: "Keep billing/hosting owner, credential rotation, and support contact in the private access packet."
    }),
    check({
      id: "repository-access",
      label: "Repository access",
      status: repositoryReady ? "ready" : "missing",
      evidence: `${input.repositoryUrl || "Repository URL missing"}; repository access ${flag("XPRIZE_REPOSITORY_ACCESS_CONFIGURED") ? "confirmed" : "missing"}; source completeness ${flag("XPRIZE_SOURCE_CODE_COMPLETE_CONFIRMED") ? "confirmed" : "missing"}.`,
      fix: "Keep the repository public or shared with required judge/testing accounts, then set repository/source flags only after access and source completeness are reviewed.",
      ownerRole: "engineering",
      requiredBeforeSubmit: true,
      privateHandling: "Do not include private evidence, .env files, invoices, customer findings, or judge credentials in the source repository."
    }),
    check({
      id: "demo-video-access",
      label: "Public demo video access",
      status: demoReady ? "ready" : "missing",
      evidence: `${input.demoVideoUrl || "Demo URL missing"}; allowed host ${isAllowedDemoUrl(input.demoVideoUrl) ? "confirmed" : "missing"}; under 3 minutes ${flag("XPRIZE_DEMO_VIDEO_UNDER_3_MIN_CONFIRMED") ? "confirmed" : "missing"}; public ${flag("XPRIZE_DEMO_VIDEO_PUBLICLY_ACCESSIBLE_CONFIRMED") ? "confirmed" : "missing"}; clearance ${flag("XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED") ? "confirmed" : "missing"}; redaction ${flag("XPRIZE_DEMO_VIDEO_CUSTOMER_DATA_REDACTED_CONFIRMED") ? "confirmed" : "missing"}; English/subtitles ${flag("XPRIZE_DEMO_VIDEO_ENGLISH_OR_SUBTITLED_CONFIRMED") ? "confirmed" : "missing"}.`,
      fix: "Publish the under-three-minute demo video on an allowed host, then complete visibility, duration, asset clearance, redaction, and language review.",
      ownerRole: "marketing",
      requiredBeforeSubmit: true,
      privateHandling: "Use redacted or seeded data in the public video; keep customer-specific proof private."
    }),
    check({
      id: "evidence-response-owner",
      label: "Two-business-day evidence response owner",
      status: responseReady ? "private-on-request" : "missing",
      evidence: `Private response contact ${flag("XPRIZE_EVIDENCE_RESPONSE_PRIVATE_CONTACT_CONFIGURED") ? "configured" : "missing"}; response SLA ${env("XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS") || "missing"} business day(s).`,
      fix: "Assign a human owner who can answer organizer evidence requests within two business days and access the private Evidence Vault.",
      ownerRole: "founder",
      requiredBeforeSubmit: true,
      privateHandling: "Keep the owner's direct contact in private testing instructions, not public source or this JSON packet."
    })
  ];
}

function buildSmokeCommands(productUrl) {
  const base = isHttpsUrl(productUrl) ? productUrl.replace(/\/+$/u, "") : "https://YOUR-CLOUD-RUN-URL";

  return [
    smokeCommand({
      id: "homepage",
      label: "Homepage loads",
      command: `curl -I ${base}/`,
      expectedEvidence: "HTTP 200 or expected redirect to judge-access flow.",
      redactionRequired: false
    }),
    smokeCommand({
      id: "judge-access-pack",
      label: "Judge access packet loads",
      command: `curl -s ${base}/api/xprize/judge-access-pack`,
      expectedEvidence: "JSON response lists URL, repository, demo video, private credential rules, and walkthrough.",
      redactionRequired: true
    }),
    smokeCommand({
      id: "submission-gate",
      label: "Submission gate loads",
      command: `curl -s ${base}/api/xprize/submission-gate`,
      expectedEvidence: "JSON response separates passed, warning, and blocked proof gates.",
      redactionRequired: true
    }),
    smokeCommand({
      id: "claim-guard",
      label: "Claim guard loads",
      command: `curl -s ${base}/api/compliance/claims`,
      expectedEvidence: "No banned compliance or win-certainty claims before public submission.",
      redactionRequired: false
    })
  ];
}

function buildEvidenceResponsePlan() {
  return [
    {
      id: "judge-login-support",
      label: "Judge login and support owner",
      ownerRole: "founder",
      responseSlaHours: 48,
      status:
        flag("XPRIZE_JUDGE_ACCESS_CONFIGURED") &&
        flag("XPRIZE_TESTING_INSTRUCTIONS_CONFIGURED") &&
        flag("XPRIZE_EVIDENCE_RESPONSE_PRIVATE_CONTACT_CONFIGURED")
          ? "private-on-request"
          : "missing",
      handling: "Provide test login path, support contact, and credential reset process privately; never commit credentials."
    },
    {
      id: "hosted-url-proof",
      label: "Hosted URL browser proof",
      ownerRole: "engineering",
      responseSlaHours: 48,
      status:
        isHttpsUrl(env("NEXT_PUBLIC_PRODUCT_URL")) && flag("XPRIZE_WORKING_PROJECT_ACCESS_CONFIGURED")
          ? "private-on-request"
          : "missing",
      handling: "Capture signed-out browser screenshot and route smoke JSON from the hosted product."
    },
    {
      id: "free-access-proof",
      label: "Free judging-period access proof",
      ownerRole: "founder",
      responseSlaHours: 48,
      status: flag("XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED") ? "private-on-request" : "missing",
      handling: "Store confirmation that hosting, billing, and credentials remain active and free for judges through the judging period."
    }
  ];
}

function buildNextActions(checks, blockers) {
  if (blockers.length > 0) {
    return checks
      .filter((check) => check.status === "missing" || check.status === "blocked")
      .slice(0, 6)
      .map((check) => check.fix);
  }

  return [
    "Run the hosted smoke commands from a signed-out browser or judge-like account.",
    "Paste only non-secret testing guidance into Devpost public fields; keep credentials in private testing instructions.",
    "Store screenshots, smoke JSON, support-owner proof, and free-access confirmation in the private Evidence Vault.",
    "Run Claim Guard, Submission Gate, and hosted proof collection after final testing instructions are drafted."
  ];
}

function readPackageJson() {
  try {
    return JSON.parse(readFileSync(resolve("package.json"), "utf8"));
  } catch {
    return {};
  }
}

function env(name) {
  return process.env[name] ?? "";
}

function resolveProductUrl(override) {
  return (
    normalizeOptionalProductUrl(override) ||
    normalizeOptionalProductUrl(env("NEXT_PUBLIC_PRODUCT_URL")) ||
    normalizeOptionalProductUrl(env("VERCEL_PROJECT_PRODUCTION_URL")) ||
    normalizeOptionalProductUrl(env("VERCEL_URL")) ||
    ""
  );
}

function normalizeProductUrl(value, source) {
  const normalized = normalizeOptionalProductUrl(value);
  if (!normalized) {
    throw new Error(`${source} requires a hosted HTTPS product URL.`);
  }

  return normalized;
}

function normalizeOptionalProductUrl(value) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  const candidate = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || !url.hostname || ["localhost", "127.0.0.1"].includes(url.hostname)) {
      return "";
    }

    if (url.username || url.password || url.search || url.hash) {
      throw new Error("Hosted product URL must not include credentials, query strings, or fragments.");
    }

    return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
  } catch (error) {
    if (error instanceof Error && error.message.includes("must not include")) {
      throw error;
    }

    return "";
  }
}

function flag(name) {
  return process.env[name] === "true";
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function isAllowedDemoUrl(value) {
  try {
    const hostname = new URL(value).hostname.replace(/^www\./u, "");
    return ["youtu.be", "youtube.com", "vimeo.com", "youku.com"].includes(hostname);
  } catch {
    return false;
  }
}

function check(input) {
  return input;
}

function smokeCommand(input) {
  return input;
}

function writeJson(path, value) {
  const absolutePath = resolve(path);
  const parentDirectory = dirname(absolutePath);
  assertDirectoryPathSafe(parentDirectory, "Judge access readiness output parent directory");
  mkdirSync(parentDirectory, { recursive: true });
  assertDirectoryExistsSafe(parentDirectory, "Judge access readiness output parent directory");
  writeTextFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "Judge access readiness output file");
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
    throw new Error(`${label} ${resolve(path)} changed while writing; regenerate the private judge access packet in a stable private directory.`);
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
  const report = buildReport(args);

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
