"use client";

import { type FormEvent } from "react";
import { Download, Play, Wrench } from "lucide-react";
import type {
  ApproverRole,
  FrameworkEvidenceAudience,
  FrameworkEvidencePack,
  FrameworkName,
  ReadinessCommandCenter,
  RecommendationAction,
  RemediationPlaybook
} from "@/lib/types";

export interface PlaybookFormState {
  id: string;
  name: string;
  trigger: string;
  stagedActions: RecommendationAction[];
  autoAllowed: boolean;
  approvalSlaHours: string;
  ownerRole: ApproverRole;
  escalationTarget: string;
  status: RemediationPlaybook["status"];
}

export interface PlaybooksPanelProps {
  busy: boolean;
  readiness: ReadinessCommandCenter;
  playbookForm: PlaybookFormState;
  onPlaybookFormChange: (form: PlaybookFormState) => void;
  onEditPlaybook: (playbook: RemediationPlaybook) => void;
  onSavePlaybook: (event: FormEvent<HTMLFormElement>) => void;
  onTogglePlaybookAction: (action: RecommendationAction) => void;
  playbookActionOptions: RecommendationAction[];
  frameworkSelection: FrameworkName;
  onFrameworkSelectionChange: (value: FrameworkName) => void;
  frameworkAudience: FrameworkEvidenceAudience;
  onFrameworkAudienceChange: (value: FrameworkEvidenceAudience) => void;
  frameworkPack: FrameworkEvidencePack | null;
  onExportFrameworkPack: () => void;
}

export function PlaybooksPanel({
  busy,
  readiness,
  playbookForm,
  onPlaybookFormChange,
  onEditPlaybook,
  onSavePlaybook,
  onTogglePlaybookAction,
  playbookActionOptions,
  frameworkSelection,
  onFrameworkSelectionChange,
  frameworkAudience,
  onFrameworkAudienceChange,
  frameworkPack,
  onExportFrameworkPack
}: PlaybooksPanelProps) {
  return (
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
              <button type="button" className="secondary" onClick={() => onEditPlaybook(playbook)} disabled={busy}>
                <Wrench size={16} aria-hidden="true" />
                Edit
              </button>
            </article>
          ))}
        </div>
        <form className="playbook-form" onSubmit={onSavePlaybook}>
          <label className="stacked-input">
            Playbook name
            <input
              value={playbookForm.name}
              onChange={(event) => onPlaybookFormChange({ ...playbookForm, name: event.target.value })}
            />
          </label>
          <label className="stacked-input">
            Trigger condition
            <textarea
              rows={3}
              value={playbookForm.trigger}
              onChange={(event) => onPlaybookFormChange({ ...playbookForm, trigger: event.target.value })}
            />
          </label>
          <div className="form-row">
            <label className="stacked-input">
              Owner
              <select
                value={playbookForm.ownerRole}
                onChange={(event) => onPlaybookFormChange({ ...playbookForm, ownerRole: event.target.value as ApproverRole })}
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
                  onPlaybookFormChange({ ...playbookForm, status: event.target.value as RemediationPlaybook["status"] })
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
                onChange={(event) => onPlaybookFormChange({ ...playbookForm, approvalSlaHours: event.target.value })}
              />
            </label>
            <label className="stacked-input">
              Escalation
              <input
                value={playbookForm.escalationTarget}
                onChange={(event) => onPlaybookFormChange({ ...playbookForm, escalationTarget: event.target.value })}
              />
            </label>
          </div>
          <div className="action-picker" aria-label="Staged playbook actions">
            {playbookActionOptions.map((action) => (
              <label key={action} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={playbookForm.stagedActions.includes(action)}
                  onChange={() => onTogglePlaybookAction(action)}
                />
                {action.replaceAll("_", " ")}
              </label>
            ))}
          </div>
          <label className="checkbox-row playbook-auto">
            <input
              type="checkbox"
              checked={playbookForm.autoAllowed}
              onChange={(event) => onPlaybookFormChange({ ...playbookForm, autoAllowed: event.target.checked })}
            />
            Allow automatic execution only when tenant safe-auto policy permits every action
          </label>
          <button type="submit" disabled={busy}>
            <Wrench size={16} aria-hidden="true" />
            {playbookForm.id ? "Update playbook" : "Create playbook"}
          </button>
        </form>
        <div className="framework-export">
          <label className="stacked-input">
            Framework evidence pack
            <select
              value={frameworkSelection}
              onChange={(event) => onFrameworkSelectionChange(event.target.value as FrameworkName)}
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
              onChange={(event) => onFrameworkAudienceChange(event.target.value as FrameworkEvidenceAudience)}
            >
              <option value="judge">Judge summary</option>
              <option value="prospect">Prospect-safe</option>
              <option value="auditor">Auditor review</option>
            </select>
          </label>
          <button type="button" className="secondary" onClick={onExportFrameworkPack} disabled={busy}>
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
  );
}
