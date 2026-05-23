import { GoogleGenerativeAI } from "@google/generative-ai";
import { sentinelConfig } from "@/lib/config";
import type { DetectorFinding, GeminiRiskClassification, RecommendationAction, ResourceEvent, Severity } from "@/lib/types";

export async function classifyRiskWithGemini(
  event: ResourceEvent,
  detectorFindings: DetectorFinding[]
): Promise<GeminiRiskClassification> {
  const model = sentinelConfig.geminiModel;
  const prompt = buildRiskPrompt(event, detectorFindings);
  const inputTokensEstimated = estimateTokens(prompt);

  if (!process.env.GEMINI_API_KEY) {
    return mockGeminiClassification(event, detectorFindings, model, inputTokensEstimated, "api-key-missing");
  }

  let text: string;
  let parsed: Record<string, unknown>;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const generativeModel = genAI.getGenerativeModel({
      model,
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    });

    const result = await generativeModel.generateContent(prompt);
    text = result.response.text();
    parsed = parseGeminiJson(text);
  } catch (error) {
    return mockGeminiClassification(event, detectorFindings, model, inputTokensEstimated, "api-call-failed", errorClass(error));
  }

  const outputTokensEstimated = estimateTokens(text);

  return {
    severity: normalizeSeverity(parsed.severity),
    confidence: normalizeConfidence(parsed.confidence),
    rationale: stringOr(parsed.rationale, "Gemini identified a possible Workspace data exposure."),
    soc2ReadinessMapping: normalizeStringArray(parsed.soc2ReadinessMapping),
    suggestedAction: normalizeAction(parsed.suggestedAction),
    blastRadius: stringOr(parsed.blastRadius, "Potential exposure scope requires admin review."),
    summary: stringOr(parsed.summary, "Review and approve the staged remediation."),
    model,
    provider: "gemini-api",
    inputTokensEstimated,
    outputTokensEstimated,
    estimatedCostUsd: estimateCost(inputTokensEstimated, outputTokensEstimated)
  };
}

function buildRiskPrompt(event: ResourceEvent, detectorFindings: DetectorFinding[]) {
  const contentSample = truncateUtf8(event.content ?? "", sentinelConfig.geminiMaxContentBytesPerEvent);
  return [
    "You are SME Workspace Sentinel, an AI DLP and SOC2 readiness evidence assistant.",
    "You do not claim audit certification. You provide risk explanations and staged recommendations for human approval.",
    "Return strict JSON with keys: severity, confidence, rationale, soc2ReadinessMapping, suggestedAction, blastRadius, summary.",
    "Allowed severities: critical, high, medium, low, info.",
    "Allowed actions: disable_public_sharing, notify_owner, request_owner_review, label_restricted, no_action.",
    "",
    `Resource: ${event.resourceName}`,
    `Source: ${event.source}`,
    `MIME: ${event.mimeType}`,
    `Sharing: public=${event.sharing.public}, anyoneWithLink=${event.sharing.anyoneWithLink}, externalDomains=${event.sharing.externalDomains.join(",") || "none"}`,
    `Labels: ${event.labels.join(",") || "none"}`,
    `Detector findings: ${JSON.stringify(detectorFindings)}`,
    `Content sample: ${contentSample}`
  ].join("\n");
}

export function estimateRiskClassificationCost(event: ResourceEvent, detectorFindings: DetectorFinding[]) {
  const prompt = buildRiskPrompt(event, detectorFindings);
  const inputTokensEstimated = estimateTokens(prompt);
  const outputTokensEstimated = 300;

  return {
    inputTokensEstimated,
    outputTokensEstimated,
    estimatedCostUsd: estimateCost(inputTokensEstimated, outputTokensEstimated)
  };
}

function mockGeminiClassification(
  event: ResourceEvent,
  detectorFindings: DetectorFinding[],
  model: string,
  inputTokensEstimated: number,
  fallbackReason: string,
  errorClass?: string
): GeminiRiskClassification {
  const publicExposure = event.sharing.public || event.sharing.anyoneWithLink;
  const hasCredential = detectorFindings.some((finding) =>
    ["AWS_SECRET_ACCESS_KEY", "PRIVATE_KEY", "AUTH_TOKEN", "AWS_CREDENTIALS"].includes(finding.type)
  );
  const hasPii = detectorFindings.some((finding) =>
    ["US_SOCIAL_SECURITY_NUMBER", "CREDIT_CARD_NUMBER", "EMAIL_ADDRESS"].includes(finding.type)
  );

  const severity: Severity = publicExposure && hasCredential ? "critical" : hasCredential || hasPii ? "high" : "medium";
  const suggestedAction: RecommendationAction = publicExposure ? "disable_public_sharing" : "request_owner_review";
  const output = [
    publicExposure ? "Public sharing increases the blast radius." : "The item is not public, but content risk remains.",
    hasCredential ? "A credential-like secret was detected." : "",
    hasPii ? "PII-like content was detected." : ""
  ]
    .filter(Boolean)
    .join(" ");
  const outputTokensEstimated = estimateTokens(output);

  return {
    severity,
    confidence: publicExposure && (hasCredential || hasPii) ? 0.94 : 0.78,
    rationale: output,
    soc2ReadinessMapping: ["CC6.1 logical access controls", "CC6.6 vulnerability and data exposure response"],
    suggestedAction,
    blastRadius: publicExposure
      ? "Anyone with the link may access sensitive security or customer data until sharing is restricted."
      : "Exposure appears bounded to authorized users, but the owner should confirm business need.",
    summary: "Stage this recommendation for admin approval before changing Workspace permissions.",
    model,
    provider: "mock-gemini",
    fallbackReason,
    errorClass,
    inputTokensEstimated,
    outputTokensEstimated,
    estimatedCostUsd: estimateCost(inputTokensEstimated, outputTokensEstimated)
  };
}

function errorClass(error: unknown) {
  if (error instanceof Error && error.name) {
    return error.name.slice(0, 80);
  }

  return "UnknownError";
}

function parseGeminiJson(text: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    }

    return {};
  }
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function truncateUtf8(text: string, maxBytes: number) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return text;
  }

  let output = "";
  let bytes = 0;

  for (const character of text) {
    const nextBytes = Buffer.byteLength(character, "utf8");
    if (bytes + nextBytes > maxBytes) {
      break;
    }

    output += character;
    bytes += nextBytes;
  }

  return output;
}

function estimateCost(inputTokens: number, outputTokens: number) {
  const inputCost = (inputTokens / 1000) * sentinelConfig.geminiInputPer1kUsd;
  const outputCost = (outputTokens / 1000) * sentinelConfig.geminiOutputPer1kUsd;
  return Number((inputCost + outputCost).toFixed(6));
}

function normalizeSeverity(value: unknown): Severity {
  return ["critical", "high", "medium", "low", "info"].includes(String(value)) ? (value as Severity) : "medium";
}

function normalizeConfidence(value: unknown) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.min(1, Math.max(0, numeric));
  }

  return 0.7;
}

function normalizeAction(value: unknown): RecommendationAction {
  const action = String(value);
  return ["disable_public_sharing", "notify_owner", "request_owner_review", "label_restricted", "no_action"].includes(
    action
  )
    ? (action as RecommendationAction)
    : "request_owner_review";
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return ["SOC2 readiness evidence"];
  }

  return value.map(String).filter(Boolean).slice(0, 6);
}

function stringOr(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}
