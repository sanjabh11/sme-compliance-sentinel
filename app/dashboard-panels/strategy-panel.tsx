"use client";

import { FileSearch, Target } from "lucide-react";
import type { DashboardSnapshot, MarketPositioningCommandCenter } from "@/lib/types";
import { Confidence } from "../dashboard-ui";

export interface StrategyPanelProps {
  busy: boolean;
  snapshot: DashboardSnapshot;
  marketPositioning: MarketPositioningCommandCenter | null;
  onCheckMarketPositioning: () => void;
}

export function StrategyPanel({
  busy,
  snapshot,
  marketPositioning,
  onCheckMarketPositioning
}: StrategyPanelProps) {
  return (
    <section id="admin-submission" className="strategy-grid">
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
        <button type="button" className="secondary" onClick={onCheckMarketPositioning} disabled={busy}>
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
  );
}
