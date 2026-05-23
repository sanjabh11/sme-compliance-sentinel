import { isHighRiskDocument, runLocalRegexDetectors, runSensitiveDataProtectionDetector } from "@/lib/detectors";
import { classifyRiskWithGemini } from "@/lib/gemini";
import { evaluateGeminiInvocationGuardrail } from "@/lib/ai-guardrails";
import type { AiInvocationGuardrailResult, DetectorFinding, DetectorTier, Finding, GeminiRiskClassification, ResourceEvent, ScanDecision } from "@/lib/types";

type FindingDraft = Omit<Finding, "id" | "createdAt" | "updatedAt" | "status" | "approval">;

export async function scanResourceEvent(event: ResourceEvent, options?: { currentGeminiSpendUsd?: number }): Promise<{
  decision: ScanDecision;
  classification?: Awaited<ReturnType<typeof classifyRiskWithGemini>>;
  findingDraft?: FindingDraft;
}> {
  const tier0 = tier0MetadataFilter(event);

  if (tier0.skipped) {
    return {
      decision: {
        skipped: true,
        skipReason: tier0.reason,
        tiersRun: ["tier0_metadata"],
        shouldRunGemini: false,
        deterministicFindings: [],
        counters: {
          filesInspected: 1,
          bytesExtracted: 0,
          bytesScannedByDlp: 0,
          bytesRoutedToGemini: 0
        }
      }
    };
  }

  const bytesExtracted = Buffer.byteLength(event.content ?? "", "utf8");
  const localRegexFindings = runLocalRegexDetectors(event.content ?? "");
  const sensitiveDataProtection = await runSensitiveDataProtectionDetector(event);
  const deterministicFindings = mergeDetectorFindings([...localRegexFindings, ...sensitiveDataProtection.findings]);
  const highRisk = isHighRiskDocument(event, deterministicFindings);
  const needsGeminiReview = highRisk || deterministicFindings.length > 0;
  const tiersRun: DetectorTier[] = ["tier0_metadata", "tier1_deterministic"];
  if (sensitiveDataProtection.attempted) {
    tiersRun.push("tier1_sdp");
  }
  const guardrail = needsGeminiReview
    ? evaluateGeminiInvocationGuardrail({
        event,
        detectorFindings: deterministicFindings,
        currentSpendUsd: options?.currentGeminiSpendUsd ?? 0
      })
    : undefined;
  const shouldRunGemini = Boolean(needsGeminiReview && guardrail?.status === "allowed");
  const counters = {
    filesInspected: 1,
    bytesExtracted,
    bytesScannedByDlp: bytesExtracted,
    bytesRoutedToGemini: shouldRunGemini ? guardrail?.bytesSelectedForGemini ?? 0 : 0
  };

  if (!needsGeminiReview) {
    return {
      decision: {
        skipped: false,
        tiersRun,
        shouldRunGemini: false,
        deterministicFindings,
        counters
      }
    };
  }

  const classification =
    guardrail?.status === "blocked"
      ? buildDeterministicGuardrailClassification(event, deterministicFindings, guardrail)
      : await classifyRiskWithGemini(event, deterministicFindings);

  if (shouldRunGemini) {
    tiersRun.push("tier2_gemini");
  }

  return {
    decision: {
      skipped: false,
      tiersRun,
      shouldRunGemini,
      geminiGuardrail: guardrail,
      deterministicFindings,
      counters
    },
    classification,
    findingDraft: {
      tenantId: event.tenantId,
      eventId: event.id,
      resourceId: event.resourceId,
      resourceName: event.resourceName,
      source: event.source,
      severity: classification.severity,
      title: buildFindingTitle(event, classification.severity),
      rationale: classification.rationale,
      soc2ReadinessMapping: classification.soc2ReadinessMapping,
      recommendation: {
        action: classification.suggestedAction,
        confidence: classification.confidence,
        blastRadius: classification.blastRadius,
        humanApprovalRequired: classification.suggestedAction !== "no_action"
      },
      detectorFindings: deterministicFindings,
      counters
    }
  };
}

function buildDeterministicGuardrailClassification(
  event: ResourceEvent,
  detectorFindings: DetectorFinding[],
  guardrail: AiInvocationGuardrailResult
): GeminiRiskClassification {
  const publicExposure = event.sharing.public || event.sharing.anyoneWithLink;
  const hasCredential = detectorFindings.some((finding) =>
    ["AWS_SECRET_ACCESS_KEY", "PRIVATE_KEY", "AUTH_TOKEN", "AWS_CREDENTIALS"].includes(finding.type)
  );
  const hasPii = detectorFindings.some((finding) =>
    ["US_SOCIAL_SECURITY_NUMBER", "CREDIT_CARD_NUMBER", "EMAIL_ADDRESS"].includes(finding.type)
  );

  return {
    severity: publicExposure && hasCredential ? "critical" : hasCredential || hasPii ? "high" : "medium",
    confidence: publicExposure && (hasCredential || hasPii) ? 0.88 : 0.72,
    rationale: [
      "Gemini semantic audit was blocked by AI cost/model guardrails.",
      publicExposure ? "Public sharing increases the blast radius." : "Exposure appears bounded, but owner review is still required.",
      hasCredential ? "A credential-like secret was detected." : "",
      hasPii ? "PII-like content was detected." : "",
      guardrail.reasons.join(" ")
    ]
      .filter(Boolean)
      .join(" "),
    soc2ReadinessMapping: ["CC6.1 logical access controls", "CC6.6 vulnerability and data exposure response"],
    suggestedAction: publicExposure ? "disable_public_sharing" : "request_owner_review",
    blastRadius: publicExposure
      ? "Anyone with the link may access sensitive security or customer data until sharing is restricted."
      : "Exposure appears bounded to authorized users, but the owner should confirm business need.",
    summary: "Deterministic DLP staged this recommendation because Gemini was blocked by budget or model policy.",
    model: guardrail.model,
    provider: "deterministic",
    fallbackReason: "guardrail-blocked",
    inputTokensEstimated: 0,
    outputTokensEstimated: 0,
    estimatedCostUsd: 0
  };
}

function mergeDetectorFindings(findings: DetectorFinding[]) {
  const seen = new Set<string>();

  return findings.filter((finding) => {
    const key = `${finding.tier}:${finding.type}:${finding.quote}:${finding.offset ?? "unknown"}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function tier0MetadataFilter(event: ResourceEvent): { skipped: boolean; reason?: string } {
  if (event.contentHash && event.previousContentHash && event.contentHash === event.previousContentHash) {
    return { skipped: true, reason: "unchanged content hash" };
  }

  if (event.metadataOnly && !event.sharing.public && !event.sharing.anyoneWithLink && event.sharing.externalDomains.length === 0) {
    return { skipped: true, reason: "metadata-only change without sharing risk" };
  }

  if (event.mimeType.startsWith("image/") && event.sizeBytes < 1_000_000 && !event.sharing.public) {
    return { skipped: true, reason: "low-risk image/thumbnail update" };
  }

  if (event.labels.includes("draft") && !event.sharing.public && !event.sharing.anyoneWithLink) {
    return { skipped: true, reason: "internal draft without external sharing" };
  }

  return { skipped: false };
}

function buildFindingTitle(event: ResourceEvent, severity: string) {
  if (event.sharing.public || event.sharing.anyoneWithLink) {
    return `${severity.toUpperCase()} public exposure: ${event.resourceName}`;
  }

  return `${severity.toUpperCase()} sensitive-data risk: ${event.resourceName}`;
}
