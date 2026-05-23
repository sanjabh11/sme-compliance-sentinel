import { sentinelConfig } from "@/lib/config";
import type {
  CompetitorPositioningItem,
  DashboardSnapshot,
  MarketDifferentiator,
  MarketPositioningCommandCenter,
  MarketPositioningStatus
} from "@/lib/types";

type MarketSnapshot = Pick<
  DashboardSnapshot,
  | "tenant"
  | "agentRuns"
  | "findings"
  | "remediations"
  | "pilotRecords"
  | "pilotProspects"
  | "trustPackets"
  | "questionnairePacks"
  | "aggregateCounters"
  | "syncState"
>;

const sourceUrls = [
  "https://www.vanta.com/",
  "https://drata.com/products",
  "https://secureframe.com/"
];

export function buildMarketPositioningCommandCenter(snapshot: MarketSnapshot): MarketPositioningCommandCenter {
  const topDifferentiators = buildDifferentiators(snapshot);
  const parityGaps = buildParityGaps(snapshot);
  const competitorComparisons = buildCompetitorComparisons(snapshot);
  const implemented = topDifferentiators.filter((item) => item.status === "implemented").length;
  const partial = topDifferentiators.filter((item) => item.status === "partial").length;
  const blockingParityGaps = parityGaps.filter((item) => item.status !== "implemented").length;
  const wedgeScore = Math.max(
    0,
    Math.min(100, Math.round(((implemented * 18 + partial * 10) / (topDifferentiators.length * 18)) * 100) - blockingParityGaps * 4)
  );
  const overallStatus = resolveMarketStatus(wedgeScore, snapshot);

  return {
    generatedAt: new Date().toISOString(),
    overallStatus,
    targetSegment: "Seed-stage B2B SaaS and founder-led services teams using Google Workspace before their first enterprise security review.",
    usp:
      "A one-day Google Workspace risk scan that turns risky sharing and sensitive-data exposure into SOC2 readiness evidence, Trust Packets, questionnaire answers, and XPRIZE business proof.",
    wedgeScore,
    competitorComparisons,
    topDifferentiators,
    parityGaps,
    pricingHypothesis:
      "$199 one-day paid scan for the first proof event, then $49-$199/month evidence-room subscription based on tenant size and review volume.",
    buyerNarrative: [
      "Vanta, Drata, and Secureframe are broad trust/compliance platforms; Sentinel should not fight them head-on.",
      "Sentinel wins the hackathon wedge by being narrower, faster to demo, and more founder-operational: one Workspace tenant, one risky exposure, one human-approved fix, one trust packet, one revenue proof trail.",
      "The sales promise is not certification. The promise is that a small team can find deal-blocking Workspace risks and produce buyer-readable readiness evidence in a day.",
      "The proof story must show a before/after workflow, not a static compliance dashboard."
    ],
    proofActions: buildProofActions(snapshot),
    marketRisks: [
      "Incumbents already offer broad compliance automation, trust centers, questionnaire automation, risk management, and large integration libraries.",
      "A narrow Workspace-first wedge can look too small unless the demo ties it directly to paid pilots and enterprise deal acceleration.",
      "Without production Workspace OAuth and real customer proof, the product reads as a polished prototype rather than a business.",
      "Certification, audit, or legal wording would weaken trust and create avoidable submission risk.",
      "Pricing must stay founder-friendly; a broad GRC price story would undercut the small-business category fit."
    ],
    sources: sourceUrls,
    disclaimer:
      "This battlecard is a market-positioning aid based on public competitor positioning and current local product evidence. It does not guarantee market adoption, revenue, compliance, certification, or hackathon placement."
  };
}

