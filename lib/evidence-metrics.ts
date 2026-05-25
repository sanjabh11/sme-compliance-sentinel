import { sentinelConfig } from "@/lib/config";
import type { DashboardSnapshot, MetricId, MetricIntent, MetricQueryResult, MetricSqlPlan, Severity } from "@/lib/types";

const maxBytesBilled = 10_000_000;
const severities: Severity[] = ["critical", "high", "medium", "low", "info"];
const findingStatuses = ["recommended", "approved", "remediated", "dismissed", "false_positive", "rescanning"];

const metricCatalog: Record<
  MetricId,
  {
    label: string;
    view: string;
    keywords: string[];
    sql: string;
  }
> = {
  findings_by_severity: {
    label: "Findings by severity",
    view: "sentinel_findings_summary_v",
    keywords: ["finding", "findings", "severity", "critical", "high", "medium", "low"],
    sql: "SELECT severity, COUNT(*) AS finding_count FROM `${project}.${dataset}.sentinel_findings_summary_v` WHERE tenant_id = @tenant_id GROUP BY severity ORDER BY finding_count DESC"
  },
  findings_by_status: {
    label: "Findings by status",
    view: "sentinel_findings_summary_v",
    keywords: ["finding", "findings", "status", "recommended", "approved", "dismissed", "remediated"],
    sql: "SELECT status, COUNT(*) AS finding_count FROM `${project}.${dataset}.sentinel_findings_summary_v` WHERE tenant_id = @tenant_id GROUP BY status ORDER BY finding_count DESC"
  },
  remediations_approved: {
    label: "Remediations approved",
    view: "sentinel_remediations_summary_v",
    keywords: ["remediation", "remediations", "approved", "approve"],
    sql: "SELECT action, COUNT(*) AS approved_count FROM `${project}.${dataset}.sentinel_remediations_summary_v` WHERE tenant_id = @tenant_id AND mode = 'human_approved' GROUP BY action ORDER BY approved_count DESC"
  },
  false_positive_rate: {
    label: "False-positive rate",
    view: "sentinel_findings_summary_v",
    keywords: ["false", "positive", "false-positive", "rate"],
    sql: "SELECT SAFE_DIVIDE(COUNTIF(status = 'false_positive'), COUNT(*)) AS false_positive_rate FROM `${project}.${dataset}.sentinel_findings_summary_v` WHERE tenant_id = @tenant_id"
  },
  public_exposures_closed: {
    label: "Public exposures closed",
    view: "sentinel_remediations_summary_v",
    keywords: ["public", "exposure", "closed", "sharing", "disable"],
    sql: "SELECT COUNT(*) AS public_exposures_closed FROM `${project}.${dataset}.sentinel_remediations_summary_v` WHERE tenant_id = @tenant_id AND action = 'disable_public_sharing' AND outcome != 'failed'"
  },
  agent_run_cost: {
    label: "Agent-run cost",
    view: "sentinel_agent_runs_summary_v",
    keywords: ["agent", "run", "cost", "spend", "gemini", "token"],
    sql: "SELECT provider, model, SUM(estimated_cost_usd) AS estimated_cost_usd FROM `${project}.${dataset}.sentinel_agent_runs_summary_v` WHERE tenant_id = @tenant_id GROUP BY provider, model ORDER BY estimated_cost_usd DESC"
  },
  bytes_routed_to_gemini: {
    label: "Bytes routed to Gemini",
    view: "sentinel_counters_summary_v",
    keywords: ["bytes", "routed", "gemini", "dlp", "counter"],
    sql: "SELECT SUM(bytes_routed_to_gemini) AS bytes_routed_to_gemini FROM `${project}.${dataset}.sentinel_counters_summary_v` WHERE tenant_id = @tenant_id"
  },
  audit_events_by_type: {
    label: "Audit events by type",
    view: "sentinel_audit_events_v",
    keywords: ["audit", "event", "events", "type", "chain"],
    sql: "SELECT type, COUNT(*) AS event_count FROM `${project}.${dataset}.sentinel_audit_events_v` WHERE tenant_id = @tenant_id GROUP BY type ORDER BY event_count DESC"
  },
  evidence_vault_readiness: {
    label: "Evidence Vault readiness",
    view: "sentinel_evidence_vault_summary_v",
    keywords: ["evidence", "vault", "readiness", "artifact", "proof", "redaction"],
    sql: "SELECT status, COUNT(*) AS artifact_count FROM `${project}.${dataset}.sentinel_evidence_vault_summary_v` WHERE tenant_id = @tenant_id GROUP BY status ORDER BY artifact_count DESC"
  },
  pilot_mrr_users: {
    label: "Pilot MRR and users",
    view: "sentinel_pilots_summary_v",
    keywords: ["pilot", "mrr", "revenue", "users", "customer", "business"],
    sql: "SELECT SUM(monthly_revenue_usd) AS mrr_usd, SUM(active_users) AS active_users, COUNT(*) AS pilot_count FROM `${project}.${dataset}.sentinel_pilots_summary_v` WHERE tenant_id = @tenant_id"
  }
};

