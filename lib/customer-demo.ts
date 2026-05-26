export interface CustomerDemoFeature {
  rank: number;
  feature: string;
  talkTrack: string;
  whyShowcase: string;
}

export interface CustomerDemoStep {
  id: "pain" | "scan" | "review" | "trust" | "pilot";
  label: string;
  eyebrow: string;
  title: string;
  customerTalkTrack: string;
  showcaseReason: string;
  proofPoints: string[];
}

export interface CustomerDemoScenario {
  customerSegment: string;
  offer: string;
  sampleDataNotice: string;
  valueStack: string[];
  leadCapture: {
    headline: string;
    description: string;
    privacyNote: string;
  };
  scenarioTitle: string;
  scenarioSummary: string;
  sampleFinding: {
    title: string;
    severity: "critical" | "high" | "medium" | "low";
    resource: string;
    exposure: string;
    deterministicSignals: string[];
    aiExplanation: string;
    blastRadius: string;
    recommendation: string;
  };
  trustPacketPreview: {
    title: string;
    contents: string[];
    boundary: string;
  };
  questionnairePreview: {
    question: string;
    answer: string;
    reviewNote: string;
  };
  copilotPrompt: string;
  copilotAnswer: string;
  riskMovement: {
    before: number;
    after: number;
    label: string;
    note: string;
  };
  consentWizard: {
    title: string;
    steps: { label: string; detail: string }[];
  };
  faq: { question: string; answer: string }[];
  pilotCta: {
    headline: string;
    checklist: string[];
    followUpPlan: string[];
    optimizationNote: string;
  };
}

export const customerDemoFeatures: CustomerDemoFeature[] = [
  {
    rank: 1,
    feature: "One-day Workspace Risk Scan",
    talkTrack: "We scan the Workspace surfaces most likely to create buyer-review friction.",
    whyShowcase: "Clear paid offer; easy to understand; avoids broad compliance-platform confusion."
  },
  {
    rank: 2,
    feature: "Consent and Scope Boundary",
    talkTrack: "We define exactly what is scanned, excluded, and never sent to AI.",
    whyShowcase: "Builds trust before OAuth or document access."
  },
  {
    rank: 3,
    feature: "Low-Risk Skip",
    talkTrack: "Not every file goes to AI; low-risk changes are skipped.",
    whyShowcase: "Shows privacy discipline and keeps AI cost down."
  },
  {
    rank: 4,
    feature: "Deterministic Sensitive Data Checks",
    talkTrack: "Rules catch obvious sensitive-data patterns before semantic AI review.",
    whyShowcase: "Makes the system feel reliable, not purely LLM-based."
  },
  {
    rank: 5,
    feature: "Gemini Risk Explanation",
    talkTrack: "AI explains why this exposure matters in plain English.",
    whyShowcase: "Founder buyers can understand risk without hiring a compliance lead."
  },
  {
    rank: 6,
    feature: "Human-Approved Remediation",
    talkTrack: "AI recommends; your team approves before anything important changes.",
    whyShowcase: "Differentiates Sentinel from risky autonomous security tooling."
  },
  {
    rank: 7,
    feature: "Blast Radius Note",
    talkTrack: "Here is who can access it and what could go wrong.",
    whyShowcase: "Makes the risk concrete and decision-ready."
  },
  {
    rank: 8,
    feature: "Audit Trail",
    talkTrack: "Every finding, approval, dismissal, and action is recorded.",
    whyShowcase: "Turns security work into buyer-review evidence."
  },
  {
    rank: 9,
    feature: "Redacted Trust Packet",
    talkTrack: "After the scan, you get a prospect-safe evidence packet.",
    whyShowcase: "This is the main deliverable the customer can use in a sales cycle."
  },
  {
    rank: 10,
    feature: "Questionnaire Assistant",
    talkTrack: "Paste a buyer questionnaire; Sentinel drafts answers from approved evidence.",
    whyShowcase: "Strong painkiller for repetitive security reviews."
  },
  {
    rank: 11,
    feature: "Evidence Copilot",
    talkTrack: "Ask what proof exists and get cited answers.",
    whyShowcase: "Shows AI-native value while reducing hallucination risk."
  },
  {
    rank: 12,
    feature: "Evidence Synthesis",
    talkTrack: "Generate a customer security packet from scattered evidence.",
    whyShowcase: "Converts raw proof into something a buyer can consume quickly."
  },
  {
    rank: 13,
    feature: "Trust Center Lite",
    talkTrack: "Share approved documents without exposing private findings.",
    whyShowcase: "Matches the way modern trust platforms support sales teams."
  },
  {
    rank: 14,
    feature: "Document Access Approval",
    talkTrack: "Sensitive docs require approval before sharing.",
    whyShowcase: "Shows customer data and security posture are protected."
  },
  {
    rank: 15,
    feature: "Risk Score Movement",
    talkTrack: "We show before-and-after movement after approvals or remediations.",
    whyShowcase: "Makes impact measurable instead of anecdotal."
  },
  {
    rank: 16,
    feature: "Deal Impact Score",
    talkTrack: "We connect security work to buyer-readiness.",
    whyShowcase: "Helps founders justify the pilot cost."
  },
  {
    rank: 17,
    feature: "ROI Estimate",
    talkTrack: "This estimates time saved in security reviews, with proof gaps shown.",
    whyShowcase: "Useful for buying decisions when framed as an estimate."
  },
  {
    rank: 18,
    feature: "Evidence Vault",
    talkTrack: "Consent, screenshots, logs, and trust artifacts stay organized.",
    whyShowcase: "Supports customer continuity after the first scan."
  },
  {
    rank: 19,
    feature: "Claim Guard",
    talkTrack: "The product blocks unsupported certification or guarantee language.",
    whyShowcase: "Builds credibility with security-conscious buyers."
  },
  {
    rank: 20,
    feature: "Paid Pilot Conversion Kit",
    talkTrack: "Here is the fixed scope, deliverables, invoice checklist, and next step.",
    whyShowcase: "Converts demo interest into a concrete paid pilot."
  }
];

