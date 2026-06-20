"use client";

import { AlertTriangle, CheckCircle2, EyeOff, RefreshCw, Wrench } from "lucide-react";
import type { Finding, Severity } from "@/lib/types";

const severityOrder: Severity[] = ["critical", "high", "medium", "low", "info"];

const numberFormatter = new Intl.NumberFormat("en-US");
const utcDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
  year: "numeric"
});
const utcTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  timeZone: "UTC"
});
const utcDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "short",
  timeZone: "UTC",
  year: "numeric"
});

export function Confidence({ label, value }: { label: string; value: number }) {
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

export function Score({ label, value, tone }: { label: string; value: number; tone: "risk" | "good" }) {
  return (
    <div className="score-card" data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ReadinessBlock({ title, rows }: { title: string; rows: string[] }) {
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

export function FindingCard({
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
            {finding.approval.status.replaceAll("_", " ")} · due {formatUtcDateTime(finding.approval.dueAt)}
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

export function SeverityLegend({ active }: { active: Severity }) {
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

export function formatDelta(value: number) {
  if (value > 0) {
    return `+${value}`;
  }

  return String(value);
}

export function formatNumber(value: number) {
  return numberFormatter.format(value);
}

export function formatUtcDate(value: string) {
  return utcDateFormatter.format(new Date(value));
}

export function formatUtcTime(value: string) {
  return utcTimeFormatter.format(new Date(value));
}

export function formatUtcDateTime(value: string) {
  return utcDateTimeFormatter.format(new Date(value));
}

export function formatCurrencyDelta(value: number) {
  if (value > 0) {
    return `+$${formatNumber(value)}`;
  }

  if (value < 0) {
    return `-$${formatNumber(Math.abs(value))}`;
  }

  return "$0";
}