function buildCompetitorComparisons(snapshot: MarketSnapshot): CompetitorPositioningItem[] {
  const operationalProof = operationalProofSummary(snapshot);
  const businessProof = businessProofSummary(snapshot);

  return [
    {
      name: "Vanta",
      sourceUrl: "https://www.vanta.com/",
      publicPositioning:
        "Broad trust platform covering compliance, risk, audit prep, questionnaire automation, Trust Center, AI, and many integrations.",
      incumbentStrength:
        "Strongest apparent breadth: frameworks, automation, trust center, questionnaire automation, customer proof, and startup-to-enterprise positioning.",
      sentinelCounterPosition:
        "Do not compete as a full GRC suite. Win as the one-day Workspace risk-to-trust proof desk for small teams that need a buyer-ready evidence packet fast.",
      sentinelCurrentProof: operationalProof,
      gapToClose: "Add production Workspace OAuth, live Gemini logs, hosted Trust Packet links, and arms-length paid pilot proof.",
      wedgeScore: snapshot.agentRuns.length && snapshot.trustPackets.length ? 78 : 58
    },
    {
      name: "Drata",
      sourceUrl: "https://drata.com/products",
      publicPositioning:
        "Agentic trust management platform for governance, risk, compliance, assurance, trust center, AI questionnaire assistance, and integrations.",
      incumbentStrength:
        "Strong AI and governance narrative with cross-framework operations and sales-cycle assurance positioning.",
      sentinelCounterPosition:
        "Show an end-to-end AI operation that is concrete and inspectable: event filter, Gemini explanation, staged approval, remediation audit, and submission evidence.",
      sentinelCurrentProof: operationalProof,
      gapToClose: "Run the same loop in production with Cloud Run, Google Cloud persistence, and live Workspace sync.",
      wedgeScore: snapshot.remediations.length ? 80 : 62
    },
    {
      name: "Secureframe",
      sourceUrl: "https://secureframe.com/",
      publicPositioning:
        "Compliance automation platform for trust, AI-powered compliance tasks, readiness reports, questionnaire automation, continuous monitoring, and risk remediation.",
      incumbentStrength:
        "Strong small-business and framework breadth story with compliance resources, support, and continuous monitoring.",
      sentinelCounterPosition:
        "Lean into small-business speed and specificity: Google Workspace risk scan, prospect-safe packet, questionnaire answers, and evidence vault in a single day.",
      sentinelCurrentProof: businessProof,
      gapToClose: "Replace local seeded pilots with real paid pilot artifacts and hosted customer-facing packet analytics.",
      wedgeScore: snapshot.pilotRecords.length && snapshot.questionnairePacks.length ? 74 : 55
    }
  ];
}

function buildDifferentiators(snapshot: MarketSnapshot): MarketDifferentiator[] {
  return [
    {
      label: "Workspace-first risk-to-trust workflow",
      status: snapshot.aggregateCounters.filesInspected > 0 || snapshot.findings.length > 0 ? "implemented" : "partial",
      whyItMatters: "A narrow Workspace wedge is easier for small teams to buy and easier for judges to understand quickly.",
      proofSurface: "Mock Workspace event flow, hybrid scanner counters, findings, remediations, and Evidence Room.",
      nextProof: "Run the flow against a live consented Workspace pilot."
    },
    {
      label: "Human-in-the-loop remediation by default",
      status: "implemented",
      whyItMatters: "Security buyers need control before AI mutates permissions or notifies owners.",
      proofSurface: "Staged recommendations, approval operations, remediation records, and audit events.",
      nextProof: "Connect production identity and notification delivery."
    },
    {
      label: "Cost-aware Gemini usage",
      status: "implemented",
      whyItMatters: "SMEs need predictable margins and data minimization before they trust AI scanning.",
      proofSurface: "Tier 0/Tier 1/Tier 2 scanner, model allowlist, budget gates, and byte counters.",
      nextProof: "Attach Cloud Billing budget, Gemini quota, and API-key restriction evidence."
    },
    {
      label: "Evidence Room built for the hackathon business mandate",
      status: snapshot.pilotRecords.length ? "implemented" : "partial",
      whyItMatters: "Judges need revenue, user, cost, CAC, consent, and production proof separated from demo data.",
      proofSurface: "Financial ledger, Evidence Vault, submission binder, Devpost pack, and launch command center.",
      nextProof: "Replace seeded data with private real customer artifacts."
    },
    {
      label: "Trust Packet plus questionnaire response loop",
      status: snapshot.questionnairePacks.length || snapshot.trustPackets.length ? "implemented" : "partial",
      whyItMatters: "The buyer value is not only finding risk; it is accelerating security review conversations.",
      proofSurface: "Trust Center, packet access, questionnaire packs, answer library, and deal-impact report.",
      nextProof: "Create hosted packet links for real prospects and persist access analytics."
    }
  ];
}

