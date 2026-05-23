import packageJson from "@/package.json";
import {
  demoVideoClearanceSummary,
  hasDemoVideoClearance,
  hasJudgeProductAccess,
  judgeProductAccessSummary,
  sentinelConfig
} from "@/lib/config";
import type {
  JudgeAccessCheck,
  JudgeAccessPack,
  JudgeAccessPackStatus,
  JudgeAccessSmokeCommand,
  JudgeAccessWalkthroughStep,
  SubmissionPrivateEvidenceRequest
} from "@/lib/types";

export function buildJudgeAccessPack(): JudgeAccessPack {
  const productUrl = sentinelConfig.productUrl || "missing";
  const repositoryUrl = sentinelConfig.repositoryUrl || packageJson.repository?.url || "missing";
  const demoVideoUrl = sentinelConfig.demoVideoUrl || "missing";
  const checks = buildAccessChecks({ productUrl, repositoryUrl, demoVideoUrl });
  const blockers = checks
    .filter((check) => check.requiredBeforeSubmit && check.status === "missing")
    .map((check) => `${check.label}: ${check.fix}`);
  const reviewItems = checks.filter((check) => check.status === "mock-only");
  const overallStatus: JudgeAccessPackStatus = blockers.length ? "blocked" : reviewItems.length ? "needs-review" : "ready";

  return {
    generatedAt: new Date().toISOString(),
    overallStatus,
    productUrl,
    repositoryUrl,
    demoVideoUrl,
    testingInstructionsSummary: sentinelConfig.judgeTestingInstructions,
    accessChecks: checks,
    walkthrough: buildWalkthrough(productUrl),
    smokeCommands: buildSmokeCommands(productUrl),
    privateCredentialRules: [
      "Do not commit judge usernames, passwords, magic links, admin tokens, OAuth secrets, or customer data.",
      "Provide judge credentials only in Devpost private testing instructions or an approved private channel.",
      "Use a dedicated judge test tenant with seeded or consented data; do not expose live customer findings in the public walkthrough.",
      "Keep the product free and reachable for judges through the judging period before setting the free-access confirmation flag.",
      "If a private login is required, include credential expiry, reset contact, and support response owner outside the repository."
    ],
    evidenceResponsePlan: buildEvidenceResponsePlan(),
    blockers,
    nextActions: buildNextActions(checks, blockers),
    disclaimer:
      "This packet prepares judge access and testing instructions. It does not verify hosted availability, create credentials, or prove access unless a human operator tests the hosted URL and stores private evidence."
  };
}

