"use client";

import { ArrowRight, CheckCircle2, FileCheck2, FileQuestion, LockKeyhole, SearchCheck, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { CustomerDemoFeature, CustomerDemoScenario, CustomerDemoStep } from "@/lib/customer-demo";

type DemoStage = "ready" | "running";

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
  const active = demo.steps.find((step) => step.id === activeStep) ?? demo.steps[0];
  const started = stage === "running";

  function startDemo() {
    setStage("running");
    setActiveStep("scan");
  }

  return (
    <main className="customer-demo-shell">
      <section className="customer-hero">
        <div>
          <p className="eyebrow">Customer demo mode</p>
          <h1>One-day Google Workspace risk scan for buyer-ready trust evidence.</h1>
          <p className="customer-hero-copy">
            Built for {demo.scenario.customerSegment} The demo shows one sample exposure moving from detection to
            human-approved action, redacted Trust Packet, questionnaire answer, and fixed-scope paid pilot.
          </p>
          <div className="customer-cta-row">
            <button type="button" onClick={startDemo}>
              <SearchCheck size={18} aria-hidden="true" />
              Start sample demo
            </button>
            <a className="customer-secondary-link" href="#pilot-next-step">
              View pilot next step
              <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
        </div>
        <aside className="customer-offer-panel" aria-label="Pilot offer">
          <span>Fixed-scope pilot</span>
          <strong>{demo.scenario.offer}</strong>
          <p>{demo.scenario.sampleDataNotice}</p>
        </aside>
      </section>

      <section className="customer-stage-tabs" aria-label="Customer demo sequence">
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
        </article>
      </section>

      <section className="customer-outcome-grid" aria-label="Demo outputs">
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
        </article>

        <article>
          <div className="customer-panel-heading">
            <h2>Questionnaire answer</h2>
            <FileQuestion size={22} aria-hidden="true" />
          </div>
          <strong>{demo.scenario.questionnairePreview.question}</strong>
          <p>{demo.scenario.questionnairePreview.answer}</p>
          <small>{demo.scenario.questionnairePreview.reviewNote}</small>
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
            The pilot stays narrow: consent first, scan only approved sources, review staged recommendations, and export
            buyer-ready evidence.
          </p>
        </div>
        <ul className="customer-compact-list">
          {demo.scenario.pilotCta.checklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
