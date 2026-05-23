import { createHash } from "node:crypto";
import type { EvidenceVaultArtifactInput } from "@/lib/evidence-vault";
import type {
  EvidenceVaultArtifact,
  EvidenceVaultArtifactKind,
  EvidenceVaultArtifactStatus,
  EvidenceVaultImportCandidate,
  EvidenceVaultImportRequest,
  EvidenceVaultImportResult,
  EvidenceVaultImportSource
} from "@/lib/types";

type JsonObject = Record<string, unknown>;

interface ImportContext {
  source: EvidenceVaultImportSource;
  payload: JsonObject;
  checksumSha256: string;
  redacted: boolean;
  hosted: boolean;
  sourceUrl?: string;
  ownerNote?: string;
}

interface VerificationResultRow {
  id: string;
  status: string;
  detail?: string;
  ok?: boolean;
}

const blockedStatuses = new Set([
  "blocked",
  "failed",
  "missing",
  "needs-hosted-proof",
  "needs-review",
  "ready-for-review",
  "ready-to-record",
  "ready-to-commit",
  "secret-required",
  "transport-error"
]);

const mockStatuses = new Set(["mock", "mock-only", "simulated", "template-needs-values", "local-mock"]);
const verifiedStatuses = new Set(["passed", "ready", "verified", "captured", "published", "ready-to-capture", "ready-to-dry-run"]);

export function buildEvidenceVaultImport(input: EvidenceVaultImportRequest, generatedAt = new Date().toISOString()): EvidenceVaultImportResult {
  const payload = parsePayload(input.payload);
  const source = input.source ?? inferSource(payload);
  const checksumSha256 = sha256(stableStringify(payload));
  const redacted = input.redacted === true;
  const sourceUrl = cleanOptional(input.sourceUrl) ?? sourceUrlFromPayload(payload);
  const hosted = isHostedUrl(sourceUrl ?? urlFromPayload(payload));
  const context: ImportContext = {
    source,
    payload,
    checksumSha256,
    redacted,
    hosted,
    sourceUrl,
    ownerNote: cleanOptional(input.ownerNote)
  };
  const candidates = dedupeCandidates(buildCandidates(context));
  const blockers = [
    ...(candidates.length ? [] : ["No supported evidence artifact could be inferred from this JSON payload."]),
    ...(redacted ? [] : ["Imported JSON must be marked redacted before it can be registered as judge-facing evidence."])
  ];

  return {
    generatedAt,
    source,
    checksumSha256,
    redacted,
    status: blockers.length ? (redacted ? "blocked" : "needs-redaction") : "ready",
    artifactCount: candidates.length,
    candidates,
    blockers,
    warnings: buildWarnings(context, candidates),
    privateHandling: [
      "Store the full source JSON only in the private evidence store, not in public screenshots or repository files.",
      "The Evidence Vault keeps the checksum, redaction state, owner, and redacted source summary; it does not store raw tokens or customer content in this import result.",
      "A hosted JSON report can prove that a verification run happened, but blocked/mock statuses remain proof gaps until rerun successfully against production.",
      "Do not import customer names, OAuth tokens, API keys, raw Workspace content, invoices, or security findings without redaction."
    ],
    disclaimer:
      "This importer registers private evidence metadata from redacted JSON. It does not prove production readiness unless the source JSON came from the hosted product and the relevant checks passed."
  };
}

export function buildEvidenceVaultArtifactInputsFromImport(result: EvidenceVaultImportResult): EvidenceVaultArtifactInput[] {
  return result.candidates.map((candidate) => ({
    id: candidate.artifactId,
    kind: candidate.kind,
    label: candidate.label,
    ownerRole: candidate.ownerRole,
    status: candidate.status,
    sourceDescription: candidate.sourceDescription,
    checksumSha256: result.redacted && candidate.status === "verified" ? result.checksumSha256 : undefined,
    redacted: result.redacted,
    privateHandling: candidate.privateHandling,
    requiredFor: candidate.requiredFor,
    nextAction: candidate.nextAction
  }));
}

