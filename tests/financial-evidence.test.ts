import { describe, expect, it } from "vitest";
import { buildFinancialEvidenceLedger } from "@/lib/financial-evidence";
import { getDashboardSnapshot, resetState } from "@/lib/store";

describe("financial evidence ledger", () => {
  it("separates seeded demo metrics from private or missing submission proof", () => {
    resetState();

    const ledger = buildFinancialEvidenceLedger(getDashboardSnapshot());

    expect(ledger.evidenceMode).toBe("mock");
    expect(ledger.totalMrrUsd).toBe(1194);
    expect(ledger.revenueByMonth.May.status).toBe("mock-only");
    expect(ledger.summary["mock-only"]).toBeGreaterThan(0);
    expect(ledger.summary.missing).toBeGreaterThan(0);
    expect(ledger.summary.verified).toBe(0);
    expect(ledger.items.some((item) => item.kind === "pilot-invoice" && item.status === "missing")).toBe(true);
    expect(ledger.items.some((item) => item.kind === "monthly-revenue" && item.privateHandling.includes("invoices stay private"))).toBe(true);
    expect(ledger.blockers.join(" ")).toContain("SENTINEL_EVIDENCE_MODE");
    expect(ledger.blockers.join(" ")).toContain("4 qualified pilot(s) still need invoice/payment proof");
    expect(ledger.nextActions).toContain("Attach private invoices or payment-processor exports for every counted pilot.");
    expect(ledger.disclaimer).toContain("Financial evidence is private by default");
  });
});
