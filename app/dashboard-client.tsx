"use client";

import {
  RefreshCw,
  Sparkles
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type {
  ApproverRole,
  ClaimGuardResult,
  CloudCostControlCenter,
  CloudCostControlVerificationResult,
  CloudRunDeploymentEvidence,
  DashboardSnapshot,
  DeploymentEvidencePacket,
  DealImpactReport,
  DemoVideoCompliancePack,
  DevpostSubmissionPack,
  EligibilityDisclosurePacket,
  EvidenceCopilotResult,
  EvidenceDocumentAnalysisResult,
  EvidenceDocumentInputKind,
  EvidenceExport,
  EvidenceIntakeQueue,
  EvidenceSynthesisPack,
  EvidenceSynthesisPackType,
  EvidenceVault,
  EvidenceVaultImportResult,
  FinancialEvidenceLedger,
  FrameworkEvidencePack,
  FrameworkEvidenceAudience,
  FrameworkName,
  HostedEvidenceCapturePacket,
  JudgeAccessPack,
  MarketPositioningCommandCenter,
  MetricQueryResult,
  MvpOutreachPlan,
  PersistenceVerificationResult,
  PilotConsentPacket,
  PilotConversionKit,
  PilotLaunchPlan,
  PilotProspectPipeline,
  ProjectProvenanceReport,
  ProductionLaunchCommandCenter,
  ProductionGeminiProofResult,
  ProductionProvisioningPack,
  QuestionnaireDraft,
  QuestionnaireInputSource,
  QuestionnaireResponsePack,
  RecommendationAction,
  RemediationPlaybook,
  SourceReleaseGuard,
  SubmissionComplianceCenter,
  ThirdPartyManifest,
  TrustAccessRequest,
  TrustPacket,
  TrustCenterProfile,
  WorkspaceOAuthPlan,
  WorkspaceReconciliationResult,
  XPrizeSubmissionBinder,
  XPrizeSubmissionGate
} from "@/lib/types";
import { buildBusinessVerificationChecklist, getBusinessVerificationSummary } from "@/lib/business-verification";
import { buildStripeProofStatusPanel } from "@/lib/stripe-proof-status";
import {
  SeverityLegend,
  formatNumber,
  formatUtcTime
} from "./dashboard-ui";
import { FindingsPanel } from "./dashboard-panels/findings-panel";
import { EvidencePanel } from "./dashboard-panels/evidence-panel";
import { TrustCenterPanel } from "./dashboard-panels/trust-center-panel";
import { QuestionnairePanel } from "./dashboard-panels/questionnaire-panel";
import { EvidenceCopilotPanel } from "./dashboard-panels/evidence-copilot-panel";
import { WorkspaceFlowPanel } from "./dashboard-panels/workspace-flow-panel";
import { MvpOutreachPanel } from "./dashboard-panels/mvp-outreach-panel";
import { PilotCrmPanel } from "./dashboard-panels/pilot-crm-panel";
import { ReadinessCommandPanel } from "./dashboard-panels/readiness-command-panel";
import { PlaybooksPanel } from "./dashboard-panels/playbooks-panel";
import { StrategyPanel } from "./dashboard-panels/strategy-panel";
import { GapsPanel } from "./dashboard-panels/gaps-panel";
import { ProductionPanel } from "./dashboard-panels/production-panel";

type ActionState = "idle" | "running" | "error";
const playbookActionOptions: RecommendationAction[] = [
  "disable_public_sharing",
  "notify_owner",
  "request_owner_review",
  "label_restricted",
  "no_action"
];
const adminTabs = [
  { href: "#admin-overview", label: "Overview" },
  { href: "#admin-workspace-scan", label: "Workspace Scan" },
  { href: "#admin-evidence", label: "Evidence" },
  { href: "#admin-trust", label: "Trust" },
  { href: "#admin-readiness", label: "Readiness" },
  { href: "#admin-submission", label: "Submission" }
];

export function DashboardClient({ initialSnapshot }: { initialSnapshot: DashboardSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [lastMessage, setLastMessage] = useState("Ready for a mock Workspace event.");
  const [exportPreview, setExportPreview] = useState<EvidenceExport | null>(null);
  const [trustProfile, setTrustProfile] = useState<TrustCenterProfile | null>(null);
  const [trustPacket, setTrustPacket] = useState<TrustPacket | null>(null);
  const [trustAccessRequest, setTrustAccessRequest] = useState<TrustAccessRequest | null>(
    initialSnapshot.trustAccessRequests[0] ?? null
  );
  const [questionnaireDraft, setQuestionnaireDraft] = useState<QuestionnaireDraft | null>(null);
  const [questionnairePack, setQuestionnairePack] = useState<QuestionnaireResponsePack | null>(null);
  const [questionnaireForm, setQuestionnaireForm] = useState({
    customerAlias: "Enterprise prospect",
    customerSegment: "Seed-stage SaaS",
    source: "uploaded-text" as QuestionnaireInputSource,
    originalFileName: "security-questionnaire.txt",
    questionnaireText: [
      "How do you monitor Google Workspace for sensitive-data exposure?",
      "How do you prevent sensitive content from being sent to AI models?",
      "Can AI automatically change access permissions?",
      "Do you keep an audit trail of AI security decisions?",
      "Are you SOC2 certified?"
    ].join("\n")
  });
  const [persistenceCheck, setPersistenceCheck] = useState<PersistenceVerificationResult | null>(null);
  const [oauthPlan, setOauthPlan] = useState<WorkspaceOAuthPlan | null>(null);
  const [syncCheck, setSyncCheck] = useState<WorkspaceReconciliationResult | null>(null);
  const [costControls, setCostControls] = useState<CloudCostControlCenter | null>(null);
  const [costControlCheck, setCostControlCheck] = useState<CloudCostControlVerificationResult | null>(null);
  const [claimGuardCheck, setClaimGuardCheck] = useState<ClaimGuardResult | null>(null);
  const [submissionGate, setSubmissionGate] = useState<XPrizeSubmissionGate | null>(null);
  const [projectProvenance, setProjectProvenance] = useState<ProjectProvenanceReport | null>(null);
  const [eligibilityDisclosure, setEligibilityDisclosure] = useState<EligibilityDisclosurePacket | null>(null);
  const [sourceReleaseGuard, setSourceReleaseGuard] = useState<SourceReleaseGuard | null>(null);
  const [submissionBinder, setSubmissionBinder] = useState<XPrizeSubmissionBinder | null>(null);
  const [submissionCompliance, setSubmissionCompliance] = useState<SubmissionComplianceCenter | null>(null);
  const [demoVideoPack, setDemoVideoPack] = useState<DemoVideoCompliancePack | null>(null);
  const [devpostPack, setDevpostPack] = useState<DevpostSubmissionPack | null>(null);
  const [judgeAccessPack, setJudgeAccessPack] = useState<JudgeAccessPack | null>(null);
  const [thirdPartyManifest, setThirdPartyManifest] = useState<ThirdPartyManifest | null>(null);
  const [frameworkSelection, setFrameworkSelection] = useState<FrameworkName>("SOC2");
  const [frameworkAudience, setFrameworkAudience] = useState<FrameworkEvidenceAudience>("judge");
  const [frameworkPack, setFrameworkPack] = useState<FrameworkEvidencePack | null>(null);
  const [dealImpactReport, setDealImpactReport] = useState<DealImpactReport | null>(null);
  const [financialLedger, setFinancialLedger] = useState<FinancialEvidenceLedger | null>(null);
  const [evidenceVaultCheck, setEvidenceVaultCheck] = useState<EvidenceVault | null>(null);
  const [evidenceVaultImportResult, setEvidenceVaultImportResult] = useState<EvidenceVaultImportResult | null>(null);
  const [evidenceIntakeQueue, setEvidenceIntakeQueue] = useState<EvidenceIntakeQueue | null>(null);
  const [pilotConsentPacket, setPilotConsentPacket] = useState<PilotConsentPacket | null>(null);
  const [pilotConversionKit, setPilotConversionKit] = useState<PilotConversionKit | null>(null);
  const [pilotLaunchPlan, setPilotLaunchPlan] = useState<PilotLaunchPlan | null>(null);
  const [prospectPipeline, setProspectPipeline] = useState<PilotProspectPipeline | null>(null);
  const [productionLaunch, setProductionLaunch] = useState<ProductionLaunchCommandCenter | null>(null);
  const [productionProvisioning, setProductionProvisioning] = useState<ProductionProvisioningPack | null>(null);
  const [cloudRunDeploymentEvidence, setCloudRunDeploymentEvidence] = useState<CloudRunDeploymentEvidence | null>(null);
  const [hostedEvidenceCapture, setHostedEvidenceCapture] = useState<HostedEvidenceCapturePacket | null>(null);
  const [deploymentEvidencePacket, setDeploymentEvidencePacket] = useState<DeploymentEvidencePacket | null>(null);
  const [productionGeminiProof, setProductionGeminiProof] = useState<ProductionGeminiProofResult | null>(null);
  const [marketPositioning, setMarketPositioning] = useState<MarketPositioningCommandCenter | null>(null);
  const [mvpOutreachPlan, setMvpOutreachPlan] = useState<MvpOutreachPlan | null>(null);
  const [copilotQuery, setCopilotQuery] = useState("What evidence supports Workspace risk detection and Gemini usage?");
  const [copilotResult, setCopilotResult] = useState<EvidenceCopilotResult | null>(null);
  const [synthesisType, setSynthesisType] = useState<EvidenceSynthesisPackType>("judge-summary");
  const [synthesisPack, setSynthesisPack] = useState<EvidenceSynthesisPack | null>(null);
  const [metricQuestion, setMetricQuestion] = useState("Show findings by severity");
  const [metricResult, setMetricResult] = useState<MetricQueryResult | null>(null);
  const [documentInputKind, setDocumentInputKind] = useState<EvidenceDocumentInputKind>("security-questionnaire");
  const [documentText, setDocumentText] = useState("How do you monitor Google Workspace for sensitive-data exposure?");
  const [documentAnalysis, setDocumentAnalysis] = useState<EvidenceDocumentAnalysisResult | null>(null);
  const [pilotForm, setPilotForm] = useState({
    customerAlias: "Private pilot customer",
    segment: "Seed-stage B2B SaaS preparing enterprise security review",
    monthlyRevenueUsd: "199",
    activeUsers: "2",
    proofStatus: "invoice-needed",
    consentStatus: "pending",
    armsLength: true,
    relatedParty: false
  });
  const [playbookForm, setPlaybookForm] = useState<{
    id: string;
    name: string;
    trigger: string;
    stagedActions: RecommendationAction[];
    autoAllowed: boolean;
    approvalSlaHours: string;
    ownerRole: ApproverRole;
    escalationTarget: string;
    status: RemediationPlaybook["status"];
  }>({
    id: "",
    name: "Prospect security-review packet exposure",
    trigger: "External sharing plus proposal, security review, or legal agreement keywords.",
    stagedActions: ["request_owner_review", "notify_owner"],
    autoAllowed: false,
    approvalSlaHours: "12",
    ownerRole: "security",
    escalationTarget: "founder@mainstreet-security.example",
    status: "active"
  });
  const [evidenceImportToken, setEvidenceImportToken] = useState("");
  const [evidenceImportJson, setEvidenceImportJson] = useState(
    JSON.stringify(
      {
        source: "verify-production",
        redacted: true,
        payload: {
          baseUrl: "https://YOUR-CLOUD-RUN-URL",
          mode: "read-only",
          summary: { total: 0, passedTransport: 0, failedTransport: 0, blockedOrNeedsReview: 0 },
          results: []
        }
      },
      null,
      2
    )
  );
  const readiness = snapshot.readiness;
  const persistence = readiness?.persistenceReadiness;
  const financialEvidence = financialLedger ?? readiness.financialEvidence;
  const evidenceVault = evidenceVaultCheck ?? readiness.evidenceVault;
  const intakeQueue = evidenceIntakeQueue ?? readiness.evidenceIntakeQueue;
  const consentPacket = pilotConsentPacket ?? readiness.pilotConsentPacket;
  const launchPlan = pilotLaunchPlan ?? readiness.pilotLaunchPlan;
  const conversionKit = pilotConversionKit ?? readiness.pilotConversionKit;
  const pilotProspectPipeline = prospectPipeline ?? readiness.pilotProspectPipeline;

  const metrics = useMemo(() => {
    const remediated = snapshot.findings.filter((finding) => finding.status === "remediated").length;
    const falsePositives = snapshot.findings.filter((finding) => finding.status === "false_positive").length;
    const falsePositiveRate = snapshot.findings.length ? Math.round((falsePositives / snapshot.findings.length) * 100) : 0;
    const geminiCost = snapshot.agentRuns.reduce((total, run) => total + run.estimatedCostUsd, 0);

    return {
      remediated,
      falsePositiveRate,
      geminiCost,
      risksDetected: snapshot.findings.length,
      agentRuns: snapshot.agentRuns.length
    };
  }, [snapshot]);
  const financialLedgerStatus =
    financialEvidence.summary.missing > 0 ? "blocked" : financialEvidence.summary["mock-only"] > 0 ? "warning" : "passed";
  const evidenceVaultStatus =
    evidenceVault.summary.missing + evidenceVault.summary["needs-redaction"] > 0
      ? "blocked"
      : evidenceVault.summary["mock-only"] > 0
        ? "warning"
        : "passed";

  async function callSnapshotAction(url: string, options?: RequestInit, message?: string) {
    setActionState("running");
    setLastMessage(message ?? "Running Sentinel workflow...");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...options
      });
      const payload = await response.json();

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error ?? "Request failed.");
      }

      if (payload.tenant && payload.findings) {
        setSnapshot(payload);
      } else {
        await refreshState();
      }

      setActionState("idle");
      setLastMessage(message ?? "Workflow completed.");
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Action failed.");
    }
  }

  async function refreshState() {
    const response = await fetch("/api/demo/state");
    const payload = (await response.json()) as DashboardSnapshot;
    setSnapshot(payload);
    return payload;
  }

  async function injectEvent(kind: "public-secret" | "low-risk" | "gmail-pii") {
    const endpoint = kind === "gmail-pii" ? "/api/webhooks/pubsub/gmail" : "/api/webhooks/pubsub/drive";
    await callSnapshotAction(
      endpoint,
      { body: JSON.stringify({ demo: kind }) },
      kind === "low-risk" ? "Injecting low-risk event. Gemini should not be called." : "Injecting high-risk event through the hybrid scanner."
    );
  }

  async function exportEvidence() {
    setActionState("running");
    setLastMessage("Generating redacted judge evidence packet...");
    const response = await fetch("/api/evidence/export?redacted=true");
    const payload = (await response.json()) as EvidenceExport;
    setExportPreview(payload);
    await refreshState();
    setActionState("idle");
    setLastMessage("Redacted judge evidence packet generated.");
  }

  async function exportEvidenceFormat(format: "markdown" | "csv") {
    setActionState("running");
    setLastMessage(`Generating redacted ${format} evidence packet...`);

    try {
      const response = await fetch(`/api/evidence/export?redacted=true&format=${format}`);
      const body = await response.text();
      await refreshState();
      setActionState("idle");
      setLastMessage(`${format.toUpperCase()} evidence packet generated (${body.length} characters).`);
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : `Unable to generate ${format} evidence packet.`);
    }
  }

  async function exportSignedEvidencePacket() {
    setActionState("running");
    setLastMessage("Generating sealed print-ready evidence packet...");

    try {
      const response = await fetch("/api/evidence/signed-packet?redacted=true");
      const body = await response.text();
      await refreshState();
      setActionState("idle");
      setLastMessage(
        `Sealed HTML packet generated (${body.length} characters, status ${response.headers.get("x-sentinel-seal-status") ?? "unknown"}).`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to generate sealed evidence packet.");
    }
  }

  async function generateTrustProfile() {
    setActionState("running");
    setLastMessage("Generating Trust Center Lite profile...");
    const response = await fetch("/api/trust-center");
    const payload = (await response.json()) as TrustCenterProfile;
    setTrustProfile(payload);
    setActionState("idle");
    setLastMessage("Trust Center Lite profile generated.");
  }

  async function createProspectTrustPacket() {
    setActionState("running");
    setLastMessage("Creating time-limited redacted Trust Packet...");

    try {
      const response = await fetch("/api/trust-center/packets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prospectAlias: "Redacted prospect",
          prospectDomain: "prospect.example",
          expiresInDays: 7,
          accessRequestId: trustAccessRequest?.status === "approved" ? trustAccessRequest.id : undefined
        })
      });
      const payload = (await response.json()) as { packet: TrustPacket; snapshot: DashboardSnapshot; ok?: false; error?: string };

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error ?? "Unable to create Trust Packet.");
      }

      setTrustPacket(payload.packet);
      setSnapshot(payload.snapshot);
      setActionState("idle");
      setLastMessage("Redacted Trust Packet created with expiry and access logging.");
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to create Trust Packet.");
    }
  }

  async function requestTrustDocuments() {
    setActionState("running");
    setLastMessage("Requesting NDA-gated trust documents...");

    try {
      const response = await fetch("/api/trust-center/access-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prospectAlias: "Redacted prospect",
          prospectDomain: "prospect.example",
          requesterEmail: "buyer@prospect.example",
          requestedDocumentIds: snapshot.trustDocuments
            .filter((document) => document.visibility === "requestable")
            .map((document) => document.id),
          ndaAccepted: true
        })
      });
      const payload = (await response.json()) as {
        request: TrustAccessRequest;
        snapshot: DashboardSnapshot;
        ok?: false;
        error?: string;
      };

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error ?? "Unable to request trust documents.");
      }

      setTrustAccessRequest(payload.request);
      setSnapshot(payload.snapshot);
      setActionState("idle");
      setLastMessage("Trust document access request created with NDA acceptance.");
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to request trust documents.");
    }
  }

  async function approveTrustDocuments() {
    const request = trustAccessRequest ?? snapshot.trustAccessRequests.find((item) => item.status === "pending");
    if (!request) {
      return;
    }

    await callSnapshotAction(
      `/api/trust-center/access-requests/${request.id}/approve`,
      { body: JSON.stringify({ decisionReason: "Approved for active prospect security review after NDA acceptance." }) },
      "Approving trust document access request."
    );
    const refreshed = await refreshState();
    setTrustAccessRequest(refreshed.trustAccessRequests.find((item) => item.id === request.id) ?? null);
  }

  async function generateQuestionnaireDraft() {
    setActionState("running");
    setLastMessage("Drafting security questionnaire answers from approved evidence...");
    const response = await fetch("/api/questionnaire/draft", { method: "POST" });
    const payload = (await response.json()) as QuestionnaireDraft;
    setQuestionnaireDraft(payload);
    setActionState("idle");
    setLastMessage("Security questionnaire draft generated.");
  }

  async function createQuestionnairePack() {
    setActionState("running");
    setLastMessage("Parsing uploaded questionnaire and drafting response pack...");

    try {
      const response = await fetch("/api/questionnaire/packs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(questionnaireForm)
      });
      const payload = (await response.json()) as {
        pack: QuestionnaireResponsePack;
        snapshot: DashboardSnapshot;
        ok?: false;
        error?: string;
      };

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error ?? "Unable to create questionnaire response pack.");
      }

      setQuestionnairePack(payload.pack);
      setSnapshot(payload.snapshot);
      setActionState("idle");
      setLastMessage("Questionnaire response pack is ready for human approval.");
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to create questionnaire response pack.");
    }
  }

  async function approveFirstQuestionnaireAnswer() {
    const answer = questionnairePack?.answers.find((item) => item.status !== "approved");
    if (!questionnairePack || !answer) {
      return;
    }

    setActionState("running");
    setLastMessage("Approving questionnaire answer...");

    try {
      const response = await fetch(`/api/questionnaire/packs/${questionnairePack.id}/answers/${answer.id}/approve`, {
        method: "POST"
      });
      const payload = (await response.json()) as {
        pack: QuestionnaireResponsePack;
        snapshot: DashboardSnapshot;
        ok?: false;
        error?: string;
      };

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error ?? "Unable to approve questionnaire answer.");
      }

      setQuestionnairePack(payload.pack);
      setSnapshot(payload.snapshot);
      setActionState("idle");
      setLastMessage("Questionnaire answer approved.");
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to approve questionnaire answer.");
    }
  }

  async function verifyFirstAnswerLibraryItem() {
    const item = snapshot.answerLibrary.find((candidate) => candidate.status === "review_due") ?? snapshot.answerLibrary[0];
    if (!item) {
      return;
    }

    await callSnapshotAction(
      `/api/questionnaire/library/${item.id}/verify`,
      undefined,
      `Verifying answer library item for ${item.ownerRole}.`
    );
  }

  async function bulkVerifyAnswerLibrary() {
    setActionState("running");
    setLastMessage("Bulk verifying Answer Library items for the selected segment...");

    try {
      const response = await fetch("/api/questionnaire/library/bulk-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ segment: questionnaireForm.customerSegment, maxItems: 25 })
      });
      const payload = (await response.json()) as {
        verifiedCount: number;
        snapshot: DashboardSnapshot;
        ok?: false;
        error?: string;
      };

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error ?? "Unable to bulk verify Answer Library.");
      }

      setSnapshot(payload.snapshot);
      setActionState("idle");
      setLastMessage(`${payload.verifiedCount} Answer Library item(s) verified for ${questionnaireForm.customerSegment}.`);
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to bulk verify Answer Library.");
    }
  }

  async function exportQuestionnairePack() {
    if (!questionnairePack) {
      return;
    }

    setActionState("running");
    setLastMessage("Exporting questionnaire response pack...");

    try {
      const response = await fetch(`/api/questionnaire/packs/${questionnairePack.id}/export`, { method: "POST" });
      const payload = (await response.json()) as {
        pack: QuestionnaireResponsePack;
        snapshot: DashboardSnapshot;
        ok?: false;
        error?: string;
      };

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error ?? "Unable to export questionnaire response pack.");
      }

      setQuestionnairePack(payload.pack);
      setSnapshot(payload.snapshot);
      setActionState("idle");
      setLastMessage("Questionnaire response pack exported.");
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to export questionnaire response pack.");
    }
  }

  async function recordPilot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionState("running");
    setLastMessage("Recording private pilot evidence...");

    try {
      const response = await fetch("/api/pilots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...pilotForm,
          monthlyRevenueUsd: Number(pilotForm.monthlyRevenueUsd),
          activeUsers: Number(pilotForm.activeUsers)
        })
      });
      const payload = await response.json();

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error ?? "Unable to record pilot evidence.");
      }

      setSnapshot(payload);
      setActionState("idle");
      setLastMessage("Pilot evidence recorded and private metrics refreshed.");
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to record pilot evidence.");
    }
  }

  async function savePlaybook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionState("running");
    setLastMessage(playbookForm.id ? "Updating tenant remediation playbook..." : "Creating tenant remediation playbook...");

    try {
      const response = await fetch("/api/playbooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...playbookForm,
          id: playbookForm.id || undefined,
          approvalSlaHours: Number(playbookForm.approvalSlaHours)
        })
      });
      const payload = (await response.json()) as {
        playbook: RemediationPlaybook;
        snapshot: DashboardSnapshot;
        ok?: false;
        error?: string;
      };

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error ?? "Unable to save remediation playbook.");
      }

      setSnapshot(payload.snapshot);
      setPlaybookForm({
        id: payload.playbook.id,
        name: payload.playbook.name,
        trigger: payload.playbook.trigger,
        stagedActions: payload.playbook.stagedActions,
        autoAllowed: payload.playbook.autoAllowed,
        approvalSlaHours: String(payload.playbook.approvalSlaHours),
        ownerRole: payload.playbook.ownerRole,
        escalationTarget: payload.playbook.escalationTarget,
        status: payload.playbook.status
      });
      setActionState("idle");
      setLastMessage("Tenant remediation playbook saved with safety guardrails.");
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to save remediation playbook.");
    }
  }

  function editPlaybook(playbook: RemediationPlaybook) {
    setPlaybookForm({
      id: playbook.id,
      name: playbook.name,
      trigger: playbook.trigger,
      stagedActions: playbook.stagedActions,
      autoAllowed: playbook.autoAllowed,
      approvalSlaHours: String(playbook.approvalSlaHours),
      ownerRole: playbook.ownerRole,
      escalationTarget: playbook.escalationTarget,
      status: playbook.status
    });
    setLastMessage(`Editing playbook: ${playbook.name}`);
  }

  function togglePlaybookAction(action: RecommendationAction) {
    const hasAction = playbookForm.stagedActions.includes(action);
    const stagedActions = hasAction
      ? playbookForm.stagedActions.filter((candidate) => candidate !== action)
      : [...playbookForm.stagedActions, action];

    setPlaybookForm({ ...playbookForm, stagedActions });
  }

  async function verifyPersistence() {
    setActionState("running");
    setLastMessage("Checking production persistence write-through...");

    try {
      const response = await fetch("/api/production/persistence", { method: "POST" });
      const payload = (await response.json()) as PersistenceVerificationResult;
      setPersistenceCheck(payload);
      setActionState(payload.status === "failed" ? "error" : "idle");
      setLastMessage(
        payload.status === "passed"
          ? "Production persistence write-through verified."
          : payload.status === "blocked"
            ? "Production persistence is blocked until GCP env and IAM are configured."
            : "Production persistence check failed."
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to verify production persistence.");
    }
  }

  async function checkOAuthPlan() {
    setActionState("running");
    setLastMessage("Checking Google Workspace OAuth launch path...");

    try {
      const response = await fetch("/api/oauth/google/start");
      const payload = (await response.json()) as WorkspaceOAuthPlan;
      setOauthPlan(payload);
      setActionState(payload.launchAllowed ? "idle" : "error");
      setLastMessage(
        payload.launchAllowed
          ? "Workspace OAuth authorization URL is ready for pilot installs."
          : `Workspace OAuth is blocked: ${(payload.launchBlockers.length ? payload.launchBlockers : payload.missingEnv).join(" ")}`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to check Workspace OAuth.");
    }
  }

  async function runSyncReconciliation() {
    setActionState("running");
    setLastMessage("Reconciling Drive/Gmail sync cursors...");

    try {
      const response = await fetch("/api/workspace/sync/reconcile", { method: "POST" });
      const payload = (await response.json()) as { result: WorkspaceReconciliationResult; snapshot: DashboardSnapshot };

      if (!response.ok) {
        throw new Error("Unable to run sync reconciliation.");
      }

      setSyncCheck(payload.result);
      setSnapshot(payload.snapshot);
      setActionState(payload.result.status === "failed" ? "error" : "idle");
      setLastMessage(
        payload.result.status === "simulated"
          ? "Mock sync reconciliation completed without live Google API calls."
          : payload.result.status === "blocked"
            ? "Live sync reconciliation is blocked until OAuth cursors are initialized."
            : `Sync reconciliation ${payload.result.status}.`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to run sync reconciliation.");
    }
  }

  async function bootstrapLiveSync() {
    setActionState("running");
    setLastMessage("Bootstrapping live Drive/Gmail sync cursors...");

    try {
      const response = await fetch("/api/workspace/sync/bootstrap", { method: "POST" });
      const payload = (await response.json()) as { result: WorkspaceReconciliationResult; snapshot: DashboardSnapshot };

      if (!response.ok) {
        throw new Error("Unable to bootstrap live Workspace sync.");
      }

      setSyncCheck(payload.result);
      setSnapshot(payload.snapshot);
      setActionState(payload.result.status === "failed" ? "error" : "idle");
      setLastMessage(
        payload.result.status === "passed"
          ? "Live Workspace sync cursors initialized and persisted."
          : payload.result.status === "blocked"
            ? "Live sync bootstrap is blocked until OAuth, GCP persistence, product URL, and webhook secrets are configured."
            : `Live sync bootstrap ${payload.result.status}.`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to bootstrap live Workspace sync.");
    }
  }

  async function renewWorkspaceWatches() {
    setActionState("running");
    setLastMessage("Renewing live Drive/Gmail watches...");

    try {
      const response = await fetch("/api/workspace/sync/renew", { method: "POST" });
      const payload = (await response.json()) as { result: WorkspaceReconciliationResult; snapshot: DashboardSnapshot };

      if (!response.ok) {
        throw new Error("Unable to renew Workspace watches.");
      }

      setSyncCheck(payload.result);
      setSnapshot(payload.snapshot);
      setActionState(payload.result.status === "failed" ? "error" : "idle");
      setLastMessage(
        payload.result.status === "passed"
          ? "Live Workspace watches renewed and persisted."
          : payload.result.status === "blocked"
            ? "Watch renewal is blocked until hosted OAuth, GCP persistence, product URL, and webhook secrets are configured."
            : `Workspace watch renewal ${payload.result.status}.`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to renew Workspace watches.");
    }
  }

  async function checkCostControls() {
    setActionState("running");
    setLastMessage("Checking Google Cloud budget and Gemini key controls...");

    try {
      const planResponse = await fetch("/api/production/cost-controls");
      const planPayload = (await planResponse.json()) as CloudCostControlCenter;
      const verifyResponse = await fetch("/api/production/cost-controls", { method: "POST" });
      const verifyPayload = (await verifyResponse.json()) as CloudCostControlVerificationResult;

      setCostControls(planPayload);
      setCostControlCheck(verifyPayload);
      setActionState(verifyPayload.status === "passed" ? "idle" : "error");
      setLastMessage(
        verifyPayload.status === "passed"
          ? "Cloud cost controls verified against configured GCP resources."
          : "Cloud cost controls still need production GCP budget, quota, or key-restriction proof."
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to check cloud cost controls.");
    }
  }

  async function captureScoreSnapshot() {
    setActionState("running");
    setLastMessage("Capturing risk and deal-impact score snapshot...");

    try {
      const response = await fetch("/api/risk/score-history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "manual_snapshot" })
      });
      const payload = (await response.json()) as {
        snapshot: DashboardSnapshot;
        ok?: false;
        error?: string;
      };

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error ?? "Unable to capture score snapshot.");
      }

      setSnapshot(payload.snapshot);
      setActionState("idle");
      setLastMessage("Risk score snapshot captured for trend evidence.");
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to capture score snapshot.");
    }
  }

  async function runClaimGuard() {
    setActionState("running");
    setLastMessage("Scanning product and submission copy for overclaims...");

    try {
      const response = await fetch("/api/compliance/claims");
      const payload = (await response.json()) as ClaimGuardResult;
      setClaimGuardCheck(payload);
      setActionState(payload.status === "failed" ? "error" : "idle");
      setLastMessage(
        payload.status === "passed"
          ? "Claim guard passed. No banned compliance or win claims found."
          : payload.status === "warning"
            ? "Claim guard completed with warnings."
            : "Claim guard found copy that must be fixed before submission."
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to run claim guard.");
    }
  }

  async function checkSubmissionGate() {
    setActionState("running");
    setLastMessage("Checking XPRIZE submission gate against current evidence...");

    try {
      const response = await fetch("/api/xprize/submission-gate");
      const payload = (await response.json()) as XPrizeSubmissionGate;
      setSubmissionGate(payload);
      setActionState(payload.overallStatus === "blocked" ? "error" : "idle");
      setLastMessage(
        payload.overallStatus === "passed"
          ? "XPRIZE submission gate passed on current evidence."
          : payload.overallStatus === "warning"
            ? "XPRIZE submission gate has warnings."
            : `XPRIZE submission gate is blocked by ${payload.blockingSummary.length} item(s).`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to check XPRIZE submission gate.");
    }
  }

  async function checkProjectProvenance() {
    setActionState("running");
    setLastMessage("Checking project provenance and disclosure readiness...");

    try {
      const response = await fetch("/api/xprize/provenance");
      const payload = (await response.json()) as ProjectProvenanceReport;
      setProjectProvenance(payload);
      setActionState(payload.overallStatus === "blocked" ? "error" : "idle");
      setLastMessage(
        payload.overallStatus === "passed"
          ? "Project provenance checks passed on current evidence."
          : `Project provenance has ${payload.blockers.length} blocker(s).`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to check project provenance.");
    }
  }

  async function checkEligibilityDisclosure() {
    setActionState("running");
    setLastMessage("Generating eligibility and disclosure review packet...");

    try {
      const response = await fetch("/api/xprize/eligibility-disclosure");
      const payload = (await response.json()) as EligibilityDisclosurePacket;
      setEligibilityDisclosure(payload);
      setActionState(payload.overallStatus === "blocked" ? "error" : "idle");
      setLastMessage(
        payload.overallStatus === "ready-for-review"
          ? "Eligibility disclosure packet is ready for human review."
          : `Eligibility disclosure packet is blocked by ${payload.blockers.length} item(s).`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to generate eligibility disclosure packet.");
    }
  }

  async function checkSourceRelease() {
    setActionState("running");
    setLastMessage("Checking source-release readiness before staging or publishing...");

    try {
      const response = await fetch("/api/xprize/source-release");
      const payload = (await response.json()) as SourceReleaseGuard;
      setSourceReleaseGuard(payload);
      setActionState(payload.overallStatus === "blocked" ? "error" : "idle");
      setLastMessage(
        payload.overallStatus === "published"
          ? "Source-release guard sees tracked source with no blocking release hygiene findings."
          : payload.overallStatus === "ready-to-commit"
            ? "Source-release guard is ready for first commit after final review."
            : `Source-release guard is blocked by ${payload.blockers.length} item(s).`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to check source-release readiness.");
    }
  }

  async function checkSubmissionCompliance() {
    setActionState("running");
    setLastMessage("Checking submission, IP, license, and demo clearance...");

    try {
      const response = await fetch("/api/xprize/submission-compliance");
      const payload = (await response.json()) as SubmissionComplianceCenter;
      setSubmissionCompliance(payload);
      setActionState(payload.overallStatus === "blocked" ? "error" : "idle");
      setLastMessage(
        payload.overallStatus === "passed"
          ? "Submission compliance gate passed."
          : `Submission compliance has ${payload.summary.blocked} blocker(s) and ${payload.summary.warning} warning(s).`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to check submission compliance.");
    }
  }

  async function checkDemoVideoPack() {
    setActionState("running");
    setLastMessage("Checking demo-video runtime, platform, clearance, and proof gates...");

    try {
      const response = await fetch("/api/xprize/demo-video-pack");
      const payload = (await response.json()) as DemoVideoCompliancePack;
      setDemoVideoPack(payload);
      setActionState(payload.overallStatus === "blocked" ? "error" : "idle");
      setLastMessage(
        payload.overallStatus === "cleared"
          ? "Demo-video compliance pack is cleared against current human confirmations."
          : payload.overallStatus === "ready-to-record"
            ? "Demo-video plan is ready to record, but final public proof still needs human review."
            : `Demo-video pack is blocked by ${payload.blockers.length} item(s).`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to check demo-video pack.");
    }
  }

  async function checkThirdPartyManifest() {
    setActionState("running");
    setLastMessage("Generating dependency and third-party API manifest...");

    try {
      const response = await fetch("/api/xprize/license-manifest");
      const payload = (await response.json()) as ThirdPartyManifest;
      setThirdPartyManifest(payload);
      setActionState(payload.summary.status === "blocked" ? "error" : "idle");
      setLastMessage(
        payload.summary.status === "passed"
          ? "Third-party manifest is ready for submission disclosure."
          : `Third-party manifest needs review: ${payload.summary.restrictedLicenseReviewCount} restricted-review package(s), ${payload.summary.obligationReviewCount} obligation-review package(s), ${payload.summary.licenseNeedsReviewCount} license-review package(s), ${payload.summary.integrationsNeedingReview} integration(s).`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to generate third-party manifest.");
    }
  }

  async function checkJudgeAccessPack() {
    setActionState("running");
    setLastMessage("Building private judge access and testing packet...");

    try {
      const response = await fetch("/api/xprize/judge-access-pack");
      const payload = (await response.json()) as JudgeAccessPack;
      setJudgeAccessPack(payload);
      setActionState(payload.overallStatus === "blocked" ? "error" : "idle");
      setLastMessage(
        payload.overallStatus === "ready"
          ? "Judge access packet is ready on current confirmations."
          : payload.overallStatus === "needs-review"
            ? "Judge access packet needs final private review."
            : `Judge access packet is blocked by ${payload.blockers.length} item(s).`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to build judge access packet.");
    }
  }

  async function generateSubmissionBinder() {
    setActionState("running");
    setLastMessage("Generating private XPRIZE submission binder...");

    try {
      const response = await fetch("/api/xprize/submission-binder");
      const payload = (await response.json()) as XPrizeSubmissionBinder;
      setSubmissionBinder(payload);
      setActionState("idle");
      setLastMessage(
        payload.overallStatus === "passed"
          ? "Submission binder generated with current evidence marked ready."
          : `Submission binder generated with ${payload.artifactSummary.missing} missing artifact(s).`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to generate submission binder.");
    }
  }

  async function generateDevpostPack() {
    setActionState("running");
    setLastMessage("Generating claim-safe Devpost copy, demo script, and screenshot checklist...");

    try {
      const response = await fetch("/api/xprize/devpost-pack");
      const payload = (await response.json()) as DevpostSubmissionPack;
      setDevpostPack(payload);
      setActionState(payload.overallStatus === "blocked" ? "error" : "idle");
      setLastMessage(
        payload.overallStatus === "ready"
          ? "Devpost pack generated and ready for final human review."
          : `Devpost pack generated with ${payload.blockers.length} blocker(s).`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to generate Devpost pack.");
    }
  }

  async function checkProductionLaunch() {
    setActionState("running");
    setLastMessage("Building production launch and proof command center...");

    try {
      const response = await fetch("/api/production/launch-readiness");
      const payload = (await response.json()) as ProductionLaunchCommandCenter;
      setProductionLaunch(payload);
      setActionState(payload.overallStatus === "blocked" ? "error" : "idle");
      setLastMessage(
        payload.overallStatus === "ready"
          ? "Production launch proof is ready on current evidence."
          : `Production launch plan has ${payload.blockers.length} blocker(s).`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to build production launch plan.");
    }
  }

  async function checkProductionProvisioning() {
    setActionState("running");
    setLastMessage("Building non-secret production provisioning pack...");

    try {
      const response = await fetch("/api/production/provisioning");
      const payload = (await response.json()) as ProductionProvisioningPack;
      setProductionProvisioning(payload);
      setActionState(payload.status === "external-required" ? "error" : "idle");
      setLastMessage(
        payload.status === "ready-to-run"
          ? "Production provisioning pack is ready for operator execution."
          : `Provisioning pack generated with ${payload.blockers.length} value or review gap(s).`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to build production provisioning pack.");
    }
  }

  async function checkCloudRunDeploymentEvidence() {
    setActionState("running");
    setLastMessage("Checking Cloud Run manifest deployment evidence...");

    try {
      const response = await fetch("/api/production/deployment-evidence");
      const payload = (await response.json()) as CloudRunDeploymentEvidence;
      setCloudRunDeploymentEvidence(payload);
      setActionState(payload.overallStatus === "blocked" ? "error" : "idle");
      setLastMessage(
        payload.overallStatus === "ready-to-dry-run"
          ? "Cloud Run manifest is ready for dry-run."
          : payload.overallStatus === "template-needs-values"
            ? `Cloud Run manifest still has ${payload.replacementFindings.length} replacement value(s).`
            : `Cloud Run manifest has ${payload.blockers.length} blocker(s).`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to check Cloud Run deployment evidence.");
    }
  }

  async function checkHostedEvidenceCapture() {
    setActionState("running");
    setLastMessage("Building hosted production evidence capture packet...");

    try {
      const response = await fetch("/api/production/hosted-evidence");
      const payload = (await response.json()) as HostedEvidenceCapturePacket;
      setHostedEvidenceCapture(payload);
      setActionState(payload.overallStatus === "blocked" ? "error" : "idle");
      setLastMessage(
        payload.overallStatus === "ready-to-capture"
          ? "Hosted evidence capture packet is complete on current proof."
          : payload.overallStatus === "needs-hosted-proof"
            ? `Hosted evidence still needs ${payload.checks.filter((check) => check.status !== "captured").length} production artifact(s).`
            : `Hosted evidence capture has ${payload.blockers.length} blocker(s).`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to build hosted evidence capture packet.");
    }
  }

  async function checkDeploymentEvidencePacket() {
    setActionState("running");
    setLastMessage("Building release deployment evidence packet...");

    try {
      const response = await fetch("/api/production/deployment-packet");
      const payload = (await response.json()) as DeploymentEvidencePacket;
      setDeploymentEvidencePacket(payload);
      setActionState(payload.status === "blocked" ? "error" : "idle");
      setLastMessage(
        payload.status === "ready-to-capture"
          ? "Deployment evidence packet is ready for hosted capture."
          : payload.status === "template-needs-values"
            ? `Deployment evidence packet still needs ${payload.nextActions.length} setup action(s).`
            : `Deployment evidence packet has ${payload.blockers.length} blocker(s).`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to build deployment evidence packet.");
    }
  }

  async function runProductionGeminiSmoke() {
    setActionState("running");
    setLastMessage("Running synthetic production Gemini proof smoke...");

    try {
      const response = await fetch("/api/production/gemini-smoke", { method: "POST" });
      const payload = (await response.json()) as ProductionGeminiProofResult;
      setProductionGeminiProof(payload);
      await refreshState();
      setActionState(payload.status === "passed" ? "idle" : "error");
      setLastMessage(
        payload.status === "passed"
          ? "Live Gemini proof smoke recorded with provider=gemini-api."
          : `Gemini proof smoke is ${payload.status}: ${payload.nextAction}`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to run production Gemini smoke.");
    }
  }

  async function checkMarketPositioning() {
    setActionState("running");
    setLastMessage("Building market positioning and competitor battlecard...");

    try {
      const response = await fetch("/api/market/positioning");
      const payload = (await response.json()) as MarketPositioningCommandCenter;
      setMarketPositioning(payload);
      setActionState(payload.overallStatus === "behind-incumbents" ? "error" : "idle");
      setLastMessage(
        payload.overallStatus === "strong"
          ? "Market positioning is strong on current evidence."
          : `Market positioning needs proof: wedge score ${payload.wedgeScore}%.`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to build market positioning.");
    }
  }

  async function checkMvpOutreachPlan() {
    setActionState("running");
    setLastMessage("Building MVP outreach plan...");

    try {
      const response = await fetch("/api/mvp/outreach-plan");
      const payload = (await response.json()) as MvpOutreachPlan;
      setMvpOutreachPlan(payload);
      setActionState(payload.status === "blocked" ? "error" : "idle");
      setLastMessage(
        payload.status === "ready-for-outreach"
          ? "MVP outreach plan is ready for private pilot outreach on current evidence."
          : `MVP outreach plan is ${payload.status.replaceAll("-", " ")} with score ${payload.readinessScore}%.`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to build MVP outreach plan.");
    }
  }

  async function exportFrameworkPack() {
    setActionState("running");
    setLastMessage(`Exporting ${frameworkSelection} ${frameworkAudience} readiness evidence pack...`);

    try {
      const response = await fetch(
        `/api/frameworks/evidence?framework=${encodeURIComponent(frameworkSelection)}&audience=${frameworkAudience}&redacted=true`
      );
      const payload = (await response.json()) as FrameworkEvidencePack;
      setFrameworkPack(payload);
      setActionState("idle");
      setLastMessage(
        `${payload.framework} ${payload.audience} pack exported with ${payload.summary.ready} ready, ${payload.summary.partial} partial, and ${payload.summary.blocked} blocked control(s).`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to export framework evidence pack.");
    }
  }

  async function generateDealImpactReport() {
    setActionState("running");
    setLastMessage("Generating redacted deal-impact report...");

    try {
      const response = await fetch("/api/deal-impact/report?redacted=true");
      const payload = (await response.json()) as DealImpactReport;
      setDealImpactReport(payload);
      await refreshState();
      setActionState("idle");
      setLastMessage(
        `Deal-impact report generated with ${payload.productionGaps.length} production gap(s) still visible.`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to generate deal-impact report.");
    }
  }

  async function checkFinancialEvidenceLedger() {
    setActionState("running");
    setLastMessage("Checking private financial evidence ledger...");

    try {
      const response = await fetch("/api/financial-evidence/ledger");
      const payload = (await response.json()) as FinancialEvidenceLedger;
      setFinancialLedger(payload);
      setActionState(payload.blockers.length ? "error" : "idle");
      setLastMessage(
        payload.blockers.length
          ? `Financial ledger found ${payload.blockers.length} evidence blocker(s).`
          : "Financial ledger is ready for private judge review."
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to check financial evidence ledger.");
    }
  }

  async function checkEvidenceVault() {
    setActionState("running");
    setLastMessage("Checking private Evidence Vault artifacts...");

    try {
      const response = await fetch("/api/evidence/vault");
      const payload = (await response.json()) as EvidenceVault;
      setEvidenceVaultCheck(payload);
      setActionState(payload.blockers.length ? "error" : "idle");
      setLastMessage(
        payload.blockers.length
          ? `Evidence Vault found ${payload.blockers.length} blocker(s).`
          : "Evidence Vault artifacts are ready for private judge review."
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to check Evidence Vault.");
    }
  }

  async function importEvidenceVaultJson() {
    setActionState("running");
    setLastMessage("Importing redacted hosted proof JSON into the Evidence Vault...");

    try {
      const parsed = JSON.parse(evidenceImportJson) as unknown;
      const response = await fetch("/api/evidence/vault/import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(evidenceImportToken.trim() ? { "x-sentinel-admin-token": evidenceImportToken.trim() } : {})
        },
        body: JSON.stringify(parsed)
      });
      const payload = (await response.json()) as {
        importResult?: EvidenceVaultImportResult;
        artifacts?: unknown[];
        snapshot?: DashboardSnapshot;
        error?: string;
      };

      if (!response.ok || !payload.importResult || !payload.snapshot) {
        throw new Error(payload.error ?? "Unable to import hosted proof JSON.");
      }

      setEvidenceVaultImportResult(payload.importResult);
      setSnapshot(payload.snapshot);
      setEvidenceVaultCheck(payload.snapshot.readiness.evidenceVault);
      setActionState(payload.importResult.status === "blocked" ? "error" : "idle");
      setLastMessage(
        `Imported ${payload.artifacts?.length ?? payload.importResult.artifactCount} artifact(s) from ${payload.importResult.source}; checksum ${payload.importResult.checksumSha256.slice(0, 12)}...`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to import hosted proof JSON.");
    }
  }

  async function checkEvidenceIntakeQueue() {
    setActionState("running");
    setLastMessage("Building private evidence intake queue...");

    try {
      const response = await fetch("/api/evidence/vault?view=intake");
      const payload = (await response.json()) as EvidenceIntakeQueue;
      setEvidenceIntakeQueue(payload);
      setActionState(payload.overallStatus === "blocked" ? "error" : "idle");
      setLastMessage(
        payload.overallStatus === "ready"
          ? "Evidence intake queue is ready for private judge review."
          : `Evidence intake queue is ${payload.overallStatus.replaceAll("-", " ")} with ${payload.criticalMissing} priority blocker(s).`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to build evidence intake queue.");
    }
  }

  async function runCopilotQuery() {
    setActionState("running");
    setLastMessage("Searching redacted evidence with citations...");

    try {
      const response = await fetch("/api/evidence/copilot/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: copilotQuery, mode: "judge", maxCitations: 5 })
      });
      const payload = (await response.json()) as EvidenceCopilotResult;
      if (!response.ok) {
        throw new Error("Evidence Copilot query failed.");
      }
      setCopilotResult(payload);
      setActionState("idle");
      setLastMessage(`Evidence Copilot returned ${payload.citations.length} cited source(s).`);
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Evidence Copilot query failed.");
    }
  }

  async function runEvidenceSynthesis() {
    setActionState("running");
    setLastMessage("Generating cited evidence synthesis pack...");

    try {
      const response = await fetch("/api/evidence/synthesis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packType: synthesisType, mode: "judge" })
      });
      const payload = (await response.json()) as EvidenceSynthesisPack;
      if (!response.ok) {
        throw new Error("Evidence synthesis failed.");
      }
      setSynthesisPack(payload);
      setActionState("idle");
      setLastMessage(`Evidence synthesis generated ${payload.sections.length} section(s).`);
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Evidence synthesis failed.");
    }
  }

  async function runMetricQuery() {
    setActionState("running");
    setLastMessage("Compiling allowlisted evidence metric...");

    try {
      const response = await fetch("/api/evidence/metrics/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: metricQuestion })
      });
      const payload = (await response.json()) as MetricQueryResult;
      setMetricResult(payload);
      setActionState(payload.blocked ? "error" : "idle");
      setLastMessage(payload.blocked ? "Metric query was blocked by safety policy." : `Metric query returned ${payload.rows.length} row(s).`);
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Evidence metric query failed.");
    }
  }

  async function analyzeDocumentInput() {
    setActionState("running");
    setLastMessage("Analyzing evidence document fixture...");

    try {
      const response = await fetch("/api/evidence/documents/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentName: `copilot-${documentInputKind}.txt`,
          inputKind: documentInputKind,
          text: documentText
        })
      });
      const payload = (await response.json()) as EvidenceDocumentAnalysisResult;
      if (!response.ok) {
        throw new Error("Evidence document analysis failed.");
      }
      setDocumentAnalysis(payload);
      setActionState(payload.blockers.length ? "error" : "idle");
      setLastMessage(
        payload.blockers.length
          ? `Document analysis found ${payload.blockers.length} review blocker(s).`
          : `Document analysis routed ${payload.documentKind.replaceAll("-", " ")} evidence.`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Evidence document analysis failed.");
    }
  }

  async function checkPilotLaunchPlan() {
    setActionState("running");
    setLastMessage("Building one-day paid pilot launch plan...");

    try {
      const response = await fetch("/api/pilots/launch-plan");
      const payload = (await response.json()) as PilotLaunchPlan;
      setPilotLaunchPlan(payload);
      setActionState(payload.status === "blocked" ? "error" : "idle");
      setLastMessage(
        payload.status === "ready"
          ? "Pilot launch plan is ready."
          : `Pilot launch plan is ${payload.status.replaceAll("-", " ")} with ${payload.blockers.length} blocker(s).`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to build pilot launch plan.");
    }
  }

  async function checkPilotProspectPipeline() {
    setActionState("running");
    setLastMessage("Checking prospect-to-paid-pilot pipeline...");

    try {
      const response = await fetch("/api/pilots/prospects");
      const payload = (await response.json()) as PilotProspectPipeline;
      setProspectPipeline(payload);
      setActionState(payload.blockers.length ? "error" : "idle");
      setLastMessage(
        payload.blockers.length
          ? `Prospect pipeline has ${payload.blockers.length} conversion blocker(s).`
          : "Prospect pipeline is ready for outreach execution."
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to check prospect pipeline.");
    }
  }

  async function checkPilotConversionKit() {
    setActionState("running");
    setLastMessage("Building paid pilot conversion kit...");

    try {
      const response = await fetch("/api/pilots/conversion-kit");
      const payload = (await response.json()) as PilotConversionKit;
      setPilotConversionKit(payload);
      setActionState(payload.status === "blocked" ? "error" : "idle");
      setLastMessage(
        payload.status === "ready"
          ? "Pilot conversion kit is ready on current evidence."
          : `Pilot conversion kit needs proof: score ${payload.conversionScore}%.`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to build pilot conversion kit.");
    }
  }

  async function checkPilotConsentPacket() {
    setActionState("running");
    setLastMessage("Building pilot consent and scope packet...");

    try {
      const response = await fetch("/api/pilots/consent-packet");
      const payload = (await response.json()) as PilotConsentPacket;
      setPilotConsentPacket(payload);
      setActionState(payload.status === "blocked" ? "error" : "idle");
      setLastMessage(
        payload.status === "ready"
          ? "Pilot consent packet is ready."
          : `Pilot consent packet is ${payload.status.replaceAll("-", " ")} with score ${payload.authorizationScore}%.`
      );
    } catch (error) {
      setActionState("error");
      setLastMessage(error instanceof Error ? error.message : "Unable to build pilot consent packet.");
    }
  }

  const primaryFinding = snapshot.findings[0];
  const businessVerificationChecklist = useMemo(() => buildBusinessVerificationChecklist(), []);
  const businessVerificationSummary = useMemo(
    () => getBusinessVerificationSummary(businessVerificationChecklist),
    [businessVerificationChecklist]
  );
  const stripeProofStatusPanel = useMemo(
    () => buildStripeProofStatusPanel({ businessVerificationChecklist, financialEvidence }),
    [businessVerificationChecklist, financialEvidence]
  );

  return (
    <main className="admin-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Build with Gemini XPRIZE · Small Business Services</p>
          <h1>SME Workspace Sentinel</h1>
          <p className="subtle">
            AI DLP and SOC2 readiness evidence for Google Workspace pilots. Human approval is required before
            non-trivial remediation.
          </p>
        </div>
        <div className="status-pill" data-state={actionState}>
          <Sparkles size={16} aria-hidden="true" />
          {lastMessage}
        </div>
      </section>

      <nav className="admin-tabbar" aria-label="Admin console sections">
        {adminTabs.map((tab) => (
          <a key={tab.href} href={tab.href}>
            {tab.label}
          </a>
        ))}
      </nav>

      <section id="admin-overview" className="metrics-grid" aria-label="Evidence Room metrics">
        <Metric label="MRR" value={`$${formatNumber(snapshot.tenant.evidence.mrrUsd)}`} hint="Real revenue evidence field" />
        <Metric label="Pilots" value={snapshot.tenant.evidence.pilotCount.toString()} hint="Arms-length customer proof target" />
        <Metric label="Risks detected" value={metrics.risksDetected.toString()} hint="No overclaiming as violations prevented" />
        <Metric label="Public exposures closed" value={metrics.remediated.toString()} hint="Approved remediations only" />
        <Metric label="Agent runs" value={metrics.agentRuns.toString()} hint="AI-native operations evidence" />
        <Metric label="Gemini spend" value={`$${metrics.geminiCost.toFixed(4)}`} hint="Cost discipline for SME margin" />
      </section>

      <section className="panel business-verification-card" aria-label="Stripe business verification status">
        <div className="panel-heading">
          <div>
            <h2>Stripe Business Verification</h2>
            <p>
              {businessVerificationSummary.ready}/{businessVerificationSummary.total} public business-detail items
              ready; owner-held address, phone, and support email stay fail-closed until configured.
            </p>
          </div>
          <span className="state" data-state={businessVerificationSummary.complete ? "implemented" : "blocked"}>
            {businessVerificationSummary.complete ? "ready" : "blocked"}
          </span>
        </div>
        <div className="business-verification-grid">
          {businessVerificationChecklist.map((item) => (
            <article key={item.id} className="business-verification-row">
              <div>
                <strong>{item.label}</strong>
                <p>{item.ownerAction}</p>
              </div>
              <span data-status={item.status}>{item.status.replace("-", " ")}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="panel stripe-proof-status-card" aria-label="Stripe proof status">
        <div className="panel-heading">
          <div>
            <h2>Stripe Proof Status</h2>
            <p>
              {stripeProofStatusPanel.summary.ready}/{stripeProofStatusPanel.summary.total} non-secret proof gates
              ready; test checkout, live MRR, and invoice/payment evidence stay blocked until owner-held Stripe proof passes.
            </p>
          </div>
          <span className="state" data-state={stripeProofStatusPanel.summary.complete ? "implemented" : "blocked"}>
            {stripeProofStatusPanel.summary.complete ? "ready" : "blocked"}
          </span>
        </div>
        <div className="stripe-proof-grid">
          {stripeProofStatusPanel.items.map((item) => (
            <article key={item.id} className="stripe-proof-row">
              <div>
                <strong>{item.label}</strong>
                <p>{item.evidence}</p>
                <small>
                  Required: {item.requiredProof} Does not prove: {item.doesNotProve}
                </small>
              </div>
              <span data-status={item.status}>{item.status}</span>
            </article>
          ))}
        </div>
        <p className="proof-boundary-note">{stripeProofStatusPanel.summary.boundary}</p>
      </section>

      <MvpOutreachPanel
        busy={actionState === "running"}
        mvpOutreachPlan={mvpOutreachPlan}
        onBuildOutreachPlan={checkMvpOutreachPlan}
        onConversionKit={checkPilotConversionKit}
      />

      <WorkspaceFlowPanel
        busy={actionState === "running"}
        onInjectEvent={injectEvent}
        onReset={() => callSnapshotAction("/api/demo/reset")}
      />

      <section className="content-grid">
        <FindingsPanel
          findings={snapshot.findings}
          busy={actionState === "running"}
          onApprove={(id) => callSnapshotAction(`/api/findings/${id}/approve`, undefined, "Approving staged recommendation.")}
          onRemediate={(id, action) =>
            callSnapshotAction(
              `/api/findings/${id}/remediate`,
              { body: JSON.stringify({ action }) },
              "Executing simulated safe remediation."
            )
          }
          onDismiss={(id) => callSnapshotAction(`/api/findings/${id}/dismiss`, undefined, "Dismissing finding.")}
          onFalsePositive={(id) => callSnapshotAction(`/api/findings/${id}/false-positive`, undefined, "Marking false positive.")}
          onRescan={(id) => callSnapshotAction(`/api/findings/${id}/rescan`, undefined, "Requesting re-scan.")}
        />

        <EvidencePanel
          counters={snapshot.aggregateCounters}
          busy={actionState === "running"}
          exportPreview={exportPreview}
          onExport={exportEvidence}
          onExportFormat={exportEvidenceFormat}
          onExportSigned={exportSignedEvidencePacket}
        />
      </section>

      <EvidenceCopilotPanel
        busy={actionState === "running"}
        copilotQuery={copilotQuery}
        onCopilotQueryChange={setCopilotQuery}
        copilotResult={copilotResult}
        synthesisType={synthesisType}
        onSynthesisTypeChange={setSynthesisType}
        synthesisPack={synthesisPack}
        metricQuestion={metricQuestion}
        onMetricQuestionChange={setMetricQuestion}
        metricResult={metricResult}
        documentInputKind={documentInputKind}
        onDocumentInputKindChange={setDocumentInputKind}
        documentText={documentText}
        onDocumentTextChange={setDocumentText}
        documentAnalysis={documentAnalysis}
        onRunCopilotQuery={runCopilotQuery}
        onRunEvidenceSynthesis={runEvidenceSynthesis}
        onRunMetricQuery={runMetricQuery}
        onAnalyzeDocumentInput={analyzeDocumentInput}
      />

      <section id="admin-trust" className="content-grid">
        <TrustCenterPanel
          busy={actionState === "running"}
          hasPendingTrustRequests={snapshot.trustAccessRequests.some((request) => request.status === "pending")}
          trustProfile={trustProfile}
          trustPacket={trustPacket}
          trustAccess={readiness.trustAccess}
          trustAnalytics={readiness.trustAnalytics}
          onGenerateProfile={generateTrustProfile}
          onCreatePacket={createProspectTrustPacket}
          onRequestDocuments={requestTrustDocuments}
          onApproveDocuments={approveTrustDocuments}
        />

        <QuestionnairePanel
          busy={actionState === "running"}
          form={questionnaireForm}
          onFormChange={setQuestionnaireForm}
          draft={questionnaireDraft}
          pack={questionnairePack}
          answerLibrary={snapshot.answerLibrary}
          answerLibrarySummary={readiness.answerLibrary}
          onGenerateDraft={generateQuestionnaireDraft}
          onCreatePack={createQuestionnairePack}
          onVerifyItem={verifyFirstAnswerLibraryItem}
          onBulkVerify={bulkVerifyAnswerLibrary}
          onApproveAnswer={approveFirstQuestionnaireAnswer}
          onExportPack={exportQuestionnairePack}
        />
      </section>

      {readiness ? (
        <section id="admin-readiness" className="strategy-grid">
        <ReadinessCommandPanel
          busy={actionState === "running"}
          readiness={readiness}
          persistence={persistence}
          oauthPlan={oauthPlan}
          syncCheck={syncCheck}
          costControls={costControls}
          costControlCheck={costControlCheck}
          productionLaunch={productionLaunch}
          productionProvisioning={productionProvisioning}
          cloudRunDeploymentEvidence={cloudRunDeploymentEvidence}
          hostedEvidenceCapture={hostedEvidenceCapture}
          deploymentEvidencePacket={deploymentEvidencePacket}
          productionGeminiProof={productionGeminiProof}
          claimGuardCheck={claimGuardCheck}
          submissionGate={submissionGate}
          projectProvenance={projectProvenance}
          eligibilityDisclosure={eligibilityDisclosure}
          sourceReleaseGuard={sourceReleaseGuard}
          submissionBinder={submissionBinder}
          submissionCompliance={submissionCompliance}
          demoVideoPack={demoVideoPack}
          devpostPack={devpostPack}
          judgeAccessPack={judgeAccessPack}
          thirdPartyManifest={thirdPartyManifest}
          onCaptureScoreSnapshot={captureScoreSnapshot}
          onCheckOAuthPlan={checkOAuthPlan}
          onRunSyncReconciliation={runSyncReconciliation}
          onBootstrapLiveSync={bootstrapLiveSync}
          onRenewWorkspaceWatches={renewWorkspaceWatches}
          onCheckCostControls={checkCostControls}
          onCheckProductionLaunch={checkProductionLaunch}
          onCheckProductionProvisioning={checkProductionProvisioning}
          onCheckCloudRunDeploymentEvidence={checkCloudRunDeploymentEvidence}
          onCheckHostedEvidenceCapture={checkHostedEvidenceCapture}
          onCheckDeploymentEvidencePacket={checkDeploymentEvidencePacket}
          onRunProductionGeminiSmoke={runProductionGeminiSmoke}
          onRunClaimGuard={runClaimGuard}
          onCheckSubmissionGate={checkSubmissionGate}
          onCheckProjectProvenance={checkProjectProvenance}
          onCheckEligibilityDisclosure={checkEligibilityDisclosure}
          onCheckSourceRelease={checkSourceRelease}
          onCheckSubmissionCompliance={checkSubmissionCompliance}
          onCheckDemoVideoPack={checkDemoVideoPack}
          onCheckThirdPartyManifest={checkThirdPartyManifest}
          onCheckJudgeAccessPack={checkJudgeAccessPack}
          onGenerateSubmissionBinder={generateSubmissionBinder}
          onGenerateDevpostPack={generateDevpostPack}
        />

        <PilotCrmPanel
          busy={actionState === "running"}
          pilotCrm={readiness.pilotCrm}
          roiCalculator={readiness.roiCalculator}
          launchPlan={launchPlan}
          pilotProspectPipeline={pilotProspectPipeline}
          conversionKit={conversionKit}
          consentPacket={consentPacket}
          financialLedgerStatus={financialLedgerStatus}
          financialEvidence={financialEvidence}
          evidenceVaultStatus={evidenceVaultStatus}
          evidenceVault={evidenceVault}
          intakeQueue={intakeQueue}
          dealImpactReport={dealImpactReport}
          evidenceVaultImportResult={evidenceVaultImportResult}
          evidenceImportJson={evidenceImportJson}
          onEvidenceImportJsonChange={setEvidenceImportJson}
          evidenceImportToken={evidenceImportToken}
          onEvidenceImportTokenChange={setEvidenceImportToken}
          pilotForm={pilotForm}
          onPilotFormChange={setPilotForm}
          onCheckPilotLaunchPlan={checkPilotLaunchPlan}
          onCheckPilotProspectPipeline={checkPilotProspectPipeline}
          onCheckPilotConversionKit={checkPilotConversionKit}
          onCheckPilotConsentPacket={checkPilotConsentPacket}
          onCheckFinancialEvidenceLedger={checkFinancialEvidenceLedger}
          onCheckEvidenceVault={checkEvidenceVault}
          onImportEvidenceVaultJson={importEvidenceVaultJson}
          onCheckEvidenceIntakeQueue={checkEvidenceIntakeQueue}
          onGenerateDealImpactReport={generateDealImpactReport}
          onRecordPilot={recordPilot}
        />
      </section>
      ) : null}

      {readiness ? (
        <PlaybooksPanel
          busy={actionState === "running"}
          readiness={readiness}
          playbookForm={playbookForm}
          onPlaybookFormChange={setPlaybookForm}
          onEditPlaybook={editPlaybook}
          onSavePlaybook={savePlaybook}
          onTogglePlaybookAction={togglePlaybookAction}
          playbookActionOptions={playbookActionOptions}
          frameworkSelection={frameworkSelection}
          onFrameworkSelectionChange={setFrameworkSelection}
          frameworkAudience={frameworkAudience}
          onFrameworkAudienceChange={setFrameworkAudience}
          frameworkPack={frameworkPack}
          onExportFrameworkPack={exportFrameworkPack}
        />
      ) : null}

      {persistence ? (
        <ProductionPanel
          busy={actionState === "running"}
          persistence={persistence}
          persistenceCheck={persistenceCheck}
          readiness={readiness}
          onVerifyPersistence={verifyPersistence}
          onCheckCostControls={checkCostControls}
        />
      ) : null}

      <StrategyPanel
        busy={actionState === "running"}
        snapshot={snapshot}
        marketPositioning={marketPositioning}
        onCheckMarketPositioning={checkMarketPositioning}
      />

      <GapsPanel snapshot={snapshot} />

      <section className="panel audit-panel">
        <div className="panel-heading">
          <div>
            <h2>AI Operations Timeline</h2>
            <p>Append-only audit events show how AI is operating the product and business workflow.</p>
          </div>
          <RefreshCw size={24} aria-hidden="true" />
        </div>
        <ol className="timeline">
          {snapshot.auditEvents.slice(0, 10).map((event) => (
            <li key={event.id}>
              <time>{formatUtcTime(event.createdAt)}</time>
              <span>{event.message}</span>
            </li>
          ))}
        </ol>
      </section>

      {primaryFinding ? <SeverityLegend active={primaryFinding.severity} /> : null}
    </main>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

