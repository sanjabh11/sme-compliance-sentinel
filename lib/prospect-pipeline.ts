import { makeId, nowIso, sentinelConfig } from "@/lib/config";
import type {
  DashboardSnapshot,
  PilotProspectOutreachStep,
  PilotProspectPipeline,
  PilotProspectPipelineSummary,
  PilotProspectRecord,
  PilotProspectSource,
  PilotProspectStage
} from "@/lib/types";

type ProspectPipelineSnapshot = Pick<
  DashboardSnapshot,
  "pilotProspects" | "pilotRecords" | "trustPackets" | "questionnairePacks"
> & {
  readiness: Pick<DashboardSnapshot["readiness"], "pilotLaunchPlan">;
};

export interface PilotProspectInput {
  id?: string;
  prospectAlias?: string;
  segment?: string;
  source?: PilotProspectSource;
  stage?: PilotProspectStage;
  fitScore?: number;
  estimatedMrrUsd?: number;
  ownerRole?: "founder" | "sales";
  painSignal?: string;
  objection?: string;
  nextAction?: string;
  evidenceNeeded?: string[];
}

const stages: PilotProspectStage[] = [
  "targeted",
  "contacted",
  "demo-scheduled",
  "pilot-proposed",
  "pilot-started",
  "won",
  "lost"
];

const sources: PilotProspectSource[] = ["founder-network", "linkedin", "community", "referral", "inbound", "manual"];

export function buildPilotProspectPipeline(snapshot: ProspectPipelineSnapshot): PilotProspectPipeline {
  const prospects = snapshot.pilotProspects.length ? snapshot.pilotProspects : makeSeedProspects();
  const summary = summarizeProspects(prospects);
  const hasTrustProof = snapshot.trustPackets.length > 0;
  const hasQuestionnaireProof = snapshot.questionnairePacks.some((pack) => pack.status === "exported");
  const launchPlan = snapshot.readiness.pilotLaunchPlan;

  return {
    generatedAt: new Date().toISOString(),
    offer: launchPlan.offer,
    targetSegment: launchPlan.targetSegment,
    summary,
    prospects: [...prospects].sort((a, b) => b.fitScore - a.fitScore).slice(0, 12),
    outreachSequence: buildOutreachSequence({ hasTrustProof, hasQuestionnaireProof }),
    conversionRules: [
      "Only count arms-length customers as XPRIZE revenue proof.",
      "Do not scan live Workspace data before written consent and scope approval.",
      "Treat Trust Packets and questionnaire exports as sales proof, not certification claims.",
      "Move a prospect to pilot-started only after invoice/payment proof and active-user evidence are queued in the Evidence Vault."
    ],
    blockers: [
      ...(sentinelConfig.evidenceMode !== "production" ? ["Prospect pipeline is local planning proof until SENTINEL_EVIDENCE_MODE=production."] : []),
      ...(summary.highFit < 5 ? ["Add at least five high-fit arms-length prospects before outreach week."] : []),
      ...(summary.contacted === 0 ? ["No prospect has been contacted yet."] : []),
      ...(summary.pilotProposed + summary.pilotStarted + summary.won === 0 ? ["No prospect has an active paid-pilot proposal yet."] : []),
      ...(summary.convertedPilots === 0 ? ["No prospect has converted into a live paid pilot in this pipeline yet."] : []),
      ...(hasTrustProof ? [] : ["Create at least one Trust Packet before outbound outreach."]),
      ...(hasQuestionnaireProof ? [] : ["Export at least one questionnaire pack for reusable sales proof."])
    ].slice(0, 8),
    nextActions: [
      "Add five named but redacted high-fit prospects from founder network, LinkedIn, or startup communities.",
      "Send the day-zero outreach with the one-day Workspace risk scan offer.",
      "Create a Trust Packet and questionnaire proof attachment before follow-up.",
      "Move one prospect to pilot-proposed and register required private artifacts in the Evidence Vault.",
      "Convert one arms-length prospect to a paid pilot and replace seeded revenue."
    ],
    disclaimer:
      "Prospect pipeline entries are planning and sales-operations evidence. They are not revenue proof until a real arms-length paid pilot and private artifacts exist."
  };
}

