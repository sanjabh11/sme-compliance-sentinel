import {
  demoVideoClearanceSummary,
  hasDemoVideoClearance,
  hasJudgeProductAccess,
  judgeProductAccessSummary,
  makeId,
  nowIso,
  sentinelConfig
} from "@/lib/config";
import type {
  DashboardSnapshot,
  EvidenceVault,
  EvidenceVaultArtifact,
  EvidenceVaultArtifactKind,
  EvidenceVaultArtifactStatus,
  PilotCustomerRecord
} from "@/lib/types";

type EvidenceVaultSnapshot = Pick<
  DashboardSnapshot,
  "tenant" | "pilotRecords" | "evidenceVaultArtifacts" | "agentRuns" | "connections"
>;

type EvidenceVaultOwnerRole = EvidenceVaultArtifact["ownerRole"];
type EvidenceVaultRequiredFor = EvidenceVaultArtifact["requiredFor"];

export interface EvidenceVaultArtifactInput {
  id?: string;
  kind?: EvidenceVaultArtifactKind;
  label?: string;
  ownerRole?: EvidenceVaultOwnerRole;
  status?: EvidenceVaultArtifactStatus;
  customerAlias?: string;
  linkedPilotId?: string;
  linkedFinancialItemId?: string;
  amountUsd?: number;
  sourceDescription?: string;
  checksumSha256?: string;
  redacted?: boolean;
  privateHandling?: string;
  requiredFor?: EvidenceVaultRequiredFor;
  nextAction?: string;
  expiresAt?: string;
}

const artifactStatuses: EvidenceVaultArtifactStatus[] = [
  "missing",
  "requested",
  "uploaded",
  "verified",
  "needs-redaction",
  "mock-only"
];

const artifactKinds: EvidenceVaultArtifactKind[] = [
  "pilot-consent",
  "pilot-invoice",
  "payment-export",
  "active-user-log",
  "cost-receipt",
  "cac-receipt",
  "testimonial-consent",
  "cloud-run-proof",
  "gcp-persistence-proof",
  "cloud-billing-proof",
  "gemini-usage-log",
  "production-readiness-report",
  "workspace-oauth-log",
  "product-url-proof",
  "demo-video-proof",
  "repository-proof",
  "trust-policy",
  "customer-reference"
];

export function buildEvidenceVault(snapshot: EvidenceVaultSnapshot): EvidenceVault {
  const evidenceMode: EvidenceVault["evidenceMode"] = sentinelConfig.evidenceMode === "production" ? "production" : "mock";
  const expectedArtifacts = buildExpectedArtifacts(snapshot);
  const registeredById = new Map(snapshot.evidenceVaultArtifacts.map((artifact) => [artifact.id, artifact]));
  const requiredArtifacts = expectedArtifacts.map((expected) => mergeRegisteredArtifact(expected, registeredById.get(expected.id)));
  const summary = summarizeArtifacts(requiredArtifacts);
  const missingOrUnsafe = summary.missing + summary["needs-redaction"];

  return {
    generatedAt: new Date().toISOString(),
    evidenceMode,
    summary,
    requiredArtifacts,
    blockers: [
      ...(evidenceMode !== "production" ? ["SENTINEL_EVIDENCE_MODE is not production, so vault artifacts are local proof only."] : []),
      ...(sentinelConfig.storageMode !== "gcp-rest" ? ["Evidence Vault artifacts are not persisted to Firestore/BigQuery yet."] : []),
      ...(missingOrUnsafe > 0 ? [`${missingOrUnsafe} required artifact(s) are missing or need redaction.`] : []),
      ...(summary.verified === 0 ? ["No required artifact has production verification yet."] : []),
      ...(sentinelConfig.evidenceSigningSecretConfigured ? [] : ["Final judge packet is not production-HMAC signed yet."])
    ].slice(0, 8),
    nextActions: [
      "Upload or register private invoice/payment proof for every counted pilot.",
      "Attach active-user screenshots/logs with customer emails redacted.",
      "Attach Cloud Billing, CAC, Gemini usage, and Workspace OAuth evidence from the deployed project.",
      "Mark each artifact redacted before it can appear in a judge packet.",
      "Verify artifact checksums after production storage is enabled."
    ],
    disclaimer:
      "The Evidence Vault is a private proof register. It tracks artifact readiness and redaction state, but local entries are not production proof until backed by real documents and durable storage."
  };
}

