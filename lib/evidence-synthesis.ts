import { GoogleGenAI, type GoogleGenAIOptions } from "@google/genai";
import { sentinelConfig } from "@/lib/config";
import { queryEvidenceCopilot } from "@/lib/evidence-copilot";
import type {
  DashboardSnapshot,
  EvidenceCopilotCitation,
  EvidenceCopilotMode,
  EvidenceSynthesisPack,
  EvidenceSynthesisPackType,
  EvidenceSynthesisRequest,
  EvidenceSynthesisSection
} from "@/lib/types";

const claimBoundaries = [
  "SOC2 readiness evidence only.",
  "Not certification.",
  "Not legal, audit, or compliance advice.",
  "Use only with human review and cited evidence."
];

const packQueries: Record<EvidenceSynthesisPackType, string> = {
  "judge-summary": "Summarize AI-native operations, Google Cloud evidence, Gemini usage, business evidence, users, and XPRIZE proof blockers.",
  "customer-security-packet": "Summarize Workspace monitoring, sensitive-data minimization, human approval, audit trail, and Trust Center evidence.",
  "remediation-timeline": "Summarize findings, approvals, remediation actions, audit events, and open remediation gaps.",
  "business-evidence-brief": "Summarize pilot MRR, active users, revenue evidence, invoices, costs, testimonials, and related-party boundaries.",
  "ai-operations-proof": "Summarize agent runs, Gemini usage, bytes routed to Gemini, cost controls, audit logs, and production proof gaps."
};

export async function buildEvidenceSynthesisPack(
  snapshot: DashboardSnapshot,
  request: EvidenceSynthesisRequest
): Promise<EvidenceSynthesisPack> {
  const deterministic = buildDeterministicSynthesisPack(snapshot, request);

  if (!request.useGemini) {
    return deterministic;
  }

  const clientConfig = buildGeminiClientConfig();
  if (!clientConfig.config) {
    return { ...deterministic, provider: "mock-gemini", fallbackReason: clientConfig.fallbackReason };
  }

  try {
    const genAI = new GoogleGenAI(clientConfig.config);
    const result = await genAI.models.generateContent({
      model: sentinelConfig.geminiModel,
      contents: buildSynthesisPrompt(deterministic),
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            executiveSummary: { type: "string" },
            unsupportedClaims: { type: "array", items: { type: "string" } },
            missingEvidence: { type: "array", items: { type: "string" } }
          },
          required: ["executiveSummary", "unsupportedClaims", "missingEvidence"],
          additionalProperties: false
        }
      } as never
    });
    const parsed = parseJson(result.text ?? "");
    const executiveSummary = typeof parsed.executiveSummary === "string" ? parsed.executiveSummary : deterministic.executiveSummary;

    return {
      ...deterministic,
      executiveSummary: appendBoundary(executiveSummary),
      unsupportedClaims: normalizeStringArray(parsed.unsupportedClaims, deterministic.unsupportedClaims),
      missingEvidence: normalizeStringArray(parsed.missingEvidence, deterministic.missingEvidence),
      provider: "gemini-api"
    };
  } catch (error) {
    return { ...deterministic, provider: "mock-gemini", fallbackReason: error instanceof Error ? error.name : "gemini-call-failed" };
  }
}

export function buildDeterministicSynthesisPack(
  snapshot: DashboardSnapshot,
  request: EvidenceSynthesisRequest
): EvidenceSynthesisPack {
  const packType = normalizePackType(request.packType);
  const mode: EvidenceCopilotMode = request.mode === "admin" ? "admin" : "judge";
  const query = request.prompt?.trim() || packQueries[packType];
  const copilot = queryEvidenceCopilot(snapshot, { query, mode, maxCitations: 8 });
  const sections = buildSections(packType, copilot.citations, snapshot);
  const citedSectionCount = sections.filter((section) => section.citationIds.length > 0).length;
  const citationCoverageScore = sections.length ? Math.round((citedSectionCount / sections.length) * 100) : 0;

  return {
    generatedAt: new Date().toISOString(),
    packType,
    mode,
    title: titleForPack(packType),
    executiveSummary: appendBoundary(copilot.answer),
    sections,
    citations: copilot.citations,
    citationCoverageScore,
    unsupportedClaims: copilot.unsafeClaimWarnings,
    missingEvidence: copilot.missingEvidence,
    redactionStatus: mode === "admin" ? "admin-private" : "redacted",
    humanReviewStatus: "required",
    claimBoundaries,
    provider: "deterministic"
  };
}

