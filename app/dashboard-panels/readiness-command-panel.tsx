"use client";

import {
  Database,
  Download,
  FileSearch,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  Wrench
} from "lucide-react";
import type {
  ClaimGuardResult,
  CloudCostControlCenter,
  CloudCostControlVerificationResult,
  CloudRunDeploymentEvidence,
  DemoVideoCompliancePack,
  DeploymentEvidencePacket,
  DevpostSubmissionPack,
  EligibilityDisclosurePacket,
  HostedEvidenceCapturePacket,
  JudgeAccessPack,
  PersistenceReadiness,
  ProductionGeminiProofResult,
  ProductionLaunchCommandCenter,
  ProductionProvisioningPack,
  ProjectProvenanceReport,
  ReadinessCommandCenter,
  SourceReleaseGuard,
  SubmissionComplianceCenter,
  ThirdPartyManifest,
  WorkspaceOAuthPlan,
  WorkspaceReconciliationResult,
  XPrizeSubmissionBinder,
  XPrizeSubmissionGate
} from "@/lib/types";
import { ReadinessBlock, Score, formatCurrencyDelta, formatDelta, formatNumber, formatUtcDate, formatUtcDateTime, formatUtcTime } from "../dashboard-ui";

export interface ReadinessCommandPanelProps {
  busy: boolean;
  readiness: ReadinessCommandCenter;
  persistence: PersistenceReadiness | null;
  oauthPlan: WorkspaceOAuthPlan | null;
  syncCheck: WorkspaceReconciliationResult | null;
  costControls: CloudCostControlCenter | null;
  costControlCheck: CloudCostControlVerificationResult | null;
  productionLaunch: ProductionLaunchCommandCenter | null;
  productionProvisioning: ProductionProvisioningPack | null;
  cloudRunDeploymentEvidence: CloudRunDeploymentEvidence | null;
  hostedEvidenceCapture: HostedEvidenceCapturePacket | null;
  deploymentEvidencePacket: DeploymentEvidencePacket | null;
  productionGeminiProof: ProductionGeminiProofResult | null;
  claimGuardCheck: ClaimGuardResult | null;
  submissionGate: XPrizeSubmissionGate | null;
  projectProvenance: ProjectProvenanceReport | null;
  eligibilityDisclosure: EligibilityDisclosurePacket | null;
  sourceReleaseGuard: SourceReleaseGuard | null;
  submissionBinder: XPrizeSubmissionBinder | null;
  submissionCompliance: SubmissionComplianceCenter | null;
  demoVideoPack: DemoVideoCompliancePack | null;
  devpostPack: DevpostSubmissionPack | null;
  judgeAccessPack: JudgeAccessPack | null;
  thirdPartyManifest: ThirdPartyManifest | null;
  onCaptureScoreSnapshot: () => void;
  onCheckOAuthPlan: () => void;
  onRunSyncReconciliation: () => void;
  onBootstrapLiveSync: () => void;
  onRenewWorkspaceWatches: () => void;
  onCheckCostControls: () => void;
  onCheckProductionLaunch: () => void;
  onCheckProductionProvisioning: () => void;
  onCheckCloudRunDeploymentEvidence: () => void;
  onCheckHostedEvidenceCapture: () => void;
  onCheckDeploymentEvidencePacket: () => void;
  onRunProductionGeminiSmoke: () => void;
  onRunClaimGuard: () => void;
  onCheckSubmissionGate: () => void;
  onCheckProjectProvenance: () => void;
  onCheckEligibilityDisclosure: () => void;
  onCheckSourceRelease: () => void;
  onCheckSubmissionCompliance: () => void;
  onCheckDemoVideoPack: () => void;
  onCheckThirdPartyManifest: () => void;
  onCheckJudgeAccessPack: () => void;
  onGenerateSubmissionBinder: () => void;
  onGenerateDevpostPack: () => void;
}

