import { sentinelConfig } from "@/lib/config";
import { buildMarketPositioningCommandCenter } from "@/lib/market-positioning";
import type {
  DashboardSnapshot,
  MvpFeatureMaturity,
  MvpGapFix,
  MvpOutreachPlan,
  MvpOutreachStatus,
  MvpOutreachStep
} from "@/lib/types";

const sourceUrls = [
  "https://www.geminixprize.com/rules",
  "https://vercel.com/docs/frameworks/full-stack/nextjs",
  "https://vercel.com/docs/environment-variables",
  "https://www.vanta.com/",
  "https://drata.com/products",
  "https://secureframe.com/"
];

export function buildMvpOutreachPlan(snapshot: DashboardSnapshot, options: { productUrl?: string } = {}): MvpOutreachPlan {
  const market = buildMarketPositioningCommandCenter(snapshot);
  const hostedUrl = options.productUrl ?? sentinelConfig.productUrl;
  const leadFeatures = buildLeadFeatures(snapshot);
  const gapFixes = buildGapFixes(snapshot, Boolean(hostedUrl));
  const readinessScore = calculateReadinessScore(leadFeatures, gapFixes, Boolean(hostedUrl));
  const status = resolveStatus(readinessScore, Boolean(hostedUrl), gapFixes);

  return {
    generatedAt: new Date().toISOString(),
    status,
    headline: "One-day Google Workspace risk scan that turns security gaps into buyer-ready trust evidence.",
    targetSegment: market.targetSegment,
    primaryOffer: snapshot.readiness.pilotLaunchPlan.offer,
    hostedUrl,
    hostedUrlStatus: hostedUrl ? "configured" : "missing",
    readinessScore,
    leadFeatures,
    gapFixes,
    outreachSteps: buildOutreachSteps(snapshot),
    demoPath: [
      "Start with a high-risk Drive event and show Tier 0/Tier 1 filtering before Gemini is considered.",
      "Open the staged recommendation and point to confidence, rationale, approver, SLA, and blast-radius fields.",
      "Approve or dismiss the recommendation to demonstrate human-in-the-loop control.",
      "Generate a Trust Packet or questionnaire response pack as the buyer-facing artifact.",
      "Open Evidence Copilot and ask which proof supports Workspace risk detection; show citations.",
      "End in the financial ledger and Evidence Vault, explicitly separating local demo records from real customer proof."
    ],
    manualInterventions: buildManualInterventions(Boolean(hostedUrl)),
    adversarialRisks: [
      "Broad compliance automation is an incumbent game; the outreach wedge must stay Workspace-first and one-day.",
      "A polished local demo is not enough for XPRIZE business viability; paid pilot artifacts remain the critical external proof.",
      "Autonomous remediation weakens buyer trust; keep non-trivial actions staged for approval.",
      "Do not claim SOC2 certification, audit assurance, legal advice, or guaranteed deal acceleration.",
      "Vercel proves web availability for outreach, not Google Cloud product evidence; Cloud Run/Gemini proof remains a separate XPRIZE track."
    ],
    sourceUrls,
    proofBoundary:
      "This plan packages current MVP capability for outreach. It does not create customer consent, revenue, production Workspace access, hosted Gemini proof, Google Cloud proof, legal clearance, certification, or judge approval.",
    disclaimer:
      "Use this as an outreach and MVP operating plan only. Replace mock/local proof with private, consented customer evidence before making revenue, user, production, or XPRIZE proof claims."
  };
}