export function normalizeEvidenceVaultArtifactInput(
  input: EvidenceVaultArtifactInput,
  tenantId: string,
  createdAt = nowIso()
): EvidenceVaultArtifact {
  const kind = parseKind(input.kind);
  const status = parseStatus(input.status);
  const ownerRole = parseOwnerRole(input.ownerRole ?? roleForKind(kind));
  const label = cleanText(input.label ?? labelForKind(kind));
  const sourceDescription = cleanText(input.sourceDescription ?? "Private evidence artifact registered by admin.");
  const checksumSha256 = cleanOptionalText(input.checksumSha256);

  if (checksumSha256 && !/^[a-f0-9]{64}$/iu.test(checksumSha256)) {
    throw new Error("Evidence checksum must be a SHA-256 hex digest.");
  }

  return {
    id: cleanText(input.id ?? makeId("vault")),
    tenantId,
    kind,
    label,
    ownerRole,
    status,
    customerAlias: cleanOptionalText(input.customerAlias),
    linkedPilotId: cleanOptionalText(input.linkedPilotId),
    linkedFinancialItemId: cleanOptionalText(input.linkedFinancialItemId),
    amountUsd: typeof input.amountUsd === "number" && Number.isFinite(input.amountUsd) ? Math.max(0, Math.round(input.amountUsd)) : undefined,
    sourceDescription,
    checksumSha256,
    redacted: input.redacted ?? false,
    privateHandling: cleanText(
      input.privateHandling ??
        "Keep the source document private; expose only redacted alias, status, checksum, and owner routing in judge-facing exports."
    ),
    requiredFor: input.requiredFor ?? requiredForKind(kind),
    nextAction: cleanText(input.nextAction ?? nextActionForStatus(status)),
    blocker: cleanOptionalText(blockerForArtifact(status, input.redacted ?? false, checksumSha256)),
    createdAt,
    updatedAt: createdAt,
    expiresAt: cleanOptionalText(input.expiresAt)
  };
}