function buildAccessChecks(input: { productUrl: string; repositoryUrl: string; demoVideoUrl: string }): JudgeAccessCheck[] {
  return [
    check({
      id: "hosted-product-url",
      label: "Hosted product URL",
      status: hasJudgeProductAccess() ? "ready" : "missing",
      evidence: judgeProductAccessSummary(),
      fix: "Deploy the app, verify the hosted URL from a signed-out browser, configure private judge access, and confirm free access through the judging period.",
      ownerRole: "engineering",
      requiredBeforeSubmit: true,
      privateHandling: "Store screenshots or browser-smoke JSON privately; do not include judge credentials in source."
    }),
    check({
      id: "judge-testing-instructions",
      label: "Private judge testing instructions",
      status: sentinelConfig.judgeAccessConfigured ? "private-on-request" : "missing",
      evidence: sentinelConfig.judgeAccessConfigured
        ? "Judge access is marked configured; private instructions must be supplied outside the repository."
        : "XPRIZE_JUDGE_ACCESS_CONFIGURED is not confirmed.",
      fix: "Prepare Devpost private testing instructions with URL, test-account path, demo reset path, expected workflow, support contact, and credential handling notes.",
      ownerRole: "founder",
      requiredBeforeSubmit: true,
      privateHandling: "The dashboard may summarize the path, but real credentials belong only in private Devpost fields or a private channel."
    }),
    check({
      id: "free-judging-period-access",
      label: "Free access through judging",
      status: sentinelConfig.xprizeFreeJudgeAccessThroughJudgingConfirmed ? "ready" : "missing",
      evidence: sentinelConfig.xprizeFreeJudgeAccessThroughJudgingConfirmed
        ? "Free judging-period access flag is confirmed."
        : "XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED is not confirmed.",
      fix: "Confirm the hosted product will remain free and reachable for judges for the full judging period before setting the flag.",
      ownerRole: "founder",
      requiredBeforeSubmit: true,
      privateHandling: "Keep hosting/billing owner, uptime fallback, and support contact in the private access packet."
    }),
    check({
      id: "repository-access",
      label: "Repository access",
      status: input.repositoryUrl === "missing" ? "missing" : "ready",
      evidence: input.repositoryUrl,
      fix: "Publish the repository or share the private repository with judge/testing accounts and keep the URL in package metadata or XPRIZE_REPOSITORY_URL.",
      ownerRole: "engineering",
      requiredBeforeSubmit: true,
      privateHandling: "Do not include private evidence, .env files, invoices, customer findings, or judge credentials in the source repository."
    }),
    check({
      id: "demo-video-access",
      label: "Public demo video access",
      status: hasDemoVideoClearance() ? "ready" : "missing",
      evidence: demoVideoClearanceSummary(),
      fix: "Record and publish the under-three-minute demo, then confirm visibility, duration, English/subtitle status, asset clearance, and customer-data redaction.",
      ownerRole: "sales",
      requiredBeforeSubmit: true,
      privateHandling: "Use redacted or seeded data in the public video; keep customer-specific proof private."
    }),
    check({
      id: "support-and-evidence-response",
      label: "Two-business-day support and evidence response",
      status: "private-on-request",
      evidence: "Private evidence response owner and SLA are represented in the judge access packet.",
      fix: "Assign a human owner who can answer organizer evidence requests within two business days and access the private Evidence Vault.",
      ownerRole: "founder",
      requiredBeforeSubmit: false,
      privateHandling: "Keep the owner's direct contact in private testing instructions, not public source."
    }),
    check({
      id: "demo-reset-and-seeded-data",
      label: "Safe demo reset and seeded data",
      status: "ready",
      evidence: "Dashboard includes reset, low-risk event, high-risk event, HITL remediation, Evidence Vault, Claim Guard, and submission pack controls.",
      fix: "Before final submission, smoke-test the walkthrough from a clean browser session and preserve screenshots privately.",
      ownerRole: "engineering",
      requiredBeforeSubmit: false,
      privateHandling: "Use seeded or consented data only; redact screenshots before sharing outside the private packet."
    })
  ];
}

function buildWalkthrough(productUrl: string): JudgeAccessWalkthroughStep[] {
  const base = productUrl === "missing" ? "https://YOUR-CLOUD-RUN-URL" : productUrl;

  return [
    step({
      id: "open-dashboard",
      label: "Open product dashboard",
      routeOrAction: base,
      expectedResult: "Dashboard loads with Small Business Services positioning, readiness metrics, and rule-boundary copy.",
      proofBoundary: "Shows product experience only; does not prove production Google Cloud or revenue by itself.",
      resetOrSafetyNote: "Use a clean browser profile or signed-out session before recording access proof."
    }),
    step({
      id: "reset-demo",
      label: "Reset seeded demo state",
      routeOrAction: "Click Reset demo",
      expectedResult: "The local demo state returns to the seeded tenant without exposing private customer data.",
      proofBoundary: "Seeded data is demo proof, not customer evidence.",
      resetOrSafetyNote: "Run reset before judge walkthroughs so prior local actions do not confuse the flow."
    }),
    step({
      id: "hybrid-scan",
      label: "Run low-risk and high-risk events",
      routeOrAction: "Click Low-risk skip, then High-risk Drive event",
      expectedResult: "Low-risk event skips Gemini; high-risk event creates deterministic findings and semantic audit evidence.",
      proofBoundary: "Live Gemini proof still requires provider=gemini-api from the hosted deployment.",
      resetOrSafetyNote: "Use seeded fixture text only unless a pilot gave explicit consent."
    }),
    step({
      id: "hitl-remediation",
      label: "Review staged remediation",
      routeOrAction: "Open the newest finding, approve or dismiss, then remediate only if approval exists",
      expectedResult: "Recommendation shows severity, rationale, confidence, blast radius, approver role, and audit trail.",
      proofBoundary: "Human-in-the-loop safety is demonstrated; real Workspace mutation still requires live OAuth and consent.",
      resetOrSafetyNote: "Avoid showing raw file names, customer emails, or private findings in public screenshots."
    }),
    step({
      id: "evidence-surfaces",
      label: "Open evidence and submission controls",
      routeOrAction: "Run Evidence Vault, Claim Guard, Submission Gate, Devpost Pack, Judge Access Pack, and Release Packet",
      expectedResult: "The app separates ready, private-on-request, mock-only, and missing evidence without overclaiming.",
      proofBoundary: "External blockers remain pending until hosted Cloud Run, Gemini, GCP, Workspace, paid-pilot, and demo-video proof exists.",
      resetOrSafetyNote: "Keep full proof JSON, invoices, cost exports, OAuth logs, and support contacts in private storage."
    })
  ];
}

