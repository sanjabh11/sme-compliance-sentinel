import type { DashboardSnapshot, StrategyFeature, StrategyGap, StrategyLoophole, StrategySnapshot } from "@/lib/types";

type StrategyFeatureScore = Pick<
  StrategyFeature,
  "marketabilityScore" | "winningLeverageScore" | "sellabilityScore" | "proofStatus" | "scoreReason"
>;

type RawStrategyFeature = Omit<
  StrategyFeature,
  "marketabilityScore" | "winningLeverageScore" | "sellabilityScore" | "totalScore" | "proofStatus" | "scoreReason"
>;

const rawTopFeatures: RawStrategyFeature[] = [
  {
    rank: 1,
    name: "One-day Paid Workspace Risk Scan Launch Plan + Consent Packet",
    marketSignal: "Seed-stage SaaS teams need rapid security review readiness before enterprise deals.",
    winSignal: "Creates a clear buyer offer, day-one workflow, before/after demo, and measurable category impact.",
    currentState: "partial",
    nextFix: "Use real Google OAuth credentials, collect signed consent packets, initialize Drive/Gmail cursors, register private proof artifacts, and prove live reconciliation."
  },
  {
    rank: 2,
    name: "Human-in-the-Loop Remediation",
    marketSignal: "Security buyers distrust autonomous fixes without approval.",
    winSignal: "Shows AI operating production workflows while controlling false-positive risk.",
    currentState: "implemented",
    nextFix: "Connect the local RBAC/notification queue to production identity and delivery channels."
  },
  {
    rank: 3,
    name: "SOC2 Readiness Evidence Export",
    marketSignal: "Startups buy tools that help unblock vendor reviews and audits.",
    winSignal: "Directly maps to XPRIZE evidence requirements and business viability.",
    currentState: "implemented",
    nextFix: "Configure production HMAC signing and generate the final sealed packet from the hosted judge/customer evidence flow."
  },
  {
    rank: 4,
    name: "Trust Center Lite",
    marketSignal: "Vanta, Drata, and Secureframe all compete on proving trust to prospects.",
    winSignal: "Makes Sentinel commercially legible, not just a scanner.",
    currentState: "implemented",
    nextFix: "Host branded prospect links, replace seeded summaries with real reviewed policies/reports, and persist access analytics."
  },
  {
    rank: 5,
    name: "AI Security Questionnaire Drafting",
    marketSignal: "Questionnaire automation is a core trust-platform feature across incumbents.",
    winSignal: "Demonstrates AI-native operations beyond detection.",
    currentState: "implemented",
    nextFix: "Add binary XLSX/DOCX/PDF extraction and original-format export after selecting production parser dependencies."
  },
  {
    rank: 6,
    name: "Risk Score and Deal-Impact History",
    marketSignal: "Executives buy outcomes: fewer blockers, faster security reviews, less exposed data.",
    winSignal: "Condenses category impact into a metric judges can understand quickly.",
    currentState: "implemented",
    nextFix: "Persist score snapshots to Firestore/BigQuery after production deployment."
  },
  {
    rank: 7,
    name: "Google Workspace OAuth Readiness Wizard",
    marketSignal: "OAuth verification and restricted scopes are a real adoption bottleneck.",
    winSignal: "Shows mastery of Google ecosystem constraints.",
    currentState: "implemented",
    nextFix: "Wire wizard to real Google OAuth client credentials."
  },
  {
    rank: 8,
    name: "Gmail/Drive Sync Reliability Monitor",
    marketSignal: "Security systems must handle delayed or dropped push notifications.",
    winSignal: "Removes a technical loophole that could weaken judge trust.",
    currentState: "implemented",
    nextFix: "Replace simulated cursor movement with real Gmail history and Drive changes responses."
  },
  {
    rank: 9,
    name: "Multi-Framework Control Mapping",
    marketSignal: "Buyers compare SOC2, ISO 27001, GDPR, HIPAA, and PCI readiness together.",
    winSignal: "Raises category impact beyond a single framework.",
    currentState: "implemented",
    nextFix: "Replace local framework packs with durable production tenant history and customer-selected export templates."
  },
  {
    rank: 10,
    name: "Enforced AI Cost Guardrails + Cloud Cost Controls",
    marketSignal: "SMEs need predictable margins and safe API-key operations.",
    winSignal: "Strengthens business viability and AI-native operations scoring.",
    currentState: "implemented",
    nextFix: "Verify Cloud Billing budget alerts, hard quota screenshots, and API key restrictions in the deployed GCP project."
  },
  {
    rank: 11,
    name: "Pilot Prospect Pipeline, Conversion Kit, Consent Packet, Revenue CRM, Financial Ledger, Evidence Vault, and Intake Queue",
    marketSignal: "XPRIZE demands real users, revenue, costs, and testimonials.",
    winSignal:
      "Turns customer acquisition into a product workflow while separating prospects, close assets, accepted proof, redaction checks, pilot consent, invoice/payment/OAuth/scan proof, mock proof, missing proof, private artifacts, and verified revenue evidence.",
    currentState: "implemented",
    nextFix:
      "Use the conversion kit, consent packet, and intake queue for the highest-fit prospect, then attach signed consent, invoices, payment export, customer contact records, active-user proof, Gemini/GCP logs, CAC receipts, checksums, and private judge handling notes."
  },
  {
    rank: 12,
    name: "Tenant Isolation, Production Launch, and Secret Storage",
    marketSignal: "Security products must prove they protect the data they process.",
    winSignal: "Prevents the most damaging trust failure.",
    currentState: "partial",
    nextFix: "Connect the Firestore/BigQuery/Secret Manager REST persistence contract and launch command center to deployed service credentials."
  },
  {
    rank: 13,
    name: "Remediation Playbook Builder",
    marketSignal: "Teams want repeatable workflows, not one-off alerts.",
    winSignal: "Proves AI executes broad operational decisions.",
    currentState: "implemented",
    nextFix: "Persist tenant playbooks in production and connect owner notification delivery."
  },
  {
    rank: 14,
    name: "Founder-Friendly Pricing, ROI Calculator, and Market Battlecard",
    marketSignal: "SMB tools need immediate value proof.",
    winSignal: "Improves revenue probability and pitch clarity while showing why the Workspace risk-scan wedge is narrower than Vanta, Drata, and Secureframe.",
    currentState: "implemented",
    nextFix: "Back ROI and competitor positioning with production-mode paid pilot events, invoices, customer quotes, and durable score history."
  },
  {
    rank: 15,
    name: "Judge-Ready Demo, Claim Guard, Production Launch Plan, Submission Compliance Gate, License Manifest, Devpost Pack, and Binder",
    marketSignal: "Judges may rely heavily on text, video, screenshots, and logs.",
    winSignal: "Turns the product into the pitch artifact while mapping every rule requirement to launch workstreams, claim-safe copy, demo scenes, screenshot targets, market wedge, owned artifacts, dependency/API disclosure, IP/license gaps, and demo clearance risks before submission.",
    currentState: "implemented",
    nextFix: "Replace submission pack and binder placeholders with hosted product, repository, demo video, license/IP clearance, live Google Cloud/Gemini logs, and real customer evidence."
  }
];

