import { describe, expect, it } from "vitest";
import { buildCustomerConsentPacket } from "@/lib/customer-consent";

describe("customer consent packet", () => {
  it("builds a buyer-safe consent template from the five-field pilot request", () => {
    const packet = buildCustomerConsentPacket(
      {
        name: "Priya Founder",
        workEmail: "priya@example.com",
        company: "Example SaaS",
        buyerDeadline: "This month",
        pilotGoal: "Prepare a buyer trust packet"
      },
      new Date("2026-05-26T10:00:00.000Z")
    );

    expect(packet.status).toBe("template-ready");
    expect(packet.fieldCount).toBe(5);
    expect(packet.customerAlias).toBe("Example SaaS");
    expect(packet.redactedContact).toBe("p***@example.com");
    expect(JSON.stringify(packet)).not.toContain("priya@example.com");
    expect(packet.allowedSources.join(" ")).toContain("Google Drive metadata");
    expect(packet.excludedData.join(" ")).toContain("OAuth refresh tokens");
    expect(packet.aiUseBoundary.join(" ")).toContain("Gemini receives only bounded");
    expect(packet.remediationApprovalBoundary.join(" ")).toContain("staged recommendation");
    expect(packet.claimBoundaries.join(" ")).toContain("not certification");
    expect(packet.exportText).toContain("## Signature Checklist");
    expect(packet.safeHandling).toContain("do not commit it to Git");
  });

  it("requires a valid work email before preparing the consent packet", () => {
    expect(() =>
      buildCustomerConsentPacket({
        workEmail: "not-an-email",
        company: "Example SaaS"
      })
    ).toThrow("valid work email");
  });
});