function buildSmokeCommands(productUrl: string): JudgeAccessSmokeCommand[] {
  const base = productUrl === "missing" ? "https://YOUR-CLOUD-RUN-URL" : productUrl;

  return [
    smokeCommand({
      id: "homepage",
      label: "Homepage loads",
      command: `curl -I ${base}/`,
      expectedEvidence: "HTTP 200 or expected redirect to judge-access flow.",
      redactionRequired: false
    }),
    smokeCommand({
      id: "readiness",
      label: "Readiness JSON loads",
      command: `curl -s ${base}/api/readiness`,
      expectedEvidence: "JSON response includes readiness and current blockers.",
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
      id: "judge-access-pack",
      label: "Judge access packet loads",
      command: `curl -s ${base}/api/xprize/judge-access-pack`,
      expectedEvidence: "JSON response lists URL, repository, demo video, private credential rules, and walkthrough.",
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

function buildEvidenceResponsePlan(): SubmissionPrivateEvidenceRequest[] {
  return [
    {
      id: "judge-login-support",
      label: "Judge login and support owner",
      ownerRole: "founder",
      responseSlaHours: 48,
      status: sentinelConfig.judgeAccessConfigured ? "private-on-request" : "missing",
      handling: "Provide test login path, support contact, and credential reset process privately; never commit credentials."
    },
    {
      id: "hosted-url-proof",
      label: "Hosted URL browser proof",
      ownerRole: "engineering",
      responseSlaHours: 48,
      status: hasJudgeProductAccess() ? "private-on-request" : "missing",
      handling: "Capture signed-out browser screenshot and route smoke JSON from the hosted product."
    },
    {
      id: "demo-video-access-proof",
      label: "Public demo video proof",
      ownerRole: "sales",
      responseSlaHours: 48,
      status: hasDemoVideoClearance() ? "private-on-request" : "missing",
      handling: "Store public URL, duration screenshot, visibility proof, subtitle/language confirmation, asset review, and redaction review."
    },
    {
      id: "free-access-proof",
      label: "Free judging-period access proof",
      ownerRole: "founder",
      responseSlaHours: 48,
      status: sentinelConfig.xprizeFreeJudgeAccessThroughJudgingConfirmed ? "private-on-request" : "missing",
      handling: "Store confirmation that hosting, billing, and credentials remain active and free for judges through the judging period."
    }
  ];
}

function buildNextActions(checks: JudgeAccessCheck[], blockers: string[]) {
  if (blockers.length) {
    return checks
      .filter((check) => check.status === "missing")
      .slice(0, 5)
      .map((check) => check.fix);
  }

  return [
    "Smoke-test the hosted URL and judge walkthrough from a signed-out browser.",
    "Paste non-secret testing instructions into Devpost and keep credentials in the private testing field.",
    "Store screenshots, smoke JSON, and support-owner proof in the private Evidence Vault.",
    "Run Claim Guard and Submission Gate after final testing instructions are drafted."
  ];
}

function check(input: JudgeAccessCheck): JudgeAccessCheck {
  return input;
}

function step(input: JudgeAccessWalkthroughStep): JudgeAccessWalkthroughStep {
  return input;
}

function smokeCommand(input: JudgeAccessSmokeCommand): JudgeAccessSmokeCommand {
  return input;
}
