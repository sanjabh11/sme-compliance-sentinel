import { describe, expect, it } from "vitest";
import { buildPilotProspectPipeline, normalizePilotProspectInput } from "@/lib/prospect-pipeline";
import { getDashboardSnapshot, recordPilotProspect, resetState } from "@/lib/store";
import { scanClaimText } from "@/lib/claim-guard";

describe("paid pilot prospect pipeline", () => {
  it("surfaces high-fit prospects without treating pipeline as revenue proof", () => {
    resetState();

    const pipeline = buildPilotProspectPipeline(getDashboardSnapshot());
    const outreachCopy = pipeline.outreachSequence
      .map((step) => [step.subject, step.body, step.claimBoundary].join("\n"))
      .join("\n");

    expect(pipeline.offer).toContain("$199 one-day Google Workspace risk scan");
    expect(pipeline.summary.highFit).toBeGreaterThanOrEqual(3);
    expect(pipeline.summary.proposedPilots).toBeGreaterThanOrEqual(1);
    expect(pipeline.summary.estimatedPipelineMrrUsd).toBeGreaterThan(0);
    expect(pipeline.blockers.join(" ")).toContain("production");
    expect(pipeline.disclaimer).toContain("not revenue proof");
    expect(pipeline.outreachSequence.every((step) => step.proofAttachments.length > 0)).toBe(true);
    expect(scanClaimText({ artifact: "pilot-prospect-outreach", text: outreachCopy })).toEqual([]);
  });

  it("records a prospect stage change and logs the conversion workflow", () => {
    resetState();

    const { prospect, snapshot } = recordPilotProspect({
      prospectAlias: "Redacted live pilot candidate",
      segment: "Seed-stage SaaS preparing a customer security review",
      source: "referral",
      stage: "pilot-started",
      fitScore: 95,
      estimatedMrrUsd: 299,
      evidenceNeeded: ["Invoice/payment proof", "Active-user proof", "Workspace OAuth install proof"]
    });

    expect(prospect.stage).toBe("pilot-started");
    expect(snapshot.pilotProspects[0].id).toBe(prospect.id);
    expect(snapshot.readiness.pilotProspectPipeline.summary.convertedPilots).toBeGreaterThanOrEqual(1);
    expect(snapshot.readiness.pilotProspectPipeline.summary.estimatedPipelineMrrUsd).toBeGreaterThanOrEqual(299);
    expect(snapshot.auditEvents.some((event) => event.type === "pilot_prospect_recorded" && event.targetId === prospect.id)).toBe(true);
    expect(snapshot.scoreHistory[0].reason).toBe("pilot_prospect_recorded");
  });

  it("normalizes prospect inputs with bounded fit score and default evidence needs", () => {
    const prospect = normalizePilotProspectInput({
      prospectAlias: "Redacted target",
      segment: "Founder-led services team",
      source: "manual",
      stage: "targeted",
      fitScore: 180
    });

    expect(prospect.fitScore).toBe(100);
    expect(prospect.evidenceNeeded).toContain("Pilot consent");
    expect(prospect.nextAction).toContain("day-zero outreach");
  });
});