function buildCandidates(context: ImportContext): EvidenceVaultImportCandidate[] {
  if (context.source === "verify-production") {
    return buildVerifyProductionCandidates(context);
  }

  if (context.source === "hosted-evidence") {
    return buildHostedEvidenceCandidates(context);
  }

  return [candidateForSource(context, context.source, statusFromPayload(context.payload), detailFromPayload(context.payload))];
}

function buildVerifyProductionCandidates(context: ImportContext): EvidenceVaultImportCandidate[] {
  const rows = extractVerificationRows(context.payload);
  const pendingCount =
    Number((context.payload.summary as JsonObject | undefined)?.blockedOrNeedsReview ?? 0) +
    Number((context.payload.summary as JsonObject | undefined)?.failedTransport ?? 0);
  const candidates = [
    candidate({
      context,
      artifactId: "vault_production_readiness_report",
      kind: "production-readiness-report",
      label: "Hosted production readiness verification JSON",
      rawStatus: pendingCount === 0 ? "passed" : "uploaded",
      detail: `${rows.length} endpoint check(s), ${pendingCount} blocked/review or transport gap(s).`,
      requiredFor: "Submission Logistics",
      nextAction:
        pendingCount === 0
          ? "Keep this redacted verification JSON ready for the private judge packet."
          : "Clear blocked hosted verification rows, rerun verify:production, and import the replacement JSON."
    })
  ];

  for (const row of rows) {
    const mapped = mapVerifyProductionRow(row.id);
    if (!mapped) {
      continue;
    }

    candidates.push(
      candidate({
        context,
        artifactId: mapped.artifactId,
        kind: mapped.kind,
        label: mapped.label,
        rawStatus: row.status,
        detail: row.detail,
        requiredFor: mapped.requiredFor,
        nextAction: mapped.nextAction
      })
    );
  }

  return candidates;
}

function buildHostedEvidenceCandidates(context: ImportContext): EvidenceVaultImportCandidate[] {
  const checks = Array.isArray(context.payload.checks) ? (context.payload.checks as JsonObject[]) : [];

  return checks
    .map((check) => {
      const id = String(check.id ?? "");
      const mapped = mapHostedEvidenceCheck(id);
      if (!mapped) {
        return undefined;
      }

      return candidate({
        context,
        artifactId: mapped.artifactId,
        kind: mapped.kind,
        label: mapped.label,
        rawStatus: String(check.status ?? "missing"),
        detail: String(check.evidence ?? check.fix ?? ""),
        requiredFor: mapped.requiredFor,
        nextAction: mapped.nextAction
      });
    })
    .filter((item): item is EvidenceVaultImportCandidate => Boolean(item));
}

function candidateForSource(
  context: ImportContext,
  source: EvidenceVaultImportSource,
  rawStatus: string,
  detail?: string
): EvidenceVaultImportCandidate {
  const mapped =
    source === "cloudrun-deployment"
      ? {
          artifactId: "vault_cloud_run_deployment_proof",
          kind: "cloud-run-proof" as const,
          label: "Cloud Run deployment evidence JSON",
          requiredFor: "AI-Native Operations" as const,
          nextAction: "Attach Cloud Run revision, dry-run/deploy, and hosted URL proof."
        }
      : source === "gemini-smoke"
        ? {
            artifactId: "vault_gemini_usage_log",
            kind: "gemini-usage-log" as const,
            label: "Gemini API usage evidence JSON",
            requiredFor: "AI-Native Operations" as const,
            nextAction: "Persist provider=gemini-api agent-run metadata to BigQuery."
          }
        : source === "persistence"
          ? {
              artifactId: "vault_gcp_persistence_proof",
              kind: "gcp-persistence-proof" as const,
              label: "GCP persistence write-through evidence JSON",
              requiredFor: "AI-Native Operations" as const,
              nextAction: "Keep Firestore, BigQuery, and Secret Manager write-through output in the private judge packet."
            }
          : source === "workspace-bootstrap"
            ? {
                artifactId: "vault_workspace_oauth_log",
                kind: "workspace-oauth-log" as const,
                label: "Workspace sync bootstrap evidence JSON",
                requiredFor: "AI-Native Operations" as const,
                nextAction: "Attach Drive/Gmail cursor initialization and reconciliation output."
              }
            : {
                artifactId: "vault_cloud_billing_proof",
                kind: "cloud-billing-proof" as const,
                label: "Cloud Billing and Gemini key-control evidence JSON",
                requiredFor: "Business Viability" as const,
                nextAction: "Attach budget, alert, quota, and API-key restriction proof."
              };

  return candidate({ context, rawStatus, detail, ...mapped });
}

