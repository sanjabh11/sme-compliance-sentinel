"use client";

import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileCheck2,
  FileQuestion,
  LockKeyhole,
  Mail,
  SearchCheck,
  ShieldCheck
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import type { CustomerConsentPacket } from "@/lib/customer-consent";
import type { CustomerDemoFeature, CustomerDemoScenario, CustomerDemoStep } from "@/lib/customer-demo";
import type { CustomerLeadReceipt } from "@/lib/customer-leads";

type DemoStage = "ready" | "running";

type LeadFormState = {
  name: string;
  workEmail: string;
  company: string;
  buyerDeadline: string;
  pilotGoal: string;
};

const initialLeadForm: LeadFormState = {
  name: "",
  workEmail: "",
  company: "",
  buyerDeadline: "This month",
  pilotGoal: "Prepare for an enterprise security review"
};

function trackCustomerEvent(eventName: string, detail: Record<string, string>) {
  if (typeof window === "undefined") {
    return;
  }

  const trackedWindow = window as Window & { dataLayer?: unknown[] };
  trackedWindow.dataLayer?.push({ event: eventName, ...detail });
  window.dispatchEvent(new CustomEvent(`sentinel:${eventName}`, { detail }));
}

function buildTrustPacketDownload(scenario: CustomerDemoScenario) {
  return [
    "# SME Workspace Sentinel - Sample Trust Packet",
    "",
    scenario.sampleDataNotice,
    "",
    "## Scope",
    "- Google Workspace risk scan demo",
    "- Deterministic checks before semantic AI review",
    "- Human approval before non-trivial remediation",
    "",
    "## Included Sections",
    ...scenario.trustPacketPreview.contents.map((item) => `- ${item}`),
    "",
    "## Boundary",
    scenario.trustPacketPreview.boundary
  ].join("\n");
}