const featureScores: Record<number, StrategyFeatureScore> = {
  1: {
    marketabilityScore: 5,
    winningLeverageScore: 5,
    sellabilityScore: 5,
    proofStatus: "customer-proof-needed",
    scoreReason: "Directly converts the niche into revenue, user proof, consent, and a repeatable paid pilot motion."
  },
  2: {
    marketabilityScore: 5,
    winningLeverageScore: 5,
    sellabilityScore: 4,
    proofStatus: "production-proof-needed",
    scoreReason: "High buyer-trust value and strong safety story; production identity and delivery proof still need wiring."
  },
  3: {
    marketabilityScore: 5,
    winningLeverageScore: 5,
    sellabilityScore: 5,
    proofStatus: "production-proof-needed",
    scoreReason: "Turns technical scanning into buyer-readable readiness evidence; final signed hosted packet remains external proof."
  },
  4: {
    marketabilityScore: 5,
    winningLeverageScore: 4,
    sellabilityScore: 5,
    proofStatus: "customer-proof-needed",
    scoreReason: "Matches incumbent trust-center buyer expectations while staying narrower than full GRC platforms."
  },
  5: {
    marketabilityScore: 4,
    winningLeverageScore: 4,
    sellabilityScore: 4,
    proofStatus: "production-proof-needed",
    scoreReason: "Commercially familiar and AI-native, but binary-file/original-format support is still a parity gap."
  },
  6: {
    marketabilityScore: 4,
    winningLeverageScore: 5,
    sellabilityScore: 4,
    proofStatus: "customer-proof-needed",
    scoreReason: "Makes category impact legible through before/after outcomes; must be tied to real pilot events."
  },
  7: {
    marketabilityScore: 4,
    winningLeverageScore: 5,
    sellabilityScore: 4,
    proofStatus: "external-clearance-needed",
    scoreReason: "Shows Google ecosystem depth and OAuth realism, but real credentials and consented install proof are external."
  },
  8: {
    marketabilityScore: 4,
    winningLeverageScore: 5,
    sellabilityScore: 4,
    proofStatus: "production-proof-needed",
    scoreReason: "Directly addresses missed-event criticism that judges or security buyers could raise."
  },
  9: {
    marketabilityScore: 4,
    winningLeverageScore: 4,
    sellabilityScore: 4,
    proofStatus: "customer-proof-needed",
    scoreReason: "Improves breadth against incumbents without overclaiming certification; real tenant history is still required."
  },
  10: {
    marketabilityScore: 4,
    winningLeverageScore: 5,
    sellabilityScore: 4,
    proofStatus: "external-clearance-needed",
    scoreReason: "Strong margin and operational-safety signal; final proof requires Cloud Billing and API-key configuration."
  },
  11: {
    marketabilityScore: 5,
    winningLeverageScore: 5,
    sellabilityScore: 5,
    proofStatus: "customer-proof-needed",
    scoreReason: "Most important XPRIZE business-viability engine because it operationalizes revenue, users, consent, and proof."
  },
  12: {
    marketabilityScore: 4,
    winningLeverageScore: 5,
    sellabilityScore: 4,
    proofStatus: "production-proof-needed",
    scoreReason: "Security buyers and judges need durable tenant isolation; the local contract is strong but not deployed proof."
  },
  13: {
    marketabilityScore: 4,
    winningLeverageScore: 4,
    sellabilityScore: 4,
    proofStatus: "production-proof-needed",
    scoreReason: "Useful operational depth for buyers, especially after production notifications and analytics exist."
  },
  14: {
    marketabilityScore: 5,
    winningLeverageScore: 4,
    sellabilityScore: 5,
    proofStatus: "customer-proof-needed",
    scoreReason: "Improves close rate and category clarity, but ROI and positioning must be backed by real paid pilots."
  },
  15: {
    marketabilityScore: 4,
    winningLeverageScore: 5,
    sellabilityScore: 4,
    proofStatus: "external-clearance-needed",
    scoreReason: "Critical for judging mechanics; still depends on hosted URLs, demo video, repository, and license/IP clearance."
  }
};