export function normalizePilotProspectInput(input: PilotProspectInput, createdAt = nowIso()): PilotProspectRecord {
  const stage = parseStage(input.stage ?? "targeted");
  const source = parseSource(input.source ?? "manual");
  const fitScore = clampScore(input.fitScore ?? defaultFitScore(stage, source));
  const requestedMrrUsd = Number(input.estimatedMrrUsd ?? 199);
  const estimatedMrrUsd = Number.isFinite(requestedMrrUsd) ? Math.max(0, Math.round(requestedMrrUsd)) : 199;

  return {
    id: input.id ? cleanText(input.id) : makeId("prospect"),
    prospectAlias: cleanText(input.prospectAlias ?? "Redacted high-fit prospect"),
    segment: cleanText(input.segment ?? "Seed-stage B2B SaaS preparing for enterprise security review"),
    source,
    stage,
    fitScore,
    estimatedMrrUsd,
    ownerRole: input.ownerRole === "sales" ? "sales" : "founder",
    painSignal: cleanText(input.painSignal ?? "Prospect is preparing for a customer security review and uses Google Workspace."),
    objection: cleanText(input.objection ?? "Needs assurance that AI will not modify Workspace without approval."),
    nextAction: cleanText(input.nextAction ?? nextActionForStage(stage)),
    evidenceNeeded: normalizeEvidenceNeeded(input.evidenceNeeded),
    createdAt,
    updatedAt: createdAt
  };
}

function makeSeedProspects(): PilotProspectRecord[] {
  const createdAt = "2026-05-22T00:00:00.000Z";

  return [
    normalizeSeedProspect({
      prospectAlias: "Redacted SOC2-bound SaaS founder",
      segment: "Seed-stage B2B SaaS with enterprise procurement request",
      source: "founder-network",
      stage: "targeted",
      fitScore: 92,
      painSignal: "Enterprise buyer asked for security questionnaire, trust artifacts, and Drive data-handling proof.",
      objection: "Concerned about exposing customer files to AI.",
      nextAction: "Send one-day scan offer and data-minimization proof.",
      createdAt
    }),
    normalizeSeedProspect({
      prospectAlias: "Redacted agency operator",
      segment: "Small agency sharing client proposals in Google Drive",
      source: "community",
      stage: "contacted",
      fitScore: 86,
      painSignal: "Public proposal links and client folders create review risk.",
      objection: "Needs a simple owner-review workflow, not a broad GRC rollout.",
      nextAction: "Offer a fixed-scope Drive sharing scan.",
      createdAt
    }),
    normalizeSeedProspect({
      prospectAlias: "Redacted fractional CTO",
      segment: "Fractional CTO managing several startup Workspace tenants",
      source: "referral",
      stage: "targeted",
      fitScore: 84,
      painSignal: "Needs repeatable security-review prep across multiple small clients.",
      objection: "Wants proof the tool will not create noisy false positives.",
      nextAction: "Show HITL remediation and false-positive workflow.",
      createdAt
    }),
    normalizeSeedProspect({
      prospectAlias: "Redacted consulting studio",
      segment: "Consulting studio selling to regulated customers",
      source: "linkedin",
      stage: "targeted",
      fitScore: 79,
      painSignal: "Needs Trust Packet and questionnaire responses before procurement calls.",
      objection: "Has no time for a full compliance platform implementation.",
      nextAction: "Lead with one-day trust proof package.",
      createdAt
    })
  ];
}

function normalizeSeedProspect(input: PilotProspectInput & { createdAt: string }) {
  return normalizePilotProspectInput(input, input.createdAt);
}

function summarizeProspects(prospects: PilotProspectRecord[]): PilotProspectPipelineSummary {
  const activeStages: PilotProspectStage[] = ["targeted", "contacted", "demo-scheduled", "pilot-proposed", "pilot-started"];
  const proposedPilots = prospects.filter((prospect) =>
    ["pilot-proposed", "pilot-started", "won"].includes(prospect.stage)
  ).length;
  const convertedPilots = prospects.filter((prospect) => ["pilot-started", "won"].includes(prospect.stage)).length;

  return {
    total: prospects.length,
    targeted: countStage(prospects, "targeted"),
    contacted: countStage(prospects, "contacted"),
    demoScheduled: countStage(prospects, "demo-scheduled"),
    pilotProposed: countStage(prospects, "pilot-proposed"),
    pilotStarted: countStage(prospects, "pilot-started"),
    won: countStage(prospects, "won"),
    lost: countStage(prospects, "lost"),
    highFit: prospects.filter((prospect) => prospect.fitScore >= 80).length,
    activeOpportunities: prospects.filter((prospect) => activeStages.includes(prospect.stage)).length,
    proposedPilots,
    convertedPilots,
    estimatedPipelineMrrUsd: prospects
      .filter((prospect) => activeStages.includes(prospect.stage))
      .reduce((total, prospect) => total + prospect.estimatedMrrUsd, 0),
    expectedPipelineMrrUsd: prospects
      .filter((prospect) => prospect.stage !== "lost")
      .reduce((total, prospect) => total + prospect.estimatedMrrUsd * probabilityForStage(prospect.stage), 0)
  };
}

