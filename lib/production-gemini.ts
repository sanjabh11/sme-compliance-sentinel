import { sentinelConfig } from "@/lib/config";
import { fetchCloudRunAccessToken } from "@/lib/persistence";
import type { DashboardSnapshot, ProductionGeminiProofResult, ResourceEvent, ScanDecision } from "@/lib/types";

type GeminiProofSnapshot = Pick<DashboardSnapshot, "agentRuns" | "auditEvents" | "findings">;
type DurableGeminiAgentRun = {
  id: string;
  eventId?: string;
  findingId?: string;
  purpose: string;
  model: string;
  provider: "gemini-api";
  estimatedCostUsd?: number;
  completedAt?: string;
};

export function buildProductionGeminiProofStatus(snapshot: GeminiProofSnapshot): ProductionGeminiProofResult {
  const latestLiveRun = snapshot.agentRuns.find((run) => run.provider === "gemini-api");
  const latestRun = latestLiveRun ?? snapshot.agentRuns[0];
  const finding = latestRun?.findingId
    ? snapshot.findings.find((candidate) => candidate.id === latestRun.findingId)
    : undefined;

  if (latestLiveRun) {
    return {
      generatedAt: new Date().toISOString(),
      status: "passed",
      provider: latestLiveRun.provider,
      model: latestLiveRun.model,
      eventId: latestLiveRun.eventId,
      findingId: latestLiveRun.findingId,
      agentRunId: latestLiveRun.id,
      estimatedCostUsd: latestLiveRun.estimatedCostUsd,
      decisionSummary: `Live Gemini API run recorded for ${finding?.resourceName ?? latestLiveRun.purpose}.`,
      proofSummary:
        "Current state contains provider=gemini-api metadata. For final XPRIZE proof, persist this run to BigQuery and attach redacted hosted verification output.",
      nextAction: "Run /api/production/persistence POST in gcp-rest mode so the live Gemini run is written to the BigQuery agent-run table.",
      privateHandling: privateHandlingRules()
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    status: latestRun ? "mock-only" : "blocked",
    provider: latestRun?.provider,
    model: latestRun?.model ?? sentinelConfig.geminiModel,
    eventId: latestRun?.eventId,
    findingId: latestRun?.findingId,
    agentRunId: latestRun?.id,
    fallbackReason: latestRun?.fallbackReason,
    errorClass: latestRun?.errorClass,
    estimatedCostUsd: latestRun?.estimatedCostUsd,
    decisionSummary: latestRun
      ? `Only ${latestRun.provider} evidence is present; fallback=${latestRun.fallbackReason ?? "none"}.`
      : "No Gemini or agent-run evidence is present in current state.",
    proofSummary:
      "This does not satisfy deployed Gemini API proof. A real production run must record provider=gemini-api with model, timestamp, token estimate, cost estimate, and staged recommendation metadata.",
    nextAction: "Configure GEMINI_API_KEY in Secret Manager, deploy Cloud Run, then POST /api/production/gemini-smoke using the synthetic fixture.",
    privateHandling: privateHandlingRules()
  };
}

export async function buildProductionGeminiProofStatusWithDurableEvidence(
  snapshot: GeminiProofSnapshot,
  fetchImpl: typeof fetch = fetch
): Promise<ProductionGeminiProofResult> {
  const inMemoryStatus = buildProductionGeminiProofStatus(snapshot);

  if (inMemoryStatus.status === "passed" || !hasDurableGeminiEvidenceConfig()) {
    return inMemoryStatus;
  }

  const durableRun = await fetchLatestDurableGeminiAgentRun(fetchImpl);

  if (!durableRun) {
    return inMemoryStatus;
  }

  return {
    generatedAt: new Date().toISOString(),
    status: "passed",
    provider: durableRun.provider,
    model: durableRun.model,
    eventId: durableRun.eventId,
    findingId: durableRun.findingId,
    agentRunId: durableRun.id,
    estimatedCostUsd: durableRun.estimatedCostUsd,
    decisionSummary: `Durable BigQuery Gemini API run recorded for ${durableRun.purpose}.`,
    proofSummary:
      "BigQuery agent_runs contains provider=gemini-api metadata from the hosted Cloud Run service. Attach the verifier output and the redacted BigQuery row to the private evidence binder.",
    nextAction:
      "Complete the remaining manual evidence gates: Workspace OAuth consent, quota evidence, judge access, demo video, and business proof.",
    privateHandling: privateHandlingRules()
  };
}

export function buildProductionGeminiSmokeResult(
  event: ResourceEvent,
  result: { decision?: ScanDecision; snapshot: GeminiProofSnapshot }
): ProductionGeminiProofResult {
  const snapshot = result.snapshot;
  const run = snapshot.agentRuns.find((candidate) => candidate.eventId === event.id);

  if (!run) {
    return {
      generatedAt: new Date().toISOString(),
      status: "blocked",
      model: sentinelConfig.geminiModel,
      eventId: event.id,
      decisionSummary: result.decision?.skipped
        ? `Synthetic smoke event was skipped: ${result.decision.skipReason ?? "unknown reason"}.`
        : "Synthetic smoke event did not produce an agent-run record.",
      proofSummary: "No live Gemini proof was created.",
      nextAction: "Check Tier 0/Tier 1 scanner routing, Gemini model allowlist, and budget guardrail configuration.",
      privateHandling: privateHandlingRules()
    };
  }

  const status: ProductionGeminiProofResult["status"] = run.provider === "gemini-api" ? "passed" : "mock-only";

  return {
    generatedAt: new Date().toISOString(),
    status,
    provider: run.provider,
    model: run.model,
    eventId: event.id,
    findingId: run.findingId,
    agentRunId: run.id,
    fallbackReason: run.fallbackReason,
    errorClass: run.errorClass,
    estimatedCostUsd: run.estimatedCostUsd,
    decisionSummary:
      run.provider === "gemini-api"
        ? "Synthetic non-customer fixture completed through Gemini API and created a staged recommendation."
        : `Synthetic fixture completed without live Gemini API proof; provider=${run.provider}, fallback=${run.fallbackReason ?? "none"}.`,
    proofSummary:
      run.provider === "gemini-api"
        ? "Attach this hosted POST response and the BigQuery agent-run row to the private XPRIZE evidence binder."
        : "This run is useful local/demo evidence only and must not be counted as deployed Gemini API proof.",
    nextAction:
      run.provider === "gemini-api"
        ? "Run production persistence write-through so the provider=gemini-api row is durable in BigQuery."
        : "Configure the production Gemini API key and retry from the hosted Cloud Run URL.",
    privateHandling: privateHandlingRules()
  };
}

function privateHandlingRules() {
  return [
    "The smoke fixture is synthetic and must not include customer files, employee records, payment data, PHI, or real secrets.",
    "Share model, provider, timestamps, token estimates, cost estimates, and redacted summaries only.",
    "Do not publish raw prompts, API keys, customer file names, tenant emails, or unredacted findings.",
    "Final XPRIZE proof still needs hosted Cloud Run output and a durable BigQuery agent-run row with provider=gemini-api."
  ];
}

function hasDurableGeminiEvidenceConfig() {
  return (
    sentinelConfig.storageMode === "gcp-rest" &&
    Boolean(sentinelConfig.googleCloudProject) &&
    Boolean(sentinelConfig.bigQueryDataset) &&
    Boolean(sentinelConfig.bigQueryAgentRunsTable)
  );
}

async function fetchLatestDurableGeminiAgentRun(fetchImpl: typeof fetch): Promise<DurableGeminiAgentRun | undefined> {
  try {
    const accessToken = await fetchCloudRunAccessToken(fetchImpl);
    const response = await fetchImpl(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${sentinelConfig.googleCloudProject}/queries`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          query: [
            "SELECT run_id, event_id, finding_id, purpose, model, provider, estimated_cost_usd, completed_at",
            `FROM \`${sentinelConfig.googleCloudProject}.${sentinelConfig.bigQueryDataset}.${sentinelConfig.bigQueryAgentRunsTable}\``,
            "WHERE tenant_id = @tenantId AND provider = 'gemini-api'",
            "ORDER BY completed_at DESC",
            "LIMIT 1"
          ].join(" "),
          useLegacySql: false,
          parameterMode: "NAMED",
          queryParameters: [
            {
              name: "tenantId",
              parameterType: { type: "STRING" },
              parameterValue: { value: sentinelConfig.tenantId }
            }
          ]
        })
      }
    );

    if (!response.ok) {
      return undefined;
    }

    const body = (await response.json()) as { rows?: Array<{ f?: Array<{ v?: string | number | null }> }> };
    const row = body.rows?.[0]?.f;

    if (!row) {
      return undefined;
    }

    return {
      id: readBigQueryString(row, 0) ?? "",
      eventId: readBigQueryString(row, 1),
      findingId: readBigQueryString(row, 2),
      purpose: readBigQueryString(row, 3) ?? "durable Gemini proof",
      model: readBigQueryString(row, 4) ?? sentinelConfig.geminiModel,
      provider: "gemini-api",
      estimatedCostUsd: readBigQueryNumber(row, 6),
      completedAt: readBigQueryString(row, 7)
    };
  } catch {
    return undefined;
  }
}

function readBigQueryString(row: Array<{ v?: string | number | null }>, index: number) {
  const value = row[index]?.v;

  return typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;
}

function readBigQueryNumber(row: Array<{ v?: string | number | null }>, index: number) {
  const value = row[index]?.v;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  return Number.isFinite(parsed) ? parsed : undefined;
}