const topFeatures: StrategyFeature[] = rawTopFeatures.map((feature) => {
  const score = featureScores[feature.rank];

  return {
    ...feature,
    ...score,
    totalScore: score.marketabilityScore + score.winningLeverageScore + score.sellabilityScore
  };
});

const topGaps: StrategyGap[] = [
  {
    priority: 1,
    capability: "Real Workspace OAuth + sync",
    currentlyHave: "Mock Drive/Gmail event ingestion, OAuth launch/callback paths, Secret Manager token-storage contract, sync cursor/channel control plane, one-day paid pilot launch plan, and Pilot Consent & Scope Packet.",
    neededForTopTier: "Consented pilot installs with signed scope packets, real Drive/Gmail cursor persistence, channel renewal, and reconciliation logs.",
    implementationPlan: "Use real OAuth credentials, collect signed pilot-consent packets, store pilot refresh tokens in Secret Manager, initialize Gmail history IDs and Drive page tokens, then run scheduled reconciliation."
  },
  {
    priority: 2,
    capability: "Durable multi-tenant persistence and launch proof",
    currentlyHave: "In-memory local state plus tenant-scoped Firestore, BigQuery, Secret Manager REST contract, and a Production Launch Command Center with env readiness, workstreams, commands, and proof artifacts.",
    neededForTopTier: "Firestore/BigQuery-backed tenant isolation, replayable evidence, Cloud Run proof, Secret Manager token path, and hosted launch-readiness evidence.",
    implementationPlan: "Deploy on Cloud Run with service-account IAM, switch SENTINEL_STORAGE_MODE to gcp-rest, then run the launch-readiness and write-through verification commands from the hosted product."
  },
  {
    priority: 3,
    capability: "Paid pilot evidence",
    currentlyHave:
      "Paid-pilot prospect pipeline, conversion kit, consent packet, private pilot CRM with MRR, proof status, consent state, related-party flags, financial evidence ledger, private Evidence Vault artifact register, Evidence Intake Queue, one-day launch plan, redacted exports, and local integrity-sealed evidence packet.",
    neededForTopTier: "Arms-length customer revenue, signed pilot consent, costs, CAC, users, testimonials, related-party separation, and production-signed final packet.",
    implementationPlan:
      "Run the conversion kit, Consent & Scope Packet, and Evidence Intake Queue for the highest-fit prospect, move one real prospect to paid pilot, replace mock entries with signed pilots, attach private pilot consent, invoices/payment exports, active-user logs, Gemini/GCP/Workspace proof, consented customer references, CAC receipts, SHA-256 checksums, and regenerate a hosted final packet signed with a production secret."
  },
  {
    priority: 4,
    capability: "Trust Center Lite",
    currentlyHave: "Redacted Trust Center Lite profile plus time-limited Trust Packets, public/requestable/private document visibility, NDA-aware access approvals, prospect alias, expiry, allowed sections, access logging, engagement analytics, and follow-up queue.",
    neededForTopTier: "Hosted branded trust links, real reviewed policies/reports, and durable production access analytics.",
    implementationPlan: "Deploy the packet route, replace seeded document summaries with real reviewed artifacts, and persist access logs/follow-ups to production CRM evidence."
  },
  {
    priority: 5,
    capability: "Questionnaire automation",
    currentlyHave: "Static draft answers plus text/CSV/TSV/spreadsheet/PDF-text questionnaire intake, category matching, approval states, reusable approved-answer library, owner routing, segment history, bulk answer-library verification, review cadence, audit logs, and customer-specific markdown export.",
    neededForTopTier: "Binary XLSX/DOCX/PDF extraction, original-format export, and production customer-segment history.",
    implementationPlan: "Add vetted file-parser dependencies for binary documents, preserve original questionnaire structure, and persist segment history per tenant after live pilots."
  },
  {
    priority: 6,
    capability: "Risk scoring",
    currentlyHave: "Executive risk score, deal-impact score, evidence maturity score, score snapshots, deltas, trend narrative, manual capture endpoint, and redacted Deal Impact Report.",
    neededForTopTier: "Durable score history across live tenants with production evidence and score movement tied to remediation outcomes.",
    implementationPlan: "Persist score snapshots and deal-impact reports in Firestore/BigQuery after deployment, then regenerate reports from real pilot data."
  },
  {
    priority: 7,
    capability: "Framework breadth",
    currentlyHave: "SOC2, ISO 27001, GDPR, HIPAA, and PCI coverage map plus framework-specific evidence packs with control status, gaps, owner roles, redacted markdown export, and judge/prospect/auditor templates.",
    neededForTopTier: "Production tenant history behind every framework export plus customer-selected evidence from real pilots.",
    implementationPlan: "Persist framework packs per tenant, connect them to live findings/remediations, and replace local evidence counts with production tenant history after pilot validation."
  },
  {
    priority: 8,
    capability: "AI cost and model safety",
    currentlyHave: "Enforced model allowlist, monthly Gemini budget, per-event content byte cap, deterministic fallback, Cloud Billing budget plan, Pub/Sub alert path, API-key restriction plan, quota runbook, and blocked local verifier.",
    neededForTopTier: "Budgets, model allowlist, failure policy, API-key abuse protections, Cloud Billing budgets, quotas, and anomaly response.",
    implementationPlan: "Create the Cloud Billing budget, connect Pub/Sub alert automation, apply the Gemini API key restrictions, capture quota screenshots, and run production verification before public launch."
  },
  {
    priority: 9,
    capability: "Playbook operations",
    currentlyHave: "Tenant-editable playbooks with staged actions, owner role, SLA, escalation target, active/paused state, safe-auto enforcement, local RBAC decisions, and in-app notification queue.",
    neededForTopTier: "Production tenant persistence, verified identity, delivered owner notifications, playbook execution analytics, and customer-specific workflow tuning.",
    implementationPlan: "Persist playbooks in Firestore, route queued notifications through verified delivery channels, and track playbook-to-remediation outcomes after live pilots."
  },
  {
    priority: 10,
    capability: "Demo/pitch packaging, market wedge, and submission binder",
    currentlyHave: "Clickable mock flow, under-three-minute judge script, screenshot/proof checklist, Market Positioning Command Center, Claim Guard, Production Launch Command Center, Submission Gate, Submission Compliance Gate, dependency/license manifest, Devpost Submission Pack, and private Submission Binder.",
    neededForTopTier: "Hosted product URL, repository URL, public under-three-minute demo video, judge test access, IP/license clearance, human-reviewed Devpost copy, competitor-aware pitch, and all private evidence owners cleared.",
    implementationPlan: "Replace submission pack and binder placeholders with live URLs, production logs, license/IP clearance, customer proof, market battlecard proof, and a final redacted judge packet before Devpost submission."
  }
];

