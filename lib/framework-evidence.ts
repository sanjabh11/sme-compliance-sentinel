import type {
  DashboardSnapshot,
  FrameworkCoverage,
  FrameworkEvidenceAudience,
  FrameworkEvidenceControl,
  FrameworkEvidencePack,
  FrameworkName
} from "@/lib/types";

type FrameworkSnapshot = Pick<
  DashboardSnapshot,
  "findings" | "agentRuns" | "auditEvents" | "remediations" | "aggregateCounters" | "questionnairePacks" | "trustPackets"
>;

export const supportedFrameworks: FrameworkName[] = ["SOC2", "ISO 27001", "GDPR", "HIPAA", "PCI"];

const frameworkCoverage: Record<FrameworkName, Omit<FrameworkCoverage, "framework">> = {
  SOC2: {
    coverageLevel: "implemented",
    buyerValue: "Maps Workspace exposure findings to access control, change evidence, and trust-review proof.",
    evidenceTypes: ["agent logs", "remediation approvals", "risk findings", "questionnaire answers"]
  },
  "ISO 27001": {
    coverageLevel: "partial",
    buyerValue: "Supports information security risk-treatment and access-control evidence narratives.",
    evidenceTypes: ["risk register", "audit events", "approval records"]
  },
  GDPR: {
    coverageLevel: "partial",
    buyerValue: "Flags personal-data exposure and supports data minimization and accountability evidence.",
    evidenceTypes: ["PII findings", "redacted exports", "access approvals"]
  },
  HIPAA: {
    coverageLevel: "planned",
    buyerValue: "Useful only after healthcare scope, BAA terms, and PHI handling boundaries are configured.",
    evidenceTypes: ["deferred healthcare controls", "access logs", "policy evidence"]
  },
  PCI: {
    coverageLevel: "partial",
    buyerValue: "Detects payment-card-like data in Workspace content and records human-approved response evidence.",
    evidenceTypes: ["DLP findings", "remediation approvals", "audit events"]
  }
};

export function buildFrameworkCoverage(): FrameworkCoverage[] {
  return supportedFrameworks.map((framework) => ({
    framework,
    ...frameworkCoverage[framework]
  }));
}

export function buildFrameworkEvidencePack(
  snapshot: FrameworkSnapshot,
  input: { framework: FrameworkName; redacted?: boolean; audience?: FrameworkEvidenceAudience }
): FrameworkEvidencePack {
  const redacted = input.redacted ?? true;
  const audience = input.audience ?? "judge";
  const controls = buildFrameworkControls(snapshot, input.framework);
  const coverage = frameworkCoverage[input.framework];
  const template = frameworkAudienceTemplates[audience];
  const templateControls = controls
    .filter((control) => includeControlForAudience(control, audience))
    .map((control) => applyAudienceRedaction(redacted ? redactControl(control) : control, audience));

  return {
    generatedAt: new Date().toISOString(),
    framework: input.framework,
    audience,
    redacted,
    coverageLevel: coverage.coverageLevel,
    buyerValue: coverage.buyerValue,
    audienceSummary: template.summary(input.framework),
    includedSections: template.includedSections,
    hiddenSections: template.hiddenSections,
    summary: summarizeControls(controls),
    controls: templateControls,
    exportText: buildFrameworkExportText({
      framework: input.framework,
      audience,
      redacted,
      coverageLevel: coverage.coverageLevel,
      buyerValue: coverage.buyerValue,
      audienceSummary: template.summary(input.framework),
      includedSections: template.includedSections,
      hiddenSections: template.hiddenSections,
      controls: templateControls
    }),
    disclaimer:
      "This pack is framework-specific readiness evidence only. It is not a certification, legal conclusion, or auditor opinion."
  };
}

export function parseFrameworkName(value: string | null): FrameworkName {
  const normalized = (value ?? "SOC2").trim().toLowerCase();
  const match = supportedFrameworks.find((framework) => framework.toLowerCase() === normalized);

  return match ?? "SOC2";
}

export function parseFrameworkAudience(value: string | null): FrameworkEvidenceAudience {
  const normalized = (value ?? "judge").trim().toLowerCase();

  return normalized === "prospect" || normalized === "auditor" ? normalized : "judge";
}

const frameworkAudienceTemplates: Record<
  FrameworkEvidenceAudience,
  {
    summary: (framework: FrameworkName) => string;
    includedSections: string[];
    hiddenSections: string[];
  }
