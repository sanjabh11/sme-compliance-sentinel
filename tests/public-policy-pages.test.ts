import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildBusinessVerificationChecklist, getBusinessVerificationSummary } from "@/lib/business-verification";
import { getPublicBusinessContact } from "@/lib/public-business";

const policyRoutes = [
  "app/support/page.tsx",
  "app/privacy/page.tsx",
  "app/terms-of-service/page.tsx",
  "app/cancellation-refund-policy/page.tsx"
];

describe("public policy pages", () => {
  it("adds concrete public routes needed for Stripe business verification", async () => {
    for (const route of policyRoutes) {
      const source = await readFile(route, "utf8");
      expect(source).toContain("SME Workspace Sentinel");
    }

    const customerDemo = await readFile("app/demo/customer/customer-demo-client.tsx", "utf8");
    expect(customerDemo).toContain("/support");
    expect(customerDemo).toContain("/privacy");
    expect(customerDemo).toContain("/terms-of-service");
    expect(customerDemo).toContain("/cancellation-refund-policy");
  });

  it("keeps support contact details explicit and fail-closed until owner values are configured", () => {
    const missing = getPublicBusinessContact({
      NEXT_PUBLIC_APP_NAME: "SME Workspace Sentinel",
      NEXT_PUBLIC_PRODUCT_URL: "https://sme-workspace-sentinel.vercel.app"
    });

    expect(missing.detailsComplete).toBe(false);
    expect(missing.registeredAddress).toContain("registered India business address");
    expect(missing.domesticPhone).toContain("domestic India support telephone");
    expect(missing.supportEmail).toContain("monitored support email");

    const complete = getPublicBusinessContact({
      NEXT_PUBLIC_APP_NAME: "SME Workspace Sentinel",
      NEXT_PUBLIC_PRODUCT_URL: "https://sme-workspace-sentinel.vercel.app",
      NEXT_PUBLIC_BUSINESS_LEGAL_NAME: "Sanjay Bhargava",
      NEXT_PUBLIC_BUSINESS_REGISTERED_ADDRESS: "Owner-approved registered address, India",
      NEXT_PUBLIC_BUSINESS_SUPPORT_PHONE: "+91 00000 00000",
      NEXT_PUBLIC_BUSINESS_SUPPORT_EMAIL: "support@example.com"
    });

    expect(complete.detailsComplete).toBe(true);
    expect(complete.legalName).toBe("Sanjay Bhargava");
  });

  it("surfaces Stripe business verification checklist without faking owner-held details", () => {
    const missing = getPublicBusinessContact({
      NEXT_PUBLIC_APP_NAME: "SME Workspace Sentinel",
      NEXT_PUBLIC_PRODUCT_URL: "https://sme-workspace-sentinel.vercel.app"
    });
    const checklist = buildBusinessVerificationChecklist(missing);
    const summary = getBusinessVerificationSummary(checklist);
    const rowsById = Object.fromEntries(checklist.map((item) => [item.id, item]));

    expect(summary.complete).toBe(false);
    expect(rowsById["support-url"].status).toBe("ready");
    expect(rowsById["terms-url"].status).toBe("ready");
    expect(rowsById["privacy-url"].status).toBe("ready");
    expect(rowsById["refund-url"].status).toBe("ready");
    expect(rowsById["registered-address"].status).toBe("blocked");
    expect(rowsById["domestic-phone"].status).toBe("blocked");
    expect(rowsById["support-email"].status).toBe("blocked");
    expect(rowsById["payment-methods"].evidence).toContain("Website");
    expect(rowsById["payment-methods"].evidence).toContain("Offline");
  });

  it("keeps terms and refund pages distinct for Stripe review", async () => {
    const terms = await readFile("app/terms-of-service/page.tsx", "utf8");
    const refunds = await readFile("app/cancellation-refund-policy/page.tsx", "utf8");

    expect(terms).toContain("Payment terms");
    expect(terms).toContain("Cancellation and refunds");
    expect(refunds).toContain("Cancellation before work starts");
    expect(refunds).toContain("Refund request process");
    expect(refunds).not.toContain("guarantee that every risk will be detected");
  });
});