const loopholes: StrategyLoophole[] = [
  {
    risk: "Winning confidence cannot be 100% factual.",
    severity: "critical",
    whyItMatters: "Judges, competitor traction, and revenue outcomes are unknowable.",
    fix: "Treat 100% as rule-compliance confidence only; track win-confidence as a probabilistic score."
  },
  {
    risk: "Gemini model name may be wrong or unavailable.",
    severity: "high",
    whyItMatters: "A broken model string could fail the deployed Gemini requirement.",
    fix: "Default to a verified stable Gemini model and validate the exact model before submission."
  },
  {
    risk: "Google Workspace OAuth verification can delay public launch.",
    severity: "high",
    whyItMatters: "Sensitive or restricted scopes can block Marketplace distribution.",
    fix: "Use pilot test-user installs first; publish Marketplace only after verification."
  },
  {
    risk: "Push notifications can be delayed, dropped, or expire.",
    severity: "high",
    whyItMatters: "A security scanner cannot rely only on webhooks.",
    fix: "Add periodic Gmail history and Drive changes reconciliation plus channel renewal monitoring."
  },
  {
    risk: "Compliance claims can overreach.",
    severity: "high",
    whyItMatters: "SOC2 certification/audit claims are legally and commercially risky.",
    fix: "Use readiness/evidence language, include disclaimers in exports, and run the claim guard before release."
  },
  {
    risk: "Mock revenue is not competition evidence.",
    severity: "high",
    whyItMatters: "XPRIZE prioritizes real arms-length revenue.",
    fix: "Use the Evidence Vault to collect real customer proof, then close paid pilots and register private artifacts."
  },
  {
    risk: "Private proof artifacts can leak customer or security details.",
    severity: "high",
    whyItMatters: "Invoices, Workspace logs, screenshots, and consent records can expose customers if they enter public exports.",
    fix: "Keep source artifacts in the private Evidence Vault, track redaction state, and export only aliases, status, owner, and checksum."
  },
  {
    risk: "In-memory storage is not production evidence.",
    severity: "high",
    whyItMatters: "Judges can ask for production logs and financial docs.",
    fix: "Move tenant state to Firestore and audit events to BigQuery."
  },
  {
    risk: "AI might leak sensitive content into prompts.",
    severity: "medium",
    whyItMatters: "Security buyers require strict data minimization.",
    fix: "Keep Tier 0/Tier 1 filters, redact detector quotes, and route only justified samples to Gemini."
  },
  {
    risk: "Competitors already own broad compliance automation.",
    severity: "medium",
    whyItMatters: "A generic compliance dashboard will not beat Vanta/Drata/Secureframe.",
    fix: "Differentiate on Google Workspace-first, one-day risk scan, evidence-to-deal acceleration."
  },
  {
    risk: "The category impact story could look too narrow.",
    severity: "medium",
    whyItMatters: "Category impact is equally weighted.",
    fix: "Frame as affordable trust infrastructure for small businesses competing for enterprise deals."
  }
];

