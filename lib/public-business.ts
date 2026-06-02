export type PublicBusinessContact = {
  appName: string;
  legalName: string;
  registeredAddress: string;
  domesticPhone: string;
  supportEmail: string;
  productUrl: string;
  detailsComplete: boolean;
};

const missingAddress =
  "Owner must add the registered India business address before using this page for Stripe verification.";
const missingPhone =
  "Owner must add a domestic India support telephone number before using this page for Stripe verification.";
const missingEmail = "Owner must add a monitored support email before using this page for Stripe verification.";

function clean(value: string | undefined) {
  return value?.trim() ?? "";
}

export function getPublicBusinessContact(env: Partial<Record<string, string | undefined>> = process.env): PublicBusinessContact {
  const appName = clean(env.NEXT_PUBLIC_APP_NAME) || "SME Workspace Sentinel";
  const legalName = clean(env.NEXT_PUBLIC_BUSINESS_LEGAL_NAME) || "Sanjay Bhargava";
  const registeredAddress = clean(env.NEXT_PUBLIC_BUSINESS_REGISTERED_ADDRESS);
  const domesticPhone = clean(env.NEXT_PUBLIC_BUSINESS_SUPPORT_PHONE);
  const supportEmail = clean(env.NEXT_PUBLIC_BUSINESS_SUPPORT_EMAIL);
  const productUrl = clean(env.NEXT_PUBLIC_PRODUCT_URL) || "https://sme-workspace-sentinel.vercel.app";

  return {
    appName,
    legalName,
    registeredAddress: registeredAddress || missingAddress,
    domesticPhone: domesticPhone || missingPhone,
    supportEmail: supportEmail || missingEmail,
    productUrl,
    detailsComplete: Boolean(registeredAddress && domesticPhone && supportEmail)
  };
}
