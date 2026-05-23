import type {
  DashboardSnapshot,
  QuestionnaireDraft,
  QuestionnaireAnswerLibraryItem,
  QuestionnaireImportSummary,
  QuestionnaireInputSource,
  QuestionnaireResponseAnswer,
  QuestionnaireResponsePack
} from "@/lib/types";

export function buildQuestionnaireDraft(snapshot: DashboardSnapshot): QuestionnaireDraft {
  const remediated = snapshot.remediations.length;
  const agentRuns = snapshot.agentRuns.length;
  const filesInspected = snapshot.aggregateCounters.filesInspected;
  const bytesToGemini = snapshot.aggregateCounters.bytesRoutedToGemini;

  return {
    generatedAt: new Date().toISOString(),
    source: "approved-evidence",
    disclaimer:
      "Answers are drafts generated from approved evidence. A human owner must review and approve before sharing with customers, auditors, or prospects.",
    questions: [
      {
        id: "q_data_exposure_monitoring",
        question: "How do you monitor Google Workspace for sensitive-data exposure?",
        draftAnswer:
          `We run a hybrid Workspace scan. Tier 0 filters low-risk metadata changes, Tier 1 checks for secrets and PII, and Tier 2 uses Gemini semantic review only when risk justifies it. Current evidence shows ${filesInspected} inspected resource(s).`,
        citations: ["Evidence Room counters", "Hybrid scanner audit logs"],
        approvalRequired: true
      },
      {
        id: "q_ai_data_minimization",
        question: "How do you prevent unnecessary sensitive content from being sent to AI models?",
        draftAnswer:
          `We use deterministic screening before Gemini and track bytes routed to Gemini separately. Current evidence shows ${bytesToGemini} byte(s) routed to Gemini after risk filtering.`,
        citations: ["AI cost guardrail counters", "Detector redaction policy"],
        approvalRequired: true
      },
      {
        id: "q_remediation_controls",
        question: "Can AI automatically change access permissions?",
        draftAnswer:
          `Non-trivial remediation requires human approval. In the current evidence set, ${remediated} remediation action(s) were approved or recorded through the HITL flow.`,
        citations: ["HITL recommendation workflow", "Remediation audit log"],
        approvalRequired: true
      },
      {
        id: "q_audit_trail",
        question: "Do you keep an audit trail of AI security decisions?",
        draftAnswer:
          `Yes. Each AI operation creates an AgentRun and AuditEvent with purpose, model, estimated cost, timestamps, and output summary. Current evidence contains ${agentRuns} agent run(s).`,
        citations: ["AI Operations Timeline", "AgentRun records"],
        approvalRequired: true
      },
      {
        id: "q_compliance_claims",
        question: "Are you SOC2 certified?",
        draftAnswer:
          "No certification claim is made by Sentinel. The product provides SOC2 readiness evidence and risk-detection support; formal certification or attestation must come from qualified auditors.",
        citations: ["Compliance disclaimer", "XPRIZE checklist"],
        approvalRequired: true
      }
    ]
  };
}

export function buildQuestionnaireResponsePack(input: {
  snapshot: DashboardSnapshot;
  id: string;
  customerAlias: string;
  customerSegment?: string;
  questionnaireText: string;
  source?: QuestionnaireInputSource;
  originalFileName?: string;
  createdAt: string;
  answerLibrary?: QuestionnaireAnswerLibraryItem[];
}): QuestionnaireResponsePack {
  const parsed = parseQuestionnaireInput({
    text: input.questionnaireText,
    source: input.source ?? "uploaded-text",
    originalFileName: input.originalFileName
  });
  const answers = parsed.questions.map((question, index) =>
    buildQuestionnaireAnswer(input.snapshot, question, index, input.answerLibrary ?? [])
  );
  const needsReviewCount = answers.filter((answer) => answer.status === "needs_review").length;

  return {
    id: input.id,
    customerAlias: input.customerAlias,
    customerSegment: normalizeSegment(input.customerSegment),
    source: parsed.summary.source,
    importSummary: parsed.summary,
    status: "ready_for_review",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    questionsCount: answers.length,
    approvedCount: answers.filter((answer) => answer.status === "approved").length,
    needsReviewCount,
    libraryHitCount: answers.filter((answer) => answer.libraryItemId).length,
    answers,
    disclaimer:
      "Questionnaire answers are draft evidence responses. A human owner must approve every answer before sharing with prospects, customers, auditors, or judges."
  };
}