function buildOutreachSequence(input: { hasTrustProof: boolean; hasQuestionnaireProof: boolean }): PilotProspectOutreachStep[] {
  return [
    {
      day: 0,
      channel: "email",
      targetSegment: "Seed-stage SaaS founder with an enterprise security review blocker",
      subject: "One-day Google Workspace risk scan before your next security review",
      body:
        "We help seed-stage teams find risky Drive/Gmail exposure, approve fixes with a human in the loop, and leave with a redacted SOC2 readiness evidence packet.",
      proofAttachments: input.hasTrustProof ? ["Redacted Trust Packet", "One-day pilot scope"] : ["One-page trust proof summary"],
      followUpAfterDays: 2,
      claimBoundary: "Readiness evidence only; no certification, legal, or audit assurance claim."
    },
    {
      day: 2,
      channel: "linkedin",
      targetSegment: "Founder-led agency sharing client proposals through Google Drive",
      subject: "Follow-up on Workspace risk proof",
      body:
        "If a customer security review is blocking a deal, we can run a fixed-scope scan and show exactly what was inspected, skipped, approved, and remediated.",
      proofAttachments: input.hasQuestionnaireProof ? ["Questionnaire response excerpt"] : ["HITL remediation screenshot"],
      followUpAfterDays: 3,
      claimBoundary: "Describe risks detected and approved remediation logs; do not claim guaranteed outcomes."
    },
    {
      day: 5,
      channel: "intro",
      targetSegment: "Fractional CTO or security advisor managing several Workspace tenants",
      subject: "Pilot scope and consent",
      body:
        "The pilot is scoped to consented Workspace data and does not change access without admin approval. We provide private evidence for invoices, user proof, and remediation logs.",
      proofAttachments: ["Pilot launch plan", "Evidence Vault checklist"],
      followUpAfterDays: 4,
      claimBoundary: "Only count revenue after arms-length payment proof and active-user evidence exist."
    }
  ];
}

function countStage(prospects: PilotProspectRecord[], stage: PilotProspectStage) {
  return prospects.filter((prospect) => prospect.stage === stage).length;
}

function probabilityForStage(stage: PilotProspectStage) {
  switch (stage) {
    case "won":
      return 1;
    case "pilot-started":
      return 0.8;
    case "pilot-proposed":
      return 0.55;
    case "demo-scheduled":
      return 0.35;
    case "contacted":
      return 0.18;
    case "targeted":
      return 0.08;
    case "lost":
      return 0;
    default:
      return 0;
  }
}

function parseStage(stage: PilotProspectStage) {
  if (!stages.includes(stage)) {
    throw new Error("Unsupported prospect stage.");
  }

  return stage;
}

function parseSource(source: PilotProspectSource) {
  if (!sources.includes(source)) {
    throw new Error("Unsupported prospect source.");
  }

  return source;
}

function defaultFitScore(stage: PilotProspectStage, source: PilotProspectSource) {
  const stageBoost = stage === "pilot-proposed" || stage === "pilot-started" ? 12 : stage === "demo-scheduled" ? 8 : 0;
  const sourceBoost = source === "referral" || source === "founder-network" ? 8 : source === "inbound" ? 5 : 0;
  return clampScore(65 + stageBoost + sourceBoost);
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

function nextActionForStage(stage: PilotProspectStage) {
  switch (stage) {
    case "targeted":
      return "Send day-zero outreach with the one-day risk scan offer.";
    case "contacted":
      return "Send proof-backed follow-up and request a 20-minute scope call.";
    case "demo-scheduled":
      return "Prepare Trust Packet, launch plan, and consent boundaries for the call.";
    case "pilot-proposed":
      return "Collect consent, invoice/payment proof, and Workspace install requirements.";
    case "pilot-started":
      return "Run scan, approve remediation, and attach Evidence Vault artifacts.";
    case "won":
      return "Convert to active pilot record and private judge evidence.";
    case "lost":
      return "Record loss reason and refine target criteria.";
    default:
      return "Assign next action.";
  }
}

function normalizeEvidenceNeeded(input?: string[]) {
  const defaults = ["Pilot consent", "Trust Packet", "Invoice/payment proof", "Active-user proof"];
  const values = input?.length ? input : defaults;
  return values.map((item) => cleanText(item)).slice(0, 8);
}

function cleanText(value: string) {
  const cleaned = value.trim();
  if (!cleaned) {
    throw new Error("Prospect fields cannot be empty.");
  }

  return cleaned.slice(0, 700);
}