const injectionPatterns = [
  /\bdrop\s+tables?\b/iu,
  /\bdelete\s+from\b/iu,
  /\binsert\s+into\b/iu,
  /\bupdate\s+\w+\s+set\b/iu,
  /\bremove\s+tenant\b/iu,
  /\bbypass\s+(?:tenant|allowlist|filter)\b/iu,
  /\braw\s+(?:content|document|secret|token|invoice)\b/iu,
  /\b(api\s*keys?|oauth|refresh\s*tokens?|client\s*secrets?|passwords?|bearer)\b/iu,
  /;\s*(select|drop|delete|update|insert)\b/iu
];

export function queryEvidenceMetrics(snapshot: DashboardSnapshot, question: string): MetricQueryResult {
  const cleanedQuestion = cleanQuestion(question);
  const safetyWarnings = getMetricSafetyWarnings(cleanedQuestion);
  const intent = buildMetricIntent(snapshot.tenant.id, cleanedQuestion, safetyWarnings);
  const sqlPlan = compileMetricSql(intent);
  const rows = safetyWarnings.length ? [] : runMockMetric(snapshot, intent.metricId);
  const blocked = safetyWarnings.length > 0;

  return {
    generatedAt: new Date().toISOString(),
    question: cleanedQuestion,
    intent,
    rows,
    summary: blocked
      ? "Metric request blocked because it asks for unsafe SQL, raw content, secrets, or tenant-filter bypass."
      : summarizeMetric(intent.metricId, rows),
    sqlPlan,
    blocked,
    safetyWarnings,
    nextAction: blocked
      ? "Rephrase the metric request using an approved evidence metric without raw content, secrets, or tenant-filter bypass."
      : "Use the mock result locally; production BigQuery must dry-run this compiled allowlisted SQL before execution."
  };
}

export function buildMetricIntent(tenantId: string, question: string, warnings: string[] = []): MetricIntent {
  const lower = question.toLowerCase();
  const metricId = warnings.length
    ? "audit_events_by_type"
    : (Object.entries(metricCatalog).find(([, metric]) => metric.keywords.some((keyword) => lower.includes(keyword)))?.[0] as
        | MetricId
        | undefined) ?? "evidence_vault_readiness";

  return {
    metricId,
    label: metricCatalog[metricId].label,
    tenantId,
    filters: {},
    rejectedTerms: warnings,
    source: "deterministic"
  };
}

export function compileMetricSql(intent: MetricIntent): MetricSqlPlan {
  const metric = metricCatalog[intent.metricId];
  const project = sentinelConfig.googleCloudProject || "PROJECT_ID";
  const dataset = sentinelConfig.bigQueryDataset || "sentinel_evidence";
  const sql = metric.sql.replaceAll("${project}", project).replaceAll("${dataset}", dataset);

  return {
    sql,
    parameters: [{ name: "tenant_id", type: "STRING", value: intent.tenantId }],
    tenantFilter: "tenant_id = @tenant_id",
    readOnlyView: metric.view,
    dryRunRequired: true,
    maximumBytesBilled: maxBytesBilled,
    rawContentColumnsExcluded: ["raw_content", "document_text", "secret_value", "oauth_token", "refresh_token", "invoice_pdf"],
    executionMode: sentinelConfig.storageMode === "gcp-rest" ? "production-plan" : "mock"
  };
}