function buildLeadFeatures(snapshot: DashboardSnapshot): MvpFeatureMaturity[] {
  const hasScan = snapshot.findings.length > 0 && snapshot.agentRuns.length > 0;
  const hasRemediation = snapshot.remediations.length > 0;
  const hasTrustPacket = snapshot.trustPackets.length > 0;
  const hasQuestionnaire = snapshot.questionnairePacks.length > 0;
  const copilotReady = true;

  return [
    feature({
      rank: 1,
      feature: "One-day Workspace Risk Scan",
      buyerAngle: "Know what is exposed before an enterprise buyer asks.",
      currentEvidence: `${snapshot.aggregateCounters.filesInspected} file(s) inspected, ${snapshot.findings.length} finding(s), ${snapshot.agentRuns.length} agent run(s).`,
      maturity: hasScan ? 4 : 3,
      leadWith: true,
      gap: hasScan ? "Live consented Workspace proof remains pending." : "Run the high-risk demo event before buyer demos.",
      nextAction: "Lead outreach with the fixed-scope $199 scan and show the mock high-risk event in the first demo."
    }),
    feature({
      rank: 2,
      feature: "Trust Packet and Evidence Export",
      buyerAngle: "Share security proof without exposing private findings.",
      currentEvidence: `${snapshot.trustPackets.length} Trust Packet(s), ${snapshot.readiness.evidenceVault.requiredArtifacts.length} Evidence Vault slot(s).`,
      maturity: hasTrustPacket ? 4 : 3,
      leadWith: true,
      gap: hasTrustPacket ? "Hosted packet analytics and customer artifacts are pending." : "Generate one redacted packet before outreach calls.",
      nextAction: "Use the Trust Packet as the proof attachment after a scope call."
    }),
    feature({
      rank: 3,
      feature: "Human-Approved AI Remediation",
      buyerAngle: "No AI changes Workspace permissions without approval.",
      currentEvidence: `${snapshot.findings.filter((finding) => finding.approval.status !== "not_required").length} staged approval item(s), ${snapshot.remediations.length} remediation record(s).`,
      maturity: hasRemediation ? 4 : 3,
      leadWith: true,
      gap: hasRemediation ? "Production identity and notification delivery are pending." : "Approve one staged demo recommendation before recording demos.",
      nextAction: "Make HITL the trust differentiator in every outreach message."
    }),
    feature({
      rank: 4,
      feature: "Questionnaire Response Packs",
      buyerAngle: "Stop rewriting the same security answers for every prospect.",
      currentEvidence: `${snapshot.questionnairePacks.length} questionnaire pack(s), ${snapshot.answerLibrary.length} reusable answer(s).`,
      maturity: hasQuestionnaire ? 4 : 3,
      leadWith: true,
      gap: hasQuestionnaire ? "Original binary file ingestion is still a later adapter." : "Export one sample questionnaire pack for the demo path.",
      nextAction: "Use questionnaire acceleration as the second outreach hook after the risk scan."
    }),
    feature({
      rank: 5,
      feature: "Evidence Copilot",
      buyerAngle: "Ask what proof exists and get cited answers.",
      currentEvidence: "Local deterministic cited retrieval, synthesis, metrics, and document intake APIs are implemented.",
      maturity: copilotReady ? 4 : 2,
      leadWith: true,
      gap: "Gemini File Search and live customer evidence indexing remain future production adapters.",
      nextAction: "Use cited answers as the high-signal demo moment after evidence is generated."
    }),
    feature({
      rank: 6,
      feature: "Claim Guard",
      buyerAngle: "Keeps marketing and security-review language honest.",
      currentEvidence: `${snapshot.readiness.claimGuard.violations.length} current claim violation(s).`,
      maturity: snapshot.readiness.claimGuard.violations.length ? 3 : 5,
      leadWith: true,
      gap: "Final outreach copy still needs a quick Claim Guard pass before sending.",
      nextAction: "Run Claim Guard on every website, email, and Devpost text change."
    }),
    feature({
      rank: 7,
      feature: "Financial Evidence Ledger",
      buyerAngle: "Capture the numbers that prove paid pilot traction.",
      currentEvidence: `${snapshot.readiness.financialEvidence.summary.verified} verified, ${snapshot.readiness.financialEvidence.summary.missing} missing, ${snapshot.readiness.financialEvidence.summary["mock-only"]} mock-only item(s).`,
      maturity: snapshot.readiness.financialEvidence.summary.verified > 0 ? 4 : 3,
      leadWith: false,
      gap: "Real invoice, payment, user, cost, CAC, and consent artifacts are external proof.",
      nextAction: "Use it internally to run founder/sales operations; do not lead public outreach with revenue claims yet."
    })
  ];
}