export function CustomerDemoClient({
  demo
}: {
  demo: {
    features: CustomerDemoFeature[];
    steps: CustomerDemoStep[];
    scenario: CustomerDemoScenario;
  };
}) {
  const [stage, setStage] = useState<DemoStage>("ready");
  const [activeStep, setActiveStep] = useState<CustomerDemoStep["id"]>("pain");
  const [leadForm, setLeadForm] = useState<LeadFormState>(initialLeadForm);
  const [leadReceipt, setLeadReceipt] = useState<CustomerLeadReceipt | null>(null);
  const [leadError, setLeadError] = useState("");
  const [consentPacket, setConsentPacket] = useState<CustomerConsentPacket | null>(null);
  const [consentError, setConsentError] = useState("");
  const [questionnaireQuestion, setQuestionnaireQuestion] = useState(demo.scenario.questionnairePreview.question);
  const [questionnaireDraftVisible, setQuestionnaireDraftVisible] = useState(false);
  const active = demo.steps.find((step) => step.id === activeStep) ?? demo.steps[0];
  const started = stage === "running";
  const trustPacketDownload = useMemo(() => buildTrustPacketDownload(demo.scenario), [demo.scenario]);
  const trustPacketHref = `data:text/markdown;charset=utf-8,${encodeURIComponent(trustPacketDownload)}`;

  function startDemo() {
    trackCustomerEvent("customer_demo_started", { source: "hero" });
    setStage("running");
    setActiveStep("scan");
  }

  async function submitLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLeadError("");
    trackCustomerEvent("pilot_scope_requested", { source: "lead_form" });

    const response = await fetch("/api/customer/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(leadForm)
    });
    const payload = (await response.json()) as { ok: boolean; receipt?: CustomerLeadReceipt; error?: string };
    if (!response.ok || !payload.ok || !payload.receipt) {
      setLeadError(payload.error ?? "Unable to prepare the pilot scope request.");
      return;
    }

    setLeadReceipt(payload.receipt);
  }

  async function prepareConsentPacket() {
    setConsentError("");
    trackCustomerEvent("consent_packet_requested", { source: "consent_panel" });

    const response = await fetch("/api/customer/consent-packet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(leadForm)
    });
    const payload = (await response.json()) as { ok: boolean; packet?: CustomerConsentPacket; error?: string };
    if (!response.ok || !payload.ok || !payload.packet) {
      setConsentError(payload.error ?? "Unable to prepare the consent packet.");
      return;
    }

    setConsentPacket(payload.packet);
  }

  return (
    <main className="customer-demo-shell">
      <nav className="customer-nav" aria-label="Customer demo navigation">
        <Link className="customer-brand" href="/">
          SME Workspace Sentinel
        </Link>
        <div className="customer-nav-links">
          <a href="#customer-flow">How it works</a>
          <a href="#trust-packet">Trust packet</a>
          <a href="#scan-consent">Consent</a>
          <a href="#pilot-next-step">Pilot</a>
          <Link href={"/admin" as Route}>Admin</Link>
        </div>
      </nav>

      <section className="customer-hero">
        <div>
          <p className="eyebrow">Customer demo mode</p>
          <h1>One-day Google Workspace risk scan for buyer-ready trust evidence.</h1>
          <p className="customer-hero-copy">
            Built for {demo.scenario.customerSegment}. Find exposed Workspace risk fast, then turn the review into
            buyer-ready evidence.
          </p>
          <p className="customer-hero-copy customer-hero-copy-tight">{demo.scenario.sampleDataNotice}</p>
          <ul className="customer-value-stack" aria-label="Pilot value summary">
            {demo.scenario.valueStack.map((item) => (
              <li key={item}>
                <CheckCircle2 size={16} aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
          <div className="customer-cta-row">
            <button type="button" onClick={startDemo}>
              <SearchCheck size={18} aria-hidden="true" />
              Get my sample risk scan
            </button>
            <a
              className="customer-secondary-link"
              href="#pilot-lead-form"
              onClick={() => trackCustomerEvent("booking_cta_clicked", { source: "hero" })}
            >
              Book my one-day scan
              <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
        </div>
        <aside className="customer-offer-panel" aria-label="Pilot offer">
          <span>Fixed-scope pilot</span>
          <strong>{demo.scenario.offer}</strong>
          <p>{demo.scenario.sampleDataNotice}</p>
          <div className="customer-preview-metrics" aria-label="Sample demo preview metrics">
            <div>
              <b>1</b>
              <small>sample exposure</small>
            </div>
            <div>
              <b>1</b>
              <small>justified AI review</small>
            </div>
            <div>
              <b>0</b>
              <small>auto mutations</small>
            </div>
          </div>
          <div className="customer-mini-packet">
            <span>{demo.scenario.trustPacketPreview.title}</span>
            <ul>
              {demo.scenario.trustPacketPreview.contents.slice(0, 3).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <a
              className="customer-download-link"
              href={trustPacketHref}
              download="sme-workspace-sentinel-sample-trust-packet.md"
              onClick={() => trackCustomerEvent("sample_trust_packet_downloaded", { source: "hero_panel" })}
            >
              <Download size={16} aria-hidden="true" />
              Download sample packet
            </a>
          </div>
        </aside>
      </section>
      <a className="customer-mobile-sticky-cta" href="#pilot-lead-form">
        Book my one-day scan
      </a>

      <section id="customer-flow" className="customer-stage-tabs" aria-label="Customer demo sequence">
        {demo.steps.map((step) => (
          <button
            key={step.id}
            type="button"
            className="customer-stage-tab"
            data-active={activeStep === step.id}
            onClick={() => setActiveStep(step.id)}
          >
            {step.label}
          </button>
        ))}
      </section>

      <section className="customer-demo-grid">
        <article className="customer-story-panel">
          <p className="eyebrow">{active.eyebrow}</p>
          <h2>{active.title}</h2>
          <p>{active.customerTalkTrack}</p>
          <div className="customer-proof-strip">
            {active.proofPoints.map((point) => (
              <span key={point}>{point}</span>
            ))}
          </div>
          <small>{active.showcaseReason}</small>
        </article>

        <article className="customer-scenario-panel" data-started={started}>
          <div className="customer-panel-heading">
            <div>
              <p className="eyebrow">{started ? "Sample finding created" : "Preloaded sample"}</p>
              <h2>{demo.scenario.scenarioTitle}</h2>
            </div>
            <ShieldCheck size={28} aria-hidden="true" />
          </div>
          <p>{demo.scenario.scenarioSummary}</p>
          <div className="customer-finding">
            <span data-severity={demo.scenario.sampleFinding.severity}>{demo.scenario.sampleFinding.severity}</span>
            <strong>{demo.scenario.sampleFinding.title}</strong>
            <p>{demo.scenario.sampleFinding.exposure}</p>
          </div>
          <div className="customer-risk-movement" aria-label={demo.scenario.riskMovement.label}>
            <div>
              <span>Before</span>
              <strong>{demo.scenario.riskMovement.before}</strong>
            </div>
            <ArrowRight size={18} aria-hidden="true" />
            <div>
              <span>After approval</span>
              <strong>{demo.scenario.riskMovement.after}</strong>
            </div>
          </div>
          <small>{demo.scenario.riskMovement.note}</small>
        </article>
      </section>

      <section id="trust-packet" className="customer-outcome-grid" aria-label="Demo outputs">
        <article>
          <div className="customer-panel-heading">
            <h2>Risk explanation</h2>
            <SearchCheck size={22} aria-hidden="true" />
          </div>
          <dl className="customer-detail-list">
            <div>
              <dt>Resource</dt>
              <dd>{demo.scenario.sampleFinding.resource}</dd>
            </div>
            <div>
              <dt>Signals</dt>
              <dd>{demo.scenario.sampleFinding.deterministicSignals.join(" · ")}</dd>
            </div>
            <div>
              <dt>AI explanation</dt>
              <dd>{demo.scenario.sampleFinding.aiExplanation}</dd>
            </div>
          </dl>
        </article>

        <article>
          <div className="customer-panel-heading">
            <h2>Human-approved action</h2>
            <LockKeyhole size={22} aria-hidden="true" />
          </div>
          <p>{demo.scenario.sampleFinding.blastRadius}</p>
          <div className="customer-recommendation">
            <CheckCircle2 size={18} aria-hidden="true" />
            <span>{demo.scenario.sampleFinding.recommendation}</span>
          </div>
        </article>

        <article>
          <div className="customer-panel-heading">
            <h2>Redacted Trust Packet</h2>
            <FileCheck2 size={22} aria-hidden="true" />
          </div>
          <ul className="customer-compact-list">
            {demo.scenario.trustPacketPreview.contents.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <small>{demo.scenario.trustPacketPreview.boundary}</small>
          <a
            className="customer-download-link"
            href={trustPacketHref}
            download="sme-workspace-sentinel-sample-trust-packet.md"
            onClick={() => trackCustomerEvent("sample_trust_packet_downloaded", { source: "trust_packet_card" })}
          >
            <Download size={16} aria-hidden="true" />
            Download sample packet
          </a>
        </article>

        <article>
          <div className="customer-panel-heading">
            <h2>Questionnaire answer</h2>
            <FileQuestion size={22} aria-hidden="true" />
          </div>
          <label className="customer-field">
            <span>Buyer question</span>
            <textarea
              value={questionnaireQuestion}
              onChange={(event) => setQuestionnaireQuestion(event.target.value)}
              rows={3}
            />
          </label>
          <button
            type="button"
            className="customer-inline-button"
            onClick={() => {
              setQuestionnaireDraftVisible(true);
              trackCustomerEvent("questionnaire_answer_drafted", { source: "trust_packet_card" });
            }}
          >
            <ClipboardCheck size={16} aria-hidden="true" />
            Draft my sample answer
          </button>
          {questionnaireDraftVisible ? (
            <div className="customer-answer-preview">
              <strong>{questionnaireQuestion}</strong>
              <p>{demo.scenario.questionnairePreview.answer}</p>
              <small>{demo.scenario.questionnairePreview.reviewNote}</small>
            </div>
          ) : null}
        </article>
      </section>

      <section id="scan-consent" className="customer-conversion-grid" aria-label="Consent and pilot request">
        <article className="customer-consent-panel">
          <div className="customer-panel-heading">
            <div>
              <p className="eyebrow">Consent wizard</p>
              <h2>{demo.scenario.consentWizard.title}</h2>
            </div>
            <ShieldCheck size={24} aria-hidden="true" />
          </div>
          <div className="customer-consent-steps">
            {demo.scenario.consentWizard.steps.map((step, index) => (
              <div key={step.label}>
                <span>{index + 1}</span>
                <div>
                  <strong>{step.label}</strong>
                  <p>{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="customer-consent-template">
            <button type="button" className="customer-inline-button" onClick={prepareConsentPacket}>
              <FileCheck2 size={16} aria-hidden="true" />
              Prepare my consent packet
            </button>
            <small>Template only. Signed consent stays private and must be registered before live Workspace access.</small>
            {consentError ? <p className="customer-form-error">{consentError}</p> : null}
            {consentPacket ? (
              <div className="customer-consent-download" role="status">
                <strong>{consentPacket.packetTitle}</strong>
                <p>{consentPacket.scopeSummary}</p>
                <ul className="customer-compact-list">
                  {consentPacket.nextSteps.slice(0, 3).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <a
                  className="customer-download-link"
                  href={`data:text/markdown;charset=utf-8,${encodeURIComponent(consentPacket.exportText)}`}
                  download="sme-workspace-sentinel-consent-packet-template.md"
                  onClick={() => trackCustomerEvent("consent_packet_downloaded", { source: "consent_panel" })}
                >
                  <Download size={16} aria-hidden="true" />
                  Download consent packet
                </a>
              </div>
            ) : null}
          </div>
        </article>

        <article id="pilot-lead-form" className="customer-lead-panel">
          <div className="customer-panel-heading">
            <div>
              <p className="eyebrow">Pilot request</p>
              <h2>{demo.scenario.leadCapture.headline}</h2>
            </div>
            <Mail size={24} aria-hidden="true" />
          </div>
          <p>{demo.scenario.leadCapture.description}</p>
          <form className="customer-lead-form" onSubmit={submitLead}>
            <label className="customer-field">
              <span>Name</span>
              <input
                value={leadForm.name}
                onChange={(event) => setLeadForm({ ...leadForm, name: event.target.value })}
                placeholder="Your name"
              />
            </label>
            <label className="customer-field">
              <span>Work email</span>
              <input
                required
                type="email"
                value={leadForm.workEmail}
                onChange={(event) => setLeadForm({ ...leadForm, workEmail: event.target.value })}
                placeholder="name@company.com"
              />
            </label>
            <label className="customer-field">
              <span>Company</span>
              <input
                value={leadForm.company}
                onChange={(event) => setLeadForm({ ...leadForm, company: event.target.value })}
                placeholder="Company"
              />
            </label>
            <label className="customer-field">
              <span>Buyer deadline</span>
              <select
                value={leadForm.buyerDeadline}
                onChange={(event) => setLeadForm({ ...leadForm, buyerDeadline: event.target.value })}
              >
                <option>This week</option>
                <option>This month</option>
                <option>This quarter</option>
                <option>No deadline yet</option>
              </select>
            </label>
            <label className="customer-field customer-field-wide">
              <span>Pilot goal</span>
              <textarea
                value={leadForm.pilotGoal}
                onChange={(event) => setLeadForm({ ...leadForm, pilotGoal: event.target.value })}
                rows={3}
              />
            </label>
            <button type="submit">
              <CalendarCheck2 size={18} aria-hidden="true" />
              Request my pilot scope
            </button>
          </form>
          <small>{demo.scenario.leadCapture.privacyNote}</small>
          {leadError ? <p className="customer-form-error">{leadError}</p> : null}
          {leadReceipt ? (
            <div className="customer-lead-success" role="status">
              <strong>Scope request ready for {leadReceipt.customerAlias}</strong>
              <p>
                Contact captured as {leadReceipt.redactedContact}. Connect the approved lead destination before using
                this as durable CRM evidence.
              </p>
              <ul className="customer-compact-list">
                {leadReceipt.nextSteps.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </article>

        <article className="customer-faq-panel">
          <p className="eyebrow">Before you book</p>
          <h2>Common buyer questions</h2>
          <div className="customer-faq-list">
            {demo.scenario.faq.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </article>
      </section>

      <section className="customer-copilot-band">
        <div>
          <p className="eyebrow">Evidence Copilot</p>
          <h2>{demo.scenario.copilotPrompt}</h2>
          <p>{demo.scenario.copilotAnswer}</p>
        </div>
        <div className="customer-citation-card">
          <span>Example citations</span>
          <strong>Scan scope · Redacted finding · Approval record · Trust Packet preview</strong>
        </div>
      </section>

      <section className="customer-feature-sequence" aria-label="Top 20 customer showcase features">
        <div className="customer-section-heading">
          <p className="eyebrow">Talk track sequence</p>
          <h2>Top 20 points to show in order</h2>
        </div>
        <div className="customer-feature-list">
          {demo.features.map((feature) => (
            <article key={feature.rank}>
              <span>{feature.rank}</span>
              <div>
                <h3>{feature.feature}</h3>
                <p>{feature.talkTrack}</p>
                <small>{feature.whyShowcase}</small>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="pilot-next-step" className="customer-pilot-panel">
        <div>
          <p className="eyebrow">Next step</p>
          <h2>{demo.scenario.pilotCta.headline}</h2>
          <p>
            The pilot stays narrow: consent first. We scan approved sources, review staged recommendations, and export
            buyer-ready evidence.
          </p>
          <small>{demo.scenario.pilotCta.optimizationNote}</small>
        </div>
        <div className="customer-pilot-actions">
          <ul className="customer-compact-list">
            {demo.scenario.pilotCta.checklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="customer-follow-up-plan">
            <span>Lead follow-up</span>
            <ul className="customer-compact-list">
              {demo.scenario.pilotCta.followUpPlan.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
