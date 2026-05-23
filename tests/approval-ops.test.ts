import { describe, expect, it } from "vitest";
import { buildApprovalOps, getApproverForRole } from "@/lib/approval-ops";
import { createDemoEvent, getDashboardSnapshot, ingestResourceEvent, resetState } from "@/lib/store";

describe("approval operations", () => {
  it("routes open findings to an authorized approver and queues a local notice", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const snapshot = getDashboardSnapshot();
    const finding = snapshot.findings[0];
    const approvalOps = buildApprovalOps(snapshot);

    expect(finding.approval.assignedTo).toBe(getApproverForRole("security").email);
    expect(approvalOps.openApprovals).toBe(1);
    expect(approvalOps.assignedApprovals).toBe(1);
    expect(approvalOps.roleMismatches).toBe(0);
    expect(approvalOps.notifications[0]).toMatchObject({
      findingId: finding.id,
      recipientRole: "security",
      recipientEmail: "security-owner@mainstreet-security.example",
      channel: "in_app",
      status: "queued",
      productionDeliveryRequired: true
    });
    expect(approvalOps.productionGaps.join(" ")).toContain("production email");
  });

  it("blocks notification delivery when the assigned approver does not match RBAC", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const snapshot = getDashboardSnapshot();
    snapshot.findings[0].approval.assignedTo = "wrong-owner@mainstreet-security.example";

    const approvalOps = buildApprovalOps(snapshot);

    expect(approvalOps.roleMismatches).toBe(1);
    expect(approvalOps.blockedNotifications).toBe(1);
    expect(approvalOps.notifications[0].status).toBe("blocked");
    expect(approvalOps.rbacDecisions[0].reason).toContain("Expected security-owner");
  });
});