function feature(input: MvpFeatureMaturity): MvpFeatureMaturity {
  return input;
}

function buildGapFixes(snapshot: DashboardSnapshot, hasHostedUrl: boolean): MvpGapFix[] {
  const conversionKit = snapshot.readiness.pilotConversionKit;
  const hasOutreachAsset = conversionKit.closeAssets.some((asset) => asset.id === "founder-email" && asset.status === "ready");
  const hasTarget = Boolean(conversionKit.targetProspect);

  return [
    gap({
      priority: 5,
      gap: "Hosted Vercel URL for outreach demos",
      bucket: "code-controllable",
      owner: "engineering",
      status: hasHostedUrl ? "done" : "next",
      fix: "Deploy the current Next.js app to Vercel and use the generated URL for immediate outreach demos.",
      successCheck: "Vercel deployment returns HTTP 200 and `/api/mvp/outreach-plan` reports hostedUrlStatus=configured."
    }),
    gap({
      priority: 5,
      gap: "Buyer-facing MVP narrative",
      bucket: "code-controllable",
      owner: "engineering",
      status: "done",
      fix: "Lead with the one-day Workspace risk scan and keep broad compliance automation secondary.",
      successCheck: "MVP Outreach Plan returns headline, lead features, outreach steps, demo path, and claim boundaries."
    }),
    gap({
      priority: 5,
      gap: "First arms-length paid pilot",
      bucket: "external-proof",
      owner: "founder/sales",
      status: "external-required",
      fix: "Use the conversion kit to send founder outreach, collect consent, invoice, payment, active-user, and testimonial-consent artifacts.",
      successCheck: "Business evidence verifier has at least one private arms-length paid pilot artifact set."
    }),
    gap({
      priority: 4,
      gap: "Outreach asset readiness",
      bucket: "code-controllable",
      owner: "engineering",
      status: hasOutreachAsset && hasTarget ? "done" : "next",
      fix: "Keep founder email, scope-call script, proposal, consent boundary, and invoice checklist available from the conversion kit.",
      successCheck: "Conversion kit has a target prospect and ready founder-email asset."
    }),
    gap({
      priority: 4,
      gap: "Production Workspace proof",
      bucket: "external-proof",
      owner: "engineering",
      status: "external-required",
      fix: "After signed consent, configure OAuth and run a live Workspace scan with private proof capture.",
      successCheck: "Workspace sync status is not mock and Evidence Vault contains redacted OAuth/sync proof."
    }),
    gap({
      priority: 4,
      gap: "Final public claim review",
      bucket: "human-attestation",
      owner: "founder/legal",
      status: "human-review",
      fix: "Review outreach copy, demo assets, licensing, screenshots, and customer-data redaction before public promotion.",
      successCheck: "Claim Guard is clean and human review flags are set only after matching private evidence exists."
    })
  ];
}

function gap(input: MvpGapFix): MvpGapFix {
  return input;
}

