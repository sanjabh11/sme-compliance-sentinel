import { describe, expect, it } from "vitest";
import { buildCustomerLeadReceipt, captureCustomerLead, listRetainedLeadReceipts } from "@/lib/customer-leads";

describe("customer lead capture", () => {
  it("keeps the public pilot request to five fields and returns a redacted receipt", () => {
    const receipt = buildCustomerLeadReceipt(
      {
        name: "Priya Founder",
        workEmail: "priya@example.com",
        company: "Example SaaS",
        buyerDeadline: "This month",
        pilotGoal: "Prepare a buyer trust packet"
      },
      new Date("2026-05-26T07:00:00.000Z")
    );

    expect(receipt.fieldCount).toBe(5);
    expect(receipt.customerAlias).toBe("Example SaaS");
    expect(receipt.redactedContact).toBe("p***@example.com");
    expect(JSON.stringify(receipt)).not.toContain("priya@example.com");
    expect(receipt.destinationStatus).toBe("lead-destination-needed");
    expect(receipt.consentChecklist.join(" ")).toContain("Non-trivial remediation remains human-approved");
  });

  it("rejects invalid work email before retaining a lead receipt", () => {
    expect(() =>
      buildCustomerLeadReceipt({
        workEmail: "not-an-email",
        buyerDeadline: "This week"
      })
    ).toThrow("valid work email");
  });

  it("retains only redacted local lead receipts", () => {
    const receipt = captureCustomerLead(
      {
        workEmail: "buyer@example.com",
        company: "Buyer Co",
        buyerDeadline: "This week"
      },
      new Date("2026-05-26T08:00:00.000Z")
    );

    expect(listRetainedLeadReceipts()[0]).toEqual(receipt);
    expect(JSON.stringify(listRetainedLeadReceipts())).not.toContain("buyer@example.com");
  });
});
