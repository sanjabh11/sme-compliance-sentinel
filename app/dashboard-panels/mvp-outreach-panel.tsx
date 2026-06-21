"use client";

import { ShieldCheck, Target, UserPlus } from "lucide-react";
import type { MvpOutreachPlan } from "@/lib/types";

export interface MvpOutreachPanelProps {
  busy: boolean;
  mvpOutreachPlan: MvpOutreachPlan | null;
  onBuildOutreachPlan: () => void;
  onConversionKit: () => void;
}

export function MvpOutreachPanel({
  busy,
  mvpOutreachPlan,
  onBuildOutreachPlan,
  onConversionKit
}: MvpOutreachPanelProps) {
  return (
    <section className="content-grid" aria-label="MVP outreach readiness">
      <div className="panel strategy-panel">
        <div className="panel-heading">
          <div>
            <h2>MVP Outreach Command</h2>
            <p>Lead with the one-day Workspace risk scan; keep revenue, customer, and XPRIZE proof separate.</p>
          </div>
          <UserPlus size={24} aria-hidden="true" />
        </div>
        <div className="button-row">
          <button type="button" className="secondary" onClick={onBuildOutreachPlan} disabled={busy}>
            <Target size={16} aria-hidden="true" />
            {busy ? "Building…" : "Build outreach plan"}
          </button>
          <button type="button" className="secondary" onClick={onConversionKit} disabled={busy}>
            <UserPlus size={16} aria-hidden="true" />
            {busy ? "Building…" : "Conversion kit"}
          </button>
        </div>
        {mvpOutreachPlan ? (
          <div className="verification-list">
            <span data-status={mvpOutreachPlan.status}>{mvpOutreachPlan.status.replaceAll("-", " ")}</span>
            <article>
              <strong>{mvpOutreachPlan.headline}</strong>
              <p>
                {mvpOutreachPlan.primaryOffer} · readiness score {mvpOutreachPlan.readinessScore}% · hosted URL{" "}
                {mvpOutreachPlan.hostedUrlStatus}
              </p>
            </article>
            <article>
              <strong>Lead features</strong>
              <p>
                {mvpOutreachPlan.leadFeatures
                  .filter((feature) => feature.leadWith)
                  .slice(0, 3)
                  .map((feature) => `${feature.rank}. ${feature.feature} (${feature.maturity}/5)`)
                  .join(" · ")}
              </p>
            </article>
            <article>
              <strong>Next code/external gaps</strong>
              <p>
                {mvpOutreachPlan.gapFixes
                  .filter((gap) => gap.status !== "done")
                  .slice(0, 2)
                  .map((gap) => `${gap.gap}: ${gap.owner}`)
                  .join(" · ")}
              </p>
            </article>
            <article>
              <strong>First outreach action</strong>
              <p>
                Day {mvpOutreachPlan.outreachSteps[0]?.day}: {mvpOutreachPlan.outreachSteps[0]?.subject} ·{" "}
                {mvpOutreachPlan.outreachSteps[0]?.nextAction}
              </p>
            </article>
            <small>{mvpOutreachPlan.proofBoundary}</small>
          </div>
        ) : (
          <div className="empty-state">Build the plan to see the current MVP outreach gap table and first pilot action.</div>
        )}
      </div>

      <aside className="panel">
        <div className="panel-heading">
          <div>
            <h2>Private Pilot Wedge</h2>
            <p>Use the current product for outreach; do not present local demo data as paid traction.</p>
          </div>
          <ShieldCheck size={24} aria-hidden="true" />
        </div>
        <ul className="check-list">
          <li>Primary offer: one-day Google Workspace risk scan.</li>
          <li>Proof artifact: redacted Trust Packet plus questionnaire pack.</li>
          <li>Trust control: human approval before non-trivial remediation.</li>
          <li>Manual blocker: arms-length paid pilot evidence is still founder/sales work.</li>
        </ul>
      </aside>
    </section>
  );
}
