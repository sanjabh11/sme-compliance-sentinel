import type {
  DashboardSnapshot,
  EvidenceCopilotCitation,
  EvidenceCopilotMode,
  EvidenceCopilotQuery,
  EvidenceCopilotResult,
  EvidenceCopilotSourceRecord
} from "@/lib/types";

const defaultMaxCitations = 5;
const unsupportedClaimPatterns = [
  /\bSOC\s?2\s+(certified|compliant|certification)\b/iu,
  /\bguarantee(?:d)?\b/iu,
  new RegExp(`\\b${["legal", "advice"].join("\\s+")}\\b`, "iu"),
  /\baudit opinion\b/iu,
  /\bviolations?\s+prevented\b/iu,
  /\b100%\b/iu,
  /\bwin(?:ning)?\s+(?:probability|guarantee|certainty)\b/iu
];

const sensitiveQueryPatterns = [
  /\b(raw|unredacted)\s+(workspace|document|invoice|finding|customer)\b/iu,
  /\b(api\s*key|oauth|refresh\s*token|client\s*secret|password|bearer)\b/iu,
  /\bdrop\s+table\b/iu,
  /\bdelete\s+from\b/iu
];

export function buildEvidenceCopilotSources(
  snapshot: DashboardSnapshot,
  mode: EvidenceCopilotMode = "judge"
): EvidenceCopilotSourceRecord[] {
  const redactor = makeEvidenceRedactor(snapshot, mode);
  const records: EvidenceCopilotSourceRecord[] = [];

  for (const finding of snapshot.findings) {
    records.push({
      sourceId: `finding:${finding.id}`,
      tenantId: finding.tenantId,
      kind: "finding",
      title: redactor(finding.title),
      summary: redactor(`${finding.severity} finding on ${finding.resourceName}; status ${finding.status}.`),
      redactedExcerpt: redactor(`${finding.rationale} Recommended action: ${finding.recommendation.action}.`),
      tags: ["finding", finding.severity, finding.status, finding.recommendation.action, ...finding.soc2ReadinessMapping],
      status: finding.status,
      occurredAt: finding.createdAt,
      private: true,
      consented: mode === "admin",
      metadata: {
        severity: finding.severity,
        confidence: finding.recommendation.confidence,
        humanApprovalRequired: finding.recommendation.humanApprovalRequired
      }
    });
  }

  for (const event of snapshot.auditEvents) {
    records.push({
      sourceId: `audit:${event.id}`,
      tenantId: event.tenantId,
      kind: "audit-event",
      title: redactor(`Audit event: ${event.type.replaceAll("_", " ")}`),
      summary: redactor(event.message),
      redactedExcerpt: redactor(event.message),
      tags: ["audit", event.actor, event.type],
      status: event.type,
      occurredAt: event.createdAt,
      private: Boolean(event.metadata),
      consented: mode === "admin",
      metadata: {
        actor: event.actor,
        sequence: event.sequence ?? null,
        sealed: Boolean(event.eventHash)
      }
    });
  }

  for (const run of snapshot.agentRuns) {
    records.push({
      sourceId: `agent-run:${run.id}`,
      tenantId: run.tenantId,
      kind: "agent-run",
      title: `${run.provider} ${run.model} ${run.purpose.replaceAll("_", " ")}`,
      summary: redactor(run.outputSummary),
      redactedExcerpt: redactor(`${run.promptSummary} ${run.outputSummary}`),
      tags: ["agent-run", run.provider, run.model, run.purpose, run.fallbackReason ?? ""].filter(Boolean),
      status: run.provider,
      occurredAt: run.completedAt,
      private: true,
      consented: mode === "admin",
      metadata: {
        estimatedCostUsd: run.estimatedCostUsd,
        inputTokensEstimated: run.inputTokensEstimated,
        outputTokensEstimated: run.outputTokensEstimated
      }
    });
  }

  for (const remediation of snapshot.remediations) {
    records.push({
      sourceId: `remediation:${remediation.id}`,
      tenantId: remediation.tenantId,
      kind: "remediation",
      title: `Remediation ${remediation.action.replaceAll("_", " ")}`,
      summary: redactor(`${remediation.outcome} ${remediation.mode} remediation.`),
      redactedExcerpt: redactor(remediation.message),
      tags: ["remediation", remediation.action, remediation.mode, remediation.outcome],
      status: remediation.outcome,
      occurredAt: remediation.createdAt,
      private: true,
      consented: mode === "admin",
      metadata: {
        findingId: remediation.findingId
      }
    });
  }

  const vault = snapshot.readiness.evidenceVault;
  for (const artifact of vault.requiredArtifacts) {
    records.push({
      sourceId: `vault:${artifact.id}`,
      tenantId: artifact.tenantId,
      kind: "evidence-vault",
      title: redactor(artifact.label),
      summary: redactor(`${artifact.kind} is ${artifact.status}; required for ${artifact.requiredFor}.`),
      redactedExcerpt: redactor(`${artifact.sourceDescription} Next action: ${artifact.nextAction}`),
      tags: ["evidence-vault", artifact.kind, artifact.status, artifact.ownerRole, String(artifact.requiredFor)],
      status: artifact.status,
      occurredAt: artifact.updatedAt,
      private: true,
      consented: artifact.redacted || mode === "admin",
      metadata: {
        redacted: artifact.redacted,
        amountUsd: artifact.amountUsd ?? null,
        checksumPresent: Boolean(artifact.checksumSha256)
      }
    });
  }

  for (const pack of snapshot.questionnairePacks) {
    records.push({
      sourceId: `questionnaire:${pack.id}`,
      tenantId: snapshot.tenant.id,
      kind: "questionnaire-pack",
      title: redactor(`Questionnaire pack for ${pack.customerAlias}`),
      summary: redactor(`${pack.questionsCount} question(s); ${pack.approvedCount} approved; ${pack.needsReviewCount} need review.`),
      redactedExcerpt: redactor(pack.answers.map((answer) => `${answer.question} ${answer.draftAnswer}`).join(" ")),
      tags: ["questionnaire", pack.status, pack.customerSegment, pack.source],
      status: pack.status,
      occurredAt: pack.updatedAt,
      private: true,
      consented: mode === "admin",
      metadata: {
        questionsCount: pack.questionsCount,
        approvedCount: pack.approvedCount,
        needsReviewCount: pack.needsReviewCount
      }
    });
  }

  for (const item of snapshot.answerLibrary) {
    records.push({
      sourceId: `answer-library:${item.id}`,
      tenantId: snapshot.tenant.id,
      kind: "answer-library",
      title: redactor(item.canonicalQuestion),
      summary: redactor(`${item.category} answer is ${item.status}; used ${item.usageCount} time(s).`),
      redactedExcerpt: redactor(item.approvedAnswer),
      tags: ["answer-library", item.category, item.status, item.ownerRole, ...item.segmentTags],
      status: item.status,
      occurredAt: item.updatedAt,
      private: false,
      consented: true,
      metadata: {
        usageCount: item.usageCount,
        confidence: item.confidence
      }
    });
  }

  for (const document of snapshot.trustDocuments) {
    records.push({
      sourceId: `trust-document:${document.id}`,
      tenantId: snapshot.tenant.id,
      kind: "trust-document",
      title: redactor(document.title),
      summary: redactor(`${document.category} trust document is ${document.visibility}.`),
      redactedExcerpt: redactor(document.summary),
      tags: ["trust", document.category, document.visibility],
      status: document.visibility,
      occurredAt: document.lastReviewedAt,
      private: document.visibility === "private" || document.visibility === "requestable",
      consented: document.visibility === "public" || mode === "admin",
      metadata: {
        ndaRequired: document.requiresNda
      }
    });
  }

  for (const pilot of snapshot.pilotRecords) {
    const canName = mode === "admin" || pilot.consentStatus === "consented";
    records.push({
      sourceId: `pilot:${pilot.id}`,
      tenantId: snapshot.tenant.id,
      kind: "pilot-record",
      title: canName ? redactor(`Pilot ${pilot.customerAlias}`) : "Redacted pilot record",
      summary: redactor(
        `${pilot.armsLength && !pilot.relatedParty ? "Arms-length" : "Related-party or non-arms-length"} pilot; proof ${pilot.proofStatus}; consent ${pilot.consentStatus}.`
      ),
      redactedExcerpt: redactor(
        `${canName ? pilot.customerAlias : "Redacted customer"} ${pilot.segment}; ${pilot.activeUsers} active user(s); $${pilot.monthlyRevenueUsd}/mo MRR.`
      ),
      tags: ["pilot", pilot.proofStatus, pilot.consentStatus, pilot.segment, pilot.armsLength ? "arms-length" : "not-arms-length"],
      status: pilot.proofStatus,
      occurredAt: pilot.startedAt,
      private: pilot.consentStatus !== "consented",
      consented: canName,
      metadata: {
        monthlyRevenueUsd: pilot.monthlyRevenueUsd,
        activeUsers: pilot.activeUsers,
        armsLength: pilot.armsLength,
        relatedParty: pilot.relatedParty
      }
    });
  }

  for (const score of snapshot.scoreHistory) {
    records.push({
      sourceId: `risk-score:${score.id}`,
      tenantId: snapshot.tenant.id,
      kind: "risk-score",
      title: `Risk score ${score.reason.replaceAll("_", " ")}`,
      summary: `Workspace risk ${score.workspaceRiskScore}; active findings ${score.activeFindings}; evidence maturity ${score.evidenceMaturity}.`,
      redactedExcerpt: `Risk ${score.workspaceRiskScore}, deal impact ${score.dealImpactScore}, evidence maturity ${score.evidenceMaturity}.`,
      tags: ["risk-score", score.reason],
      status: score.reason,
      occurredAt: score.capturedAt,
      private: false,
      consented: true,
      metadata: {
        workspaceRiskScore: score.workspaceRiskScore,
        dealImpactScore: score.dealImpactScore,
        evidenceMaturity: score.evidenceMaturity
      }
    });
  }

  return records.map((record) => ({
    ...record,
    title: redactor(record.title),
    summary: redactor(record.summary),
    redactedExcerpt: truncate(redactor(record.redactedExcerpt), 520)
  }));
}

