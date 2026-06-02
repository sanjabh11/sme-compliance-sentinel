import { getPublicBusinessContact, type PublicBusinessContact } from "@/lib/public-business";

export type BusinessVerificationStatus = "ready" | "blocked" | "manual";

export interface BusinessVerificationChecklistItem {
  id: string;
  label: string;
  status: BusinessVerificationStatus;
  evidence: string;
  requiredForStripe: string;
  ownerAction: string;
}

function hasConfiguredValue(value: string, marker: string) {
  return value.trim().length > 0 && !value.includes(marker);
}

function isValidPublicUrl(value: string) {
  return /^https:\/\/[a-z0-9.-]+/i.test(value.trim());
}

function isValidSupportEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function statusFromReady(ready: boolean): BusinessVerificationStatus {
  return ready ? "ready" : "blocked";
}

export function buildBusinessVerificationChecklist(
  contact: PublicBusinessContact = getPublicBusinessContact(),
): BusinessVerificationChecklistItem[] {
  const supportUrl = `${contact.productUrl.replace(/\/$/, "")}/support`;
  const termsUrl = `${contact.productUrl.replace(/\/$/, "")}/terms-of-service`;
  const privacyUrl = `${contact.productUrl.replace(/\/$/, "")}/privacy`;
  const refundUrl = `${contact.productUrl.replace(/\/$/, "")}/cancellation-refund-policy`;
  const addressReady = hasConfiguredValue(contact.registeredAddress, "registered India business address");
  const phoneReady = hasConfiguredValue(contact.domesticPhone, "domestic India support telephone");
  const emailReady = isValidSupportEmail(contact.supportEmail);

  return [
    {
      id: "support-url",
      label: "Customer support URL",
      status: statusFromReady(isValidPublicUrl(supportUrl)),
      evidence: supportUrl,
      requiredForStripe: "Public page with business contact details and support handling.",
      ownerAction: "Submit this URL in Stripe after registered address, phone, and email are configured.",
    },
    {
      id: "terms-url",
      label: "Terms of service URL",
      status: statusFromReady(isValidPublicUrl(termsUrl)),
      evidence: termsUrl,
      requiredForStripe: "Public terms page with payment, cancellation, refund, and support terms.",
      ownerAction: "Submit this URL in Stripe business details.",
    },
    {
      id: "privacy-url",
      label: "Privacy policy URL",
      status: statusFromReady(isValidPublicUrl(privacyUrl)),
      evidence: privacyUrl,
      requiredForStripe: "Public policy describing collected information, use, disclosure, safeguards, and contact path.",
      ownerAction: "Submit this URL in Stripe business details.",
    },
    {
      id: "refund-url",
      label: "Cancellation and refund policy URL",
      status: statusFromReady(isValidPublicUrl(refundUrl)),
      evidence: refundUrl,
      requiredForStripe: "Public page with cancellation timing, refund review, and request process.",
      ownerAction: "Submit this URL in Stripe business details.",
    },
    {
      id: "registered-address",
      label: "Registered India business address",
      status: statusFromReady(addressReady),
      evidence: addressReady ? "Configured as public deployment value." : "Missing public deployment value.",
      requiredForStripe: "Stripe requires the registered company address to be listed on support/contact page.",
      ownerAction: "Set NEXT_PUBLIC_BUSINESS_REGISTERED_ADDRESS before resubmitting support URL.",
    },
    {
      id: "domestic-phone",
      label: "Domestic India support telephone",
      status: statusFromReady(phoneReady),
      evidence: phoneReady ? "Configured as public deployment value." : "Missing public deployment value.",
      requiredForStripe: "Stripe requires a domestic telephone number in India on support/contact page.",
      ownerAction: "Set NEXT_PUBLIC_BUSINESS_SUPPORT_PHONE before resubmitting support URL.",
    },
    {
      id: "support-email",
      label: "Monitored support email",
      status: statusFromReady(emailReady),
      evidence: emailReady ? contact.supportEmail : "Missing or invalid public deployment value.",
      requiredForStripe: "Support, billing, consent, cancellation, and refund requests need a monitored contact path.",
      ownerAction: "Set NEXT_PUBLIC_BUSINESS_SUPPORT_EMAIL before resubmitting support URL.",
    },
    {
      id: "payment-methods",
      label: "Payment collection methods",
      status: "manual",
      evidence: "Recommended Stripe selection: Website and Offline. App(s) only if desktop/mobile app checkout is active.",
      requiredForStripe: "Stripe asks how payments are collected.",
      ownerAction: "Select Website for the public app and Offline if using Payment Links, invoices, or manual billing.",
    },
  ];
}

export function getBusinessVerificationSummary(
  checklist: BusinessVerificationChecklistItem[] = buildBusinessVerificationChecklist(),
) {
  const ready = checklist.filter((item) => item.status === "ready").length;
  const blocked = checklist.filter((item) => item.status === "blocked").length;
  const manual = checklist.filter((item) => item.status === "manual").length;

  return {
    ready,
    blocked,
    manual,
    total: checklist.length,
    complete: blocked === 0,
  };
}
