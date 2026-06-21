"use client";

import { AlertTriangle, ShieldAlert } from "lucide-react";
import type { DashboardSnapshot } from "@/lib/types";

export interface GapsPanelProps {
  snapshot: DashboardSnapshot;
}

export function GapsPanel({ snapshot }: GapsPanelProps) {
  return (
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
  );
}
