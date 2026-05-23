import { describe, expect, it } from "vitest";
import {
  approveQuestionnaireAnswer,
  bulkVerifyAnswerLibraryItems,
  createDemoEvent,
  createQuestionnaireResponsePack,
  exportQuestionnaireResponsePack,
  getDashboardSnapshot,
  ingestResourceEvent,
  resetState,
  verifyAnswerLibraryItem
} from "@/lib/store";

describe("questionnaire response packs", () => {
  it("parses uploaded questionnaire text into evidence-backed draft answers", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const { pack, snapshot } = createQuestionnaireResponsePack({
      customerAlias: "Enterprise buyer",
      questionnaireText: [
        "1. How do you monitor Google Workspace for sensitive-data exposure?",
        "2. How do you prevent sensitive content from being sent to AI models?",
        "3. Can AI automatically change access permissions?",
        "4. Are you SOC2 certified?",
        "5. Describe your quantum-safe coffee machine policy."
      ].join("\n")
    });

    expect(pack.questionsCount).toBe(5);
    expect(pack.source).toBe("uploaded-text");
    expect(pack.customerSegment).toBe("Unsegmented security review");
    expect(pack.answers.map((answer) => answer.category)).toEqual(
      expect.arrayContaining(["workspace-monitoring", "ai-data-minimization", "remediation-controls", "compliance-claims", "unknown"])
    );
    expect(pack.answers.every((answer) => answer.approvalRequired)).toBe(true);
    expect(pack.answers.filter((answer) => answer.answerSource === "generated-evidence").length).toBeGreaterThan(0);
    expect(pack.libraryHitCount).toBe(0);
    expect(pack.needsReviewCount).toBe(1);
    expect(pack.answers.find((answer) => answer.category === "unknown")?.status).toBe("needs_review");
    expect(snapshot.questionnairePacks[0].id).toBe(pack.id);
    expect(snapshot.auditEvents.some((event) => event.type === "questionnaire_pack_created")).toBe(true);
  });

  it("imports spreadsheet-style questionnaires and tracks customer segment history", () => {
    resetState();
    const csv = [
      "ID,Question,Owner",
      "1,How do you monitor Google Workspace for sensitive-data exposure?,Security",
      "2,Can AI automatically change access permissions?,Security",
      "3,Describe your enterprise support workflow,Sales"
    ].join("\n");

    const { pack } = createQuestionnaireResponsePack({
      customerAlias: "Enterprise CSV buyer",
      customerSegment: "Enterprise SaaS",
      source: "csv",
      originalFileName: "buyer-security.csv",
      questionnaireText: csv
    });

    expect(pack.source).toBe("csv");
    expect(pack.customerSegment).toBe("Enterprise SaaS");
    expect(pack.importSummary.rowsDetected).toBe(3);
    expect(pack.importSummary.columnsDetected).toBe(3);
    expect(pack.importSummary.originalFileName).toBe("buyer-security.csv");
    expect(pack.questionsCount).toBe(3);
    expect(pack.answers.map((answer) => answer.category)).toEqual(
      expect.arrayContaining(["workspace-monitoring", "remediation-controls", "unknown"])
    );
    expect(getDashboardSnapshot().readiness.answerLibrary.segmentHistory[0].segment).toBe("Enterprise SaaS");
  });

  it("approves answers and exports a customer-specific response pack", () => {
    resetState();
    const { pack } = createQuestionnaireResponsePack({
      customerAlias: "Procurement team",
      questionnaireText: "Do you keep an audit trail of AI security decisions?"
    });
    const answerId = pack.answers[0].id;

    const approved = approveQuestionnaireAnswer(pack.id, answerId).pack;
    expect(approved.approvedCount).toBe(1);
    expect(approved.status).toBe("approved");
    expect(getDashboardSnapshot().answerLibrary).toHaveLength(1);

    const exported = exportQuestionnaireResponsePack(pack.id);

    expect(exported.pack.status).toBe("exported");
    expect(exported.exportText).toContain("Security Questionnaire Response Pack: Procurement team");
    expect(exported.exportText).toContain("Status: approved");
    expect(exported.exportText).toContain("Source:");
    expect(getDashboardSnapshot().auditEvents.some((event) => event.type === "questionnaire_pack_exported")).toBe(true);
  });

  it("reuses approved answers from the answer library with review cadence", () => {
    resetState();
    const question = "Do you keep an audit trail of AI security decisions?";
    const firstPack = createQuestionnaireResponsePack({
      customerAlias: "First buyer",
      questionnaireText: question
    }).pack;

    approveQuestionnaireAnswer(firstPack.id, firstPack.answers[0].id);
    let snapshot = getDashboardSnapshot();
    const libraryItem = snapshot.answerLibrary[0];

    expect(libraryItem.canonicalQuestion).toBe(question);
    expect(libraryItem.status).toBe("active");
    expect(libraryItem.segmentTags).toContain("Unsegmented security review");
    expect(Date.parse(libraryItem.nextReviewAt)).toBeGreaterThan(Date.parse(libraryItem.verifiedAt));

    const secondPack = createQuestionnaireResponsePack({
      customerAlias: "Second buyer",
      questionnaireText: question
    }).pack;

    expect(secondPack.libraryHitCount).toBe(1);
    expect(secondPack.answers[0].answerSource).toBe("approved-library");
    expect(secondPack.answers[0].libraryItemId).toBe(libraryItem.id);

    snapshot = getDashboardSnapshot();
    expect(snapshot.answerLibrary[0].usageCount).toBe(1);
    expect(snapshot.readiness.answerLibrary.totalApproved).toBe(1);
    expect(snapshot.readiness.answerLibrary.libraryHitRate).toBeGreaterThan(0);

    const verified = verifyAnswerLibraryItem(libraryItem.id);
    expect(verified.answerLibrary[0].status).toBe("active");
    expect(verified.auditEvents.some((event) => event.type === "questionnaire_answer_library_verified")).toBe(true);
  });

  it("bulk verifies answer library items by customer segment", () => {
    resetState();
    const firstPack = createQuestionnaireResponsePack({
      customerAlias: "Seed buyer",
      customerSegment: "Seed SaaS",
      questionnaireText: "Do you keep an audit trail of AI security decisions?"
    }).pack;

    approveQuestionnaireAnswer(firstPack.id, firstPack.answers[0].id);
    const result = bulkVerifyAnswerLibraryItems({ segment: "Seed SaaS" });

    expect(result.verifiedCount).toBe(1);
    expect(result.items[0].segmentTags).toContain("Seed SaaS");
    expect(result.snapshot.auditEvents.some((event) => event.type === "questionnaire_answer_library_bulk_verified")).toBe(true);
  });
});