function buildExpectedArtifacts(snapshot: EvidenceVaultSnapshot): EvidenceVaultArtifact[] {
  const now = nowIso();
  const qualifiedPilots = snapshot.pilotRecords.filter((pilot) => pilot.armsLength && !pilot.relatedParty);
  const hasGeminiApiRun = snapshot.agentRuns.some((run) => run.provider === "gemini-api");
  const hasLiveWorkspaceConnection = snapshot.connections.some(
    (connection) => connection.mode === "oauth" || connection.mode === "domain-wide-delegation"
  );

  return [
    ...qualifiedPilots.map((pilot) => expectedPilotConsentArtifact(snapshot.tenant.id, pilot, now)),
    ...qualifiedPilots.map((pilot) => expectedPilotInvoiceArtifact(snapshot.tenant.id, pilot, now)),
    ...qualifiedPilots.map((pilot) => expectedPilotPaymentArtifact(snapshot.tenant.id, pilot, now)),
    ...qualifiedPilots
      .filter((pilot) => pilot.testimonialQuote || pilot.consentStatus === "pending")
      .map((pilot) => expectedTestimonialConsentArtifact(snapshot.tenant.id, pilot, now)),
    expectedArtifact({
      id: "vault_active_user_logs",
      tenantId: snapshot.tenant.id,
      kind: "active-user-log",
      label: "Active-user proof",
      status: statusForProductionArtifact(snapshot.tenant.evidence.activeUsers > 0),
      sourceDescription: "Product analytics or Google Workspace install logs.",
      amountUsd: undefined,
      ownerRole: "founder",
      requiredFor: "Business Viability",
      nextAction: "Attach active-user log with emails and domains redacted.",
      createdAt: now
    }),
    expectedArtifact({
      id: "vault_cost_receipts",
      tenantId: snapshot.tenant.id,
      kind: "cost-receipt",
      label: "Operating cost receipts",
      status: statusForProductionArtifact(snapshot.tenant.evidence.totalCostsUsd > 0),
      sourceDescription: "Cloud Billing and operating expense backup.",
      amountUsd: snapshot.tenant.evidence.totalCostsUsd,
      ownerRole: "finance",
      requiredFor: "Business Viability",
      nextAction: "Attach Cloud Billing export and operating receipts.",
      createdAt: now
    }),
    expectedArtifact({
      id: "vault_cac_receipts",
      tenantId: snapshot.tenant.id,
      kind: "cac-receipt",
      label: "Customer acquisition spend proof",
      status: statusForProductionArtifact(snapshot.tenant.evidence.customerAcquisitionSpendUsd > 0),
      sourceDescription: "Marketing spend, outreach tooling, or founder-sales assumptions.",
      amountUsd: snapshot.tenant.evidence.customerAcquisitionSpendUsd,
      ownerRole: "sales",
      requiredFor: "Business Viability",
      nextAction: "Attach CAC receipts or dated founder-sales evidence.",
      createdAt: now
    }),
    expectedArtifact({
      id: "vault_cloud_run_deployment_proof",
      tenantId: snapshot.tenant.id,
      kind: "cloud-run-proof",
      label: "Cloud Run deployment proof",
      status: sentinelConfig.productUrl ? "requested" : "missing",
      sourceDescription: "Cloud Run service URL, revision, dry-run/deploy output, and hosted verification evidence.",
      ownerRole: "engineering",
      requiredFor: "AI-Native Operations",
      nextAction: "Deploy on Cloud Run, capture redacted revision and deploy output, and import the hosted verification JSON.",
      createdAt: now
    }),
    expectedArtifact({
      id: "vault_gcp_persistence_proof",
      tenantId: snapshot.tenant.id,
      kind: "gcp-persistence-proof",
      label: "Firestore, BigQuery, and Secret Manager proof",
      status: sentinelConfig.storageMode === "gcp-rest" ? "requested" : "missing",
      sourceDescription: "Hosted write-through verification for Firestore state, BigQuery evidence rows, and Secret Manager token access.",
      ownerRole: "engineering",
      requiredFor: "AI-Native Operations",
      nextAction: "Run production write-through verification and import the redacted JSON output.",
      createdAt: now
    }),
    expectedArtifact({
      id: "vault_production_readiness_report",
      tenantId: snapshot.tenant.id,
      kind: "production-readiness-report",
      label: "Hosted production readiness verification report",
      status: hasJudgeProductAccess() ? "requested" : "missing",
      sourceDescription: "Read-only and write-through hosted verification JSON from npm run verify:production.",
      ownerRole: "engineering",
      requiredFor: "Submission Logistics",
      nextAction: "Run verify:production against the hosted Cloud Run URL and import the redacted JSON report.",
      createdAt: now
    }),
    expectedArtifact({
      id: "vault_cloud_billing_proof",
      tenantId: snapshot.tenant.id,
      kind: "cloud-billing-proof",
      label: "Google Cloud billing budget proof",
      status: sentinelConfig.cloudCostControlsMode === "production" && sentinelConfig.googleCloudBudgetId ? "requested" : "missing",
      sourceDescription: "Cloud Billing budget and Pub/Sub alert evidence.",
      ownerRole: "engineering",
      requiredFor: "AI-Native Operations",
      nextAction: "Create budget, capture alert configuration, and register a redacted screenshot or export.",
      createdAt: now
    }),
    expectedArtifact({
      id: "vault_gemini_usage_log",
      tenantId: snapshot.tenant.id,
      kind: "gemini-usage-log",
      label: "Gemini API production usage log",
      status: hasGeminiApiRun ? "uploaded" : "missing",
      sourceDescription: "Gemini API request metadata, model name, and cost log.",
      ownerRole: "engineering",
      requiredFor: "AI-Native Operations",
      nextAction: "Run deployed Gemini call and register redacted request/cost metadata.",
      createdAt: now
    }),
    expectedArtifact({
      id: "vault_workspace_oauth_log",
      tenantId: snapshot.tenant.id,
      kind: "workspace-oauth-log",
      label: "Workspace OAuth install and sync proof",
      status: hasLiveWorkspaceConnection ? "uploaded" : "missing",
      sourceDescription: "OAuth install, Drive cursor, Gmail historyId, and reconciliation logs.",
      ownerRole: "engineering",
      requiredFor: "AI-Native Operations",
      nextAction: "Install OAuth for a consented pilot and register redacted cursor/reconciliation proof.",
      createdAt: now
    }),
    expectedArtifact({
      id: "vault_product_url_proof",
      tenantId: snapshot.tenant.id,
      kind: "product-url-proof",
      label: "Hosted product URL proof",
      status: hasJudgeProductAccess() ? "uploaded" : "missing",
      sourceDescription: judgeProductAccessSummary(),
      ownerRole: "engineering",
      requiredFor: "Submission Logistics",
      nextAction: "Deploy on Cloud Run, verify signed-out product access, configure judge testing instructions, and confirm free access through judging.",
      createdAt: now
    }),
    expectedArtifact({
      id: "vault_repository_proof",
      tenantId: snapshot.tenant.id,
      kind: "repository-proof",
      label: "Repository proof",
      status: sentinelConfig.repositoryUrl ? "uploaded" : "missing",
      sourceDescription: sentinelConfig.repositoryUrl || "Repository URL not configured.",
      ownerRole: "engineering",
      requiredFor: "Submission Logistics",
      nextAction: "Register the public or judge-shared repository URL.",
      createdAt: now
    }),
    expectedArtifact({
      id: "vault_demo_video_proof",
      tenantId: snapshot.tenant.id,
      kind: "demo-video-proof",
      label: "Under-three-minute demo video proof",
      status: hasDemoVideoClearance() ? "uploaded" : "missing",
      sourceDescription: demoVideoClearanceSummary(),
      ownerRole: "founder",
      requiredFor: "Submission Logistics",
      nextAction: "Record, publish, and human-review the final video for duration, public visibility, asset clearance, and customer-data redaction.",
      createdAt: now
    }),
    expectedArtifact({
      id: "vault_trust_policy_pack",
      tenantId: snapshot.tenant.id,
      kind: "trust-policy",
      label: "Reviewed trust policy pack",
      status: "missing",
      sourceDescription: "Real reviewed policies, reports, and security summaries.",
      ownerRole: "security",
      requiredFor: "Prospect Trust",
      nextAction: "Replace seeded Trust Center summaries with reviewed tenant documents.",
      createdAt: now
    })
  ];
}