export const customerDemoSteps: CustomerDemoStep[] = [
  {
    id: "pain",
    label: "Pain",
    eyebrow: "Buyer review risk",
    title: "Your next enterprise buyer may ask for proof before they buy.",
    customerTalkTrack:
      "You are about to send a questionnaire or trust packet to an enterprise buyer. The risk is that your Workspace has public files, sensitive data, or no audit trail proving what you checked.",
    showcaseReason: "Start from a buyer deadline, not a feature tour.",
    proofPoints: ["Security questionnaire pressure", "Workspace sharing risk", "Need for redacted proof"]
  },
  {
    id: "scan",
    label: "Scan",
    eyebrow: "Workspace risk scan demo",
    title: "Find the risky exposure without sending everything to AI.",
    customerTalkTrack:
      "We run deterministic checks first, skip low-risk changes, and use Gemini only when semantic explanation is useful.",
    showcaseReason: "Shows privacy, cost control, and AI value in one step.",
    proofPoints: ["Tier 0 metadata filtering", "Deterministic sensitive-data signals", "Gemini semantic explanation"]
  },
  {
    id: "review",
    label: "Review",
    eyebrow: "Human-approved action",
    title: "AI recommends, but the customer stays in control.",
    customerTalkTrack:
      "We do not let AI silently change permissions. Your admin approves, dismisses, or marks a false positive.",
    showcaseReason: "Removes the biggest trust objection to AI security remediation.",
    proofPoints: ["Suggested action", "Blast-radius note", "Approval history"]
  },
  {
    id: "trust",
    label: "Trust",
    eyebrow: "Buyer-ready packet",
    title: "Turn the scan into evidence the buyer can review.",
    customerTalkTrack:
      "This packet explains what was checked, what was found, what was approved, and what remains out of scope.",
    showcaseReason: "Makes the deliverable concrete enough to justify a paid pilot.",
    proofPoints: ["Redacted Trust Packet", "Questionnaire-ready answer", "Cited evidence summary"]
  },
  {
    id: "pilot",
    label: "Pilot",
    eyebrow: "Fixed-scope next step",
    title: "Close with a simple paid pilot, not a vague platform promise.",
    customerTalkTrack:
      "The pilot is fixed-scope: consent, scan, review recommendations, export a Trust Packet, and leave you with buyer-ready evidence.",
    showcaseReason: "Turns interest into a purchase decision.",
    proofPoints: ["One-day scope", "$199 pilot", "Consent before live Workspace access"]
  }
];

