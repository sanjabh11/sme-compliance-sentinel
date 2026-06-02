import type { Metadata } from "next";
import Link from "next/link";
import { getPublicBusinessContact } from "@/lib/public-business";

export const metadata: Metadata = {
  title: "Privacy Policy | SME Workspace Sentinel",
  description: "Privacy policy for SME Workspace Sentinel customer demos, pilot requests, and consent-first scans."
};

export default function PrivacyPage() {
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
        <p className="eyebrow">Privacy Policy</p>
        <h1>How SME Workspace Sentinel handles pilot and demo data.</h1>
        <p>
          This policy describes the public customer-demo and pilot-intake workflow. Live Workspace access requires a
          separate signed consent packet and approved scan scope before any Google Workspace connection.
        </p>
        <small>Last updated: June 2, 2026</small>
      </section>

      <section className="legal-grid">
        <article className="legal-card">
          <h2>Information we collect</h2>
          <p>
            Customer-demo lead forms collect the minimum details needed to prepare a one-day scan scope: work email,
            buyer deadline, company context if provided, and pilot goal. The demo uses sample data unless a signed
            consent workflow is completed.
          </p>
          <p>
            For a live pilot, the approved consent packet defines Workspace sources in scope, excluded content, review
            owner, AI-use boundary, and redaction rules before access is requested.
          </p>
        </article>

        <article className="legal-card">
          <h2>How we use information</h2>
          <p>
            We use submitted information to prepare scan scope, consent checklists, pilot follow-up, redacted Trust
            Packet previews, and buyer questionnaire drafts. The product provides SOC2 readiness evidence only; it does
            not provide certification, audit assurance, or legal advice.
          </p>
          <p>
            AI review is used only when semantic explanation is justified. Deterministic checks run first, and
            remediation remains staged for human approval.
          </p>
        </article>

        <article className="legal-card">
          <h2>Disclosure and retention</h2>
          <p>
            We do not sell pilot-intake data. Redacted customer-facing outputs should omit raw file contents, OAuth
            tokens, private customer names, payment identifiers, and security findings unless the customer approves a
            specific disclosure.
          </p>
          <p>
            Local demo receipts are not durable CRM evidence until a real lead destination is configured. Live pilot
            artifacts should be retained only for support, audit trail, and buyer-review evidence purposes.
          </p>
        </article>

        <article className="legal-card">
          <h2>Your choices</h2>
          <p>
            You can ask us to stop pilot follow-up, correct contact details, or delete pilot-intake records unless we
            need to retain a limited audit trail for payment, consent, security, or dispute handling.
          </p>
          <p>
            Contact: {supportEmail}
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
        <Link href="/terms-of-service">Terms</Link>
        <Link href="/cancellation-refund-policy">Refunds</Link>
      </div>
    </nav>
  );
}