function expectedPilotConsentArtifact(tenantId: string, pilot: PilotCustomerRecord, createdAt: string): EvidenceVaultArtifact {
  return expectedArtifact({
    id: `vault_consent_${pilot.id}`,
    tenantId,
    kind: "pilot-consent",
    label: `${pilot.customerAlias} pilot consent and scope proof`,
    status: pilot.consentStatus === "consented" ? statusForProductionArtifact(true) : "missing",
    sourceDescription: pilot.consentStatus === "consented" ? "Pilot record marks consent as collected." : "Signed data-access consent and scope packet not attached.",
    customerAlias: pilot.customerAlias,
    linkedPilotId: pilot.id,
    ownerRole: "legal",
    requiredFor: "Business Viability",
    nextAction: "Attach signed pilot consent and scope packet before live Workspace access.",
    createdAt
  });
}

function expectedPilotInvoiceArtifact(tenantId: string, pilot: PilotCustomerRecord, createdAt: string): EvidenceVaultArtifact {
  return expectedArtifact({
    id: `vault_invoice_${pilot.id}`,
    tenantId,
    kind: "pilot-invoice",
    label: `${pilot.customerAlias} invoice/payment proof`,
    status: statusForPilotInvoice(pilot),
    sourceDescription: pilot.invoiceReference ?? "Pilot invoice/payment source not attached.",
    amountUsd: pilot.monthlyRevenueUsd,
    customerAlias: pilot.customerAlias,
    linkedPilotId: pilot.id,
    linkedFinancialItemId: `financial_invoice_${pilot.id}`,
    ownerRole: "finance",
    requiredFor: "Business Viability",
    nextAction:
      pilot.proofStatus === "financial-doc-ready"
        ? "Attach checksum and redacted invoice/payment export for private judge request."
        : "Attach invoice/payment proof or exclude this pilot from counted revenue.",
    createdAt
  });
}