function buildParityGaps(snapshot: MarketSnapshot): MarketDifferentiator[] {
  return [
    {
      label: "Production OAuth and continuous monitoring",
      status: snapshot.syncState.mode === "mock" ? "missing" : "implemented",
      whyItMatters: "Incumbents compete on continuous monitoring and integrations; a demo-only sync path is not enough.",
      proofSurface: "Workspace sync reliability panel and launch-readiness workstream.",
      nextProof: "Install OAuth for a pilot and run live Drive/Gmail reconciliation."
    },
    {
      label: "Live customer traction",
      status: sentinelConfig.evidenceMode === "production" ? "partial" : "missing",
      whyItMatters: "Business viability is the core XPRIZE differentiator and the hardest gap to fake honestly.",
      proofSurface: "Pilot CRM, prospect pipeline, financial ledger, and Evidence Vault.",
      nextProof: "Convert one arms-length prospect into a paid pilot with invoice, user, cost, CAC, and consent proof."
    },
    {
      label: "Broad integration ecosystem",
      status: "missing",
      whyItMatters: "Vanta and Drata publicly emphasize large integration ecosystems; Sentinel must either integrate or stay deliberately narrow.",
      proofSurface: "Workspace-only product scope and Google Cloud/Workspace APIs.",
      nextProof: "Keep the wedge narrow for the hackathon, then add Slack/Jira/GitHub only after Workspace proof converts."
    },
    {
      label: "Auditor/service-provider network",
      status: "missing",
      whyItMatters: "Incumbents sell services, audit prep, and partner access; Sentinel currently sells operational readiness only.",
      proofSurface: "Framework evidence packs and Trust Center Lite.",
      nextProof: "Add partner/auditor referral workflow only after the paid pilot wedge works."
    }
  ];
}

function buildProofActions(snapshot: MarketSnapshot) {
  return [
    "Lead the demo with the one-day Workspace risk scan, not generic compliance automation.",
    "Show the scanner skipping low-risk events before Gemini to make the data-minimization and margin story credible.",
    "Show one staged recommendation and one human approval before any remediation claim.",
    "Open the Evidence Room and explicitly label seeded records as local proof only.",
    "Use the competitor battlecard to explain why Sentinel is narrower than Vanta, Drata, and Secureframe instead of pretending to replace them.",
    ...(snapshot.trustPackets.length ? [] : ["Create one redacted Trust Packet before recording the final demo."]),
    ...(snapshot.questionnairePacks.length ? [] : ["Export one questionnaire response pack to prove the security-review acceleration loop."]),
    ...(sentinelConfig.evidenceMode === "production"
      ? []
      : ["Convert one arms-length pilot and attach private revenue/user/cost/consent proof before final submission."])
  ];
}

function operationalProofSummary(snapshot: MarketSnapshot) {
  return `${snapshot.agentRuns.length} agent run(s), ${snapshot.findings.length} finding(s), ${snapshot.remediations.length} remediation record(s), ${snapshot.aggregateCounters.filesInspected} file(s) inspected.`;
}

function businessProofSummary(snapshot: MarketSnapshot) {
  return `${snapshot.pilotRecords.length} pilot record(s), ${snapshot.pilotProspects.length} prospect(s), ${snapshot.trustPackets.length} Trust Packet(s), ${snapshot.questionnairePacks.length} questionnaire pack(s).`;
}

function resolveMarketStatus(score: number, snapshot: MarketSnapshot): MarketPositioningStatus {
  if (score < 55) {
    return "behind-incumbents";
  }

  if (sentinelConfig.evidenceMode !== "production" || snapshot.syncState.mode === "mock") {
    return "needs-proof";
  }

  return "strong";
}
