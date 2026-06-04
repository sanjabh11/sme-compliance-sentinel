import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { buildBusinessVerificationChecklist, getBusinessVerificationSummary } from "@/lib/business-verification";
import { getPublicBusinessContact } from "@/lib/public-business";

export const metadata: Metadata = {
  title: "Support | SME Workspace Sentinel",
  description: "Customer support contact details for SME Workspace Sentinel."
};

export default function SupportPage() {
  const contact = getPublicBusinessContact();
  const verificationChecklist = buildBusinessVerificationChecklist(contact);
  const verificationSummary = getBusinessVerificationSummary(verificationChecklist);
  const supportEmail = contact.supportEmail.includes("@") ? (
    <a href={`mailto:${contact.supportEmail}`}>{contact.supportEmail}</a>
  ) : (
    contact.supportEmail
  );

  return (
    <main className="legal-shell">
      <LegalNav />
      <section className="legal-hero">
        <p className="eyebrow">Customer Support</p>
        <h1>Support for the one-day Google Workspace risk scan.</h1>
        <p>
          Use this page for customer support, pilot scope questions, billing questions, consent packet questions, and
          Trust Packet follow-up.
        </p>
        {!contact.detailsComplete ? (
          <div className="legal-warning" role="status">
            Stripe verification blocker: add the registered India business address, domestic support phone, and
            monitored support email as public deployment environment values before submitting this URL to Stripe.
          </div>
        ) : null}
      </section>

      <section className="legal-grid">
        <article className="legal-card legal-card-wide business-verification-card">
          <div className="business-verification-heading">
            <div>
              <h2>Stripe business verification status</h2>
              <p>
                {verificationSummary.ready}/{verificationSummary.total} items ready. Public contact details remain
                blocked until owner-approved address, phone, and support email are configured.
              </p>
            </div>
            <span data-status={verificationSummary.complete ? "ready" : "blocked"}>
              {verificationSummary.complete ? "Ready for Stripe" : "Blocked"}
            </span>
          </div>
          <div className="business-verification-grid" role="list">
            {verificationChecklist.map((item) => (
              <div key={item.id} role="listitem" className="business-verification-row">
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.requiredForStripe}</p>
                  <small>{item.ownerAction}</small>
                </div>
                <span data-status={item.status}>{item.status.replace("-", " ")}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="legal-card legal-card-wide">
          <h2>Business contact details</h2>
          <dl className="legal-definition-list">
            <div>
              <dt>Business name</dt>
              <dd>{contact.legalName}</dd>
            </div>
            <div>
              <dt>Registered company address</dt>
              <dd>{contact.registeredAddress}</dd>
            </div>
            <div>
              <dt>Domestic telephone number in India</dt>
              <dd>{contact.domesticPhone}</dd>
            </div>
            <div>
              <dt>Support email</dt>
              <dd>{supportEmail}</dd>
            </div>
            <div>
              <dt>Website</dt>
              <dd>
                <a href={contact.productUrl}>{contact.productUrl}</a>
              </dd>
            </div>
          </dl>
        </article>

        <article className="legal-card">
          <h2>Support scope</h2>
          <p>
            We support demo access, pilot scheduling, consent packet preparation, scan scope, redacted Trust Packet
            export, invoice/payment questions, and cancellation or refund requests.
          </p>
        </article>

        <article className="legal-card">
          <h2>Response handling</h2>
          <p>
            Pilot and billing requests are handled manually. Do not send passwords, OAuth tokens, customer files,
            private invoices, or unredacted security findings through open support messages.
          </p>
        </article>
      </section>
    </main>
  );
}

function LegalNav() {
  return (
    <nav className="legal-nav" aria-label="Legal pages">
      <Link href={"/" as Route}>SME Workspace Sentinel</Link>
      <div>
        <Link href={"/privacy" as Route}>Privacy</Link>
        <Link href={"/terms-of-service" as Route}>Terms</Link>
        <Link href={"/cancellation-refund-policy" as Route}>Refunds</Link>
      </div>
    </nav>
  );
}
