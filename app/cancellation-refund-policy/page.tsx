import type { Metadata } from "next";
import Link from "next/link";
import { getPublicBusinessContact } from "@/lib/public-business";

export const metadata: Metadata = {
  title: "Cancellation and Refund Policy | SME Workspace Sentinel",
  description: "Cancellation and refund policy for SME Workspace Sentinel fixed-scope pilots."
};

export default function CancellationRefundPolicyPage() {
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
        <p className="eyebrow">Cancellation and Refund Policy</p>
        <h1>Cancellation and refund terms for fixed-scope pilots.</h1>
        <p>
          This policy applies to paid SME Workspace Sentinel pilots unless a signed agreement or invoice states a
          different cancellation or refund rule.
        </p>
        <small>Last updated: June 2, 2026</small>
      </section>

      <section className="legal-grid">
        <article className="legal-card">
          <h2>Cancellation before work starts</h2>
          <p>
            A customer may cancel before the scheduled scan starts and before Workspace access, consent processing, or
            preparation work has begun. In that case, the customer may request a full refund of the pilot fee.
          </p>
        </article>

        <article className="legal-card">
          <h2>Cancellation after preparation begins</h2>
          <p>
            If consent review, scope preparation, evidence packet preparation, or scheduled scan work has started, the
            refund may be partial or unavailable depending on work already performed and any direct third-party costs.
          </p>
        </article>

        <article className="legal-card">
          <h2>No live Workspace access</h2>
          <p>
            If the customer does not complete the required consent packet or cannot provide approved Workspace access,
            the pilot may be rescheduled once. If it cannot be rescheduled within a reasonable window, the owner will
            review whether a partial refund is appropriate.
          </p>
        </article>

        <article className="legal-card">
          <h2>Refund request process</h2>
          <p>
            Refund requests should include the payer email, invoice or payment reference, scheduled scan date, and
            reason for cancellation. Send requests to {supportEmail}.
          </p>
          <p>
            Approved refunds are processed back to the original payment method when supported by the payment processor.
          </p>
        </article>

        <article className="legal-card legal-card-wide">
          <h2>Relationship to terms</h2>
          <p>
            This policy is part of the <Link href="/terms-of-service">Terms of Service</Link>. It does not waive any
            separate written terms agreed for a specific pilot, enterprise engagement, or invoice.
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
        <Link href="/terms-of-service">Terms</Link>
      </div>
    </nav>
  );
}
