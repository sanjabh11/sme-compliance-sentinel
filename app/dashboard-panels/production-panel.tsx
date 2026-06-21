"use client";

import { AlertTriangle, Database } from "lucide-react";
import type {
  PersistenceReadiness,
  PersistenceVerificationResult,
  ReadinessCommandCenter
} from "@/lib/types";

export interface ProductionPanelProps {
  busy: boolean;
  persistence: PersistenceReadiness;
  persistenceCheck: PersistenceVerificationResult | null;
  readiness: ReadinessCommandCenter;
  onVerifyPersistence: () => void;
  onCheckCostControls: () => void;
}

export function ProductionPanel({
  busy,
  persistence,
  persistenceCheck,
  readiness,
  onVerifyPersistence,
  onCheckCostControls
}: ProductionPanelProps) {
  return (
    <>
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
          <button type="button" onClick={onVerifyPersistence} disabled={busy}>
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
          <button type="button" onClick={onCheckCostControls} disabled={busy}>
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
    </>
  );
}
