"use client";

import { ShieldAlert } from "lucide-react";
import type { Finding } from "@/lib/types";
import { FindingCard } from "../dashboard-ui";

export interface FindingsPanelProps {
  findings: Finding[];
  busy: boolean;
  onApprove: (findingId: string) => void;
  onRemediate: (findingId: string, action: string) => void;
  onDismiss: (findingId: string) => void;
  onFalsePositive: (findingId: string) => void;
  onRescan: (findingId: string) => void;
}

export function FindingsPanel({
  findings,
  busy,
  onApprove,
  onRemediate,
  onDismiss,
  onFalsePositive,
  onRescan
}: FindingsPanelProps) {
  return (
    <div className="panel findings-panel">
      <div className="panel-heading">
        <div>
          <h2>Staged Recommendations</h2>
          <p>Human-in-the-loop actions are mandatory unless a tenant explicitly enables a safe auto-action.</p>
        </div>
        <ShieldAlert size={24} aria-hidden="true" />
      </div>

      {findings.length === 0 ? (
        <div className="empty-state">No findings yet. Inject a high-risk mock event to start the demo flow.</div>
      ) : (
        <div className="finding-stack">
          {findings.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              busy={busy}
              onApprove={() => onApprove(finding.id)}
              onRemediate={() => onRemediate(finding.id, finding.recommendation.action)}
              onDismiss={() => onDismiss(finding.id)}
              onFalsePositive={() => onFalsePositive(finding.id)}
              onRescan={() => onRescan(finding.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