export const customerDemoScenario: CustomerDemoScenario = {
  customerSegment: "seed-stage B2B SaaS and founder-led services teams facing an enterprise security review",
  offer: "$199 one-day Google Workspace risk scan plus SOC2 readiness evidence packet.",
  sampleDataNotice: "Sample data only. Live scans require signed consent before Workspace access.",
  valueStack: ["Consent first", "AI only when justified", "Redacted Trust Packet"],
  leadCapture: {
    headline: "Request my pilot scope",
    description: "Share the minimum details needed to prepare a one-day scan scope and consent checklist.",
    privacyNote: "Five fields maximum. The demo stores only a redacted local receipt until a real lead destination is configured."
  },
  scenarioTitle: "Sample high-risk Workspace exposure",
  scenarioSummary:
    "A proposal draft is externally shared and includes sensitive operational details. Sentinel detects it, explains the risk, and stages the evidence.",
  sampleFinding: {
    title: "Public proposal draft contains sensitive access details",
    severity: "high",
    resource: "Drive / Customer proposal draft",
    exposure: "Anyone with the link can view a file that appears to contain operational security details.",
    deterministicSignals: ["external sharing", "credential-like phrase", "buyer security review keywords"],
    aiExplanation:
      "This looks risky because the file combines external sharing with sensitive implementation details that a buyer would expect to be controlled before procurement review.",
    blastRadius: "Anyone with the link could review the draft, copy sensitive details, or challenge your security process during diligence.",
    recommendation: "Restrict link access, notify the owner, and add the file to the Trust Packet as a remediated exposure after approval."
  },
  trustPacketPreview: {
    title: "Redacted Trust Packet preview",
    contents: [
      "Workspace risk summary and scan scope",
      "Redacted finding with owner-approved action",
      "Audit trail for recommendation review",
      "Questionnaire answer draft with human-review note",
      "Open proof gaps and out-of-scope items"
    ],
    boundary: "SOC2 readiness evidence only; not certification, audit assurance, or legal guidance."
  },
  questionnairePreview: {
    question: "How do you monitor Google Workspace for sensitive-data exposure?",
    answer:
      "Sentinel uses scoped Workspace events, deterministic sensitive-data checks, and Gemini-assisted risk explanations when review is justified. Non-trivial remediation is staged for human approval, and each decision is recorded for buyer-readiness evidence.",
    reviewNote: "Human review is required before this answer is sent to a buyer."
  },
  copilotPrompt: "What proof supports our Workspace risk scan?",
  copilotAnswer:
    "The cited proof is the scan scope, the redacted finding, the human-approved recommendation record, and the Trust Packet preview. Missing proof remains live customer consent and paid pilot artifacts.",
  riskMovement: {
    before: 72,
    after: 38,
    label: "Sample risk movement after approval",
    note: "Illustrative demo score only. Live score history requires consented Workspace evidence."
  },
  consentWizard: {
    title: "Consent-first scan setup",
    steps: [
      {
        label: "Scope",
        detail: "Confirm Drive and Gmail metadata surfaces before any OAuth connection."
      },
      {
        label: "Exclusions",
        detail: "Exclude private invoices, unrelated folders, raw customer files, and content not approved for review."
      },
      {
        label: "AI boundary",
        detail: "Run deterministic checks first; route to Gemini only when semantic explanation is justified."
      },
      {
        label: "Approval",
        detail: "Keep remediation staged until the named approval owner confirms the action."
      }
    ]
  },
  faq: [
    {
      question: "Will AI read every file?",
      answer: "No. Low-risk changes are skipped, deterministic checks run first, and semantic AI review is reserved for justified cases."
    },
    {
      question: "Can the AI change permissions by itself?",
      answer: "No. Important remediation is staged for human approval before permissions change."
    },
    {
      question: "Is this SOC2 certification?",
      answer: "No. The output is SOC2 readiness evidence for buyer review, not certification or audit assurance."
    },
    {
      question: "What happens after the scan?",
      answer: "You receive a redacted Trust Packet, a questionnaire-ready answer, and a checklist of remaining proof gaps."
    }
  ],
  pilotCta: {
    headline: "Book my one-day Workspace risk scan",
    checklist: [
      "Confirm buyer deadline and Workspace sources in scope",
      "Approve consent and excluded-content boundary",
      "Run the scan and review staged recommendations",
      "Export redacted Trust Packet and questionnaire answer",
      "Register invoice, payment, and consent evidence privately"
    ],
    followUpPlan: ["1 hour: send scope confirmation", "24 hours: send consent checklist reminder"],
    optimizationNote: "First experiment: CTA clicks to pilot-interest call."
  }
};

export function buildCustomerDemoCopyBundle() {
  return {
    features: customerDemoFeatures,
    steps: customerDemoSteps,
    scenario: customerDemoScenario
  };
}
