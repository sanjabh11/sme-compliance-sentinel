import { describe, expect, it } from "vitest";
import { getDashboardSnapshot, resetState, upsertRemediationPlaybook } from "@/lib/store";

describe("tenant remediation playbooks", () => {
  it("creates and updates tenant-specific playbooks with audit evidence", () => {
    resetState();

    const created = upsertRemediationPlaybook({
      name: "Vendor packet exposure",
      trigger: "External sharing plus vendor, security review, or legal keywords.",
      stagedActions: ["request_owner_review", "notify_owner"],
      ownerRole: "legal",
      approvalSlaHours: 12,
      escalationTarget: "founder@mainstreet-security.example"
    });

    expect(created.playbook.tenantId).toBe("tenant_mainstreet_security");
    expect(created.playbook.ownerRole).toBe("legal");
    expect(created.snapshot.playbooks[0].name).toBe("Vendor packet exposure");
    expect(created.snapshot.readiness.playbooks[0].stagedActions).toContain("notify_owner");
    expect(created.snapshot.auditEvents.some((event) => event.type === "playbook_created")).toBe(true);

    const updated = upsertRemediationPlaybook({
      id: created.playbook.id,
      name: "Vendor packet exposure",
      trigger: "External sharing plus security-review packet keywords.",
      stagedActions: ["request_owner_review", "notify_owner", "label_restricted"],
      ownerRole: "security",
      approvalSlaHours: 8,
      escalationTarget: "founder@mainstreet-security.example",
      status: "paused"
    });

    expect(updated.playbook.status).toBe("paused");
    expect(updated.playbook.stagedActions).toContain("label_restricted");
    expect(getDashboardSnapshot().auditEvents.some((event) => event.type === "playbook_updated")).toBe(true);
  });

  it("blocks unsafe automatic remediation playbooks", () => {
    resetState();

    expect(() =>
      upsertRemediationPlaybook({
        name: "Auto close public exposure",
        trigger: "Any public exposure.",
        stagedActions: ["disable_public_sharing"],
        autoAllowed: true,
        ownerRole: "security",
        approvalSlaHours: 1
      })
    ).toThrow("Auto-allowed playbooks can only use no_action");
  });

  it("allows no-action playbooks to run as safe automation", () => {
    resetState();

    const result = upsertRemediationPlaybook({
      name: "Noise suppression",
      trigger: "Metadata-only update without sharing change.",
      stagedActions: ["no_action"],
      autoAllowed: true,
      ownerRole: "security",
      approvalSlaHours: 24
    });

    expect(result.playbook.autoAllowed).toBe(true);
    expect(result.playbook.approvalSlaHours).toBe(0);
  });
});