export function queryEvidenceCopilot(snapshot: DashboardSnapshot, input: EvidenceCopilotQuery): EvidenceCopilotResult {
  const query = cleanQuery(input.query);
  const mode = input.mode === "admin" ? "admin" : "judge";
  const maxCitations = clampInteger(input.maxCitations ?? defaultMaxCitations, 1, 10);
  const sources = buildEvidenceCopilotSources(snapshot, mode);
  const warnings = unsafeClaimWarnings(query);
  const sensitiveWarnings = sensitiveQueryWarnings(query);
  const ranked = rankSources(query, sources).slice(0, maxCitations);
  const citations = ranked
    .filter((entry) => entry.score > 0)
    .map((entry) => sourceToCitation(entry.record, entry.score, ranked[0]?.score ?? entry.score));

  const missingEvidence = buildMissingEvidence(query, snapshot, citations);
  const safeWarnings = [...warnings, ...sensitiveWarnings];

  if (!query || citations.length === 0 || sensitiveWarnings.length > 0) {
    return {
      generatedAt: new Date().toISOString(),
      mode,
      query,
      answer:
        "I cannot support a positive answer from the redacted evidence set. Use the missing-evidence list and private Evidence Vault workflow before making this claim.",
      confidence: "low",
      citations: [],
      sourceIds: [],
      missingEvidence: missingEvidence.length ? missingEvidence : ["No cited source records matched the question."],
      unsafeClaimWarnings: safeWarnings,
      nextAction: "Collect or register redacted evidence, then rerun the copilot query.",
      redactionStatus: mode === "admin" ? "admin-private" : "redacted",
      adapter: "local-deterministic"
    };
  }

  const answer = buildCitedAnswer(query, citations, missingEvidence, safeWarnings);
  return {
    generatedAt: new Date().toISOString(),
    mode,
    query,
    answer,
    confidence: citations.length >= 3 && missingEvidence.length === 0 && safeWarnings.length === 0 ? "high" : "medium",
    citations,
    sourceIds: citations.map((citation) => citation.sourceId),
    missingEvidence,
    unsafeClaimWarnings: safeWarnings,
    nextAction: missingEvidence.length
      ? "Resolve the listed missing evidence before using this in a judge or customer packet."
      : "Use the cited answer only with the included claim boundaries and human review.",
    redactionStatus: mode === "admin" ? "admin-private" : "redacted",
    adapter: "local-deterministic"
  };
}