function candidate(input: {
  context: ImportContext;
  artifactId: string;
  kind: EvidenceVaultArtifactKind;
  label: string;
  rawStatus: string;
  detail?: string;
  requiredFor: EvidenceVaultArtifact["requiredFor"];
  nextAction: string;
}): EvidenceVaultImportCandidate {
  const status = statusForImport(input.rawStatus, input.context);
  const sourceDescription = [
    `${input.context.source} import: ${input.label}.`,
    `Status ${sanitizeText(input.rawStatus)}.`,
    input.detail ? sanitizeText(input.detail) : undefined,
    input.context.sourceUrl ? `Source ${sanitizeSourceUrl(input.context.sourceUrl)}.` : undefined,
    `Checksum ${input.context.checksumSha256}.`,
    input.context.ownerNote ? `Owner note: ${sanitizeText(input.context.ownerNote)}.` : undefined
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);

  return {
    artifactId: input.artifactId,
    kind: input.kind,
    label: input.label,
    status,
    ownerRole: ownerRoleForKind(input.kind),
    requiredFor: input.requiredFor,
    sourceDescription,
    nextAction: status === "verified" ? "Keep this redacted, checksummed artifact ready for judge request." : input.nextAction,
    privateHandling:
      "Keep the raw JSON private; expose only redacted summary, owner, status, checksum, and proof boundary in judge-facing exports."
  };
}

function statusForImport(rawStatus: string, context: ImportContext): EvidenceVaultArtifactStatus {
  const normalized = rawStatus.toLowerCase();

  if (!context.redacted) {
    return "needs-redaction";
  }

  if (!context.hosted || mockStatuses.has(normalized)) {
    return "mock-only";
  }

  if (verifiedStatuses.has(normalized)) {
    return "verified";
  }

  if (blockedStatuses.has(normalized)) {
    return "requested";
  }

  return "uploaded";
}