function expectedPilotPaymentArtifact(tenantId: string, pilot: PilotCustomerRecord, createdAt: string): EvidenceVaultArtifact {
  return expectedArtifact({
    id: `vault_payment_${pilot.id}`,
    tenantId,
    kind: "payment-export",
    label: `${pilot.customerAlias} payment export`,
    status: statusForPilotInvoice(pilot),
    sourceDescription: pilot.invoiceReference ? `Payment backup for ${pilot.invoiceReference}.` : "Payment export or receipt not attached.",
    customerAlias: pilot.customerAlias,
    linkedPilotId: pilot.id,
    amountUsd: pilot.monthlyRevenueUsd,
    ownerRole: "finance",
    requiredFor: "Business Viability",
    nextAction: "Attach a redacted payment export or receipt before counting this pilot as revenue proof.",
    createdAt
  });
}

function expectedTestimonialConsentArtifact(tenantId: string, pilot: PilotCustomerRecord, createdAt: string): EvidenceVaultArtifact {
  return expectedArtifact({
    id: `vault_testimonial_${pilot.id}`,
    tenantId,
    kind: "testimonial-consent",
    label: `${pilot.customerAlias} testimonial consent proof`,
    status: pilot.consentStatus === "consented" ? statusForProductionArtifact(true) : "missing",
    sourceDescription: pilot.testimonialQuote ? "Pilot testimonial quote is present." : "Consent record not attached.",
    customerAlias: pilot.customerAlias,
    linkedPilotId: pilot.id,
    ownerRole: "sales",
    requiredFor: "Business Viability",
    nextAction: "Attach signed consent or approval email before using this testimonial in judge materials.",
    createdAt
  });
}

function expectedArtifact(input: Omit<EvidenceVaultArtifact, "redacted" | "privateHandling" | "blocker" | "updatedAt">): EvidenceVaultArtifact {
  return {
    ...input,
    redacted: false,
    privateHandling:
      "Private source stays in the admin evidence vault; judge exports should include only redacted labels, status, checksum, and owner routing.",
    blocker: blockerForArtifact(input.status, false, input.checksumSha256),
    updatedAt: input.createdAt
  };
}

function mergeRegisteredArtifact(expected: EvidenceVaultArtifact, registered?: EvidenceVaultArtifact): EvidenceVaultArtifact {
  if (!registered) {
    return expected;
  }

  const merged = {
    ...expected,
    ...registered,
    tenantId: expected.tenantId,
    kind: expected.kind,
    requiredFor: expected.requiredFor,
    linkedPilotId: expected.linkedPilotId,
    linkedFinancialItemId: expected.linkedFinancialItemId
  };

  return {
    ...merged,
    blocker: blockerForArtifact(merged.status, merged.redacted, merged.checksumSha256)
  };
}

function summarizeArtifacts(artifacts: EvidenceVaultArtifact[]): Record<EvidenceVaultArtifactStatus, number> {
  return artifacts.reduce<Record<EvidenceVaultArtifactStatus, number>>(
    (summary, artifact) => {
      summary[artifact.status] += 1;
      return summary;
    },
    {
      missing: 0,
      requested: 0,
      uploaded: 0,
      verified: 0,
      "needs-redaction": 0,
      "mock-only": 0
    }
  );
}

function statusForPilotInvoice(pilot: PilotCustomerRecord): EvidenceVaultArtifactStatus {
  if (pilot.proofStatus === "mock" || sentinelConfig.evidenceMode !== "production") {
    return pilot.proofStatus === "financial-doc-ready" ? "mock-only" : "missing";
  }

  return pilot.proofStatus === "financial-doc-ready" ? "uploaded" : "missing";
}