export function buildStrategySnapshot(
  snapshot: Pick<DashboardSnapshot, "findings" | "agentRuns" | "remediations" | "pilotRecords">
): StrategySnapshot {
  const implemented = topFeatures.filter((feature) => feature.currentState === "implemented").length;
  const partial = topFeatures.filter((feature) => feature.currentState === "partial").length;
  const remediated = snapshot.remediations.length;
  const agentRuns = snapshot.agentRuns.length;
  const financialProof = snapshot.pilotRecords.filter((pilot) => pilot.proofStatus === "financial-doc-ready").length;
  const paidArmsLengthPilots = snapshot.pilotRecords.filter(
    (pilot) => pilot.armsLength && !pilot.relatedParty && pilot.monthlyRevenueUsd > 0
  ).length;
  const productionPenalty = 18;
  const businessEvidence = Math.min(72, 42 + financialProof * 8 + paidArmsLengthPilots * 3 + (remediated > 0 ? 5 : 0));

  return {
    confidence: {
      ruleCompliance: 94,
      marketability: 84,
      technicalDifferentiation: 85,
      businessEvidence,
      winConfidence: Math.min(84, 56 + implemented * 2 + Math.floor(businessEvidence / 20) + (agentRuns > 0 ? 2 : 0) - productionPenalty),
      confidenceNote:
        "No honest strategy can be 100% win-confident before real customer revenue and judge comparison. The target is 100% rule-readiness plus rising traction evidence."
    },
    topFeatures,
    topGaps,
    loopholes,
    implementationFocus: [
      "Real OAuth + durable evidence persistence",
      "Trust Center Lite and questionnaire automation",
      "Prospect-to-paid-pilot conversion with related-party revenue separation",
      "Gmail/Drive reconciliation and channel renewal monitoring",
      "Competitor-aware market wedge against broad GRC incumbents"
    ],
    completionSummary: `${implemented} top features implemented, ${partial} partially present, ${topFeatures.length - implemented - partial} still missing.`
  };
}