function buildSections(
  packType: EvidenceSynthesisPackType,
  citations: EvidenceCopilotCitation[],
  snapshot: DashboardSnapshot
): EvidenceSynthesisSection[] {
  const citationIds = citations.map((citation) => citation.sourceId);
  const byKind = (kind: string) => citations.filter((citation) => citation.kind === kind).map((citation) => citation.sourceId);
  const fallbackIds = citationIds.slice(0, 3);

  if (packType === "remediation-timeline") {
    return [
      {
        title: "Timeline",
        body: `${snapshot.findings.length} finding(s), ${snapshot.remediations.length} remediation record(s), and ${snapshot.auditEvents.length} audit event(s) are available for review.`,
        citationIds: [...byKind("finding"), ...byKind("remediation"), ...byKind("audit-event")].slice(0, 5)
      },
      {
        title: "Open Gaps",
        body: "Non-trivial remediation remains staged for human approval unless a tenant has explicitly enabled a safe automatic action.",
        citationIds: fallbackIds
      }
    ];
  }

  if (packType === "business-evidence-brief") {
    return [
      {
        title: "Revenue And Users",
        body: `${snapshot.tenant.evidence.pilotCount} pilot record(s), $${snapshot.tenant.evidence.mrrUsd}/mo MRR field, and ${snapshot.tenant.evidence.activeUsers} active user(s) are represented in local evidence.`,
        citationIds: byKind("pilot-record")
      },
      {
        title: "Proof Boundary",
        body: "Private invoice/payment/user proof must be present and consented before judge-facing use.",
        citationIds: byKind("evidence-vault")
      }
    ];
  }

  if (packType === "ai-operations-proof") {
    return [
      {
        title: "Agent Runs",
        body: `${snapshot.agentRuns.length} agent run(s), ${snapshot.aggregateCounters.bytesRoutedToGemini} byte(s) routed to Gemini, and $${snapshot.agentRuns.reduce((sum, run) => sum + run.estimatedCostUsd, 0).toFixed(4)} estimated Gemini spend are represented.`,
        citationIds: byKind("agent-run")
      },
      {
        title: "Production Evidence Boundary",
        body: "Hosted Gemini smoke, API usage, and production logs must remain attached as private evidence before judging claims.",
        citationIds: byKind("evidence-vault")
      }
    ];
  }

  if (packType === "customer-security-packet") {
    return [
      {
        title: "Security Workflow",
        body: "Sentinel uses staged recommendations, redacted evidence, Trust Center documents, and questionnaire packs to support buyer security review.",
        citationIds: [...byKind("trust-document"), ...byKind("questionnaire-pack"), ...byKind("answer-library")].slice(0, 5)
      },
      {
        title: "Human Approval",
        body: "Sensitive remediation remains human-in-the-loop unless explicitly configured as safe automatic action.",
        citationIds: byKind("finding")
      }
    ];
  }

  return [
    {
      title: "Business Viability",
      body: "The local evidence model tracks pilots, MRR, active users, costs, consent, and proof artifacts without converting local data into production proof.",
      citationIds: [...byKind("pilot-record"), ...byKind("evidence-vault")].slice(0, 5)
    },
    {
      title: "AI-Native Operations",
      body: "The evidence set tracks agent runs, audit events, findings, and Gemini routing as AI-native operations evidence.",
      citationIds: [...byKind("agent-run"), ...byKind("audit-event"), ...byKind("finding")].slice(0, 5)
    },
    {
      title: "Category Impact",
      body: "The product is positioned for Small Business Services through Workspace security review acceleration and redacted trust evidence.",
      citationIds: fallbackIds
    }
  ];
}

function titleForPack(packType: EvidenceSynthesisPackType) {
  return {
    "judge-summary": "XPRIZE Judge Evidence Summary",
    "customer-security-packet": "Customer Security Packet",
    "remediation-timeline": "Remediation Timeline",
    "business-evidence-brief": "Business Evidence Brief",
    "ai-operations-proof": "AI Operations Proof Brief"
  }[packType];
}

function normalizePackType(value: EvidenceSynthesisPackType): EvidenceSynthesisPackType {
  return [
    "judge-summary",
    "customer-security-packet",
    "remediation-timeline",
    "business-evidence-brief",
    "ai-operations-proof"
  ].includes(value)
    ? value
    : "judge-summary";
}

function appendBoundary(value: string) {
  return `${value} Boundary: SOC2 readiness evidence only; not certification; not legal, audit, or compliance advice.`;
}

type GeminiClientBuild =
  | { config: GoogleGenAIOptions; fallbackReason?: never }
  | { config: null; fallbackReason: string };

function buildGeminiClientConfig(): GeminiClientBuild {
  if (sentinelConfig.googleGenAiUseVertexAi) {
    if (!sentinelConfig.googleCloudProject || !sentinelConfig.googleCloudLocation) {
      return { config: null, fallbackReason: "vertex-config-missing" };
    }
    return { config: { vertexai: true, project: sentinelConfig.googleCloudProject, location: sentinelConfig.googleCloudLocation } };
  }

  if (!process.env.GEMINI_API_KEY) {
    return { config: null, fallbackReason: "api-key-missing" };
  }

  return { config: { apiKey: process.env.GEMINI_API_KEY } };
}

function buildSynthesisPrompt(pack: EvidenceSynthesisPack) {
  return [
    "Rewrite this evidence pack executive summary as strict JSON.",
    "Do not add claims not present in citations. Preserve the claim boundary.",
    JSON.stringify({
      title: pack.title,
      executiveSummary: pack.executiveSummary,
      sections: pack.sections,
      citations: pack.citations,
      claimBoundaries: pack.claimBoundaries
    })
  ].join("\n");
}

function parseJson(text: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeStringArray(value: unknown, fallback: string[]) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 10) : fallback;
}
