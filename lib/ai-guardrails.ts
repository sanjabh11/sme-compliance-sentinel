import { sentinelConfig } from "@/lib/config";
import { estimateRiskClassificationCost } from "@/lib/gemini";
import type { AiInvocationGuardrailResult, DetectorFinding, ResourceEvent } from "@/lib/types";

export function evaluateGeminiInvocationGuardrail(input: {
  event: ResourceEvent;
  detectorFindings: DetectorFinding[];
  currentSpendUsd: number;
}): AiInvocationGuardrailResult {
  const projectedCostUsd = estimateRiskClassificationCost(input.event, input.detectorFindings).estimatedCostUsd;
  const currentSpendUsd = Number(input.currentSpendUsd.toFixed(6));
  const projectedSpendUsd = Number((currentSpendUsd + projectedCostUsd).toFixed(6));
  const model = sentinelConfig.geminiModel;
  const reasons: string[] = [];

  if (!sentinelConfig.geminiModelAllowlist.includes(model)) {
    reasons.push(`Model ${model} is not in the tenant allowlist.`);
  }

  if (projectedSpendUsd > sentinelConfig.geminiMonthlyBudgetUsd) {
    reasons.push(
      `Projected Gemini spend $${projectedSpendUsd.toFixed(6)} exceeds monthly budget $${sentinelConfig.geminiMonthlyBudgetUsd}.`
    );
  }

  return {
    status: reasons.length ? "blocked" : "allowed",
    model,
    monthlyBudgetUsd: sentinelConfig.geminiMonthlyBudgetUsd,
    currentSpendUsd,
    projectedCostUsd,
    projectedSpendUsd,
    maxContentBytesPerEvent: sentinelConfig.geminiMaxContentBytesPerEvent,
    bytesSelectedForGemini: estimateGeminiContentBytes(input.event),
    reasons
  };
}

function estimateGeminiContentBytes(event: ResourceEvent) {
  return Math.min(Buffer.byteLength(event.content ?? "", "utf8"), sentinelConfig.geminiMaxContentBytesPerEvent);
}