function buildOutreachSteps(snapshot: DashboardSnapshot): MvpOutreachStep[] {
  const conversionKit = snapshot.readiness.pilotConversionKit;
  const founderEmail = conversionKit.closeAssets.find((asset) => asset.id === "founder-email");
  const proposal = conversionKit.closeAssets.find((asset) => asset.id === "pilot-proposal");
  const consent = conversionKit.closeAssets.find((asset) => asset.id === "consent-clause");
  const scopeCall = conversionKit.closeAssets.find((asset) => asset.id === "scope-call");

  return [
    step({
      day: 0,
      channel: "email",
      subject: "One-day Google Workspace risk scan before your next buyer review",
      copy:
        founderEmail?.copy ??
        "We run a fixed-scope Google Workspace risk scan, stage any recommendation for approval, and leave you with a redacted SOC2 readiness evidence packet for your buyer conversation.",
      proofToAttach: ["One-page scope", "Claim-safe Trust Packet sample", "Consent boundary"],
      claimBoundary: founderEmail?.claimBoundary ?? "Readiness evidence only; no certification, legal, audit, or guaranteed buyer outcome claim.",
      nextAction: "Send to the highest-fit arms-length prospect and request a 20-minute scope call."
    }),
    step({
      day: 1,
      channel: "call",
      subject: "Scope the one-day scan",
      copy: scopeCall?.copy ?? "Confirm buyer deadline, Workspace sources, excluded content, approval owner, and success criteria.",
      proofToAttach: ["Consent packet", "Allowed/excluded data source list"],
      claimBoundary: scopeCall?.claimBoundary ?? "Define exactly what is scanned and what remains out of scope.",
      nextAction: "Collect written consent before any live Workspace OAuth access."
    }),
    step({
      day: 2,
      channel: "demo",
      subject: "Show the scan-to-trust-proof loop",
      copy: proposal?.copy ?? "Demo the scanner, HITL recommendation, Trust Packet, questionnaire pack, and Evidence Copilot citations.",
      proofToAttach: ["Redacted demo evidence export", "Trust Packet sample", "Questionnaire response sample"],
      claimBoundary: proposal?.claimBoundary ?? "Operational deliverables only; no compliance certification promise.",
      nextAction: "Send the fixed-scope proposal and invoice."
    }),
    step({
      day: 3,
      channel: "follow-up",
      subject: "Consent, invoice, and evidence checklist",
      copy:
        consent?.copy ??
        "Customer authorizes a fixed-scope review of agreed Google Workspace resources; raw files, secrets, invoices, and findings stay private unless explicitly consented.",
      proofToAttach: ["Invoice checklist", "Evidence Vault artifact checklist", "Data redaction rules"],
      claimBoundary: consent?.claimBoundary ?? "Consent text is operational and must be reviewed by the responsible owner before use.",
      nextAction: "Register consent, invoice, payment, active-user, and cost/CAC proof privately."
    })
  ];
}

function step(input: MvpOutreachStep): MvpOutreachStep {
  return input;
}

function buildManualInterventions(hasHostedUrl: boolean) {
  return [
    ...(hasHostedUrl ? [] : ["Deploy to Vercel and record the generated URL for outreach demos."]),
    "Pick one high-fit arms-length prospect and send the founder email.",
    "Collect signed consent before live Workspace OAuth.",
    "Collect invoice/payment, active-user, cost/CAC, and testimonial-consent proof for any counted pilot.",
    "Run Claim Guard on public copy before sharing it beyond private pilots."
  ];
}

function calculateReadinessScore(features: MvpFeatureMaturity[], gaps: MvpGapFix[], hasHostedUrl: boolean) {
  const leadScore = features
    .filter((featureItem) => featureItem.leadWith)
    .reduce((total, featureItem) => total + featureItem.maturity, 0);
  const leadCount = features.filter((featureItem) => featureItem.leadWith).length || 1;
  const codeGapsOpen = gaps.filter((item) => item.bucket === "code-controllable" && item.status !== "done").length;
  const hostedPenalty = hasHostedUrl ? 0 : 10;
  const score = Math.round((leadScore / (leadCount * 5)) * 100) - codeGapsOpen * 8 - hostedPenalty;

  return Math.max(0, Math.min(100, score));
}

function resolveStatus(readinessScore: number, hasHostedUrl: boolean, gaps: MvpGapFix[]): MvpOutreachStatus {
  if (!hasHostedUrl) {
    return "needs-deployment";
  }

  if (gaps.some((item) => item.bucket === "code-controllable" && item.status !== "done")) {
    return "blocked";
  }

  if (readinessScore >= 70) {
    return "ready-for-outreach";
  }

  return "needs-customer-proof";
}
