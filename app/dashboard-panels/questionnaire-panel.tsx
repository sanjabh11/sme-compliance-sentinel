"use client";

import { CheckCircle2, Download, FileSearch, Sparkles } from "lucide-react";
import type {
  AnswerLibrarySummary,
  QuestionnaireAnswerLibraryItem,
  QuestionnaireDraft,
  QuestionnaireInputSource,
  QuestionnaireResponsePack
} from "@/lib/types";
import { formatUtcDate } from "../dashboard-ui";

export interface QuestionnaireFormState {
  customerAlias: string;
  customerSegment: string;
  source: QuestionnaireInputSource;
  originalFileName: string;
  questionnaireText: string;
}

export interface QuestionnairePanelProps {
  busy: boolean;
  form: QuestionnaireFormState;
  onFormChange: (form: QuestionnaireFormState) => void;
  draft: QuestionnaireDraft | null;
  pack: QuestionnaireResponsePack | null;
  answerLibrary: QuestionnaireAnswerLibraryItem[];
  answerLibrarySummary: AnswerLibrarySummary;
  onGenerateDraft: () => void;
  onCreatePack: () => void;
  onVerifyItem: () => void;
  onBulkVerify: () => void;
  onApproveAnswer: () => void;
  onExportPack: () => void;
}

export function QuestionnairePanel({
  busy,
  form,
  onFormChange,
  draft,
  pack,
  answerLibrary,
  answerLibrarySummary,
  onGenerateDraft,
  onCreatePack,
  onVerifyItem,
  onBulkVerify,
  onApproveAnswer,
  onExportPack
}: QuestionnairePanelProps) {
  return (
    <aside className="panel">
      <div className="panel-heading">
        <div>
          <h2>Questionnaire Assistant</h2>
          <p>Drafts customer security-review answers from approved evidence with human approval required.</p>
        </div>
        <FileSearch size={24} aria-hidden="true" />
      </div>
      <button type="button" className="wide" onClick={onGenerateDraft} disabled={busy}>
        <Sparkles size={16} aria-hidden="true" />
        Draft answers
      </button>
      <label className="stacked-input">
        Prospect
        <input
          value={form.customerAlias}
          onChange={(event) => onFormChange({ ...form, customerAlias: event.target.value })}
        />
      </label>
      <div className="form-row">
        <label className="stacked-input">
          Segment
          <input
            value={form.customerSegment}
            onChange={(event) => onFormChange({ ...form, customerSegment: event.target.value })}
          />
        </label>
        <label className="stacked-input">
          Source
          <select
            value={form.source}
            onChange={(event) =>
              onFormChange({ ...form, source: event.target.value as QuestionnaireInputSource })
            }
          >
            <option value="uploaded-text">Text</option>
            <option value="csv">CSV</option>
            <option value="tsv">TSV</option>
            <option value="spreadsheet-text">Spreadsheet text</option>
            <option value="pdf-text">PDF extracted text</option>
          </select>
        </label>
      </div>
      <label className="stacked-input">
        Source filename
        <input
          value={form.originalFileName}
          onChange={(event) => onFormChange({ ...form, originalFileName: event.target.value })}
        />
      </label>
      <label className="stacked-input">
        Questionnaire text
        <textarea
          rows={6}
          value={form.questionnaireText}
          onChange={(event) => onFormChange({ ...form, questionnaireText: event.target.value })}
        />
      </label>
      <button type="button" className="wide secondary" onClick={onCreatePack} disabled={busy}>
        <FileSearch size={16} aria-hidden="true" />
        Build response pack
      </button>
      <div className="verification-list">
        <span data-status={answerLibrary.length ? "passed" : "warning"}>answer library</span>
        <article>
          <strong>Reusable approved answers</strong>
          <p>
            {answerLibrary.length} approved · {answerLibrarySummary.totalUsage} reuse(s) ·{" "}
            {answerLibrarySummary.libraryHitRate}% hit rate
          </p>
        </article>
        <article>
          <strong>Review cadence</strong>
          <p>
            {answerLibrarySummary.reviewDue} due · next{" "}
            {answerLibrarySummary.nextReviewAt
              ? formatUtcDate(answerLibrarySummary.nextReviewAt)
              : "none"}
          </p>
        </article>
        {answerLibrarySummary.segmentHistory[0] ? (
          <article>
            <strong>Segment history</strong>
            <p>
              {answerLibrarySummary.segmentHistory
                .slice(0, 3)
                .map((segment) => `${segment.segment}: ${segment.packCount} pack(s), ${segment.libraryHits} hit(s)`)
                .join(" · ")}
            </p>
          </article>
        ) : null}
        <button
          type="button"
          className="secondary"
          onClick={onVerifyItem}
          disabled={busy || answerLibrary.length === 0}
        >
          <CheckCircle2 size={16} aria-hidden="true" />
          Verify library item
        </button>
        <button
          type="button"
          className="secondary"
          onClick={onBulkVerify}
          disabled={busy || answerLibrary.length === 0}
        >
          <CheckCircle2 size={16} aria-hidden="true" />
          Bulk verify segment
        </button>
      </div>
      {draft ? (
        <div className="question-list">
          {draft.questions.slice(0, 3).map((item) => (
            <article key={item.id}>
              <h3>{item.question}</h3>
              <p>{item.draftAnswer}</p>
              <small>{item.citations.join(" · ")}</small>
            </article>
          ))}
        </div>
      ) : null}
      {pack ? (
        <div className="question-list">
          <article>
            <h3>{pack.customerAlias}</h3>
            <p>
              {pack.status} · {pack.approvedCount}/{pack.questionsCount} approved ·{" "}
              {pack.needsReviewCount} needs review · {pack.libraryHitCount} library hit(s)
            </p>
            <p>
              {pack.customerSegment} · {pack.source} ·{" "}
              {pack.importSummary.questionsDetected} imported question(s)
            </p>
            <small>{pack.disclaimer}</small>
          </article>
          {pack.answers.slice(0, 3).map((answer) => (
            <article key={answer.id}>
              <h3>{answer.question}</h3>
              <p>{answer.draftAnswer}</p>
              <small>
                {answer.status} · {answer.ownerRole} · {answer.answerSource} · {Math.round(answer.confidence * 100)}% ·{" "}
                {answer.citations.join(" · ")}
              </small>
            </article>
          ))}
          <div className="button-row">
            <button type="button" onClick={onApproveAnswer} disabled={busy}>
              <CheckCircle2 size={16} aria-hidden="true" />
              Approve next
            </button>
            <button type="button" className="secondary" onClick={onExportPack} disabled={busy}>
              <Download size={16} aria-hidden="true" />
              Export pack
            </button>
          </div>
          {pack.exportText ? <pre className="export-preview">{pack.exportText.slice(0, 1200)}</pre> : null}
        </div>
      ) : null}
    </aside>
  );
}
