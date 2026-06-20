"use client";

import { AlertTriangle, EyeOff, FileSearch, Play, RotateCcw, ShieldCheck } from "lucide-react";

export interface WorkspaceFlowPanelProps {
  busy: boolean;
  onInjectEvent: (kind: "public-secret" | "low-risk" | "gmail-pii") => void;
  onReset: () => void;
}

export function WorkspaceFlowPanel({ busy, onInjectEvent, onReset }: WorkspaceFlowPanelProps) {
  return (
    <section id="admin-workspace-scan" className="workspace-band">
      <div className="panel command-panel">
        <div className="panel-heading">
          <div>
            <h2>Mock Workspace Flow</h2>
            <p>Drive and Gmail events run through Tier 0, deterministic detection, and Gemini only when justified.</p>
          </div>
          <ShieldCheck size={24} aria-hidden="true" />
        </div>
        <div className="button-row">
          <button type="button" onClick={() => onInjectEvent("public-secret")} disabled={busy}>
            <Play size={16} aria-hidden="true" />
            High-risk Drive event
          </button>
          <button type="button" onClick={() => onInjectEvent("gmail-pii")} disabled={busy}>
            <FileSearch size={16} aria-hidden="true" />
            Gmail PII event
          </button>
          <button type="button" onClick={() => onInjectEvent("low-risk")} disabled={busy}>
            <EyeOff size={16} aria-hidden="true" />
            Low-risk skip
          </button>
          <button type="button" className="secondary" onClick={onReset} disabled={busy}>
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
          <li>Uses &ldquo;SOC2 readiness evidence,&rdquo; not certification language.</li>
          <li>Requires Gemini API for deployed LLM workflow through `GEMINI_MODEL`.</li>
          <li>Uses Google Cloud deployment/services in production path.</li>
          <li>Exports redacted judge evidence; private findings stay private.</li>
        </ul>
      </div>
    </section>
  );
}
