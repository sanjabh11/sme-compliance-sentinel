"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  EyeOff,
  FileSearch,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Target,
  UserPlus,
  Wrench
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type {
  ApproverRole,
  ClaimGuardResult,
  CloudCostControlCenter,
  CloudCostControlVerificationResult,
  CloudRunDeploymentEvidence,
  DashboardSnapshot,
  DealImpactReport,
  DemoVideoCompliancePack,
  DevpostSubmissionPack,
  EligibilityDisclosurePacket,
  EvidenceExport,
  EvidenceIntakeQueue,
  EvidenceVault,
  EvidenceVaultImportResult,
  Finding,
  FinancialEvidenceLedger,
  FrameworkEvidencePack,
  FrameworkEvidenceAudience,
  FrameworkName,
  HostedEvidenceCapturePacket,
  MarketPositioningCommandCenter,
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
  Severity,
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

type ActionState = "idle" | "running" | "error";

const severityOrder: Severity[] = ["critical", "high", "medium", "low", "info"];
const playbookActionOptions: RecommendationAction[] = [
  "disable_public_sharing",
  "notify_owner",
  "request_owner_review",
  "label_restricted",
  "no_action"
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
  const [productionGeminiProof, setProductionGeminiProof] = useState<ProductionGeminiProofResult | null>(null);
  const [marketPositioning, setMarketPositioning] = useState<MarketPositioningCommandCenter | null>(null);
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
        headers: { "content-type": "application/json" },
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

  return (
    <main>
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

      <section className="metrics-grid" aria-label="Evidence Room metrics">
        <Metric label="MRR" value={`$${snapshot.tenant.evidence.mrrUsd.toLocaleString()}`} hint="Real revenue evidence field" />
        <Metric label="Pilots" value={snapshot.tenant.evidence.pilotCount.toString()} hint="Arms-length customer proof target" />
        <Metric label="Risks detected" value={metrics.risksDetected.toString()} hint="No overclaiming as violations prevented" />
        <Metric label="Public exposures closed" value={metrics.remediated.toString()} hint="Approved remediations only" />
        <Metric label="Agent runs" value={metrics.agentRuns.toString()} hint="AI-native operations evidence" />
        <Metric label="Gemini spend" value={`$${metrics.geminiCost.toFixed(4)}`} hint="Cost discipline for SME margin" />
      </section>

      <section className="workspace-band">
        <div className="panel command-panel">
          <div className="panel-heading">
            <div>
              <h2>Mock Workspace Flow</h2>
              <p>Drive and Gmail events run through Tier 0, deterministic detection, and Gemini only when justified.</p>
            </div>
            <ShieldCheck size={24} aria-hidden="true" />
          </div>
          <div className="button-row">
            <button type="button" onClick={() => injectEvent("public-secret")} disabled={actionState === "running"}>
              <Play size={16} aria-hidden="true" />
              High-risk Drive event
            </button>
            <button type="button" onClick={() => injectEvent("gmail-pii")} disabled={actionState === "running"}>
              <FileSearch size={16} aria-hidden="true" />
              Gmail PII event
            </button>
            <button type="button" onClick={() => injectEvent("low-risk")} disabled={actionState === "running"}>
              <EyeOff size={16} aria-hidden="true" />
              Low-risk skip
            </button>
            <button type="button" className="secondary" onClick={() => callSnapshotAction("/api/demo/reset")} disabled={actionState === "running"}>
              <RotateCcw size={16} aria-hidden="true" />
              Reset demo
            </button>
          </div>
        </div>

        <div className="panel compliance-panel">
          <div className="panel-heading">
            <div>
              <h2>Rule Boundaries</h2>
              <p>Antigravity is optional development tooling, not an app dependency or claimed requirement.</p>
            </div>
            <AlertTriangle size={24} aria-hidden="true" />
          </div>
          <ul className="check-list">
            <li>Uses “SOC2 readiness evidence,” not certification language.</li>
            <li>Requires Gemini API for deployed LLM workflow through `GEMINI_MODEL`.</li>
            <li>Uses Google Cloud deployment/services in production path.</li>
            <li>Exports redacted judge evidence; private findings stay private.</li>
          </ul>
        </div>
      </section>

      <section className="content-grid">
        <div className="panel findings-panel">
          <div className="panel-heading">
            <div>
              <h2>Staged Recommendations</h2>
              <p>Human-in-the-loop actions are mandatory unless a tenant explicitly enables a safe auto-action.</p>
            </div>
            <ShieldAlert size={24} aria-hidden="true" />
          </div>

          {snapshot.findings.length === 0 ? (
            <div className="empty-state">No findings yet. Inject a high-risk mock event to start the demo flow.</div>
          ) : (
            <div className="finding-stack">
              {snapshot.findings.map((finding) => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  busy={actionState === "running"}
                  onApprove={() => callSnapshotAction(`/api/findings/${finding.id}/approve`, undefined, "Approving staged recommendation.")}
                  onRemediate={() =>
                    callSnapshotAction(
                      `/api/findings/${finding.id}/remediate`,
                      { body: JSON.stringify({ action: finding.recommendation.action }) },
                      "Executing simulated safe remediation."
                    )
                  }
                  onDismiss={() => callSnapshotAction(`/api/findings/${finding.id}/dismiss`, undefined, "Dismissing finding.")}
                  onFalsePositive={() =>
                    callSnapshotAction(`/api/findings/${finding.id}/false-positive`, undefined, "Marking false positive.")
                  }
                  onRescan={() => callSnapshotAction(`/api/findings/${finding.id}/rescan`, undefined, "Requesting re-scan.")}
                />
              ))}
            </div>
          )}
        </div>

        <aside className="panel evidence-panel">
          <div className="panel-heading">
            <div>
              <h2>Private Evidence Room</h2>
              <p>Judge packets are redacted by default and only include consented testimonials.</p>
            </div>
            <Download size={24} aria-hidden="true" />
          </div>
          <dl className="evidence-list">
            <div>
              <dt>Files inspected</dt>
              <dd>{snapshot.aggregateCounters.filesInspected.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Bytes extracted</dt>
              <dd>{snapshot.aggregateCounters.bytesExtracted.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Bytes scanned by DLP</dt>
              <dd>{snapshot.aggregateCounters.bytesScannedByDlp.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Bytes routed to Gemini</dt>
              <dd>{snapshot.aggregateCounters.bytesRoutedToGemini.toLocaleString()}</dd>
            </div>
          </dl>
          <button type="button" className="wide" onClick={exportEvidence} disabled={actionState === "running"}>
            <Download size={16} aria-hidden="true" />
            Generate judge export
          </button>
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => exportEvidenceFormat("markdown")} disabled={actionState === "running"}>
              <Download size={16} aria-hidden="true" />
              Markdown packet
            </button>
            <button type="button" className="secondary" onClick={() => exportEvidenceFormat("csv")} disabled={actionState === "running"}>
              <Download size={16} aria-hidden="true" />
              CSV packet
            </button>
            <button type="button" className="secondary" onClick={exportSignedEvidencePacket} disabled={actionState === "running"}>
              <ShieldCheck size={16} aria-hidden="true" />
              Sealed packet
            </button>
          </div>
          {exportPreview ? (
            <pre className="export-preview">{JSON.stringify(exportPreview, null, 2).slice(0, 1600)}</pre>
          ) : null}
        </aside>
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>Trust Center Lite</h2>
              <p>A redacted, prospect-safe trust profile turns evidence into a sales asset.</p>
            </div>
            <ShieldCheck size={24} aria-hidden="true" />
          </div>
          <button type="button" onClick={generateTrustProfile} disabled={actionState === "running"}>
            <Sparkles size={16} aria-hidden="true" />
            Generate trust profile
          </button>
          <button type="button" className="secondary" onClick={createProspectTrustPacket} disabled={actionState === "running"}>
            <ShieldCheck size={16} aria-hidden="true" />
            Create Trust Packet
          </button>
          <button type="button" className="secondary" onClick={requestTrustDocuments} disabled={actionState === "running"}>
            <FileSearch size={16} aria-hidden="true" />
            Request docs
          </button>
          <button
            type="button"
            className="secondary"
            onClick={approveTrustDocuments}
            disabled={actionState === "running" || !snapshot.trustAccessRequests.some((request) => request.status === "pending")}
          >
            <CheckCircle2 size={16} aria-hidden="true" />
            Approve docs
          </button>
          <div className="verification-list">
            <span data-status={readiness.trustAccess.pendingRequests ? "warning" : "passed"}>document access</span>
            <article>
              <strong>Trust documents</strong>
              <p>
                {readiness.trustAccess.publicDocuments} public · {readiness.trustAccess.requestableDocuments} requestable ·{" "}
                {readiness.trustAccess.privateDocuments} private
              </p>
            </article>
            <article>
              <strong>Requests</strong>
              <p>
                {readiness.trustAccess.pendingRequests} pending · {readiness.trustAccess.approvedRequests} approved ·{" "}
                {readiness.trustAccess.ndaRequiredDocuments} NDA-gated document(s)
              </p>
            </article>
            <article>
              <strong>Engagement</strong>
              <p>
                {readiness.trustAnalytics.packetsCreated} packet(s) · {readiness.trustAnalytics.totalPacketAccesses} access(es) ·{" "}
                {readiness.trustAnalytics.followUpQueue.length} follow-up(s)
              </p>
            </article>
          </div>
          {readiness.trustAnalytics.packetsCreated ? (
            <div className="trust-analytics-panel" aria-label="Trust Center analytics">
              <div className="trust-analytics-metrics">
                <span>{readiness.trustAnalytics.activePackets} active</span>
                <span>{readiness.trustAnalytics.accessedPackets} accessed</span>
                <span>{readiness.trustAnalytics.averageAccessesPerPacket} avg views</span>
              </div>
              <div className="trust-followups">
                <strong>Prospect follow-up</strong>
                {(readiness.trustAnalytics.followUpQueue.length
                  ? readiness.trustAnalytics.followUpQueue
                  : readiness.trustAnalytics.topProspects
                )
                  .slice(0, 3)
                  .map((prospect) => (
                    <article key={`${prospect.prospectAlias}-${prospect.prospectDomain ?? "domain"}`}>
                      <span data-stage={prospect.stage}>{prospect.stage}</span>
                      <b>{prospect.prospectAlias}</b>
                      <small>
                        {prospect.accessCount} access(es) · {prospect.approvedDocumentCount} approved doc(s)
                      </small>
                      <p>{prospect.nextAction}</p>
                    </article>
                  ))}
              </div>
              <small>{readiness.trustAnalytics.productionGaps[0]}</small>
            </div>
          ) : null}
          {trustProfile ? (
            <div className="trust-profile">
              <div>
                <span>Readiness posture</span>
                <strong>{trustProfile.readinessPostureScore}%</strong>
              </div>
              <h3>{trustProfile.headline}</h3>
              <ul>
                {trustProfile.approvedClaims.map((claim) => (
                  <li key={claim}>{claim}</li>
                ))}
              </ul>
              <p>{trustProfile.disclaimer}</p>
            </div>
          ) : null}
          {trustPacket ? (
            <div className="verification-list">
              <span data-status={trustPacket.status}>{trustPacket.status}</span>
              <article>
                <strong>Prospect access</strong>
                <p>
                  {trustPacket.accessUrl} · expires {new Date(trustPacket.expiresAt).toLocaleDateString()}
                </p>
              </article>
              <article>
                <strong>Packet contents</strong>
                <p>
                  {trustPacket.sections.join(" · ")} · {trustPacket.approvedDocuments.length} approved document(s)
                </p>
              </article>
              {trustPacket.approvedDocuments.length ? (
                <article>
                  <strong>Approved documents</strong>
                  <p>{trustPacket.approvedDocuments.map((document) => document.title).join(" · ")}</p>
                </article>
              ) : null}
              {trustPacket.accessRequestId ? (
                <article>
                  <strong>Access approval</strong>
                  <p>{trustPacket.accessRequestId}</p>
                </article>
              ) : null}
              <article>
                <strong>Redaction boundary</strong>
                <p>{trustPacket.disclaimer}</p>
              </article>
            </div>
          ) : null}
        </div>

        <aside className="panel">
          <div className="panel-heading">
            <div>
              <h2>Questionnaire Assistant</h2>
              <p>Drafts customer security-review answers from approved evidence with human approval required.</p>
            </div>
            <FileSearch size={24} aria-hidden="true" />
          </div>
          <button type="button" className="wide" onClick={generateQuestionnaireDraft} disabled={actionState === "running"}>
            <Sparkles size={16} aria-hidden="true" />
            Draft answers
          </button>
          <label className="stacked-input">
            Prospect
            <input
              value={questionnaireForm.customerAlias}
              onChange={(event) => setQuestionnaireForm({ ...questionnaireForm, customerAlias: event.target.value })}
            />
          </label>
          <div className="form-row">
            <label className="stacked-input">
              Segment
              <input
                value={questionnaireForm.customerSegment}
                onChange={(event) => setQuestionnaireForm({ ...questionnaireForm, customerSegment: event.target.value })}
              />
            </label>
            <label className="stacked-input">
              Source
              <select
                value={questionnaireForm.source}
                onChange={(event) =>
                  setQuestionnaireForm({ ...questionnaireForm, source: event.target.value as QuestionnaireInputSource })
                }
              >
                <option value="uploaded-text">Text</option>
                <option value="csv">CSV</option>
                <option value="tsv">TSV</option>
                <option value="spreadsheet-text">Spreadsheet text</option>
                <option value="pdf-text">PDF extracted text</option>
              </select>
            </label>
          </div>
          <label className="stacked-input">
            Source filename
            <input
              value={questionnaireForm.originalFileName}
              onChange={(event) => setQuestionnaireForm({ ...questionnaireForm, originalFileName: event.target.value })}
            />
          </label>
          <label className="stacked-input">
            Questionnaire text
            <textarea
              rows={6}
              value={questionnaireForm.questionnaireText}
              onChange={(event) => setQuestionnaireForm({ ...questionnaireForm, questionnaireText: event.target.value })}
            />
          </label>
          <button type="button" className="wide secondary" onClick={createQuestionnairePack} disabled={actionState === "running"}>
            <FileSearch size={16} aria-hidden="true" />
            Build response pack
          </button>
          <div className="verification-list">
            <span data-status={snapshot.answerLibrary.length ? "passed" : "warning"}>answer library</span>
            <article>
              <strong>Reusable approved answers</strong>
              <p>
                {snapshot.answerLibrary.length} approved · {readiness.answerLibrary.totalUsage} reuse(s) ·{" "}
                {readiness.answerLibrary.libraryHitRate}% hit rate
              </p>
            </article>
            <article>
              <strong>Review cadence</strong>
              <p>
                {readiness.answerLibrary.reviewDue} due · next{" "}
                {readiness.answerLibrary.nextReviewAt
                  ? new Date(readiness.answerLibrary.nextReviewAt).toLocaleDateString()
                  : "none"}
              </p>
            </article>
            {readiness.answerLibrary.segmentHistory[0] ? (
              <article>
                <strong>Segment history</strong>
                <p>
                  {readiness.answerLibrary.segmentHistory
                    .slice(0, 3)
                    .map((segment) => `${segment.segment}: ${segment.packCount} pack(s), ${segment.libraryHits} hit(s)`)
                    .join(" · ")}
                </p>
              </article>
            ) : null}
            <button
              type="button"
              className="secondary"
              onClick={verifyFirstAnswerLibraryItem}
              disabled={actionState === "running" || snapshot.answerLibrary.length === 0}
            >
              <CheckCircle2 size={16} aria-hidden="true" />
              Verify library item
            </button>
            <button
              type="button"
              className="secondary"
              onClick={bulkVerifyAnswerLibrary}
              disabled={actionState === "running" || snapshot.answerLibrary.length === 0}
            >
              <CheckCircle2 size={16} aria-hidden="true" />
              Bulk verify segment
            </button>
          </div>
          {questionnaireDraft ? (
            <div className="question-list">
              {questionnaireDraft.questions.slice(0, 3).map((item) => (
                <article key={item.id}>
                  <h3>{item.question}</h3>
                  <p>{item.draftAnswer}</p>
                  <small>{item.citations.join(" · ")}</small>
                </article>
              ))}
            </div>
          ) : null}
          {questionnairePack ? (
            <div className="question-list">
              <article>
                <h3>{questionnairePack.customerAlias}</h3>
                <p>
                  {questionnairePack.status} · {questionnairePack.approvedCount}/{questionnairePack.questionsCount} approved ·{" "}
                  {questionnairePack.needsReviewCount} needs review · {questionnairePack.libraryHitCount} library hit(s)
                </p>
                <p>
                  {questionnairePack.customerSegment} · {questionnairePack.source} ·{" "}
                  {questionnairePack.importSummary.questionsDetected} imported question(s)
                </p>
                <small>{questionnairePack.disclaimer}</small>
              </article>
              {questionnairePack.answers.slice(0, 3).map((answer) => (
                <article key={answer.id}>
                  <h3>{answer.question}</h3>
                  <p>{answer.draftAnswer}</p>
                  <small>
                    {answer.status} · {answer.ownerRole} · {answer.answerSource} · {Math.round(answer.confidence * 100)}% ·{" "}
                    {answer.citations.join(" · ")}
                  </small>
                </article>
              ))}
              <div className="button-row">
                <button type="button" onClick={approveFirstQuestionnaireAnswer} disabled={actionState === "running"}>
                  <CheckCircle2 size={16} aria-hidden="true" />
                  Approve next
                </button>
                <button type="button" className="secondary" onClick={exportQuestionnairePack} disabled={actionState === "running"}>
                  <Download size={16} aria-hidden="true" />
                  Export pack
                </button>
              </div>
              {questionnairePack.exportText ? <pre className="export-preview">{questionnairePack.exportText.slice(0, 1200)}</pre> : null}
            </div>
          ) : null}
        </aside>
      </section>

      {readiness ? (
        <section className="strategy-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>Readiness Command Center</h2>
              <p>{readiness.usp}</p>
            </div>
            <ShieldCheck size={24} aria-hidden="true" />
          </div>
          <div className="score-grid">
            <Score label="Workspace risk" value={readiness.riskScore.workspaceRiskScore} tone="risk" />
            <Score label="Deal impact" value={readiness.riskScore.dealImpactScore} tone="good" />
            <Score label="Evidence maturity" value={readiness.riskScore.evidenceMaturity} tone="good" />
          </div>
          <div className="trend-panel">
            <div>
              <span data-status={readiness.riskTrend.direction}>{readiness.riskTrend.direction.replaceAll("_", " ")}</span>
              <p>{readiness.riskTrend.narrative}</p>
              <small>{readiness.riskTrend.productionWarning}</small>
            </div>
            <div className="trend-deltas" aria-label="Risk score trend deltas">
              <strong>Risk {formatDelta(readiness.riskTrend.deltas.workspaceRiskScore)}</strong>
              <strong>Deal {formatDelta(readiness.riskTrend.deltas.dealImpactScore)}</strong>
              <strong>Evidence {formatDelta(readiness.riskTrend.deltas.evidenceMaturity)}</strong>
              <strong>MRR {formatCurrencyDelta(readiness.riskTrend.deltas.mrrUsd)}</strong>
            </div>
            <ol className="trend-history">
              {readiness.riskTrend.history.slice(0, 5).map((item) => (
                <li key={item.id}>
                  <time>{new Date(item.capturedAt).toLocaleTimeString()}</time>
                  <span>{item.reason.replaceAll("_", " ")}</span>
                  <strong>
                    R{item.workspaceRiskScore} · D{item.dealImpactScore} · E{item.evidenceMaturity}
                  </strong>
                </li>
              ))}
            </ol>
            <button type="button" className="secondary" onClick={captureScoreSnapshot} disabled={actionState === "running"}>
              <Target size={16} aria-hidden="true" />
              Capture score
            </button>
          </div>
          <div className="readiness-columns">
            <ReadinessBlock
              title="OAuth readiness"
              rows={[
                `Mode: ${readiness.oauthReadiness.mode.replaceAll("-", " ")}`,
                readiness.oauthReadiness.goToMarketDecision,
                `${readiness.oauthReadiness.requiredScopes.length} scopes documented`
              ]}
            />
            {persistence ? (
              <ReadinessBlock
                title="Persistence"
                rows={[
                  `Mode: ${persistence.mode}`,
                  persistence.configured ? "GCP target configured" : "Local memory demo",
                  `${persistence.requiredIamRoles.length} IAM roles documented`
                ]}
              />
            ) : null}
            <ReadinessBlock
              title="Sync reliability"
              rows={[
                `Drive: ${readiness.syncReliability.driveChannelStatus}`,
                `Gmail: ${readiness.syncReliability.gmailWatchStatus}`,
                `Reconcile every ${readiness.syncReliability.reconciliationCadenceHours}h`,
                `Drive cursor: ${readiness.syncReliability.driveCursor ?? "not initialized"}`,
                `Gmail cursor: ${readiness.syncReliability.gmailCursor ?? "not initialized"}`
              ]}
            />
            <ReadinessBlock
              title="AI cost guardrail"
              rows={[
                `Budget: $${readiness.aiCostGuardrail.monthlyBudgetUsd}/mo`,
                `Used: ${readiness.aiCostGuardrail.budgetUsedPercent}%`,
                readiness.aiCostGuardrail.fallbackPolicy
              ]}
            />
            <ReadinessBlock
              title="Cloud cost controls"
              rows={[
                `Status: ${readiness.cloudCostControls.status}`,
                `Mode: ${readiness.cloudCostControls.mode}`,
                `Budget alerts: ${readiness.cloudCostControls.budgetPlan.alertThresholds.length} threshold(s)`,
                `Key restriction: ${readiness.cloudCostControls.apiKeyRestrictionPlan.clientRestrictionMode.replaceAll("-", " ")}`
              ]}
            />
            <ReadinessBlock
              title="Claim guard"
              rows={[
                `Status: ${readiness.claimGuard.status}`,
                `${readiness.claimGuard.bannedClaims.length} banned claims watched`,
                `${readiness.claimGuard.violations.length} runtime violation(s)`
              ]}
            />
            <ReadinessBlock
              title="Approval queue"
              rows={[
                `${readiness.approvalQueue.pending} pending`,
                `${readiness.approvalQueue.dueSoon} due soon`,
                `${readiness.approvalQueue.overdue} overdue`,
                `Next due: ${
                  readiness.approvalQueue.earliestDueAt
                    ? new Date(readiness.approvalQueue.earliestDueAt).toLocaleString()
                    : "none"
                }`,
                `Escalation: ${readiness.approvalQueue.escalationTargets[0] ?? "none"}`
              ]}
            />
            <ReadinessBlock
              title="Approval ops"
              rows={[
                `${readiness.approvalOps.directory.length} approver identities`,
                `${readiness.approvalOps.assignedApprovals}/${readiness.approvalOps.openApprovals} open approvals RBAC-matched`,
                `${readiness.approvalOps.queuedNotifications} local notice(s) queued`,
                `${readiness.approvalOps.roleMismatches} role mismatch(es)`,
                `${readiness.approvalOps.productionGaps.length} production gap(s)`
              ]}
            />
            <ReadinessBlock
              title="Answer library"
              rows={[
                `${readiness.answerLibrary.totalApproved} approved answer(s)`,
                `${readiness.answerLibrary.libraryHitRate}% questionnaire hit rate`,
                `${readiness.answerLibrary.reviewDue} review due`,
                `Next review: ${
                  readiness.answerLibrary.nextReviewAt
                    ? new Date(readiness.answerLibrary.nextReviewAt).toLocaleDateString()
                    : "none"
                }`
              ]}
            />
            <ReadinessBlock
              title="Trust access"
              rows={[
                `${readiness.trustAccess.publicDocuments} public document(s)`,
                `${readiness.trustAccess.requestableDocuments} requestable document(s)`,
                `${readiness.trustAccess.pendingRequests} pending request(s)`,
                `${readiness.trustAccess.expiringApprovals} expiring approval(s)`
              ]}
            />
            <ReadinessBlock
              title="Trust analytics"
              rows={[
                `${readiness.trustAnalytics.packetsCreated} packet(s) created`,
                `${readiness.trustAnalytics.totalPacketAccesses} packet access(es)`,
                `${readiness.trustAnalytics.followUpQueue.length} follow-up item(s)`,
                `${readiness.trustAnalytics.productionGaps.length} production gap(s)`
              ]}
            />
            <ReadinessBlock
              title="XPRIZE gate"
              rows={[
                `Status: ${readiness.xprizeGate.overallStatus}`,
                `Factual win confidence: ${readiness.xprizeGate.factualWinConfidence}%`,
                `${readiness.xprizeGate.blockingSummary.length} blocker(s)`
              ]}
            />
          </div>
          {readiness.approvalOps.openApprovals ? (
            <div className="approval-ops-panel" aria-label="Approval operations">
              <div>
                <strong>RBAC decisions</strong>
                {readiness.approvalOps.rbacDecisions.slice(0, 3).map((decision) => (
                  <span key={decision.findingId} data-status={decision.authorized ? "passed" : "blocked"}>
                    {decision.requiredRole}: {decision.assignedTo} · {decision.authorized ? "authorized" : "blocked"}
                  </span>
                ))}
              </div>
              <div>
                <strong>Notification queue</strong>
                {readiness.approvalOps.notifications.slice(0, 3).map((notification) => (
                  <span key={notification.id} data-status={notification.status}>
                    {notification.channel.replaceAll("_", " ")} · {notification.recipientEmail} · due{" "}
                    {new Date(notification.dueAt).toLocaleTimeString()}
                  </span>
                ))}
              </div>
              <div>
                <strong>Production gaps</strong>
                {readiness.approvalOps.productionGaps.slice(0, 3).map((gap) => (
                  <span key={gap} data-status="warning">
                    {gap}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <button type="button" onClick={checkOAuthPlan} disabled={actionState === "running"}>
            <ShieldCheck size={16} aria-hidden="true" />
            Check OAuth launch
          </button>
          <button type="button" className="secondary" onClick={runSyncReconciliation} disabled={actionState === "running"}>
            <RefreshCw size={16} aria-hidden="true" />
            Reconcile sync cursors
          </button>
          <button type="button" className="secondary" onClick={bootstrapLiveSync} disabled={actionState === "running"}>
            <RefreshCw size={16} aria-hidden="true" />
            Bootstrap live sync
          </button>
          <button type="button" className="secondary" onClick={checkCostControls} disabled={actionState === "running"}>
            <Database size={16} aria-hidden="true" />
            Check cost controls
          </button>
          <button type="button" className="secondary" onClick={checkProductionLaunch} disabled={actionState === "running"}>
            <Wrench size={16} aria-hidden="true" />
            Launch proof plan
          </button>
          <button type="button" className="secondary" onClick={checkProductionProvisioning} disabled={actionState === "running"}>
            <Database size={16} aria-hidden="true" />
            Provisioning pack
          </button>
          <button type="button" className="secondary" onClick={checkCloudRunDeploymentEvidence} disabled={actionState === "running"}>
            <FileSearch size={16} aria-hidden="true" />
            Cloud Run evidence
          </button>
          <button type="button" className="secondary" onClick={checkHostedEvidenceCapture} disabled={actionState === "running"}>
            <FileSearch size={16} aria-hidden="true" />
            Hosted evidence
          </button>
          <button type="button" className="secondary" onClick={runProductionGeminiSmoke} disabled={actionState === "running"}>
            <Sparkles size={16} aria-hidden="true" />
            Gemini proof smoke
          </button>
          {oauthPlan ? (
            <div className="verification-list">
              <span data-status={oauthPlan.launchAllowed ? "passed" : "blocked"}>
                {oauthPlan.launchAllowed ? "launch allowed" : "blocked"}
              </span>
              <article>
                <strong>Requested scopes</strong>
                <p>{oauthPlan.requestedScopes.map((scope) => scope.scope).join(" · ")}</p>
              </article>
              <article>
                <strong>Consent gate</strong>
                <p>{oauthPlan.consentGate.detail}</p>
              </article>
              <article>
                <strong>Deferred scope</strong>
                <p>{oauthPlan.deferredScopes.map((scope) => scope.scope).join(" · ")}</p>
              </article>
              {oauthPlan.missingEnv.length ? (
                <article>
                  <strong>Missing env</strong>
                  <p>{oauthPlan.missingEnv.join(", ")}</p>
                </article>
              ) : null}
            </div>
          ) : null}
          {syncCheck ? (
            <div className="verification-list">
              <span data-status={syncCheck.status}>{syncCheck.status}</span>
              {syncCheck.checks.map((check) => (
                <article key={`${check.target}-${check.detail}`}>
                  <strong>{check.target}</strong>
                  <p>{check.detail}</p>
                </article>
              ))}
            </div>
          ) : null}
          {costControls ? (
            <div className="verification-list">
              <span data-status={costControls.status}>{costControls.status}</span>
              <article>
                <strong>Budget plan</strong>
                <p>
                  ${costControls.monthlyBudgetUsd}/mo · {costControls.budgetPlan.alertThresholds.length} alert threshold(s) ·{" "}
                  {costControls.budgetPlan.pubSubTopic ?? "Pub/Sub topic not configured"}
                </p>
              </article>
              <article>
                <strong>Gemini key restriction</strong>
                <p>
                  {costControls.apiKeyRestrictionPlan.requiredApiTargets.join(", ")} ·{" "}
                  {costControls.apiKeyRestrictionPlan.clientRestrictionMode.replaceAll("-", " ")}
                </p>
              </article>
              <article>
                <strong>Quota runbook</strong>
                <p>
                  {costControls.quotaPlan.dailyRequestLimit.toLocaleString()} requests/day ·{" "}
                  {costControls.quotaPlan.dailyTokenLimit.toLocaleString()} tokens/day · {costControls.quotaPlan.enforcement}
                </p>
              </article>
            </div>
          ) : null}
          {costControlCheck ? (
            <div className="verification-list">
              <span data-status={costControlCheck.status}>{costControlCheck.status}</span>
              {costControlCheck.checks.map((check) => (
                <article key={`${check.target}-${check.detail}`}>
                  <strong>{check.target}</strong>
                  <p>{check.detail}</p>
                </article>
              ))}
            </div>
          ) : null}
          {productionLaunch ? (
            <div className="verification-list">
              <span data-status={productionLaunch.overallStatus}>{productionLaunch.overallStatus}</span>
              <article>
                <strong>Launch mode</strong>
                <p>
                  {productionLaunch.launchMode} · {productionLaunch.readinessScore}% ready ·{" "}
                  {productionLaunch.workstreams.filter((item) => item.status === "ready").length} of{" "}
                  {productionLaunch.workstreams.length} workstream(s) ready
                </p>
              </article>
              {productionLaunch.workstreams
                .filter((workstream) => workstream.status !== "ready")
                .slice(0, 4)
                .map((workstream) => (
                  <article key={workstream.id}>
                    <strong>{workstream.label}</strong>
                    <p>{workstream.nextAction}</p>
                  </article>
                ))}
              <article>
                <strong>Environment gaps</strong>
                <p>
                  {productionLaunch.envMatrix.filter((item) => item.status !== "configured").length} missing or secret-required ·{" "}
                  {productionLaunch.proofArtifacts.filter((item) => item.status !== "ready").length} proof artifact(s) pending
                </p>
              </article>
              <article>
                <strong>First verification command</strong>
                <p>{productionLaunch.verificationCommands[0]?.command}</p>
              </article>
            </div>
          ) : null}
          {productionProvisioning ? (
            <div className="verification-list">
              <span data-status={productionProvisioning.status}>{productionProvisioning.status.replaceAll("-", " ")}</span>
              <article>
                <strong>Deploy target</strong>
                <p>
                  {productionProvisioning.serviceName} · {productionProvisioning.recommendedRegion} ·{" "}
                  {productionProvisioning.requiredApis.length} Google API(s) · {productionProvisioning.secretNames.length} secret(s)
                </p>
              </article>
              <article>
                <strong>Dry-run command</strong>
                <p>{productionProvisioning.dryRunCommand}</p>
              </article>
              {productionProvisioning.checklist
                .filter((item) => item.status !== "configured")
                .slice(0, 4)
                .map((item) => (
                  <article key={item.id}>
                    <strong>{item.label}</strong>
                    <p>{item.verification}</p>
                  </article>
                ))}
              <article>
                <strong>Secret handling</strong>
                <p>{productionProvisioning.privateHandlingRules[0]}</p>
              </article>
            </div>
          ) : null}
          {cloudRunDeploymentEvidence ? (
            <div className="verification-list">
              <span data-status={cloudRunDeploymentEvidence.overallStatus}>
                {cloudRunDeploymentEvidence.overallStatus.replaceAll("-", " ")}
              </span>
              <article>
                <strong>Manifest target</strong>
                <p>
                  {cloudRunDeploymentEvidence.serviceName} · {cloudRunDeploymentEvidence.manifestPath} ·{" "}
                  {cloudRunDeploymentEvidence.replacementFindings.length} replacement value(s)
                </p>
              </article>
              <article>
                <strong>Secret references</strong>
                <p>
                  {cloudRunDeploymentEvidence.secretRefs.length} Secret Manager ref(s) ·{" "}
                  {cloudRunDeploymentEvidence.manualReviewFlags.length} manual attestation flag(s)
                </p>
              </article>
              {cloudRunDeploymentEvidence.replacementFindings.slice(0, 4).map((finding) => (
                <article key={`${finding.target}-${finding.value}`}>
                  <strong>{finding.target}</strong>
                  <p>{finding.fix}</p>
                </article>
              ))}
              <article>
                <strong>Dry-run</strong>
                <p>{cloudRunDeploymentEvidence.dryRunCommand}</p>
              </article>
            </div>
          ) : null}
          {hostedEvidenceCapture ? (
            <div className="verification-list">
              <span data-status={hostedEvidenceCapture.overallStatus}>
                {hostedEvidenceCapture.overallStatus.replaceAll("-", " ")}
              </span>
              <article>
                <strong>Proof boundary</strong>
                <p>
                  {hostedEvidenceCapture.evidenceMode} evidence · {hostedEvidenceCapture.storageMode} storage ·{" "}
                  {hostedEvidenceCapture.productUrl}
                </p>
              </article>
              <article>
                <strong>Capture status</strong>
                <p>
                  {hostedEvidenceCapture.checks.filter((check) => check.status === "captured").length} captured ·{" "}
                  {hostedEvidenceCapture.checks.filter((check) => check.status === "mock-only").length} mock-only ·{" "}
                  {hostedEvidenceCapture.checks.filter((check) => check.status === "missing").length} missing
                </p>
              </article>
              {hostedEvidenceCapture.checks
                .filter((check) => check.status !== "captured")
                .slice(0, 4)
                .map((check) => (
                  <article key={check.id}>
                    <strong>{check.label}</strong>
                    <p>{check.fix}</p>
                  </article>
                ))}
              <article>
                <strong>First capture command</strong>
                <p>{hostedEvidenceCapture.captureCommands[0]?.command}</p>
              </article>
              <article>
                <strong>Private template</strong>
                <p>
                  {hostedEvidenceCapture.privateArtifactTemplates[0]?.label}:{" "}
                  {hostedEvidenceCapture.privateArtifactTemplates[0]?.registrationHint}
                </p>
              </article>
            </div>
          ) : null}
          {productionGeminiProof ? (
            <div className="verification-list">
              <span data-status={productionGeminiProof.status}>{productionGeminiProof.status.replaceAll("-", " ")}</span>
              <article>
                <strong>Provider and model</strong>
                <p>
                  {productionGeminiProof.provider ?? "none"} · {productionGeminiProof.model} ·{" "}
                  {productionGeminiProof.agentRunId ?? "no agent run"}
                </p>
              </article>
              <article>
                <strong>Decision</strong>
                <p>{productionGeminiProof.decisionSummary}</p>
              </article>
              <article>
                <strong>Next action</strong>
                <p>{productionGeminiProof.nextAction}</p>
              </article>
            </div>
          ) : null}
          {readiness.syncReliability.renewalWarnings.length || readiness.syncReliability.blockers.length ? (
            <ul className="check-list compact">
              {[...readiness.syncReliability.renewalWarnings, ...readiness.syncReliability.blockers].map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="secondary" onClick={runClaimGuard} disabled={actionState === "running"}>
            <ShieldAlert size={16} aria-hidden="true" />
            Run claim guard
          </button>
          <button type="button" className="secondary" onClick={checkSubmissionGate} disabled={actionState === "running"}>
            <Target size={16} aria-hidden="true" />
            Check submission gate
          </button>
          <button type="button" className="secondary" onClick={checkProjectProvenance} disabled={actionState === "running"}>
            <FileSearch size={16} aria-hidden="true" />
            Project provenance
          </button>
          <button type="button" className="secondary" onClick={checkEligibilityDisclosure} disabled={actionState === "running"}>
            <ShieldCheck size={16} aria-hidden="true" />
            Disclosure review
          </button>
          <button type="button" className="secondary" onClick={checkSourceRelease} disabled={actionState === "running"}>
            <FileSearch size={16} aria-hidden="true" />
            Source release
          </button>
          <button type="button" className="secondary" onClick={checkSubmissionCompliance} disabled={actionState === "running"}>
            <ShieldCheck size={16} aria-hidden="true" />
            Check submission compliance
          </button>
          <button type="button" className="secondary" onClick={checkDemoVideoPack} disabled={actionState === "running"}>
            <Play size={16} aria-hidden="true" />
            Demo video pack
          </button>
          <button type="button" className="secondary" onClick={checkThirdPartyManifest} disabled={actionState === "running"}>
            <FileSearch size={16} aria-hidden="true" />
            License manifest
          </button>
          <button type="button" className="secondary" onClick={generateSubmissionBinder} disabled={actionState === "running"}>
            <Download size={16} aria-hidden="true" />
            Generate submission binder
          </button>
          <button type="button" className="secondary" onClick={generateDevpostPack} disabled={actionState === "running"}>
            <FileSearch size={16} aria-hidden="true" />
            Devpost pack
          </button>
          {claimGuardCheck ? (
            <div className="verification-list">
              <span data-status={claimGuardCheck.status}>{claimGuardCheck.status}</span>
              <article>
                <strong>Scanned artifacts</strong>
                <p>{claimGuardCheck.scannedArtifacts}</p>
              </article>
              {claimGuardCheck.violations.slice(0, 5).map((violation) => (
                <article key={`${violation.location}-${violation.phrase}`}>
                  <strong>{violation.location}</strong>
                  <p>
                    {violation.phrase}: {violation.fix}
                  </p>
                </article>
              ))}
              {claimGuardCheck.violations.length === 0 ? (
                <article>
                  <strong>No blocked claims</strong>
                  <p>Submission copy keeps readiness, evidence, and risk-detection boundaries explicit.</p>
                </article>
              ) : null}
            </div>
          ) : null}
          {submissionGate ? (
            <div className="verification-list">
              <span data-status={submissionGate.overallStatus}>{submissionGate.overallStatus}</span>
              <article>
                <strong>Criterion scores</strong>
                <p>
                  {Object.entries(submissionGate.criterionScores)
                    .map(([criterion, score]) => `${criterion}: ${score}%`)
                    .join(" · ")}
                </p>
              </article>
              {submissionGate.blockingSummary.slice(0, 5).map((item) => (
                <article key={item}>
                  <strong>Blocked</strong>
                  <p>{item}</p>
                </article>
              ))}
              {submissionGate.nextBestActions.length ? (
                <article>
                  <strong>Next action</strong>
                  <p>{submissionGate.nextBestActions[0]}</p>
                </article>
              ) : null}
            </div>
          ) : null}
          {projectProvenance ? (
            <div className="verification-list">
              <span data-status={projectProvenance.overallStatus}>{projectProvenance.overallStatus}</span>
              <article>
                <strong>Git provenance</strong>
                <p>
                  {projectProvenance.git.commitCount} commit(s) · {projectProvenance.git.trackedFileCount} tracked file(s) ·{" "}
                  {projectProvenance.git.untrackedPaths.length} untracked path(s)
                </p>
              </article>
              {projectProvenance.checks
                .filter((check) => check.status !== "passed")
                .slice(0, 4)
                .map((check) => (
                  <article key={check.id}>
                    <strong>{check.label}</strong>
                    <p>{check.fix}</p>
                  </article>
                ))}
              <article>
                <strong>Disclosure draft</strong>
                <p>{projectProvenance.draftDevpostDisclosure[0]}</p>
              </article>
            </div>
          ) : null}
          {eligibilityDisclosure ? (
            <div className="verification-list">
              <span data-status={eligibilityDisclosure.overallStatus}>
                {eligibilityDisclosure.overallStatus.replaceAll("-", " ")}
              </span>
              <article>
                <strong>Review packet</strong>
                <p>
                  {eligibilityDisclosure.provenanceSummary.commitCount} commit(s) ·{" "}
                  {eligibilityDisclosure.provenanceSummary.trackedFileCount} tracked file(s) · repository{" "}
                  {eligibilityDisclosure.repositoryUrl || "missing"}
                </p>
              </article>
              <article>
                <strong>Reviewer attestations</strong>
                <p>
                  {eligibilityDisclosure.reviewerAttestations.filter((item) => item.currentValue).length}/
                  {eligibilityDisclosure.reviewerAttestations.length} flag(s) currently confirmed.
                </p>
              </article>
              {eligibilityDisclosure.checks
                .filter((check) => check.status !== "passed")
                .slice(0, 4)
                .map((check) => (
                  <article key={check.id}>
                    <strong>{check.label}</strong>
                    <p>{check.fix}</p>
                  </article>
                ))}
              <article>
                <strong>Private handling</strong>
                <p>{eligibilityDisclosure.privateHandling[0]}</p>
              </article>
            </div>
          ) : null}
          {sourceReleaseGuard ? (
            <div className="verification-list">
              <span data-status={sourceReleaseGuard.overallStatus}>{sourceReleaseGuard.overallStatus.replaceAll("-", " ")}</span>
              <article>
                <strong>Release file plan</strong>
                <p>
                  {sourceReleaseGuard.releasableFileCount} releasable file(s) · {sourceReleaseGuard.trackedFileCount} tracked ·{" "}
                  {sourceReleaseGuard.untrackedFileCount} untracked
                </p>
              </article>
              <article>
                <strong>Secret scan</strong>
                <p>{sourceReleaseGuard.secretFindings.length} possible secret finding(s) in releasable files.</p>
              </article>
              {sourceReleaseGuard.checks
                .filter((check) => check.status !== "passed")
                .slice(0, 4)
                .map((check) => (
                  <article key={check.id}>
                    <strong>{check.label}</strong>
                    <p>{check.fix}</p>
                  </article>
                ))}
              <article>
                <strong>Next command</strong>
                <p>{sourceReleaseGuard.recommendedCommands[0]}</p>
              </article>
            </div>
          ) : null}
          {submissionCompliance ? (
            <div className="verification-list">
              <span data-status={submissionCompliance.overallStatus}>{submissionCompliance.overallStatus}</span>
              <article>
                <strong>IP and demo clearance</strong>
                <p>
                  {submissionCompliance.summary.passed} passed · {submissionCompliance.summary.warning} warning ·{" "}
                  {submissionCompliance.summary.blocked} blocked
                </p>
              </article>
              {submissionCompliance.checks
                .filter((check) => check.status !== "passed")
                .slice(0, 4)
                .map((check) => (
                  <article key={check.id}>
                    <strong>{check.label}</strong>
                    <p>{check.fix}</p>
                  </article>
                ))}
              <article>
                <strong>Video asset check</strong>
                <p>{submissionCompliance.demoAssetChecklist[0]?.clearanceAction}</p>
              </article>
              <article>
                <strong>Third-party manifest</strong>
                <p>
                  {submissionCompliance.thirdPartyManifestSummary.totalPackages} packages ·{" "}
                  {submissionCompliance.thirdPartyManifestSummary.unknownLicenseCount} unknown license(s) ·{" "}
                  {submissionCompliance.thirdPartyManifestSummary.obligationReviewCount} obligation-review package(s) ·{" "}
                  {submissionCompliance.thirdPartyManifestSummary.licenseNeedsReviewCount} license-review package(s) ·{" "}
                  {submissionCompliance.thirdPartyManifestSummary.integrationsNeedingReview} integration(s) need review
                </p>
              </article>
            </div>
          ) : null}
          {demoVideoPack ? (
            <div className="verification-list">
              <span data-status={demoVideoPack.overallStatus}>{demoVideoPack.overallStatus.replaceAll("-", " ")}</span>
              <article>
                <strong>Runtime plan</strong>
                <p>
                  {demoVideoPack.plannedDurationSeconds}s planned · {demoVideoPack.maximumAllowedSeconds}s maximum ·{" "}
                  {demoVideoPack.bufferSeconds}s buffer
                </p>
              </article>
              <article>
                <strong>Public host</strong>
                <p>
                  {demoVideoPack.videoUrl || "No public video URL configured"} · allowed:{" "}
                  {demoVideoPack.allowedPlatforms.join(", ")}
                </p>
              </article>
              {demoVideoPack.checks
                .filter((check) => check.status !== "passed")
                .slice(0, 4)
                .map((check) => (
                  <article key={check.id}>
                    <strong>{check.label}</strong>
                    <p>{check.fix}</p>
                  </article>
                ))}
              <article>
                <strong>Recording checklist</strong>
                <p>{demoVideoPack.recordingChecklist[0]}</p>
              </article>
              <article>
                <strong>Opening scene</strong>
                <p>{demoVideoPack.scenes[0]?.screenAction}</p>
              </article>
            </div>
          ) : null}
          {thirdPartyManifest ? (
            <div className="verification-list">
              <span data-status={thirdPartyManifest.summary.status}>{thirdPartyManifest.summary.status}</span>
              <article>
                <strong>Dependency manifest</strong>
                <p>
                  {thirdPartyManifest.summary.totalPackages} packages · {thirdPartyManifest.summary.productionPackages} runtime ·{" "}
                  {thirdPartyManifest.summary.directRuntimeDependencies} direct runtime ·{" "}
                  {thirdPartyManifest.summary.directDevDependencies} direct dev
                </p>
              </article>
              <article>
                <strong>Review queue</strong>
                <p>
                  {thirdPartyManifest.summary.unknownLicenseCount} unknown license(s) ·{" "}
                  {thirdPartyManifest.summary.obligationReviewCount} obligation-review package(s) ·{" "}
                  {thirdPartyManifest.summary.licenseNeedsReviewCount} license-review package(s) ·{" "}
                  {thirdPartyManifest.summary.restrictedLicenseReviewCount} restricted-review package(s) ·{" "}
                  {thirdPartyManifest.summary.integrationsNeedingReview} integration(s)
                </p>
              </article>
              <article>
                <strong>Disclosure</strong>
                <p>{thirdPartyManifest.disclosureText[0]}</p>
              </article>
            </div>
          ) : null}
          {submissionBinder ? (
            <div className="verification-list">
              <span data-status={submissionBinder.overallStatus}>submission binder</span>
              <article>
                <strong>Artifact manifest</strong>
                <p>
                  {Object.entries(submissionBinder.artifactSummary)
                    .map(([status, count]) => `${status}: ${count}`)
                    .join(" · ")}
                </p>
              </article>
              <article>
                <strong>Testing access</strong>
                <p>
                  {submissionBinder.testingInstructions
                    .map((instruction) => `${instruction.label}: ${instruction.status}`)
                    .join(" · ")}
                </p>
              </article>
              <article>
                <strong>Private evidence queue</strong>
                <p>
                  {submissionBinder.privateEvidenceRequestQueue
                    .slice(0, 3)
                    .map((request) => `${request.label}: ${request.status}`)
                    .join(" · ")}
                </p>
              </article>
              <article>
                <strong>Demo timeline</strong>
                <p>{submissionBinder.demoTimeline.map((item) => `${item.timestamp} ${item.scene}`).join(" · ")}</p>
              </article>
              <article>
                <strong>Claim boundary</strong>
                <p>{submissionBinder.claimBoundary[0]}</p>
              </article>
            </div>
          ) : null}
          {devpostPack ? (
            <div className="verification-list">
              <span data-status={devpostPack.overallStatus}>{devpostPack.overallStatus}</span>
              <article>
                <strong>{devpostPack.title}</strong>
                <p>{devpostPack.tagline}</p>
              </article>
              <article>
                <strong>Submission assets</strong>
                <p>
                  {devpostPack.demoVideoScript.length} demo scene(s) · {devpostPack.screenshotChecklist.length} screenshot target(s) ·{" "}
                  {devpostPack.privateEvidenceResponse.length} private evidence response(s)
                </p>
              </article>
              <article>
                <strong>Demo opener</strong>
                <p>{devpostPack.demoVideoScript[0]?.voiceover}</p>
              </article>
              {devpostPack.blockers.length ? (
                <article>
                  <strong>First blocker</strong>
                  <p>{devpostPack.blockers[0]}</p>
                </article>
              ) : null}
              <article>
                <strong>Next action</strong>
                <p>{devpostPack.nextActions[0]}</p>
              </article>
            </div>
          ) : null}
        </div>

        <aside className="panel">
          <div className="panel-heading">
            <div>
              <h2>Pilot CRM + ROI</h2>
              <p>Business evidence must become real before submission.</p>
            </div>
            <Target size={24} aria-hidden="true" />
          </div>
          <div className="pilot-list">
            {readiness.pilotCrm.map((pilot) => (
              <article key={pilot.id}>
                <strong>{pilot.customerAlias}</strong>
                <span>
                  ${pilot.monthlyRevenueUsd}/mo · {pilot.proofStatus.replaceAll("-", " ")} ·{" "}
                  {pilot.relatedParty ? "related party" : "arms-length"}
                </span>
                <small>{pilot.segment}</small>
              </article>
            ))}
          </div>
          <div className="pilot-launch-card">
            <span data-status={launchPlan.status}>one-day pilot</span>
            <strong>{launchPlan.launchReadinessScore}% launch readiness</strong>
            <small>{launchPlan.offer}</small>
            <div className="pilot-launch-grid">
              {launchPlan.checklist.slice(0, 6).map((item) => (
                <article key={item.id} data-status={item.status}>
                  <b>{item.label}</b>
                  <span>
                    {item.status.replaceAll("-", " ")} · {item.ownerRole}
                  </span>
                </article>
              ))}
            </div>
            <ul>
              {launchPlan.blockers.slice(0, 3).map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
              {launchPlan.blockers.length === 0 ? <li>Day-one pilot workflow has no local blockers.</li> : null}
            </ul>
            <button type="button" className="secondary wide" onClick={checkPilotLaunchPlan} disabled={actionState === "running"}>
              <Target size={16} aria-hidden="true" />
              Build launch plan
            </button>
          </div>
          <div className="prospect-pipeline-card">
            <span data-status={pilotProspectPipeline.blockers.length ? "blocked" : "ready"}>prospect pipeline</span>
            <strong>
              {pilotProspectPipeline.summary.highFit} high-fit · {pilotProspectPipeline.summary.activeOpportunities} active ·{" "}
              {pilotProspectPipeline.summary.proposedPilots} proposed
            </strong>
            <small>
              ${pilotProspectPipeline.summary.estimatedPipelineMrrUsd.toLocaleString()}/mo pipeline · $
              {Math.round(pilotProspectPipeline.summary.expectedPipelineMrrUsd).toLocaleString()} weighted
            </small>
            <div className="prospect-grid">
              {pilotProspectPipeline.prospects.slice(0, 3).map((prospect) => (
                <article key={prospect.id}>
                  <b>{prospect.prospectAlias}</b>
                  <span>
                    {prospect.stage.replaceAll("-", " ")} · fit {prospect.fitScore} · ${prospect.estimatedMrrUsd}/mo
                  </span>
                  <small>{prospect.nextAction}</small>
                </article>
              ))}
            </div>
            <ul>
              {pilotProspectPipeline.blockers.slice(0, 2).map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
              {pilotProspectPipeline.blockers.length === 0 ? <li>Pipeline has no local conversion blockers.</li> : null}
            </ul>
            <button type="button" className="secondary wide" onClick={checkPilotProspectPipeline} disabled={actionState === "running"}>
              <UserPlus size={16} aria-hidden="true" />
              Check prospect pipeline
            </button>
          </div>
          <div className="pilot-conversion-card">
            <span data-status={conversionKit.status}>conversion kit</span>
            <strong>
              {conversionKit.conversionScore}% close readiness · {conversionKit.closeAssets.filter((asset) => asset.status === "ready").length} asset(s) ready
            </strong>
            <small>
              {conversionKit.targetProspect
                ? `${conversionKit.targetProspect.prospectAlias} · ${conversionKit.targetProspect.stage.replaceAll("-", " ")} · fit ${conversionKit.targetProspect.fitScore}`
                : "No high-fit target selected"}
            </small>
            <div className="pilot-conversion-grid">
              {conversionKit.conversionSteps.slice(0, 4).map((stepItem) => (
                <article key={stepItem.id} data-status={stepItem.status}>
                  <b>{stepItem.label}</b>
                  <span>
                    {stepItem.status.replaceAll("-", " ")} · {stepItem.ownerRole}
                  </span>
                </article>
              ))}
            </div>
            <ul>
              {conversionKit.blockers.slice(0, 2).map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
              {conversionKit.blockers.length === 0 ? <li>Conversion kit has no local blockers.</li> : null}
            </ul>
            <button type="button" className="secondary wide" onClick={checkPilotConversionKit} disabled={actionState === "running"}>
              <Sparkles size={16} aria-hidden="true" />
              Build conversion kit
            </button>
          </div>
          <div className="pilot-conversion-card">
            <span data-status={consentPacket.status}>consent packet</span>
            <strong>
              {consentPacket.authorizationScore}% authorization readiness ·{" "}
              {consentPacket.consentChecklist.filter((item) => item.status === "ready").length} check(s) ready
            </strong>
            <small>
              {consentPacket.targetProspect
                ? `${consentPacket.targetProspect.prospectAlias} · ${consentPacket.oauthScopes.filter((scope) => scope.status === "requested").length} requested scope(s)`
                : "No target prospect selected"}
            </small>
            <div className="pilot-conversion-grid">
              {consentPacket.consentChecklist.slice(0, 4).map((item) => (
                <article key={item.id} data-status={item.status}>
                  <b>{item.label}</b>
                  <span>
                    {item.status.replaceAll("-", " ")} · {item.ownerRole}
                  </span>
                </article>
              ))}
            </div>
            <ul>
              {consentPacket.blockers.slice(0, 2).map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
              {consentPacket.blockers.length === 0 ? <li>Consent packet has no local blockers.</li> : null}
            </ul>
            <button type="button" className="secondary wide" onClick={checkPilotConsentPacket} disabled={actionState === "running"}>
              <ShieldCheck size={16} aria-hidden="true" />
              Build consent packet
            </button>
          </div>
          <div className="financial-ledger-card">
            <span data-status={financialLedgerStatus}>financial evidence</span>
            <strong>
              {financialEvidence.summary.verified} verified · {financialEvidence.summary["private-on-request"]} private ·{" "}
              {financialEvidence.summary.missing} missing · {financialEvidence.summary["mock-only"]} mock
            </strong>
            <small>
              ${financialEvidence.totalMrrUsd.toLocaleString()}/mo MRR · ${financialEvidence.totalCostsUsd.toLocaleString()} costs ·{" "}
              {financialEvidence.activeUsers} active users · {financialEvidence.evidenceMode} mode
            </small>
            <div className="financial-month-grid">
              {Object.entries(financialEvidence.revenueByMonth).map(([month, evidence]) => (
                <span key={month}>
                  {month}: ${evidence.amountUsd} · {evidence.status.replaceAll("-", " ")}
                </span>
              ))}
            </div>
            <ul>
              {financialEvidence.blockers.slice(0, 3).map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
              {financialEvidence.blockers.length === 0 ? <li>Private judge evidence queue has no local blockers.</li> : null}
            </ul>
            <button type="button" className="secondary wide" onClick={checkFinancialEvidenceLedger} disabled={actionState === "running"}>
              <Database size={16} aria-hidden="true" />
              Check financial evidence
            </button>
          </div>
          <div className="evidence-vault-card">
            <span data-status={evidenceVaultStatus}>Evidence Vault</span>
            <strong>
              {evidenceVault.summary.verified} verified · {evidenceVault.summary.uploaded} uploaded ·{" "}
              {evidenceVault.summary.requested} requested · {evidenceVault.summary.missing} missing
            </strong>
            <small>
              {evidenceVault.requiredArtifacts.length} required artifact slots · {evidenceVault.evidenceMode} mode ·{" "}
              {evidenceVault.summary["needs-redaction"]} need redaction
            </small>
            <div className="evidence-vault-list">
              {evidenceVault.requiredArtifacts
                .filter((artifact) => artifact.status === "missing" || artifact.status === "needs-redaction")
                .slice(0, 4)
                .map((artifact) => (
                  <article key={artifact.id}>
                    <b>{artifact.label}</b>
                    <span>
                      {artifact.kind.replaceAll("-", " ")} · {artifact.ownerRole} · {artifact.status.replaceAll("-", " ")}
                    </span>
                  </article>
                ))}
            </div>
            <textarea
              aria-label="Hosted proof JSON import"
              value={evidenceImportJson}
              onChange={(event) => setEvidenceImportJson(event.target.value)}
              rows={5}
            />
            {evidenceVaultImportResult ? (
              <small>
                Last import: {evidenceVaultImportResult.artifactCount} artifact(s) ·{" "}
                {evidenceVaultImportResult.status.replaceAll("-", " ")} · {evidenceVaultImportResult.checksumSha256.slice(0, 12)}...
              </small>
            ) : null}
            <button type="button" className="secondary wide" onClick={checkEvidenceVault} disabled={actionState === "running"}>
              <FileSearch size={16} aria-hidden="true" />
              Check Evidence Vault
            </button>
            <button type="button" className="secondary wide" onClick={importEvidenceVaultJson} disabled={actionState === "running"}>
              <Download size={16} aria-hidden="true" />
              Import proof JSON
            </button>
          </div>
          <div className="evidence-intake-card">
            <span data-status={intakeQueue.overallStatus}>intake queue</span>
            <strong>
              {intakeQueue.proofQualityScore}% proof quality · {intakeQueue.criticalMissing} priority blocker(s)
            </strong>
            <small>
              {intakeQueue.items.length} artifact intake item(s) · {intakeQueue.redactionBacklog} redaction backlog ·{" "}
              {intakeQueue.evidenceMode} mode
            </small>
            <div className="evidence-intake-list">
              {intakeQueue.items.slice(0, 4).map((item) => (
                <article key={item.id} data-status={item.status}>
                  <b>{item.label}</b>
                  <span>
                    {item.priority.toUpperCase()} · {item.status.replaceAll("-", " ")} · {item.ownerRole}
                  </span>
                </article>
              ))}
            </div>
            <ul>
              {intakeQueue.nextActions.slice(0, 2).map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
            <button type="button" className="secondary wide" onClick={checkEvidenceIntakeQueue} disabled={actionState === "running"}>
              <FileSearch size={16} aria-hidden="true" />
              Build intake queue
            </button>
          </div>
          <div className="roi-card">
            <span>Evidence-calibrated ROI</span>
            <strong>${readiness.roiCalculator.estimatedMonthlyValueUsd.toLocaleString()}</strong>
            <small>
              {readiness.roiCalculator.paybackMultiple}x payback at ${readiness.roiCalculator.pricePerMonthUsd}/mo ·{" "}
              {readiness.roiCalculator.calibrationSource.replaceAll("-", " ")}
            </small>
            <div className="roi-metrics">
              <span>{readiness.roiCalculator.qualifiedPilotCount} pilots</span>
              <span>${readiness.roiCalculator.pilotMrrUsd}/mo MRR</span>
              <span>{readiness.roiCalculator.averageSecurityReviewDelayDaysAvoided} days avoided</span>
              <span>{readiness.roiCalculator.securityReviewHoursSaved} hours saved</span>
            </div>
            <ul className="roi-evidence-list" aria-label="ROI evidence factors">
              {readiness.roiCalculator.evidenceFactors.slice(0, 4).map((factor) => (
                <li key={factor.label}>
                  <b>{factor.label}</b>
                  <span>{factor.value}</span>
                </li>
              ))}
            </ul>
            <div className="roi-proof-gaps">
              <b>Proof gaps</b>
              {readiness.roiCalculator.proofGaps.slice(0, 2).map((gap) => (
                <span key={gap}>{gap}</span>
              ))}
            </div>
          </div>
          <button type="button" className="secondary wide" onClick={generateDealImpactReport} disabled={actionState === "running"}>
            <Target size={16} aria-hidden="true" />
            Generate deal-impact report
          </button>
          {dealImpactReport ? (
            <div className="deal-impact-card">
              <span data-status={dealImpactReport.productionGaps.length ? "warning" : "passed"}>deal impact</span>
              <strong>{dealImpactReport.headline}</strong>
              <div className="deal-impact-grid">
                <span>Risk {formatDelta(dealImpactReport.summaryMetrics.workspaceRiskDelta)}</span>
                <span>Deal {formatDelta(dealImpactReport.summaryMetrics.dealImpactDelta)}</span>
                <span>Evidence {formatDelta(dealImpactReport.summaryMetrics.evidenceMaturityDelta)}</span>
                <span>{dealImpactReport.summaryMetrics.paybackMultiple}x payback</span>
              </div>
              <ul>
                {dealImpactReport.buyerProofPoints.slice(0, 3).map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <small>{dealImpactReport.productionGaps[0]}</small>
            </div>
          ) : null}
          <form className="pilot-form" onSubmit={recordPilot}>
            <label>
              Customer alias
              <input
                value={pilotForm.customerAlias}
                onChange={(event) => setPilotForm({ ...pilotForm, customerAlias: event.target.value })}
              />
            </label>
            <label>
              Segment
              <input value={pilotForm.segment} onChange={(event) => setPilotForm({ ...pilotForm, segment: event.target.value })} />
            </label>
            <div className="form-row">
              <label>
                MRR
                <input
                  inputMode="numeric"
                  value={pilotForm.monthlyRevenueUsd}
                  onChange={(event) => setPilotForm({ ...pilotForm, monthlyRevenueUsd: event.target.value })}
                />
              </label>
              <label>
                Users
                <input
                  inputMode="numeric"
                  value={pilotForm.activeUsers}
                  onChange={(event) => setPilotForm({ ...pilotForm, activeUsers: event.target.value })}
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Proof
                <select
                  value={pilotForm.proofStatus}
                  onChange={(event) => setPilotForm({ ...pilotForm, proofStatus: event.target.value })}
                >
                  <option value="invoice-needed">Invoice needed</option>
                  <option value="financial-doc-ready">Financial doc ready</option>
                  <option value="testimonial-consented">Testimonial consented</option>
                  <option value="mock">Mock only</option>
                </select>
              </label>
              <label>
                Consent
                <select
                  value={pilotForm.consentStatus}
                  onChange={(event) => setPilotForm({ ...pilotForm, consentStatus: event.target.value })}
                >
                  <option value="pending">Pending</option>
                  <option value="consented">Consented</option>
                  <option value="private">Private</option>
                </select>
              </label>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={pilotForm.armsLength}
                onChange={(event) => setPilotForm({ ...pilotForm, armsLength: event.target.checked })}
              />
              Arms-length customer
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={pilotForm.relatedParty}
                onChange={(event) => setPilotForm({ ...pilotForm, relatedParty: event.target.checked })}
              />
              Related-party revenue
            </label>
            <button type="submit" className="wide" disabled={actionState === "running"}>
              <UserPlus size={16} aria-hidden="true" />
              Record pilot evidence
            </button>
          </form>
        </aside>
      </section>
      ) : null}

      {readiness ? (
        <section className="content-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>Playbooks + Frameworks</h2>
              <p>Repeatable operational workflows and broader readiness mapping improve category impact.</p>
            </div>
            <Wrench size={24} aria-hidden="true" />
          </div>
          <div className="playbook-grid">
            {readiness.playbooks.map((playbook) => (
              <article key={playbook.id}>
                <h3>{playbook.name}</h3>
                <p>{playbook.trigger}</p>
                <small>
                  {playbook.status} · {playbook.ownerRole} · {playbook.stagedActions.join(" -> ")} · SLA{" "}
                  {playbook.approvalSlaHours}h
                </small>
                <button type="button" className="secondary" onClick={() => editPlaybook(playbook)} disabled={actionState === "running"}>
                  <Wrench size={16} aria-hidden="true" />
                  Edit
                </button>
              </article>
            ))}
          </div>
          <form className="playbook-form" onSubmit={savePlaybook}>
            <label className="stacked-input">
              Playbook name
              <input
                value={playbookForm.name}
                onChange={(event) => setPlaybookForm({ ...playbookForm, name: event.target.value })}
              />
            </label>
            <label className="stacked-input">
              Trigger condition
              <textarea
                rows={3}
                value={playbookForm.trigger}
                onChange={(event) => setPlaybookForm({ ...playbookForm, trigger: event.target.value })}
              />
            </label>
            <div className="form-row">
              <label className="stacked-input">
                Owner
                <select
                  value={playbookForm.ownerRole}
                  onChange={(event) => setPlaybookForm({ ...playbookForm, ownerRole: event.target.value as ApproverRole })}
                >
                  <option value="security">Security</option>
                  <option value="founder">Founder</option>
                  <option value="legal">Legal</option>
                  <option value="engineering">Engineering</option>
                </select>
              </label>
              <label className="stacked-input">
                Status
                <select
                  value={playbookForm.status}
                  onChange={(event) =>
                    setPlaybookForm({ ...playbookForm, status: event.target.value as RemediationPlaybook["status"] })
                  }
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                </select>
              </label>
            </div>
            <div className="form-row">
              <label className="stacked-input">
                SLA hours
                <input
                  inputMode="numeric"
                  value={playbookForm.approvalSlaHours}
                  onChange={(event) => setPlaybookForm({ ...playbookForm, approvalSlaHours: event.target.value })}
                />
              </label>
              <label className="stacked-input">
                Escalation
                <input
                  value={playbookForm.escalationTarget}
                  onChange={(event) => setPlaybookForm({ ...playbookForm, escalationTarget: event.target.value })}
                />
              </label>
            </div>
            <div className="action-picker" aria-label="Staged playbook actions">
              {playbookActionOptions.map((action) => (
                <label key={action} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={playbookForm.stagedActions.includes(action)}
                    onChange={() => togglePlaybookAction(action)}
                  />
                  {action.replaceAll("_", " ")}
                </label>
              ))}
            </div>
            <label className="checkbox-row playbook-auto">
              <input
                type="checkbox"
                checked={playbookForm.autoAllowed}
                onChange={(event) => setPlaybookForm({ ...playbookForm, autoAllowed: event.target.checked })}
              />
              Allow automatic execution only when tenant safe-auto policy permits every action
            </label>
            <button type="submit" disabled={actionState === "running"}>
              <Wrench size={16} aria-hidden="true" />
              {playbookForm.id ? "Update playbook" : "Create playbook"}
            </button>
          </form>
          <div className="framework-export">
            <label className="stacked-input">
              Framework evidence pack
              <select
                value={frameworkSelection}
                onChange={(event) => setFrameworkSelection(event.target.value as FrameworkName)}
              >
                {readiness.frameworkCoverage.map((item) => (
                  <option key={item.framework} value={item.framework}>
                    {item.framework}
                  </option>
                ))}
              </select>
            </label>
            <label className="stacked-input">
              Audience template
              <select
                value={frameworkAudience}
                onChange={(event) => setFrameworkAudience(event.target.value as FrameworkEvidenceAudience)}
              >
                <option value="judge">Judge summary</option>
                <option value="prospect">Prospect-safe</option>
                <option value="auditor">Auditor review</option>
              </select>
            </label>
            <button type="button" className="secondary" onClick={exportFrameworkPack} disabled={actionState === "running"}>
              <Download size={16} aria-hidden="true" />
              Export framework pack
            </button>
          </div>
          {frameworkPack ? (
            <div className="verification-list">
              <span data-status={frameworkPack.summary.blocked ? "warning" : "passed"}>{frameworkPack.framework}</span>
              <article>
                <strong>Template</strong>
                <p>
                  {frameworkPack.audience} · included {frameworkPack.includedSections.length} · hidden{" "}
                  {frameworkPack.hiddenSections.length}
                </p>
              </article>
              <article>
                <strong>Control coverage</strong>
                <p>
                  {frameworkPack.summary.ready} ready · {frameworkPack.summary.partial} partial ·{" "}
                  {frameworkPack.summary.blocked} blocked · {frameworkPack.summary.productionRequired} require production proof
                </p>
              </article>
              {frameworkPack.controls.slice(0, 3).map((control) => (
                <article key={control.id}>
                  <strong>{control.title}</strong>
                  <p>
                    {control.status} · owner {control.ownerRole} · {control.gaps[0] ?? "no current local gap"}
                  </p>
                </article>
              ))}
              <pre className="export-preview">{frameworkPack.exportText.slice(0, 1200)}</pre>
            </div>
          ) : null}
        </div>

        <aside className="panel">
          <div className="panel-heading">
            <div>
              <h2>Judge Narrative</h2>
              <p>{readiness.judgeNarrative.headline}</p>
            </div>
            <Play size={24} aria-hidden="true" />
          </div>
          <ol className="judge-list">
            {readiness.judgeNarrative.threeMinuteScript.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </aside>
      </section>
      ) : null}

      {persistence ? (
        <section className="content-grid">
          <div className="panel">
            <div className="panel-heading">
              <div>
                <h2>Production Persistence</h2>
                <p>Durable evidence must be tenant-scoped before real pilots move beyond the local MVP.</p>
              </div>
              <Database size={24} aria-hidden="true" />
            </div>
            <div className="persistence-grid">
              <article>
                <span>Firestore root</span>
                <strong>{persistence.tenantIsolation.firestoreRoot}</strong>
              </article>
              <article>
                <span>BigQuery audit table</span>
                <strong>
                  {persistence.bigQueryDataset}.{persistence.bigQueryAuditTable}
                </strong>
              </article>
              <article>
                <span>BigQuery agent-run table</span>
                <strong>
                  {persistence.bigQueryDataset}.{persistence.bigQueryAgentRunsTable}
                </strong>
              </article>
              <article>
                <span>Secret prefix</span>
                <strong>{persistence.secretPrefix}</strong>
              </article>
            </div>
            <ul className="check-list compact">
              {persistence.writePlan.map((item) => (
                <li key={`${item.target}-${item.artifact}`}>
                  <strong>{item.target}:</strong> {item.purpose}
                </li>
              ))}
            </ul>
            <button type="button" onClick={verifyPersistence} disabled={actionState === "running"}>
              <Database size={16} aria-hidden="true" />
              Verify write-through
            </button>
            {persistenceCheck ? (
              <div className="verification-list">
                <span data-status={persistenceCheck.status}>{persistenceCheck.status}</span>
                {persistenceCheck.checks.map((check) => (
                  <article key={`${check.target}-${check.detail}`}>
                    <strong>{check.target}</strong>
                    <p>{check.detail}</p>
                  </article>
                ))}
              </div>
            ) : null}
          </div>

          <aside className="panel">
            <div className="panel-heading">
              <div>
                <h2>Production Blockers</h2>
                <p>These must be cleared before claiming live customer evidence durability.</p>
              </div>
              <AlertTriangle size={24} aria-hidden="true" />
            </div>
            <ul className="check-list compact">
              {persistence.productionWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
              {persistence.missingEnv.map((env) => (
                <li key={env}>Missing env: {env}</li>
              ))}
            </ul>
          </aside>
        </section>
      ) : null}

      {readiness ? (
        <section className="content-grid">
          <div className="panel">
            <div className="panel-heading">
              <div>
                <h2>Production Cost Controls</h2>
                <p>Cloud Billing budgets, Pub/Sub alerts, API-key restrictions, and quota runbooks protect SME margins.</p>
              </div>
              <Database size={24} aria-hidden="true" />
            </div>
            <div className="persistence-grid">
              <article>
                <span>Budget endpoint</span>
                <strong>{readiness.cloudCostControls.budgetPlan.endpoint}</strong>
              </article>
              <article>
                <span>Budget topic</span>
                <strong>{readiness.cloudCostControls.budgetPlan.pubSubTopic ?? "not configured"}</strong>
              </article>
              <article>
                <span>Gemini key endpoint</span>
                <strong>{readiness.cloudCostControls.apiKeyRestrictionPlan.endpoint}</strong>
              </article>
            </div>
            <ul className="check-list compact">
              {readiness.cloudCostControls.evidenceChecklist.map((item) => (
                <li key={item.item}>
                  <strong>{item.status}:</strong> {item.item}. {item.fix}
                </li>
              ))}
            </ul>
            <button type="button" onClick={checkCostControls} disabled={actionState === "running"}>
              <Database size={16} aria-hidden="true" />
              Verify cloud controls
            </button>
          </div>

          <aside className="panel">
            <div className="panel-heading">
              <div>
                <h2>Spend Response</h2>
                <p>Budgets warn; the app still needs explicit runtime actions when thresholds fire.</p>
              </div>
              <AlertTriangle size={24} aria-hidden="true" />
            </div>
            <ol className="judge-list">
              {readiness.cloudCostControls.runbook.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {readiness.cloudCostControls.warnings.length ? (
              <ul className="check-list compact">
                {readiness.cloudCostControls.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </aside>
        </section>
      ) : null}

      <section className="strategy-grid">
        <div className="panel strategy-panel">
          <div className="panel-heading">
            <div>
              <h2>Winning Strategy Room</h2>
              <p>{snapshot.strategy.confidence.confidenceNote}</p>
            </div>
            <Target size={24} aria-hidden="true" />
          </div>
          <div className="confidence-grid">
            <Confidence label="Rule readiness" value={snapshot.strategy.confidence.ruleCompliance} />
            <Confidence label="Marketability" value={snapshot.strategy.confidence.marketability} />
            <Confidence label="Technical edge" value={snapshot.strategy.confidence.technicalDifferentiation} />
            <Confidence label="Business proof" value={snapshot.strategy.confidence.businessEvidence} />
            <Confidence label="Win confidence" value={snapshot.strategy.confidence.winConfidence} />
          </div>
          <div className="focus-strip">
            {snapshot.strategy.implementationFocus.map((focus) => (
              <span key={focus}>{focus}</span>
            ))}
          </div>
          <button type="button" className="secondary" onClick={checkMarketPositioning} disabled={actionState === "running"}>
            <Target size={16} aria-hidden="true" />
            Market battlecard
          </button>
          {marketPositioning ? (
            <div className="verification-list">
              <span data-status={marketPositioning.overallStatus}>{marketPositioning.overallStatus}</span>
              <article>
                <strong>USP wedge</strong>
                <p>
                  {marketPositioning.wedgeScore}% · {marketPositioning.usp}
                </p>
              </article>
              <article>
                <strong>Competitor frame</strong>
                <p>
                  {marketPositioning.competitorComparisons
                    .map((item) => `${item.name}: ${item.wedgeScore}%`)
                    .join(" · ")}
                </p>
              </article>
              <article>
                <strong>Proof action</strong>
                <p>{marketPositioning.proofActions[0]}</p>
              </article>
              <article>
                <strong>Parity gap</strong>
                <p>{marketPositioning.parityGaps.find((gap) => gap.status !== "implemented")?.nextProof}</p>
              </article>
            </div>
          ) : null}
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>Top 15 Feature Bets</h2>
              <p>{snapshot.strategy.completionSummary}</p>
            </div>
            <FileSearch size={24} aria-hidden="true" />
          </div>
          <div className="feature-table" role="table" aria-label="Top feature bets">
            {snapshot.strategy.topFeatures.map((feature) => (
              <div className="feature-row" role="row" key={feature.rank}>
                <span className="rank">{feature.rank}</span>
                <div>
                  <strong>{feature.name}</strong>
                  <small>{feature.winSignal}</small>
                  <small className="feature-score">
                    Market {feature.marketabilityScore}/5 · win {feature.winningLeverageScore}/5 · sell {feature.sellabilityScore}/5 ·
                    proof {feature.proofStatus.replaceAll("-", " ")}
                  </small>
                </div>
                <div className="feature-status">
                  <span className="score-pill">{feature.totalScore}/15</span>
                  <span className="state" data-state={feature.currentState}>
                    {feature.currentState}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>Top 10 Gaps</h2>
              <p>What we have now versus what is needed for a top-tier worldwide product.</p>
            </div>
            <AlertTriangle size={24} aria-hidden="true" />
          </div>
          <div className="gap-list">
            {snapshot.strategy.topGaps.map((gap) => (
              <article key={gap.priority}>
                <span>{gap.priority}</span>
                <div>
                  <h3>{gap.capability}</h3>
                  <p>
                    <strong>Have:</strong> {gap.currentlyHave}
                  </p>
                  <p>
                    <strong>Need:</strong> {gap.neededForTopTier}
                  </p>
                  <p>
                    <strong>Plan:</strong> {gap.implementationPlan}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="panel">
          <div className="panel-heading">
            <div>
              <h2>Loophole Register</h2>
              <p>Adversarial checks that keep the strategy honest.</p>
            </div>
            <ShieldAlert size={24} aria-hidden="true" />
          </div>
          <div className="loophole-list">
            {snapshot.strategy.loopholes.slice(0, 6).map((loophole) => (
              <article key={loophole.risk} data-severity={loophole.severity}>
                <span>{loophole.severity}</span>
                <h3>{loophole.risk}</h3>
                <p>{loophole.fix}</p>
              </article>
            ))}
          </div>
        </aside>
      </section>

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
              <time>{new Date(event.createdAt).toLocaleTimeString()}</time>
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

function Confidence({ label, value }: { label: string; value: number }) {
  return (
    <div className="confidence">
      <span>{label}</span>
      <strong>{value}%</strong>
      <div className="meter" aria-hidden="true">
        <i style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function Score({ label, value, tone }: { label: string; value: number; tone: "risk" | "good" }) {
  return (
    <div className="score-card" data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDelta(value: number) {
  if (value > 0) {
    return `+${value}`;
  }

  return String(value);
}

function formatCurrencyDelta(value: number) {
  if (value > 0) {
    return `+$${value.toLocaleString()}`;
  }

  if (value < 0) {
    return `-$${Math.abs(value).toLocaleString()}`;
  }

  return "$0";
}

function ReadinessBlock({ title, rows }: { title: string; rows: string[] }) {
  return (
    <article className="readiness-block">
      <h3>{title}</h3>
      <ul>
        {rows.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
    </article>
  );
}

function FindingCard({
  finding,
  busy,
  onApprove,
  onRemediate,
  onDismiss,
  onFalsePositive,
  onRescan
}: {
  finding: Finding;
  busy: boolean;
  onApprove: () => void;
  onRemediate: () => void;
  onDismiss: () => void;
  onFalsePositive: () => void;
  onRescan: () => void;
}) {
  return (
    <article className="finding-card" data-severity={finding.severity}>
      <div className="finding-header">
        <div>
          <span className="severity">{finding.severity}</span>
          <h3>{finding.title}</h3>
        </div>
        <span className="status">{finding.status.replace("_", " ")}</span>
      </div>
      <p>{finding.rationale}</p>
      <dl className="finding-detail">
        <div>
          <dt>Recommendation</dt>
          <dd>{finding.recommendation.action.replaceAll("_", " ")}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{Math.round(finding.recommendation.confidence * 100)}%</dd>
        </div>
        <div>
          <dt>Blast radius</dt>
          <dd>{finding.recommendation.blastRadius}</dd>
        </div>
        <div>
          <dt>Approver</dt>
          <dd>
            {finding.approval.requiredRole} · {finding.approval.assignedTo}
          </dd>
        </div>
        <div>
          <dt>SLA</dt>
          <dd>
            {finding.approval.status.replaceAll("_", " ")} · due {new Date(finding.approval.dueAt).toLocaleString()}
          </dd>
        </div>
        <div>
          <dt>Escalation</dt>
          <dd>{finding.approval.escalationTarget}</dd>
        </div>
      </dl>
      <div className="button-row">
        <button type="button" onClick={onApprove} disabled={busy || finding.status !== "recommended"}>
          <CheckCircle2 size={16} aria-hidden="true" />
          Approve
        </button>
        <button type="button" onClick={onRemediate} disabled={busy || finding.status !== "approved"}>
          <Wrench size={16} aria-hidden="true" />
          Remediate
        </button>
        <button type="button" className="secondary" onClick={onRescan} disabled={busy}>
          <RefreshCw size={16} aria-hidden="true" />
          Re-scan
        </button>
        <button type="button" className="secondary" onClick={onDismiss} disabled={busy || finding.status === "remediated"}>
          <EyeOff size={16} aria-hidden="true" />
          Dismiss
        </button>
        <button type="button" className="secondary" onClick={onFalsePositive} disabled={busy || finding.status === "remediated"}>
          <AlertTriangle size={16} aria-hidden="true" />
          False positive
        </button>
      </div>
    </article>
  );
}

function SeverityLegend({ active }: { active: Severity }) {
  return (
    <section className="severity-legend" aria-label="Severity legend">
      {severityOrder.map((severity) => (
        <span key={severity} data-active={severity === active}>
          {severity}
        </span>
      ))}
    </section>
  );
}