function statusForProductionArtifact(hasLocalSignal: boolean): EvidenceVaultArtifactStatus {
  if (!hasLocalSignal) {
    return "missing";
  }

  return sentinelConfig.evidenceMode === "production" ? "requested" : "mock-only";
}

function blockerForArtifact(status: EvidenceVaultArtifactStatus, redacted: boolean, checksumSha256?: string) {
  if (status === "missing") {
    return "Required artifact is missing.";
  }

  if (status === "needs-redaction" || ((status === "uploaded" || status === "verified") && !redacted)) {
    return "Artifact must be redacted before judge export.";
  }

  if (status === "verified" && !checksumSha256) {
    return "Verified artifacts need a SHA-256 checksum.";
  }

  if (status === "mock-only") {
    return "Local/demo artifact cannot be used as production submission proof.";
  }

  return undefined;
}

function parseKind(value?: EvidenceVaultArtifactKind): EvidenceVaultArtifactKind {
  if (!value || !artifactKinds.includes(value)) {
    throw new Error("Evidence artifact kind is required.");
  }

  return value;
}

function parseStatus(value: EvidenceVaultArtifactStatus = "requested"): EvidenceVaultArtifactStatus {
  if (!artifactStatuses.includes(value)) {
    throw new Error("Unsupported evidence artifact status.");
  }

  return value;
}

function parseOwnerRole(value: EvidenceVaultOwnerRole): EvidenceVaultOwnerRole {
  const roles: EvidenceVaultOwnerRole[] = ["founder", "sales", "finance", "legal", "security", "engineering"];
  if (!roles.includes(value)) {
    throw new Error("Unsupported evidence owner role.");
  }

  return value;
}

function roleForKind(kind: EvidenceVaultArtifactKind): EvidenceVaultOwnerRole {
  if (kind === "pilot-consent") {
    return "legal";
  }

  if (kind === "pilot-invoice" || kind === "payment-export" || kind === "cost-receipt") {
    return "finance";
  }

  if (kind === "testimonial-consent" || kind === "cac-receipt" || kind === "customer-reference") {
    return "sales";
  }

  if (kind === "trust-policy") {
    return "security";
  }

  if (kind === "demo-video-proof") {
    return "founder";
  }

  return "engineering";
}

function requiredForKind(kind: EvidenceVaultArtifactKind): EvidenceVaultRequiredFor {
  if (
    kind === "pilot-invoice" ||
    kind === "pilot-consent" ||
    kind === "payment-export" ||
    kind === "active-user-log" ||
    kind === "cost-receipt" ||
    kind === "cac-receipt" ||
    kind === "testimonial-consent" ||
    kind === "customer-reference"
  ) {
    return "Business Viability";
  }

  if (kind === "product-url-proof" || kind === "demo-video-proof" || kind === "repository-proof" || kind === "production-readiness-report") {
    return "Submission Logistics";
  }

  if (kind === "trust-policy") {
    return "Prospect Trust";
  }

  return "AI-Native Operations";
}

function labelForKind(kind: EvidenceVaultArtifactKind) {
  return kind.replaceAll("-", " ");
}

function nextActionForStatus(status: EvidenceVaultArtifactStatus) {
  if (status === "missing") {
    return "Attach the private artifact or assign an owner to collect it.";
  }

  if (status === "uploaded" || status === "needs-redaction") {
    return "Redact the artifact, add checksum, then mark it verified after review.";
  }

  if (status === "verified") {
    return "Keep the artifact private and ready for judge request.";
  }

  if (status === "mock-only") {
    return "Replace demo proof with production evidence.";
  }

  return "Collect and upload the requested proof artifact.";
}

function cleanText(value: string) {
  const cleaned = value.trim();
  if (!cleaned) {
    throw new Error("Evidence artifact text fields cannot be empty.");
  }

  return cleaned.slice(0, 500);
}

function cleanOptionalText(value?: string) {
  const cleaned = value?.trim();
  return cleaned ? cleaned.slice(0, 500) : undefined;
}