export function ReadinessCommandPanel({
  busy,
  readiness,
  persistence,
  oauthPlan,
  syncCheck,
  costControls,
  costControlCheck,
  productionLaunch,
  productionProvisioning,
  cloudRunDeploymentEvidence,
  hostedEvidenceCapture,
  deploymentEvidencePacket,
  productionGeminiProof,
  claimGuardCheck,
  submissionGate,
  projectProvenance,
  eligibilityDisclosure,
  sourceReleaseGuard,
  submissionBinder,
  submissionCompliance,
  demoVideoPack,
  devpostPack,
  judgeAccessPack,
  thirdPartyManifest,
  onCaptureScoreSnapshot,
  onCheckOAuthPlan,
  onRunSyncReconciliation,
  onBootstrapLiveSync,
  onRenewWorkspaceWatches,
  onCheckCostControls,
  onCheckProductionLaunch,
  onCheckProductionProvisioning,
  onCheckCloudRunDeploymentEvidence,
  onCheckHostedEvidenceCapture,
  onCheckDeploymentEvidencePacket,
  onRunProductionGeminiSmoke,
  onRunClaimGuard,
  onCheckSubmissionGate,
  onCheckProjectProvenance,
  onCheckEligibilityDisclosure,
  onCheckSourceRelease,
  onCheckSubmissionCompliance,
  onCheckDemoVideoPack,
  onCheckThirdPartyManifest,
  onCheckJudgeAccessPack,
  onGenerateSubmissionBinder,
  onGenerateDevpostPack
}: ReadinessCommandPanelProps) {
  return (
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
              <time>{formatUtcTime(item.capturedAt)}</time>
              <span>{item.reason.replaceAll("_", " ")}</span>
              <strong>
                R{item.workspaceRiskScore} · D{item.dealImpactScore} · E{item.evidenceMaturity}
              </strong>
            </li>
          ))}
        </ol>
        <button type="button" className="secondary" onClick={onCaptureScoreSnapshot} disabled={busy}>
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
            `Renewal: ${readiness.syncReliability.renewalPlan.overallStatus}`,
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
                ? formatUtcDateTime(readiness.approvalQueue.earliestDueAt)
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
                ? formatUtcDate(readiness.answerLibrary.nextReviewAt)
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
                {formatUtcTime(notification.dueAt)}
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
      <button type="button" onClick={onCheckOAuthPlan} disabled={busy}>
        <ShieldCheck size={16} aria-hidden="true" />
        Check OAuth launch
      </button>
      <button type="button" className="secondary" onClick={onRunSyncReconciliation} disabled={busy}>
        <RefreshCw size={16} aria-hidden="true" />
        Reconcile sync cursors
      </button>
      <button type="button" className="secondary" onClick={onBootstrapLiveSync} disabled={busy}>
        <RefreshCw size={16} aria-hidden="true" />
        Bootstrap live sync
      </button>
      <button type="button" className="secondary" onClick={onRenewWorkspaceWatches} disabled={busy}>
        <RefreshCw size={16} aria-hidden="true" />
        Renew watches
      </button>
      <button type="button" className="secondary" onClick={onCheckCostControls} disabled={busy}>
        <Database size={16} aria-hidden="true" />
        Check cost controls
      </button>
      <button type="button" className="secondary" onClick={onCheckProductionLaunch} disabled={busy}>
        <Wrench size={16} aria-hidden="true" />
        Launch proof plan
      </button>
      <button type="button" className="secondary" onClick={onCheckProductionProvisioning} disabled={busy}>
        <Database size={16} aria-hidden="true" />
        Provisioning pack
      </button>
      <button type="button" className="secondary" onClick={onCheckCloudRunDeploymentEvidence} disabled={busy}>
        <FileSearch size={16} aria-hidden="true" />
        Cloud Run evidence
      </button>
      <button type="button" className="secondary" onClick={onCheckHostedEvidenceCapture} disabled={busy}>
        <FileSearch size={16} aria-hidden="true" />
        Hosted evidence
      </button>
      <button type="button" className="secondary" onClick={onCheckDeploymentEvidencePacket} disabled={busy}>
        <Download size={16} aria-hidden="true" />
        Release packet
      </button>
      <button type="button" className="secondary" onClick={onRunProductionGeminiSmoke} disabled={busy}>
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
              {formatNumber(costControls.quotaPlan.dailyRequestLimit)} requests/day ·{" "}
              {formatNumber(costControls.quotaPlan.dailyTokenLimit)} tokens/day · {costControls.quotaPlan.enforcement}
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
      {deploymentEvidencePacket ? (
        <div className="verification-list">
          <span data-status={deploymentEvidencePacket.status}>{deploymentEvidencePacket.status.replaceAll("-", " ")}</span>
          <article>
            <strong>Release binding</strong>
            <p>
              {deploymentEvidencePacket.releaseId} · {deploymentEvidencePacket.deploymentStatus.replaceAll("-", " ")} ·{" "}
              {deploymentEvidencePacket.productUrl}
            </p>
          </article>
          <article>
            <strong>Artifact packet</strong>
            <p>
              {deploymentEvidencePacket.artifactManifest.filter((artifact) => artifact.status === "ready").length} ready ·{" "}
              {deploymentEvidencePacket.artifactManifest.filter((artifact) => artifact.status === "external-required").length} external ·{" "}
              {deploymentEvidencePacket.commandSequence.filter((command) => command.mutatesProduction).length} mutating command(s) ·{" "}
              {deploymentEvidencePacket.runbook.length} runbook step(s)
            </p>
          </article>
          {deploymentEvidencePacket.runbook.slice(0, 3).map((step) => (
            <article key={step.id}>
              <strong>{step.label}</strong>
              <p>
                {step.phase.replaceAll("-", " ")} · {step.requiredArtifactIds.length} proof file(s) · {step.stopCondition}
              </p>
            </article>
          ))}
          {deploymentEvidencePacket.artifactManifest
            .filter((artifact) => artifact.status !== "ready")
            .slice(0, 3)
            .map((artifact) => (
              <article key={artifact.id}>
                <strong>{artifact.label}</strong>
                <p>{artifact.nextAction}</p>
              </article>
            ))}
          <article>
            <strong>Import template</strong>
            <p>
              {deploymentEvidencePacket.evidenceVaultImportTemplate.source} · redacted{" "}
              {deploymentEvidencePacket.evidenceVaultImportTemplate.redacted ? "true" : "false"}
            </p>
          </article>
          <article>
            <strong>Next command</strong>
            <p>{deploymentEvidencePacket.commandSequence[0]?.command}</p>
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
      <button type="button" className="secondary" onClick={onRunClaimGuard} disabled={busy}>
        <ShieldAlert size={16} aria-hidden="true" />
        Run claim guard
      </button>
      <button type="button" className="secondary" onClick={onCheckSubmissionGate} disabled={busy}>
        <Target size={16} aria-hidden="true" />
        Check submission gate
      </button>
      <button type="button" className="secondary" onClick={onCheckProjectProvenance} disabled={busy}>
        <FileSearch size={16} aria-hidden="true" />
        Project provenance
      </button>
      <button type="button" className="secondary" onClick={onCheckEligibilityDisclosure} disabled={busy}>
        <ShieldCheck size={16} aria-hidden="true" />
        Disclosure review
      </button>
      <button type="button" className="secondary" onClick={onCheckSourceRelease} disabled={busy}>
        <FileSearch size={16} aria-hidden="true" />
        Source release
      </button>
      <button type="button" className="secondary" onClick={onCheckSubmissionCompliance} disabled={busy}>
        <ShieldCheck size={16} aria-hidden="true" />
        Check submission compliance
      </button>
      <button type="button" className="secondary" onClick={onCheckDemoVideoPack} disabled={busy}>
        <Play size={16} aria-hidden="true" />
        Demo video pack
      </button>
      <button type="button" className="secondary" onClick={onCheckThirdPartyManifest} disabled={busy}>
        <FileSearch size={16} aria-hidden="true" />
        License manifest
      </button>
      <button type="button" className="secondary" onClick={onCheckJudgeAccessPack} disabled={busy}>
        <ShieldCheck size={16} aria-hidden="true" />
        Judge access pack
      </button>
      <button type="button" className="secondary" onClick={onGenerateSubmissionBinder} disabled={busy}>
        <Download size={16} aria-hidden="true" />
        Generate submission binder
      </button>
      <button type="button" className="secondary" onClick={onGenerateDevpostPack} disabled={busy}>
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
      {judgeAccessPack ? (
        <div className="verification-list">
          <span data-status={judgeAccessPack.overallStatus}>{judgeAccessPack.overallStatus.replaceAll("-", " ")}</span>
          <article>
            <strong>Access targets</strong>
            <p>
              Product {judgeAccessPack.productUrl} · repo {judgeAccessPack.repositoryUrl} · demo{" "}
              {judgeAccessPack.demoVideoUrl}
            </p>
          </article>
          <article>
            <strong>Access checks</strong>
            <p>
              {judgeAccessPack.accessChecks.filter((check) => check.status === "ready").length} ready ·{" "}
              {judgeAccessPack.accessChecks.filter((check) => check.status === "private-on-request").length} private ·{" "}
              {judgeAccessPack.accessChecks.filter((check) => check.status === "missing").length} missing
            </p>
          </article>
          {judgeAccessPack.accessChecks
            .filter((check) => check.status !== "ready")
            .slice(0, 4)
            .map((check) => (
              <article key={check.id}>
                <strong>{check.label}</strong>
                <p>{check.fix}</p>
              </article>
            ))}
          <article>
            <strong>Walkthrough</strong>
            <p>{judgeAccessPack.walkthrough.map((stepItem) => stepItem.label).join(" · ")}</p>
          </article>
          <article>
            <strong>Credential rule</strong>
            <p>{judgeAccessPack.privateCredentialRules[0]}</p>
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
            <strong>Evidence readiness export</strong>
            <p>
              {devpostPack.evidenceReadinessExport.summary.ready} ready ·{" "}
              {devpostPack.evidenceReadinessExport.summary.needsReview} review ·{" "}
              {devpostPack.evidenceReadinessExport.summary.blocked} blocked across{" "}
              {devpostPack.evidenceReadinessExport.summary.total} Devpost evidence bucket(s)
            </p>
          </article>
          <article>
            <strong>First evidence bucket</strong>
            <p>
              {devpostPack.evidenceReadinessExport.checklist[0]?.label}:{" "}
              {devpostPack.evidenceReadinessExport.checklist[0]?.status}
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
  );
}
