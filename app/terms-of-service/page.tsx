import type { Metadata } from "next";
import Link from "next/link";
import { getPublicBusinessContact } from "@/lib/public-business";

export const metadata: Metadata = {
  title: "Terms of Service | SME Workspace Sentinel",
  description: "Terms of service for SME Workspace Sentinel demos and fixed-scope pilot scans."
};

export default function TermsOfServicePage() {
  const contact = getPublicBusinessContact();
  const supportEmail = contact.supportEmail.includes("@") ? (
    <a href={`mailto:${contact.supportEmail}`}>{contact.supportEmail}</a>
  ) : (
    contact.supportEmail
  );

  return (
    <main className="legal-shell">
      <LegalNav />
      <section className="legal-hero">
        <p className="eyebrow">Terms of Service</p>
        <h1>Terms for demos, pilot requests, and fixed-scope scans.</h1>
        <p>
          These terms apply to SME Workspace Sentinel customer demos, pilot-scope requests, and fixed-scope Workspace
          risk scans unless a separate signed agreement says otherwise.
        </p>
        <small>Last updated: June 2, 2026</small>
      </section>

      <section className="legal-grid">
        <article className="legal-card">
          <h2>Service scope</h2>
          <p>
            SME Workspace Sentinel provides a one-day Google Workspace risk scan workflow, consent packet preparation,
            staged recommendation review, redacted Trust Packet previews, and buyer questionnaire support for approved
            pilot scopes.
          </p>
          <p>
            The service provides readiness evidence only. It is not SOC2 certification, audit assurance, legal advice,
            or a guarantee that every risk will be detected.
          </p>
        </article>

        <article className="legal-card">
          <h2>Customer responsibilities</h2>
          <p>
            Customers must provide accurate scope, consent, exclusions, approval owner details, and billing contact
            information. Customers must not submit data they are not authorized to share.
          </p>
          <p>
            Live Workspace access must remain limited to the approved sources and metadata/content boundaries in the
            signed consent packet.
          </p>
        </article>

        <article className="legal-card">
          <h2>Payment terms</h2>
          <p>
            Paid pilots are fixed-scope services. The listed customer demo offer is a $199 one-day Google Workspace risk
            scan plus SOC2 readiness evidence packet, unless a written quote or invoice states a different price.
          </p>
          <p>
            Payment may be collected through Stripe Checkout, Stripe Payment Links, invoices, or another written payment
            process approved by the business owner.
          </p>
        </article>

        <article className="legal-card">
          <h2>Cancellation and refunds</h2>
          <p>
            Cancellation and refund terms are stated separately at{" "}
            <Link href="/cancellation-refund-policy">Cancellation and Refund Policy</Link>. That policy forms part of
            these terms.
          </p>
        </article>

        <article className="legal-card legal-card-wide">
          <h2>Support and contact</h2>
          <p>
            Support requests can be sent to {supportEmail}. The public support page lists the business contact details
            required for customer support and payment review.
          </p>
        </article>
      </section>
    </main>
  );
}

function LegalNav() {
  return (
    <nav className="legal-nav" aria-label="Legal pages">
      <Link href="/">SME Workspace Sentinel</Link>
      <div>
        <Link href="/support">Support</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/cancellation-refund-policy">Refunds</Link>
      </div>
    </nav>
  );
}