> = {
  judge: {
    summary: (framework) =>
      `${framework} judge packet summarizes current evidence, gaps, and production blockers for XPRIZE review.`,
    includedSections: ["control status", "mapped evidence counts", "production-proof gaps", "owner roles"],
    hiddenSections: ["raw customer findings", "private invoice details", "secrets or document content"]
  },
  prospect: {
    summary: (framework) =>
      `${framework} prospect packet is sales-safe and shows only redacted trust posture, readiness claims, and next-step gaps.`,
    includedSections: ["safe buyer value", "control status", "redacted trust evidence", "next-step gaps"],
    hiddenSections: ["internal owner routing", "raw audit events", "private security findings", "non-consented customer details"]
  },
  auditor: {
    summary: (framework) =>
      `${framework} auditor-review packet keeps owner roles, production requirements, and evidence gaps visible for readiness planning.`,
    includedSections: ["owner roles", "mapped evidence", "production requirements", "gaps", "control status"],
    hiddenSections: ["secrets", "unredacted customer identifiers unless redacted=false is explicitly requested"]
  }
};

function buildFrameworkControls(snapshot: FrameworkSnapshot, framework: FrameworkName): FrameworkEvidenceControl[] {
  const common = commonControls(snapshot, framework);

  if (framework === "SOC2") {
    return [
      ...common,
      control({
        id: "soc2_cc6_access_controls",
        framework,
        title: "Logical access and risky sharing review",
        status: snapshot.findings.length > 0 ? "ready" : "partial",
        ownerRole: "security",
        mappedEvidence: [
          `${snapshot.findings.length} Workspace risk finding(s).`,
          `${snapshot.remediations.length} remediation approval record(s).`
        ],
        gaps: snapshot.remediations.length ? [] : ["Run a full approve/remediate loop before sharing final evidence."],
        exportSafe: true,
        productionRequired: true
      })
    ];
  }

  if (framework === "ISO 27001") {
    return [
      ...common,
      control({
        id: "iso_27001_risk_treatment",
        framework,
        title: "Information security risk treatment evidence",
        status: snapshot.findings.length && snapshot.auditEvents.length ? "partial" : "blocked",
        ownerRole: "security",
        mappedEvidence: [
          `${snapshot.findings.length} risk finding(s) in register.`,
          `${snapshot.auditEvents.length} audit event(s) for traceability.`
        ],
        gaps: ["Attach organization policy ownership and formal risk acceptance before using for an ISO program."],
        exportSafe: true,
        productionRequired: true
      })
    ];
  }

  if (framework === "GDPR") {
    const piiFindings = snapshot.findings.filter((finding) =>
      finding.detectorFindings.some((detector) => detector.type.toLowerCase().includes("pii") || detector.type.toLowerCase().includes("ssn"))
    ).length;

    return [
      ...common,
      control({
        id: "gdpr_data_minimization",
        framework,
        title: "Personal data exposure and minimization evidence",
        status: piiFindings > 0 ? "partial" : "blocked",
        ownerRole: "legal",
        mappedEvidence: [
          `${piiFindings} PII-oriented finding(s).`,
          `${snapshot.aggregateCounters.bytesRoutedToGemini} byte(s) routed to Gemini after guardrails.`
        ],
        gaps: [
          "Document lawful basis, DPA/processor terms, and data subject request process before using this as privacy-program evidence."
        ],
        exportSafe: true,
        productionRequired: true
      })
    ];
  }

  if (framework === "HIPAA") {
    return [
      ...common,
      control({
        id: "hipaa_scope_boundary",
        framework,
        title: "Healthcare scope and PHI boundary",
        status: "blocked",
        ownerRole: "legal",
        mappedEvidence: ["HIPAA support is intentionally gated until healthcare scope and BAA terms exist."],
        gaps: ["Add BAA workflow, PHI-specific detector policy, and healthcare tenant controls before selling HIPAA use cases."],
        exportSafe: true,
        productionRequired: true
      })
    ];
  }

  return [
    ...common,
    control({
      id: "pci_cardholder_detection",
      framework,
      title: "Payment-card-like data detection",
      status: snapshot.findings.some((finding) =>
        finding.detectorFindings.some((detector) => detector.type.toLowerCase().includes("card"))
      )
        ? "partial"
        : "blocked",
      ownerRole: "security",
      mappedEvidence: [`${snapshot.aggregateCounters.bytesScannedByDlp} byte(s) scanned by deterministic DLP.`],
      gaps: ["Confirm PCI scope, cardholder data environment boundaries, and qualified assessment path before making customer claims."],
      exportSafe: true,
      productionRequired: true
    })
  ];
}

