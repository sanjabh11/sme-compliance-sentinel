"use client";

import { Download, ShieldCheck } from "lucide-react";
import type { EvidenceCounters, EvidenceExport } from "@/lib/types";
import { formatNumber } from "../dashboard-ui";

export interface EvidencePanelProps {
  counters: EvidenceCounters;
  busy: boolean;
  exportPreview: EvidenceExport | null;
  onExport: () => void;
  onExportFormat: (format: "markdown" | "csv") => void;
  onExportSigned: () => void;
}

export function EvidencePanel({
  counters,
  busy,
  exportPreview,
  onExport,
  onExportFormat,
  onExportSigned
}: EvidencePanelProps) {
  return (
    <aside className="panel evidence-panel">
      <div className="panel-heading">
        <div>
          <h2>Private Evidence Room</h2>
          <p>Judge packets are redacted by default and only include consented testimonials.</p>
        </div>
        <Download size={24} aria-hidden="true" />
      </div>
      <dl className="evidence-list">
        <div>
          <dt>Files inspected</dt>
          <dd>{formatNumber(counters.filesInspected)}</dd>
        </div>
        <div>
          <dt>Bytes extracted</dt>
          <dd>{formatNumber(counters.bytesExtracted)}</dd>
        </div>
        <div>
          <dt>Bytes scanned by DLP</dt>
          <dd>{formatNumber(counters.bytesScannedByDlp)}</dd>
        </div>
        <div>
          <dt>Bytes routed to Gemini</dt>
          <dd>{formatNumber(counters.bytesRoutedToGemini)}</dd>
        </div>
      </dl>
      <button type="button" className="wide" onClick={onExport} disabled={busy}>
        <Download size={16} aria-hidden="true" />
        Generate judge export
      </button>
      <div className="button-row">
        <button type="button" className="secondary" onClick={() => onExportFormat("markdown")} disabled={busy}>
          <Download size={16} aria-hidden="true" />
          Markdown packet
        </button>
        <button type="button" className="secondary" onClick={() => onExportFormat("csv")} disabled={busy}>
          <Download size={16} aria-hidden="true" />
          CSV packet
        </button>
        <button type="button" className="secondary" onClick={onExportSigned} disabled={busy}>
          <ShieldCheck size={16} aria-hidden="true" />
          Sealed packet
        </button>
      </div>
      {exportPreview ? (
        <pre className="export-preview">{JSON.stringify(exportPreview, null, 2).slice(0, 1600)}</pre>
      ) : null}
    </aside>
  );
}
