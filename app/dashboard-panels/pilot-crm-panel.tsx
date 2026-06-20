"use client";

import { type FormEvent } from "react";
import { Database, Download, FileSearch, ShieldCheck, Sparkles, Target, UserPlus } from "lucide-react";
import type {
  DealImpactReport,
  EvidenceIntakeQueue,
  EvidenceVault,
  EvidenceVaultImportResult,
  FinancialEvidenceLedger,
  PilotConsentPacket,
  PilotConversionKit,
  PilotCustomerRecord,
  PilotLaunchPlan,
  PilotProspectPipeline,
  ReadinessCommandCenter
} from "@/lib/types";
import { formatDelta, formatNumber } from "../dashboard-ui";

export interface PilotFormState {
  customerAlias: string;
  segment: string;
  monthlyRevenueUsd: string;
  activeUsers: string;
  proofStatus: string;
  consentStatus: string;
  armsLength: boolean;
  relatedParty: boolean;
}

export interface PilotCrmPanelProps {
  busy: boolean;
  pilotCrm: PilotCustomerRecord[];
  roiCalculator: ReadinessCommandCenter["roiCalculator"];
  launchPlan: PilotLaunchPlan;
  pilotProspectPipeline: PilotProspectPipeline;
  conversionKit: PilotConversionKit;
  consentPacket: PilotConsentPacket;
  financialLedgerStatus: string;
  financialEvidence: FinancialEvidenceLedger;
  evidenceVaultStatus: string;
  evidenceVault: EvidenceVault;
  intakeQueue: EvidenceIntakeQueue;
  dealImpactReport: DealImpactReport | null;
  evidenceVaultImportResult: EvidenceVaultImportResult | null;
  evidenceImportJson: string;
  onEvidenceImportJsonChange: (value: string) => void;
  evidenceImportToken: string;
  onEvidenceImportTokenChange: (value: string) => void;
  pilotForm: PilotFormState;
  onPilotFormChange: (form: PilotFormState) => void;
  onCheckPilotLaunchPlan: () => void;
  onCheckPilotProspectPipeline: () => void;
  onCheckPilotConversionKit: () => void;
  onCheckPilotConsentPacket: () => void;
  onCheckFinancialEvidenceLedger: () => void;
  onCheckEvidenceVault: () => void;
  onImportEvidenceVaultJson: () => void;
  onCheckEvidenceIntakeQueue: () => void;
  onGenerateDealImpactReport: () => void;
  onRecordPilot: (event: FormEvent<HTMLFormElement>) => void;
}