function commonControls(snapshot: FrameworkSnapshot, framework: FrameworkName): FrameworkEvidenceControl[] {
  const exportedQuestionnairePacks = snapshot.questionnairePacks.filter((pack) => pack.status === "exported").length;

  return [
    control({
      id: `${slug(framework)}_ai_decision_log`,
      framework,
      title: "AI decision and human approval trail",
      status: snapshot.agentRuns.length > 0 && snapshot.auditEvents.length > 0 ? "ready" : "partial",
      ownerRole: "engineering",
      mappedEvidence: [
        `${snapshot.agentRuns.length} agent run(s).`,
        `${snapshot.auditEvents.length} audit event(s).`,
        `${snapshot.remediations.length} remediation record(s).`
      ],
      gaps: snapshot.agentRuns.length ? [] : ["Run at least one production Gemini scan and preserve the metadata log."],
      exportSafe: true,
      productionRequired: true
    }),
    control({
      id: `${slug(framework)}_questionnaire_trust_evidence`,
      framework,
      title: "Customer security-review response evidence",
      status: exportedQuestionnairePacks > 0 || snapshot.trustPackets.length > 0 ? "partial" : "blocked",
      ownerRole: "sales",
      mappedEvidence: [
        `${snapshot.trustPackets.length} Trust Packet(s).`,
        `${exportedQuestionnairePacks} exported questionnaire response pack(s).`
      ],
      gaps: exportedQuestionnairePacks ? [] : ["Export a customer-specific questionnaire pack after human approval."],
      exportSafe: true,
      productionRequired: false
    })
  ];
}

function control(input: FrameworkEvidenceControl): FrameworkEvidenceControl {
  return input;
}

function summarizeControls(controls: FrameworkEvidenceControl[]): FrameworkEvidencePack["summary"] {
  return {
    ready: controls.filter((control) => control.status === "ready").length,
    partial: controls.filter((control) => control.status === "partial").length,
    blocked: controls.filter((control) => control.status === "blocked").length,
    notApplicable: controls.filter((control) => control.status === "not_applicable").length,
    productionRequired: controls.filter((control) => control.productionRequired).length
  };
}

function buildFrameworkExportText(input: {
  framework: FrameworkName;
  audience: FrameworkEvidenceAudience;
  redacted: boolean;
  coverageLevel: FrameworkCoverage["coverageLevel"];
  buyerValue: string;
  audienceSummary: string;
  includedSections: string[];
  hiddenSections: string[];
  controls: FrameworkEvidenceControl[];
}) {
  const lines = [
    `# ${input.framework} Readiness Evidence Pack`,
    "",
    `Audience: ${input.audience}`,
    `Coverage: ${input.coverageLevel}`,
    `Redacted: ${input.redacted}`,
    `Buyer value: ${input.buyerValue}`,
    `Template summary: ${input.audienceSummary}`,
    "",
    "Boundary: readiness evidence only; not a certification, legal conclusion, or auditor opinion.",
    "",
    "## Template Boundary",
    `Included: ${input.includedSections.join(" | ")}`,
    `Hidden: ${input.hiddenSections.join(" | ")}`,
    "",
    "## Controls"
  ];

  for (const item of input.controls) {
    lines.push(
      "",
      `### ${item.title}`,
      `Status: ${item.status}`,
      `Owner: ${item.ownerRole}`,
      `Production evidence required: ${item.productionRequired ? "yes" : "no"}`,
      `Evidence: ${item.mappedEvidence.join(" | ")}`,
      `Gaps: ${item.gaps.length ? item.gaps.join(" | ") : "none"}`
    );
  }

  return lines.join("\n");
}

function includeControlForAudience(control: FrameworkEvidenceControl, audience: FrameworkEvidenceAudience) {
  if (audience === "prospect") {
    return control.exportSafe;
  }

  return true;
}

function applyAudienceRedaction(control: FrameworkEvidenceControl, audience: FrameworkEvidenceAudience): FrameworkEvidenceControl {
  if (audience !== "prospect") {
    return control;
  }

  return {
    ...control,
    ownerRole: "sales",
    mappedEvidence: control.mappedEvidence.map((item) => item.replace(/\d+ byte\(s\)/gu, "Redacted byte count")),
    gaps: control.gaps.map((gap) => gap.replace(/production Gemini/giu, "production AI"))
  };
}

function redactControl(control: FrameworkEvidenceControl): FrameworkEvidenceControl {
  return {
    ...control,
    mappedEvidence: control.mappedEvidence.map((item) => redactText(item)),
    gaps: control.gaps.map((item) => redactText(item))
  };
}

function redactText(text: string) {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/MainStreet Security Labs/g, "Redacted pilot tenant")
    .replace(/Northstar Health/g, "Redacted customer")
    .replace(/Vendor security packet - public link\.txt/g, "Redacted Workspace item");
}

function slug(framework: FrameworkName) {
  return framework.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