function mapVerifyProductionRow(id: string) {
  const mappings: Record<
    string,
    {
      artifactId: string;
      kind: EvidenceVaultArtifactKind;
      label: string;
      requiredFor: EvidenceVaultArtifact["requiredFor"];
      nextAction: string;
    }
  > = {
    "cloudrun-deployment-evidence": {
      artifactId: "vault_cloud_run_deployment_proof",
      kind: "cloud-run-proof",
      label: "Cloud Run deployment verification row",
      requiredFor: "AI-Native Operations",
      nextAction: "Replace template or blocked output with redacted Cloud Run deploy/revision proof."
    },
    "hosted-evidence-capture": {
      artifactId: "vault_production_readiness_report",
      kind: "production-readiness-report",
      label: "Hosted evidence capture row",
      requiredFor: "Submission Logistics",
      nextAction: "Clear hosted-evidence gaps and import the replacement report."
    },
    "gemini-proof-status": {
      artifactId: "vault_gemini_usage_log",
      kind: "gemini-usage-log",
      label: "Gemini proof status row",
      requiredFor: "AI-Native Operations",
      nextAction: "Run hosted Gemini smoke until provider=gemini-api is recorded."
    },
    "gemini-smoke-write-through": {
      artifactId: "vault_gemini_usage_log",
      kind: "gemini-usage-log",
      label: "Gemini write-through proof row",
      requiredFor: "AI-Native Operations",
      nextAction: "Persist provider=gemini-api agent-run evidence."
    },
    "persistence-write-through": {
      artifactId: "vault_gcp_persistence_proof",
      kind: "gcp-persistence-proof",
      label: "GCP persistence write-through row",
      requiredFor: "AI-Native Operations",
      nextAction: "Clear Firestore, BigQuery, and Secret Manager write-through gaps."
    },
    "workspace-bootstrap": {
      artifactId: "vault_workspace_oauth_log",
      kind: "workspace-oauth-log",
      label: "Workspace bootstrap row",
      requiredFor: "AI-Native Operations",
      nextAction: "Run live Workspace sync bootstrap after consented OAuth install."
    },
    "workspace-reconcile": {
      artifactId: "vault_workspace_oauth_log",
      kind: "workspace-oauth-log",
      label: "Workspace reconcile row",
      requiredFor: "AI-Native Operations",
      nextAction: "Attach Drive/Gmail reconciliation output from hosted production."
    },
    "cost-controls-write-through": {
      artifactId: "vault_cloud_billing_proof",
      kind: "cloud-billing-proof",
      label: "Cloud Billing and key-control row",
      requiredFor: "Business Viability",
      nextAction: "Attach budget, alert, quota, and API-key restriction proof."
    },
    "source-release": {
      artifactId: "vault_repository_proof",
      kind: "repository-proof",
      label: "Source release proof row",
      requiredFor: "Submission Logistics",
      nextAction: "Keep repository URL and source-release guard output ready for submission review."
    }
  };

  return mappings[id];
}

function mapHostedEvidenceCheck(id: string) {
  const mappings: Record<string, ReturnType<typeof mapVerifyProductionRow>> = {
    "hosted-product-url": {
      artifactId: "vault_product_url_proof",
      kind: "product-url-proof",
      label: "Hosted product URL evidence",
      requiredFor: "Submission Logistics",
      nextAction: "Configure hosted URL, judge access, and free judging-period access."
    },
    "cloudrun-deployment-output": mapVerifyProductionRow("cloudrun-deployment-evidence"),
    "production-readiness-readonly": {
      artifactId: "vault_production_readiness_report",
      kind: "production-readiness-report",
      label: "Read-only production verification JSON",
      requiredFor: "Submission Logistics",
      nextAction: "Run read-only verify:production against the hosted URL."
    },
    "production-readiness-write-through": mapVerifyProductionRow("persistence-write-through"),
    "live-gemini-proof": mapVerifyProductionRow("gemini-proof-status"),
    "gcp-persistence-proof": mapVerifyProductionRow("persistence-write-through"),
    "workspace-oauth-sync-proof": mapVerifyProductionRow("workspace-bootstrap"),
    "cloud-cost-controls-proof": mapVerifyProductionRow("cost-controls-write-through"),
    "demo-video-proof": {
      artifactId: "vault_demo_video_proof",
      kind: "demo-video-proof",
      label: "Demo video proof",
      requiredFor: "Submission Logistics",
      nextAction: "Record and publish the final public demo video after redaction and asset review."
    }
  };

  return mappings[id];
}

function extractVerificationRows(payload: JsonObject): VerificationResultRow[] {
  if (!Array.isArray(payload.results)) {
    return [];
  }

  return payload.results
    .filter((row): row is JsonObject => Boolean(row && typeof row === "object"))
    .map((row) => ({
      id: String(row.id ?? ""),
      status: String(row.status ?? "unknown"),
      detail: typeof row.detail === "string" ? row.detail : undefined,
      ok: typeof row.ok === "boolean" ? row.ok : undefined
    }))
    .filter((row) => row.id);
}

function dedupeCandidates(candidates: EvidenceVaultImportCandidate[]) {
  const byId = new Map<string, EvidenceVaultImportCandidate>();
  for (const item of candidates) {
    const existing = byId.get(item.artifactId);
    if (!existing || statusRank(item.status) > statusRank(existing.status)) {
      byId.set(item.artifactId, item);
    }
  }

  return [...byId.values()];
}