export function PilotCrmPanel({
  busy,
  pilotCrm,
  roiCalculator,
  launchPlan,
  pilotProspectPipeline,
  conversionKit,
  consentPacket,
  financialLedgerStatus,
  financialEvidence,
  evidenceVaultStatus,
  evidenceVault,
  intakeQueue,
  dealImpactReport,
  evidenceVaultImportResult,
  evidenceImportJson,
  onEvidenceImportJsonChange,
  evidenceImportToken,
  onEvidenceImportTokenChange,
  pilotForm,
  onPilotFormChange,
  onCheckPilotLaunchPlan,
  onCheckPilotProspectPipeline,
  onCheckPilotConversionKit,
  onCheckPilotConsentPacket,
  onCheckFinancialEvidenceLedger,
  onCheckEvidenceVault,
  onImportEvidenceVaultJson,
  onCheckEvidenceIntakeQueue,
  onGenerateDealImpactReport,
  onRecordPilot
}: PilotCrmPanelProps) {
  return (
    <aside className="panel">
      <div className="panel-heading">
        <div>
          <h2>Pilot CRM + ROI</h2>
          <p>Business evidence must become real before submission.</p>
        </div>
        <Target size={24} aria-hidden="true" />
      </div>
      <div className="pilot-list">
        {pilotCrm.map((pilot) => (
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
        <button type="button" className="secondary wide" onClick={onCheckPilotLaunchPlan} disabled={busy}>
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
          ${formatNumber(pilotProspectPipeline.summary.estimatedPipelineMrrUsd)}/mo pipeline · $
          {formatNumber(Math.round(pilotProspectPipeline.summary.expectedPipelineMrrUsd))} weighted
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
        <button type="button" className="secondary wide" onClick={onCheckPilotProspectPipeline} disabled={busy}>
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
        <button type="button" className="secondary wide" onClick={onCheckPilotConversionKit} disabled={busy}>
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
        <button type="button" className="secondary wide" onClick={onCheckPilotConsentPacket} disabled={busy}>
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
          ${formatNumber(financialEvidence.totalMrrUsd)}/mo MRR · ${formatNumber(financialEvidence.totalCostsUsd)} costs ·{" "}
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
        <button type="button" className="secondary wide" onClick={onCheckFinancialEvidenceLedger} disabled={busy}>
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
          onChange={(event) => onEvidenceImportJsonChange(event.target.value)}
          rows={5}
        />
        <input
          aria-label="Evidence import admin token"
          type="password"
          value={evidenceImportToken}
          onChange={(event) => onEvidenceImportTokenChange(event.target.value)}
          placeholder="Admin token"
          autoComplete="off"
        />
        {evidenceVaultImportResult ? (
          <small>
            Last import: {evidenceVaultImportResult.artifactCount} artifact(s) ·{" "}
            {evidenceVaultImportResult.status.replaceAll("-", " ")} · {evidenceVaultImportResult.checksumSha256.slice(0, 12)}...
          </small>
        ) : null}
        <button type="button" className="secondary wide" onClick={onCheckEvidenceVault} disabled={busy}>
          <FileSearch size={16} aria-hidden="true" />
          Check Evidence Vault
        </button>
        <button type="button" className="secondary wide" onClick={onImportEvidenceVaultJson} disabled={busy}>
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
        <button type="button" className="secondary wide" onClick={onCheckEvidenceIntakeQueue} disabled={busy}>
          <FileSearch size={16} aria-hidden="true" />
          Build intake queue
        </button>
      </div>
      <div className="roi-card">
        <span>Evidence-calibrated ROI</span>
        <strong>${formatNumber(roiCalculator.estimatedMonthlyValueUsd)}</strong>
        <small>
          {roiCalculator.paybackMultiple}x payback at ${roiCalculator.pricePerMonthUsd}/mo ·{" "}
          {roiCalculator.calibrationSource.replaceAll("-", " ")}
        </small>
        <div className="roi-metrics">
          <span>{roiCalculator.qualifiedPilotCount} pilots</span>
          <span>${roiCalculator.pilotMrrUsd}/mo MRR</span>
          <span>{roiCalculator.averageSecurityReviewDelayDaysAvoided} days avoided</span>
          <span>{roiCalculator.securityReviewHoursSaved} hours saved</span>
        </div>
        <ul className="roi-evidence-list" aria-label="ROI evidence factors">
          {roiCalculator.evidenceFactors.slice(0, 4).map((factor) => (
            <li key={factor.label}>
              <b>{factor.label}</b>
              <span>{factor.value}</span>
            </li>
          ))}
        </ul>
        <div className="roi-proof-gaps">
          <b>Proof gaps</b>
          {roiCalculator.proofGaps.slice(0, 2).map((gap) => (
            <span key={gap}>{gap}</span>
          ))}
        </div>
      </div>
      <button type="button" className="secondary wide" onClick={onGenerateDealImpactReport} disabled={busy}>
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
      <form className="pilot-form" onSubmit={onRecordPilot}>
        <label>
          Customer alias
          <input
            value={pilotForm.customerAlias}
            onChange={(event) => onPilotFormChange({ ...pilotForm, customerAlias: event.target.value })}
          />
        </label>
        <label>
          Segment
          <input value={pilotForm.segment} onChange={(event) => onPilotFormChange({ ...pilotForm, segment: event.target.value })} />
        </label>
        <div className="form-row">
          <label>
            MRR
            <input
              inputMode="numeric"
              value={pilotForm.monthlyRevenueUsd}
              onChange={(event) => onPilotFormChange({ ...pilotForm, monthlyRevenueUsd: event.target.value })}
            />
          </label>
          <label>
            Users
            <input
              inputMode="numeric"
              value={pilotForm.activeUsers}
              onChange={(event) => onPilotFormChange({ ...pilotForm, activeUsers: event.target.value })}
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Proof
            <select
              value={pilotForm.proofStatus}
              onChange={(event) => onPilotFormChange({ ...pilotForm, proofStatus: event.target.value })}
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
              onChange={(event) => onPilotFormChange({ ...pilotForm, consentStatus: event.target.value })}
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
            onChange={(event) => onPilotFormChange({ ...pilotForm, armsLength: event.target.checked })}
          />
          Arms-length customer
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={pilotForm.relatedParty}
            onChange={(event) => onPilotFormChange({ ...pilotForm, relatedParty: event.target.checked })}
          />
          Related-party revenue
        </label>
        <button type="submit" className="wide" disabled={busy}>
          <UserPlus size={16} aria-hidden="true" />
          Record pilot evidence
        </button>
      </form>
    </aside>
  );
}