export function makeEvidenceRedactor(snapshot: DashboardSnapshot, mode: EvidenceCopilotMode = "judge") {
  const nonConsentedAliases =
    mode === "admin"
      ? []
      : snapshot.pilotRecords
          .filter((pilot) => pilot.consentStatus !== "consented")
          .flatMap((pilot) => [pilot.customerAlias, pilot.invoiceReference ?? ""])
          .filter(Boolean);

  return (value: string) => redactEvidenceText(value, nonConsentedAliases, mode);
}

export function redactEvidenceText(value: string, aliases: string[] = [], mode: EvidenceCopilotMode = "judge") {
  let output = String(value ?? "");

  for (const alias of aliases) {
    output = output.replace(new RegExp(escapeRegExp(alias), "giu"), "Redacted customer");
  }

  output = output
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted-token]")
    .replace(/\b(api[_\s-]?key|token|secret|password|refresh[_\s-]?token|client[_\s-]?secret)\b\s*[:=]\s*["']?[^"'\s,;]{6,}/giu, "$1=[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, mode === "admin" ? "[admin-email-redacted]" : "[redacted-email]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/giu, "[redacted-aws-key]")
    .replace(/\b(invoice|receipt|payment)[-_\s]?(?:id|ref|reference)?[-_:\s]*[A-Za-z0-9-]{4,}\b/giu, "$1 [redacted-reference]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/gu, "[redacted-ssn]")
    .replace(/\b(?:\d[ -]*?){13,16}\b/gu, "[redacted-card]");

  return output.trim();
}

export function unsafeClaimWarnings(query: string) {
  const warnings: string[] = [];
  for (const pattern of unsupportedClaimPatterns) {
    if (pattern.test(query)) {
      warnings.push("Query asks for a certification, legal/audit, guarantee, or absolute outcome claim that Sentinel must not make.");
      break;
    }
  }
  return warnings;
}

function sensitiveQueryWarnings(query: string) {
  const warnings: string[] = [];
  for (const pattern of sensitiveQueryPatterns) {
    if (pattern.test(query)) {
      warnings.push("Query appears to request raw secrets, unredacted customer/security data, or destructive instructions; answer is refused.");
      break;
    }
  }
  return warnings;
}

function rankSources(query: string, sources: EvidenceCopilotSourceRecord[]) {
  const tokens = tokenize(query);
  return sources
    .map((record) => {
      const haystack = tokenize([record.title, record.summary, record.redactedExcerpt, record.status, ...record.tags].join(" "));
      const exactPhrase = query && [record.title, record.summary, record.redactedExcerpt].join(" ").toLowerCase().includes(query.toLowerCase()) ? 4 : 0;
      const score = tokens.reduce((total, token) => total + (haystack.includes(token) ? 2 : haystack.some((word) => word.includes(token)) ? 1 : 0), exactPhrase);
      return { record, score };
    })
    .sort((a, b) => b.score - a.score || String(b.record.occurredAt ?? "").localeCompare(String(a.record.occurredAt ?? "")));
}

function sourceToCitation(record: EvidenceCopilotSourceRecord, score: number, maxScore: number): EvidenceCopilotCitation {
  return {
    sourceId: record.sourceId,
    kind: record.kind,
    title: record.title,
    excerpt: record.redactedExcerpt || record.summary,
    relevance: maxScore > 0 ? Number((score / maxScore).toFixed(3)) : 1
  };
}

function buildMissingEvidence(query: string, snapshot: DashboardSnapshot, citations: EvidenceCopilotCitation[]) {
  const lower = query.toLowerCase();
  const missing = new Set<string>();

  if (/\b(revenue|mrr|paid|invoice|payment)\b/iu.test(lower)) {
    const hasVerifiedFinancial = snapshot.readiness.financialEvidence.summary.verified > 0;
    if (!hasVerifiedFinancial) {
      missing.add("Verified private invoice/payment evidence is still required before claiming revenue proof.");
    }
  }

  if (/\b(user|customer|testimonial|pilot)\b/iu.test(lower)) {
    const hasConsented = snapshot.pilotRecords.some((pilot) => pilot.consentStatus === "consented");
    if (!hasConsented) {
      missing.add("Customer/user evidence needs explicit consent before it can appear in judge-safe output.");
    }
  }

  if (/\b(certified|compliant|audit|legal)\b/iu.test(lower)) {
    missing.add("Only SOC2 readiness evidence can be cited; certification, legal, or auditor conclusions require external human review.");
  }

  if (/\b(workspace|gmail|drive|sync|oauth)\b/iu.test(lower) && !citations.some((citation) => citation.kind === "audit-event")) {
    missing.add("Workspace OAuth/sync proof is not sufficiently cited in the current evidence set.");
  }

  return [...missing];
}

function buildCitedAnswer(
  query: string,
  citations: EvidenceCopilotCitation[],
  missingEvidence: string[],
  warnings: string[]
) {
  const lead = `Based on ${citations.length} cited redacted source record(s), Sentinel can answer the question with evidence boundaries.`;
  const sourceSummary = citations
    .slice(0, 3)
    .map((citation) => `${citation.title} [${citation.sourceId}]`)
    .join("; ");
  const boundary =
    "Boundary: this is SOC2 readiness and operational evidence only; not certification, and not legal, audit, or compliance advice.";
  const gapText = missingEvidence.length ? ` Missing evidence: ${missingEvidence.join(" ")}` : "";
  const warningText = warnings.length ? ` Unsafe claim warning: ${warnings.join(" ")}` : "";

  return `${lead} Most relevant support: ${sourceSummary}. ${boundary}${gapText}${warningText}`.trim();
}

function cleanQuery(query: string) {
  return truncate(String(query ?? "").replace(/\s+/gu, " ").trim(), 500);
}

function tokenize(text: string) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 3 && !["the", "and", "for", "with", "from", "this", "that", "into", "over"].includes(token));
}

function clampInteger(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
