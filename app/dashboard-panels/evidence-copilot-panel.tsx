"use client";

import { Database, FileSearch, Sparkles } from "lucide-react";
import type {
  EvidenceCopilotResult,
  EvidenceDocumentAnalysisResult,
  EvidenceDocumentInputKind,
  EvidenceSynthesisPack,
  EvidenceSynthesisPackType,
  MetricQueryResult
} from "@/lib/types";

export interface EvidenceCopilotPanelProps {
  busy: boolean;
  copilotQuery: string;
  onCopilotQueryChange: (value: string) => void;
  copilotResult: EvidenceCopilotResult | null;
  synthesisType: EvidenceSynthesisPackType;
  onSynthesisTypeChange: (value: EvidenceSynthesisPackType) => void;
  synthesisPack: EvidenceSynthesisPack | null;
  metricQuestion: string;
  onMetricQuestionChange: (value: string) => void;
  metricResult: MetricQueryResult | null;
  documentInputKind: EvidenceDocumentInputKind;
  onDocumentInputKindChange: (value: EvidenceDocumentInputKind) => void;
  documentText: string;
  onDocumentTextChange: (value: string) => void;
  documentAnalysis: EvidenceDocumentAnalysisResult | null;
  onRunCopilotQuery: () => void;
  onRunEvidenceSynthesis: () => void;
  onRunMetricQuery: () => void;
  onAnalyzeDocumentInput: () => void;
}

export function EvidenceCopilotPanel({
  busy,
  copilotQuery,
  onCopilotQueryChange,
  copilotResult,
  synthesisType,
  onSynthesisTypeChange,
  synthesisPack,
  metricQuestion,
  onMetricQuestionChange,
  metricResult,
  documentInputKind,
  onDocumentInputKindChange,
  documentText,
  onDocumentTextChange,
  documentAnalysis,
  onRunCopilotQuery,
  onRunEvidenceSynthesis,
  onRunMetricQuery,
  onAnalyzeDocumentInput
}: EvidenceCopilotPanelProps) {
  return (
    <section id="admin-evidence" className="panel evidence-copilot-panel">
      <div className="panel-heading">
        <div>
          <h2>Evidence Copilot</h2>
          <p>Redacted evidence search, cited synthesis, allowlisted metrics, and document intake for local review.</p>
        </div>
        <Sparkles size={24} aria-hidden="true" />
      </div>
      <div className="pilot-conversion-grid">
        <article>
          <b>RAG Search</b>
          <textarea
            aria-label="Evidence Copilot query"
            value={copilotQuery}
            onChange={(event) => onCopilotQueryChange(event.target.value)}
            rows={4}
          />
          <button type="button" className="secondary wide" onClick={onRunCopilotQuery} disabled={busy}>
            <FileSearch size={16} aria-hidden="true" />
            {busy ? "Searching…" : "Search citations"}
          </button>
        </article>
        <article>
          <b>Synthesis Pack</b>
          <select
            aria-label="Evidence synthesis pack type"
            value={synthesisType}
            onChange={(event) => onSynthesisTypeChange(event.target.value as EvidenceSynthesisPackType)}
          >
            <option value="judge-summary">Judge summary</option>
            <option value="customer-security-packet">Customer security packet</option>
            <option value="remediation-timeline">Remediation timeline</option>
            <option value="business-evidence-brief">Business evidence brief</option>
            <option value="ai-operations-proof">AI operations proof</option>
          </select>
          <button type="button" className="secondary wide" onClick={onRunEvidenceSynthesis} disabled={busy}>
            <Sparkles size={16} aria-hidden="true" />
            {busy ? "Generating…" : "Generate synthesis"}
          </button>
        </article>
        <article>
          <b>Metrics Explorer</b>
          <textarea
            aria-label="Evidence metric question"
            value={metricQuestion}
            onChange={(event) => onMetricQuestionChange(event.target.value)}
            rows={4}
          />
          <button type="button" className="secondary wide" onClick={onRunMetricQuery} disabled={busy}>
            <Database size={16} aria-hidden="true" />
            {busy ? "Compiling…" : "Compile metric"}
          </button>
        </article>
        <article>
          <b>Document Intake</b>
          <select
            aria-label="Evidence document input kind"
            value={documentInputKind}
            onChange={(event) => onDocumentInputKindChange(event.target.value as EvidenceDocumentInputKind)}
          >
            <option value="security-questionnaire">Security questionnaire</option>
            <option value="pdf-text">PDF text</option>
            <option value="csv">CSV</option>
            <option value="spreadsheet-text">Spreadsheet text</option>
            <option value="image-metadata">Image metadata</option>
            <option value="contract">Contract</option>
            <option value="invoice">Invoice</option>
            <option value="soc2-readiness">SOC2 readiness</option>
            <option value="gcp-proof">GCP proof</option>
          </select>
          <textarea
            aria-label="Evidence document text"
            value={documentText}
            onChange={(event) => onDocumentTextChange(event.target.value)}
            rows={4}
          />
          <button type="button" className="secondary wide" onClick={onAnalyzeDocumentInput} disabled={busy}>
            <FileSearch size={16} aria-hidden="true" />
            {busy ? "Analyzing…" : "Analyze document"}
          </button>
        </article>
      </div>
      <div className="verification-list">
        {copilotResult ? (
          <article>
            <strong>Copilot answer · {copilotResult.confidence}</strong>
            <p>{copilotResult.answer}</p>
            <small>{copilotResult.citations.map((citation) => citation.sourceId).join(" · ") || "No citations returned"}</small>
          </article>
        ) : null}
        {synthesisPack ? (
          <article>
            <strong>
              {synthesisPack.title} · {synthesisPack.citationCoverageScore}% cited
            </strong>
            <p>{synthesisPack.executiveSummary}</p>
            <small>
              {synthesisPack.humanReviewStatus} review · {synthesisPack.redactionStatus} ·{" "}
              {synthesisPack.missingEvidence.length} missing proof item(s)
            </small>
          </article>
        ) : null}
        {metricResult ? (
          <article>
            <strong>{metricResult.intent.label}</strong>
            <p>{metricResult.summary}</p>
            <small>
              {metricResult.blocked ? "blocked" : "allowlisted"} · {metricResult.sqlPlan.readOnlyView} ·{" "}
              {metricResult.sqlPlan.tenantFilter}
            </small>
          </article>
        ) : null}
        {documentAnalysis ? (
          <article>
            <strong>
              {documentAnalysis.documentKind.replaceAll("-", " ")} · {documentAnalysis.evidenceVaultSuggestion.kind}
            </strong>
            <p>{documentAnalysis.normalizedTextPreview}</p>
            <small>
              {documentAnalysis.evidenceVaultSuggestion.status.replaceAll("-", " ")} · checksum{" "}
              {documentAnalysis.checksumValid ? "valid" : "needed"} · {documentAnalysis.sensitiveMarkers.length} sensitive marker(s)
            </small>
          </article>
        ) : null}
      </div>
    </section>
  );
}
