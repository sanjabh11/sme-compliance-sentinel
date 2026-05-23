import { describe, expect, it } from "vitest";
import { buildEvidenceExport } from "@/lib/evidence";
import {
  approveFinding,
  createDemoEvent,
  getDashboardSnapshot,
  ingestResourceEvent,
  recordPilotEvidence,
  remediateFinding,
  resetState
} from "@/lib/store";

describe("Sentinel HITL workflow", () => {
  it("requires approval before remediation and exports audit-ready state", async () => {
    resetState();

    await ingestResourceEvent(createDemoEvent("public-secret"));
    let snapshot = getDashboardSnapshot();
    const finding = snapshot.findings[0];

    expect(finding.status).toBe("recommended");
    expect(finding.approval.requiredRole).toBe("security");
    expect(finding.approval.assignedTo).toContain("security-owner");
    expect(finding.approval.slaHours).toBe(4);
    expect(finding.approval.status).toBe("pending");
    expect(finding.approval.escalationTarget).toBe("founder@mainstreet-security.example");
    expect(Date.parse(finding.approval.dueAt)).toBeGreaterThan(Date.parse(finding.createdAt));
    expect(() => remediateFinding(finding.id)).toThrow("Human approval is required");

    snapshot = approveFinding(finding.id);
    expect(snapshot.findings[0].status).toBe("approved");
    expect(snapshot.findings[0].approval.status).toBe("approved");
    expect(snapshot.findings[0].approval.approvedByRole).toBe("security");

    snapshot = remediateFinding(finding.id);
    expect(snapshot.findings[0].status).toBe("remediated");
    expect(snapshot.remediations[0].mode).toBe("human_approved");
    expect(snapshot.auditEvents.some((event) => event.type === "remediation_completed")).toBe(true);
  });

  it("deduplicates repeated Workspace events", async () => {
    resetState();
    const event = createDemoEvent("gmail-pii");

    await ingestResourceEvent(event);
    await ingestResourceEvent(event);

    const snapshot = getDashboardSnapshot();
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.auditEvents.some((auditEvent) => auditEvent.message.includes("Duplicate event ignored"))).toBe(true);
  });

  it("records pilot evidence and redacts customer details in judge export", () => {
    resetState();

    const snapshot = recordPilotEvidence({
      customerAlias: "Acme Finance Pilot",
      segment: "Accounting firm preparing for a client security review",
      monthlyRevenueUsd: 299,
      activeUsers: 4,
      proofStatus: "financial-doc-ready",
      consentStatus: "private",
      invoiceReference: "invoice-private-123"
    });

    expect(snapshot.tenant.evidence.mrrUsd).toBeGreaterThanOrEqual(299);
    expect(snapshot.pilotRecords[0].customerAlias).toBe("Acme Finance Pilot");
    expect(snapshot.auditEvents.some((auditEvent) => auditEvent.type === "pilot_evidence_recorded")).toBe(true);

    const exportPacket = buildEvidenceExport({ redacted: true });
    expect(JSON.stringify(exportPacket)).not.toContain("Acme Finance Pilot");
    expect(JSON.stringify(exportPacket)).not.toContain("Accounting firm preparing");
    expect(exportPacket.pilotRecords[0].customerAlias).toContain("Redacted");
  });
});