function statusRank(status: EvidenceVaultArtifactStatus) {
  return status === "verified" ? 5 : status === "uploaded" ? 4 : status === "requested" ? 3 : status === "needs-redaction" ? 2 : status === "mock-only" ? 1 : 0;
}

function buildWarnings(context: ImportContext, candidates: EvidenceVaultImportCandidate[]) {
  return [
    ...(context.hosted ? [] : ["Source URL is not a hosted HTTPS URL, so imported artifacts remain mock-only proof boundaries."]),
    ...(context.redacted ? [] : ["Redaction was not confirmed; imported artifacts are marked needs-redaction."]),
    ...candidates
      .filter((candidate) => candidate.status !== "verified")
      .slice(0, 5)
      .map((candidate) => `${candidate.label} imported as ${candidate.status}; it is not final production proof.`)
  ];
}

function inferSource(payload: JsonObject): EvidenceVaultImportSource {
  if (Array.isArray(payload.results)) {
    return "verify-production";
  }

  if (Array.isArray(payload.checks) && typeof payload.productUrl === "string") {
    return "hosted-evidence";
  }

  if (typeof payload.overallStatus === "string" && Array.isArray(payload.envChecks)) {
    return "cloudrun-deployment";
  }

  if (typeof payload.provider === "string" || typeof payload.decisionSummary === "string") {
    return "gemini-smoke";
  }

  if (Array.isArray(payload.checks) && typeof payload.mode === "string") {
    return "persistence";
  }

  if (typeof (payload.result as JsonObject | undefined)?.attemptedLiveApi === "boolean") {
    return "workspace-bootstrap";
  }

  return "cost-controls";
}

function statusFromPayload(payload: JsonObject) {
  const result = payload.result as JsonObject | undefined;
  return String(payload.overallStatus ?? payload.status ?? result?.status ?? "uploaded");
}

function detailFromPayload(payload: JsonObject) {
  const result = payload.result as JsonObject | undefined;
  return String(payload.detail ?? payload.decisionSummary ?? result?.checks ?? payload.disclaimer ?? "").slice(0, 300);
}

function sourceUrlFromPayload(payload: JsonObject) {
  return cleanOptional(String(payload.baseUrl ?? payload.productUrl ?? ""));
}

function urlFromPayload(payload: JsonObject) {
  return sourceUrlFromPayload(payload) ?? "";
}

function parsePayload(payload: unknown): JsonObject {
  if (typeof payload === "string") {
    const parsed = JSON.parse(payload) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
  }

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as JsonObject;
  }

  throw new Error("Evidence import payload must be a JSON object or JSON object string.");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonObject)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isHostedUrl(rawUrl = "") {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

function ownerRoleForKind(kind: EvidenceVaultArtifactKind): EvidenceVaultArtifact["ownerRole"] {
  if (kind === "cloud-billing-proof") {
    return "engineering";
  }

  if (kind === "demo-video-proof") {
    return "sales";
  }

  if (kind === "repository-proof" || kind === "product-url-proof" || kind === "production-readiness-report") {
    return "engineering";
  }

  return "engineering";
}

function sanitizeText(value: string) {
  return value
    .replace(/\bBearer\s+\S+/giu, "[redacted-token]")
    .replace(/\b(?:Bearer\s+)?[A-Za-z0-9._~+/=-]{32,}\b/gu, "[redacted-token]")
    .replace(/\b(api[_-]?key|secret|token|password|refresh_token|access_token)\s*[:=]\s*[^,\s;]+/giu, "$1=[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[redacted-email]")
    .slice(0, 400);
}

function sanitizeSourceUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return sanitizeText(value);
  }
}

function cleanOptional(value?: string) {
  const cleaned = value?.trim();
  return cleaned ? cleaned.slice(0, 500) : undefined;
}
