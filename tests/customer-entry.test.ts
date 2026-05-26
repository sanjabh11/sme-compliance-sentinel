import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import { buildCustomerDemoCopyBundle } from "@/lib/customer-demo";

describe("customer entry route", () => {
  it("uses the customer demo experience at the root and moves the operator dashboard to admin", async () => {
    const rootPage = await readFile("app/page.tsx", "utf8");
    const adminPage = await readFile("app/admin/page.tsx", "utf8");

    expect(rootPage).toContain("CustomerDemoClient");
    expect(rootPage).not.toContain("DashboardClient");
    expect(adminPage).toContain("DashboardClient");
    expect(adminPage).toContain("getDashboardSnapshot");
  });

  it("keeps root customer copy free of internal submission and fake-traction terms", async () => {
    const customerClient = await readFile("app/demo/customer/customer-demo-client.tsx", "utf8");
    const customerCopy = JSON.stringify(buildCustomerDemoCopyBundle(), null, 2);
    const text = `${customerClient}\n${customerCopy}`;
    const forbiddenPublicTerms = [
      "XPRIZE",
      "Devpost",
      "Judge Access",
      "Cloud Run",
      "source-release",
      "MRR",
      "$1,194",
      "/secure/local"
    ];

    expect(scanClaimText({ artifact: "customer-entry", text })).toEqual([]);
    for (const term of forbiddenPublicTerms) {
      expect(text).not.toContain(term);
    }
    expect(text).toContain("SOC2 readiness evidence");
    expect(text).toContain("Sample data only");
  });

  it("keeps the customer entry CTA first-person for the conversion gate", async () => {
    const customerClient = await readFile("app/demo/customer/customer-demo-client.tsx", "utf8");
    const customerCopy = JSON.stringify(buildCustomerDemoCopyBundle(), null, 2);
    const text = `${customerClient}\n${customerCopy}`;

    expect(text).toContain("Get my sample risk scan");
    expect(text).toContain("Book my one-day scan");
    expect(text).toContain("Request my pilot scope");
    expect(text).toContain("Download sample packet");
    expect(text).not.toContain("Start sample demo");
    expect(text).not.toContain("View pilot next step");
  });

  it("surfaces the conversion and consent controls requested for the customer goal", async () => {
    const customerClient = await readFile("app/demo/customer/customer-demo-client.tsx", "utf8");
    const customerCopy = JSON.stringify(buildCustomerDemoCopyBundle(), null, 2);
    const text = `${customerClient}\n${customerCopy}`;

    expect(text).toContain("customer-lead-form");
    expect(text).toContain("Work email");
    expect(text).toContain("Buyer deadline");
    expect(text).toContain("Consent wizard");
    expect(text).toContain("Draft my sample answer");
    expect(text).toContain("Common buyer questions");
    expect(text).toContain("sentinel:");
  });
});
