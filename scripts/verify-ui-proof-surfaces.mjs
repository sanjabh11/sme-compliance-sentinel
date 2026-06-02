#!/usr/bin/env node

/* global console, process */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assertContains(relativePath, snippet, label = snippet) {
  const source = read(relativePath);
  if (!source.includes(snippet)) {
    failures.push(`${relativePath} missing ${label}`);
  }
}

function assertMatches(relativePath, pattern, label) {
  const source = read(relativePath);
  if (!pattern.test(source)) {
    failures.push(`${relativePath} missing ${label}`);
  }
}

const businessVerificationSurfaces = [
  {
    file: "app/support/page.tsx",
    snippets: [
      "business-verification-card",
      "Stripe business verification status",
      "Stripe verification blocker",
      "getPublicBusinessContact",
      "buildBusinessVerificationChecklist",
      "registered India business address",
      "domestic support phone",
      "monitored support email"
    ]
  },
  {
    file: "app/dashboard-client.tsx",
    snippets: [
      "business-verification-card",
      "Stripe Business Verification",
      "Stripe business verification status",
      "businessVerificationSummary",
      "businessVerificationChecklist"
    ]
  },
  {
    file: "lib/public-business.ts",
    snippets: [
      "NEXT_PUBLIC_BUSINESS_LEGAL_NAME",
      "NEXT_PUBLIC_BUSINESS_REGISTERED_ADDRESS",
      "NEXT_PUBLIC_BUSINESS_SUPPORT_PHONE",
      "NEXT_PUBLIC_BUSINESS_SUPPORT_EMAIL",
      "detailsComplete"
    ]
  },
  {
    file: "lib/business-verification.ts",
    snippets: [
      "support-url",
      "terms-url",
      "privacy-url",
      "refund-url",
      "registered-address",
      "domestic-phone",
      "support-email",
      "payment-methods"
    ]
  }
];

for (const surface of businessVerificationSurfaces) {
  for (const snippet of surface.snippets) {
    assertContains(surface.file, snippet);
  }
}

const customerFunnelEvents = [
  "customer_demo_started",
  "booking_cta_clicked",
  "sample_trust_packet_downloaded",
  "consent_packet_requested",
  "pilot_scope_requested",
  "lead_scope_packet_downloaded"
];

for (const eventName of customerFunnelEvents) {
  assertContains("lib/customer-demo.ts", eventName, `${eventName} funnel definition`);
  assertContains(
    "app/demo/customer/customer-demo-client.tsx",
    eventName,
    `${eventName} customer demo tracking`
  );
}

[
  "customer-funnel-panel",
  "aria-label=\"Pilot funnel analytics\"",
  "demo.funnelEvents.map",
  "trackCustomerEvent",
  "Signed consent, customer acceptance, payment, and scan delivery",
  "proofBoundary"
].forEach((snippet) => assertContains("app/demo/customer/customer-demo-client.tsx", snippet));

[
  "does not prove",
  "customerPilotFunnelEvents",
  "proofBoundary",
  "buildCustomerDemoCopyBundle"
].forEach((snippet) => assertContains("lib/customer-demo.ts", snippet));

[
  "buildBusinessVerificationChecklist",
  "getBusinessVerificationSummary",
  "getPublicBusinessContact",
  "registered-address",
  "domestic-phone",
  "support-email",
  "payment-methods"
].forEach((snippet) => assertContains("tests/public-policy-pages.test.ts", snippet));

[
  "customerPilotFunnelEvents",
  "does not prove",
  "customer_demo_started",
  "booking_cta_clicked",
  "sample_trust_packet_downloaded",
  "consent_packet_requested",
  "pilot_scope_requested"
].forEach((snippet) => assertContains("tests/customer-demo.test.ts", snippet));

[
  "Pilot funnel analytics",
  "customer-funnel-grid",
  "Prepare my consent packet",
  "Download scope packet",
  "Open follow-up draft"
].forEach((snippet) => assertContains("tests/customer-entry.test.ts", snippet));

assertMatches(
  "app/support/page.tsx",
  /data-status=\{verificationSummary\.complete \? "ready" : "blocked"\}/,
  "fail-closed support verification status"
);
assertMatches(
  "app/dashboard-client.tsx",
  /data-state=\{businessVerificationSummary\.complete \? "implemented" : "blocked"\}/,
  "fail-closed admin verification state"
);
assertContains("package.json", "\"verify:ui-proof-surfaces\": \"node scripts/verify-ui-proof-surfaces.mjs\"", "UI proof verifier script");

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  verifiedAt: "2026-06-02",
  surfaces: [
    "support business verification card",
    "admin Stripe business verification panel",
    "customer pilot funnel analytics panel",
    "customer event catalog with proof boundaries",
    "tests covering public policy and funnel copy"
  ],
  claimBoundary: "This verifies UI/code visibility only. It does not prove Stripe account acceptance, paid subscriptions, signed consent, or customer revenue.",
}, null, 2));