export function getMetricSafetyWarnings(question: string) {
  const warnings: string[] = [];
  for (const pattern of injectionPatterns) {
    if (pattern.test(question)) {
      warnings.push("Unsafe metric request: arbitrary SQL, raw content, secrets, or tenant-filter bypass is not allowed.");
      break;
    }
  }
  return warnings;
}

function runMockMetric(snapshot: DashboardSnapshot, metricId: MetricId): Array<Record<string, string | number | boolean>> {
  switch (metricId) {
    case "findings_by_severity":
      return severities.map((severity) => ({
        severity,
        finding_count: snapshot.findings.filter((finding) => finding.severity === severity).length
      }));
    case "findings_by_status":
      return findingStatuses.map((status) => ({
        status,
        finding_count: snapshot.findings.filter((finding) => finding.status === status).length
      }));
    case "remediations_approved":
      return groupCount(
        snapshot.remediations.filter((item) => item.mode === "human_approved"),
        "action",
        "approved_count",
        (item) => item.action
      );
    case "false_positive_rate": {
      const falsePositives = snapshot.findings.filter((finding) => finding.status === "false_positive").length;
      return [{ false_positive_rate: snapshot.findings.length ? Number((falsePositives / snapshot.findings.length).toFixed(3)) : 0 }];
    }
    case "public_exposures_closed":
      return [
        {
          public_exposures_closed: snapshot.remediations.filter(
            (item) => item.action === "disable_public_sharing" && item.outcome !== "failed"
          ).length
        }
      ];
    case "agent_run_cost":
      return groupSum(
        snapshot.agentRuns,
        "provider",
        "estimated_cost_usd",
        (item) => item.provider,
        (item) => item.estimatedCostUsd
      );
    case "bytes_routed_to_gemini":
      return [{ bytes_routed_to_gemini: snapshot.aggregateCounters.bytesRoutedToGemini }];
    case "audit_events_by_type":
      return groupCount(snapshot.auditEvents, "type", "event_count", (item) => item.type);
    case "pilot_mrr_users":
      return [
        {
          mrr_usd: snapshot.tenant.evidence.mrrUsd,
          active_users: snapshot.tenant.evidence.activeUsers,
          pilot_count: snapshot.tenant.evidence.pilotCount
        }
      ];
    case "evidence_vault_readiness":
    default:
      return Object.entries(snapshot.readiness.evidenceVault.summary).map(([status, artifact_count]) => ({
        status,
        artifact_count
      }));
  }
}

function summarizeMetric(metricId: MetricId, rows: Array<Record<string, string | number | boolean>>) {
  if (metricId === "pilot_mrr_users") {
    const row = rows[0] ?? {};
    return `Pilot evidence currently shows $${row.mrr_usd ?? 0}/mo MRR, ${row.active_users ?? 0} active user(s), and ${row.pilot_count ?? 0} pilot(s), subject to private proof and consent boundaries.`;
  }

  if (metricId === "agent_run_cost") {
    const total = rows.reduce((sum, row) => sum + Number(row.estimated_cost_usd ?? 0), 0);
    return `Agent-run estimated cost is $${total.toFixed(4)} across ${rows.length} provider/model group(s).`;
  }

  return `${metricCatalog[metricId].label} returned ${rows.length} row(s) from the local evidence snapshot.`;
}

function groupCount<T>(items: T[], keyLabel: string, countLabel: string, keyFn: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const group = keyFn(item) || "unknown";
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return [...counts.entries()].map(([group, count]) => ({ [keyLabel]: group, [countLabel]: count }));
}

function groupSum<T>(
  items: T[],
  keyLabel: string,
  sumLabel: string,
  keyFn: (item: T) => string,
  valueFn: (item: T) => number
) {
  const sums = new Map<string, number>();
  for (const item of items) {
    const group = keyFn(item) || "unknown";
    sums.set(group, (sums.get(group) ?? 0) + valueFn(item));
  }
  return [...sums.entries()].map(([group, sum]) => ({ [keyLabel]: group, [sumLabel]: Number(sum.toFixed(6)) }));
}

function cleanQuestion(question: string) {
  return String(question ?? "").replace(/\s+/gu, " ").trim().slice(0, 500);
}