export function buildQuestionnaireExport(pack: QuestionnaireResponsePack) {
  const lines = [
    `# Security Questionnaire Response Pack: ${pack.customerAlias}`,
    "",
    pack.disclaimer,
    "",
    `Status: ${pack.status}`,
    `Customer segment: ${pack.customerSegment}`,
    `Source: ${pack.source}${pack.importSummary.originalFileName ? ` (${pack.importSummary.originalFileName})` : ""}`,
    `Import: ${pack.importSummary.questionsDetected} question(s), ${pack.importSummary.rowsDetected} row(s), ${pack.importSummary.columnsDetected} column(s)`,
    `Approved answers: ${pack.approvedCount}/${pack.questionsCount}`,
    `Needs review: ${pack.needsReviewCount}`,
    ""
  ];

  for (const answer of pack.answers) {
    lines.push(`## ${answer.question}`);
    lines.push(`Status: ${answer.status}`);
    lines.push(`Owner: ${answer.ownerRole}`);
    lines.push(`Source: ${answer.answerSource}`);
    if (answer.reviewDueAt) {
      lines.push(`Library review due: ${answer.reviewDueAt}`);
    }
    lines.push(`Confidence: ${Math.round(answer.confidence * 100)}%`);
    lines.push(answer.draftAnswer);
    lines.push(`Citations: ${answer.citations.join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function parseQuestionnaireInput(input: {
  text: string;
  source?: QuestionnaireInputSource;
  originalFileName?: string;
}): { questions: string[]; summary: QuestionnaireImportSummary } {
  const source = input.source ?? "uploaded-text";
  const parsed =
    source === "csv" || source === "tsv" || source === "spreadsheet-text"
      ? parseSpreadsheetQuestionnaire(input.text, source)
      : parseTextQuestionnaire(input.text, source);
  const questions = parsed.questions.length ? parsed.questions : defaultQuestions();

  return {
    questions,
    summary: {
      source,
      originalFileName: input.originalFileName,
      rowsDetected: parsed.rowsDetected,
      columnsDetected: parsed.columnsDetected,
      questionsDetected: questions.length,
      notes: parsed.notes
    }
  };
}

function parseTextQuestionnaire(text: string, source: QuestionnaireInputSource) {
  const normalized =
    source === "pdf-text"
      ? text
          .replace(/-\s*\r?\n\s*/gu, "")
          .replace(/\f/gu, "\n")
      : text;
  const cleaned = text
    ? normalized
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^(?:[-*]|\d+[.)]|[A-Z][.)])\s*/u, "").trim())
    .filter((line) => line.length > 8)
    : [];

  const questions = cleaned.filter((line) => line.includes("?") || /^(do|does|are|is|can|how|what|where|when|who|describe|explain)\b/iu.test(line));
  const unique = Array.from(new Set(questions)).slice(0, 40);

  return {
    questions: unique,
    rowsDetected: cleaned.length,
    columnsDetected: 1,
    notes: source === "pdf-text" ? ["PDF text was normalized from extracted text; binary PDF parsing is not performed locally."] : []
  };
}

function parseSpreadsheetQuestionnaire(text: string, source: QuestionnaireInputSource) {
  const delimiter = source === "csv" ? "," : text.includes("\t") ? "\t" : ",";
  const rows = parseDelimitedRows(text, delimiter);
  const header = rows[0] ?? [];
  const questionColumnIndex = findQuestionColumn(header);
  const contentRows = questionColumnIndex >= 0 ? rows.slice(1) : rows;
  const candidateCells = contentRows.flatMap((row) => {
    if (questionColumnIndex >= 0) {
      return [row[questionColumnIndex] ?? ""];
    }

    return row.filter((cell) => isQuestionLike(cell));
  });
  const questions = Array.from(
    new Set(
      candidateCells
        .map((cell) => cell.replace(/^(?:[-*]|\d+[.)]|[A-Z][.)])\s*/u, "").trim())
        .filter((cell) => cell.length > 8)
        .filter((cell) => isQuestionLike(cell))
    )
  ).slice(0, 60);

  return {
    questions,
    rowsDetected: Math.max(0, rows.length - (questionColumnIndex >= 0 ? 1 : 0)),
    columnsDetected: rows.reduce((max, row) => Math.max(max, row.length), 0),
    notes: [
      questionColumnIndex >= 0
        ? `Detected question column: ${header[questionColumnIndex]}.`
        : "No explicit question column found; extracted question-like cells."
    ]
  };
}

function parseDelimitedRows(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell.trim());
      if (row.some(Boolean)) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) {
    rows.push(row);
  }

  return rows;
}

function findQuestionColumn(header: string[]) {
  return header.findIndex((cell) => /question|requirement|prompt|control|assessment item/iu.test(cell));
}

function isQuestionLike(cell: string) {
  const trimmed = cell.trim();
  return trimmed.includes("?") || /^(do|does|are|is|can|how|what|where|when|who|describe|explain|provide|list)\b/iu.test(trimmed);
}

function defaultQuestions() {
  return [
    "How do you monitor Google Workspace for sensitive-data exposure?",
    "How do you prevent unnecessary sensitive content from being sent to AI models?",
    "Can AI automatically change access permissions?",
    "Do you keep an audit trail of AI security decisions?",
    "Are you SOC2 certified?"
  ];
}

function normalizeSegment(segment?: string) {
  const cleaned = segment?.trim();
  return cleaned || "Unsegmented security review";
}

function buildQuestionnaireAnswer(
  snapshot: DashboardSnapshot,
  question: string,
  index: number,
  answerLibrary: QuestionnaireAnswerLibraryItem[]
): QuestionnaireResponseAnswer {
  const normalized = question.toLowerCase();
  const category = classifyQuestion(normalized);
  const libraryMatch = findAnswerLibraryMatch(question, category, answerLibrary);
  const metrics = {
    filesInspected: snapshot.aggregateCounters.filesInspected,
    bytesToGemini: snapshot.aggregateCounters.bytesRoutedToGemini,
    remediations: snapshot.remediations.length,
    agentRuns: snapshot.agentRuns.length,
    mrr: snapshot.tenant.evidence.mrrUsd,
    pilots: snapshot.tenant.evidence.pilotCount
  };

  if (libraryMatch) {
    const item = libraryMatch.item;
    const isExact = libraryMatch.kind === "approved-library";

    return {
      id: `qa_${index + 1}`,
      question,
      category,
      draftAnswer: isExact
        ? item.approvedAnswer
        : `A related approved answer exists and should be reviewed for fit before sharing: ${item.approvedAnswer}`,
      citations: [...item.citations, `Answer Library: ${item.canonicalQuestion}`],
      confidence: isExact ? Math.max(0.94, item.confidence) : Math.max(0.72, item.confidence - 0.12),
      status: item.status === "review_due" ? "needs_review" : "draft",
      ownerRole: item.ownerRole,
      approvalRequired: true,
      answerSource: libraryMatch.kind,
      libraryItemId: item.id,
      reviewDueAt: item.nextReviewAt
    };
  }

  switch (category) {
    case "workspace-monitoring":
      return answer(index, question, category, "security", 0.86, [
        `We run a hybrid Google Workspace scan. Tier 0 filters low-risk metadata changes, Tier 1 checks for secrets and PII, and Tier 2 uses Gemini semantic review only when risk, model policy, and budget guardrails allow it. Current evidence shows ${metrics.filesInspected} inspected resource(s).`,
        "Evidence Room counters",
        "Hybrid scanner audit logs"
      ]);
    case "ai-data-minimization":
      return answer(index, question, category, "security", 0.84, [
        `We minimize AI exposure by using deterministic screening first, enforcing a model allowlist, enforcing a monthly Gemini budget, and capping per-event content bytes. Current evidence shows ${metrics.bytesToGemini} byte(s) routed to Gemini after risk filtering.`,
        "AI cost guardrail counters",
        "Gemini guardrail policy"
      ]);
    case "remediation-controls":
      return answer(index, question, category, "security", 0.9, [
        `Non-trivial remediation requires human approval. AI may stage recommended actions, but Workspace mutations stay blocked until an admin approves unless a tenant explicitly enables a safe auto-action. Current evidence contains ${metrics.remediations} remediation record(s).`,
        "HITL recommendation workflow",
        "Remediation audit log"
      ]);
    case "audit-trail":
      return answer(index, question, category, "security", 0.88, [
        `Each AI operation creates an AgentRun and AuditEvent with purpose, model, provider, estimated cost, timestamps, and output summary. Current evidence contains ${metrics.agentRuns} agent run(s).`,
        "AI Operations Timeline",
        "AgentRun records"
      ]);
    case "compliance-claims":
      return answer(index, question, category, "legal", 0.92, [
        "No certification claim is made by Sentinel. The product provides SOC2 readiness evidence and risk-detection support; formal certification or attestation must come from qualified auditors.",
        "Compliance disclaimer",
        "Claim Guard policy"
      ]);
    case "access-controls":
      return answer(index, question, category, "engineering", 0.73, [
        "Workspace access analysis starts with least-privilege metadata scopes. Restricted Drive mutation scope is deferred until a tenant explicitly enables human-approved remediation in production.",
        "OAuth readiness plan",
        "Workspace scope documentation"
      ]);
    case "business-evidence":
      return answer(index, question, category, "founder", 0.7, [
        `The Evidence Room tracks MRR, pilots, costs, CAC, active users, consent, and related-party flags. Current local evidence records $${metrics.mrr}/mo across ${metrics.pilots} pilot record(s), but final XPRIZE proof must be replaced with real financial documentation.`,
        "Private Evidence Room",
        "XPRIZE Submission Gate"
      ]);
    default:
      return {
        id: `qa_${index + 1}`,
        question,
        category,
        draftAnswer:
          "This question needs subject-matter review before sharing. Sentinel could not map it confidently to the approved evidence library.",
        citations: ["SME review required"],
        confidence: 0.35,
        status: "needs_review",
        ownerRole: "security",
        approvalRequired: true,
        answerSource: "sme-review"
      };
  }
}

export function normalizeQuestionText(question: string) {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\b(do|does|are|is|can|could|please|describe|explain|your|you|the|a|an|for|to|of|and|or)\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function findAnswerLibraryMatch(
  question: string,
  category: QuestionnaireResponseAnswer["category"],
  answerLibrary: QuestionnaireAnswerLibraryItem[]
):
  | { kind: "approved-library"; item: QuestionnaireAnswerLibraryItem }
  | { kind: "library-context"; item: QuestionnaireAnswerLibraryItem }
  | undefined {
  if (category === "unknown") {
    return undefined;
  }

  const normalized = normalizeQuestionText(question);
  const activeItems = answerLibrary.filter((item) => item.status !== "retired" && item.category === category);
  const exact = activeItems.find((item) => item.normalizedQuestion === normalized);

  if (exact) {
    return { kind: "approved-library", item: exact };
  }

  const scored = activeItems
    .map((item) => ({ item, score: tokenOverlap(normalized, item.normalizedQuestion) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];

  if (best && best.score >= 0.45) {
    return { kind: "library-context", item: best.item };
  }

  return undefined;
}

function tokenOverlap(left: string, right: string) {
  const leftTokens = new Set(left.split(" ").filter((token) => token.length > 2));
  const rightTokens = new Set(right.split(" ").filter((token) => token.length > 2));

  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / Math.max(leftTokens.size, rightTokens.size);
}

function classifyQuestion(question: string): QuestionnaireResponseAnswer["category"] {
  if (/(remediat|permission|sharing|access change|automatic|autonomous|disable public)/u.test(question)) {
    return "remediation-controls";
  }
  if (/(ai|gemini|model|prompt|llm|training|token|data sent|data minimization)/u.test(question)) {
    return "ai-data-minimization";
  }
  if (/(workspace|drive|gmail|sensitive|exposure|monitor|scan|dlp|pii|secret)/u.test(question)) {
    return "workspace-monitoring";
  }
  if (/(audit|log|evidence|trace|record|agent run)/u.test(question)) {
    return "audit-trail";
  }
  if (/(soc\s*2|soc2|certif|compliant|compliance|legal|attestation)/u.test(question)) {
    return "compliance-claims";
  }
  if (/(oauth|scope|mfa|least privilege|role|rbac|access control)/u.test(question)) {
    return "access-controls";
  }
  if (/(revenue|customer|user|pilot|testimonial|cost|cac|pricing)/u.test(question)) {
    return "business-evidence";
  }

  return "unknown";
}

function answer(
  index: number,
  question: string,
  category: QuestionnaireResponseAnswer["category"],
  ownerRole: QuestionnaireResponseAnswer["ownerRole"],
  confidence: number,
  content: [string, string, string]
): QuestionnaireResponseAnswer {
  return {
    id: `qa_${index + 1}`,
    question,
    category,
    draftAnswer: content[0],
    citations: [content[1], content[2]],
    confidence,
    status: "draft",
    ownerRole,
    approvalRequired: true,
    answerSource: "generated-evidence"
  };
}
