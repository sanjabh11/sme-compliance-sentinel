import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type LocalSubmissionReport = {
  overallStatus: "passed" | "warning" | "blocked";
  privateRoot: string;
  summary: {
    passed: number;
    warning: number;
    blocked: number;
    externalRequired: number;
  };
  gates: Array<{
    id: string;
    command: string;
    rawStatus: string;
    status: "passed" | "warning" | "blocked";
    externalRequired: boolean;
    evidence: string;
    blockers: string[];
    nextActions: string[];
  }>;
  remainingBlockers: string[];
  nextActions: string[];
  phasePlan: {
    objective: string;
    confidenceBoundary: string;
    sourceGateStatus: string;
    recommendedNextPhaseId: string;
    recommendedNextCodeControllablePhaseId: string;
    recommendedNextCodeControllableAction: {
      phaseId: string;
      label: string;
      bucket: "code-controllable" | "external-proof" | "human-attestation";
      owner: string;
      priority: number;
      status: string;
      action: string;
      actionDetails?: Array<{
        key: string;
        owner: string;
        status: string;
        source: string;
        derivationHint?: string;
        fix: string;
        acceptedProof: string;
      }>;
      commands: string[];
      privateArtifactPaths: string[];
      stopCondition: string;
      proofBoundary: string;
    };
    phases: Array<{
      id: string;
      label: string;
      bucket: "code-controllable" | "external-proof" | "human-attestation";
      priority: number;
      owner: string;
      status: string;
      currentPhaseRemainingPercent: number;
      relatedGateIds: string[];
      commands: string[];
      evidenceNeeded: string[];
      stopConditions: string[];
    }>;
  };
  phaseProgressChart: {
    generatedFrom: string;
    scale: string;
    overallGoalRemainingPercent: number;
    overallGoalRemainingBasis: string;
    rows: Array<{
      phaseId: string;
      label: string;
      bucket: "code-controllable" | "external-proof" | "human-attestation";
      owner: string;
      priority: number;
      status: string;
      ratingOutOf5: number;
      currentPhaseRemainingPercent: number;
      overallGoalRemainingPercent: number;
      done: string[];
      pending: string[];
      successCheckpoints: string[];
      stopConditions: string[];
      checkpointCounts: {
        total: number;
        done: number;
        partial: number;
        pending: number;
        blocked: number;
        "external-required": number;
      };
      progressBasis: string;
      evidence: string;
    }>;
  };
  manualInterventionPlan: {
    generatedFrom: string;
    status: "manual-intervention-required" | "no-open-interventions";
    confidenceBoundary: string;
    summary: {
      total: number;
      byBucket: Record<string, number>;
      byOwner: Record<string, number>;
      byStatus: Record<string, number>;
      highestPriority: number;
    };
    nextOwner: string;
    phaseFocusPlan: {
      generatedFrom: string;
      confidenceBoundary: string;
      rows: Array<{
        phaseId: string;
        label: string;
        bucket: "code-controllable" | "external-proof" | "human-attestation";
        owner: string;
        priority: number;
        status: string;
        ratingOutOf5: number;
        currentPhaseRemainingPercent: number;
        overallGoalRemainingPercent: number;
        currentFocus: string;
        done: string[];
        pending: string[];
        successChecklist: string[];
        bestPracticeNotes: string[];
        ownerActions: Array<{
          owner: string;
          status: string;
          action: string;
          privateArtifactPaths: string[];
        }>;
        stopCondition: string;
        proofBoundary: string;
      }>;
    };
    ownerPackets: Array<{
      owner: string;
      openActionCount: number;
      buckets: Record<string, number>;
      highestPriority: number;
      nextAction: string;
      privateArtifactPaths: string[];
      rows: Array<{
        id: string;
        phaseId: string;
        bucket: "code-controllable" | "external-proof" | "human-attestation";
        owner: string;
        action: string;
        privateArtifactPaths: string[];
        actionDetails?: Array<{
          key: string;
          owner: string;
          status: string;
          source: string;
          derivationHint?: string;
          fix: string;
          acceptedProof: string;
        }>;
        checklist?: string[];
        proofBoundary: string;
      }>;
    }>;
    actionRows: Array<{
      id: string;
      phaseId: string;
      phaseLabel: string;
      bucket: "code-controllable" | "external-proof" | "human-attestation";
      owner: string;
      priority: number;
      phaseRatingOutOf5: number;
      currentPhaseRemainingPercent: number;
      overallGoalRemainingPercent: number;
      source: string;
      status: string;
      action: string;
      actionDetails?: Array<{
        key: string;
        owner: string;
        status: string;
        source: string;
        derivationHint?: string;
        fix: string;
        acceptedProof: string;
      }>;
      evidenceNeeded: string;
      commands: string[];
      privateArtifactPaths: string[];
      checklist?: string[];
      stopCondition: string;
      proofBoundary: string;
    }>;
    packetFiles?: {
      indexPath: string;
      manifestPath: string;
      digestAlgorithm: string;
      packetFileCount: number;
      ownerPacketPaths: Array<{
        owner: string;
        path: string;
        actionCount: number;
        sha256: string;
        bytes: number;
      }>;
      proofBoundary: string;
    };
    bestPracticeSourceUrls: string[];
    stopConditions: string[];
    privateHandling: string[];
  };
  stopConditions: string[];
  sourceUrls: string[];
  disclaimer: string;
  markdownSummaryPath?: string;
  localSubmissionBundle?: {
    directory: string;
    status: "ready-for-private-owner-review" | "blocked";
    reportPath: string;
    markdownSummaryPath: string;
    manualPacketsDir: string;
    manifestPath: string;
    manifestVerificationPath: string;
    bundleManifestPath: string;
    digestAlgorithm: string;
    fileCount: number;
    proofBoundary: string;
  };
};

type ManualManifestVerificationReport = {
  overallStatus: "verified" | "blocked";
  generatedFrom: string;
  manifestPath: string;
  digestAlgorithm: string;
  summary: {
    passed: number;
    blocked: number;
    fileCount: number;
  };
  checks: Array<{ id: string; status: "passed" | "blocked"; evidence: string }>;
  blockers: string[];
  proofBoundary: string;
  stopConditions: string[];
};

type LocalBundleVerificationReport = {
  overallStatus: "verified" | "blocked";
  generatedFrom: string;
  manifestPath: string;
  digestAlgorithm: string;
  summary: {
    passed: number;
    blocked: number;
    fileCount: number;
  };
  checks: Array<{ id: string; status: "passed" | "blocked"; evidence: string }>;
  blockers: string[];
  proofBoundary: string;
  stopConditions: string[];
};

const localSubmissionEnv = {
  ...process.env,
  XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED: "false",
  XPRIZE_THIRD_PARTY_REVIEW_APPROVED: "false",
  XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED: "false",
  XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED: "false",
  VERCEL_PROJECT_ID: "prj_test",
  VERCEL_ORG_ID: "team_test"
};

describe("local XPRIZE submission verifier", () => {
  it("aggregates local source, provenance, license, and deployment gates without claiming external proof", () => {
    const report = runVerifier();
    const gatesById = Object.fromEntries(report.gates.map((gate) => [gate.id, gate]));

    expect(report.overallStatus).toBe("blocked");
    expect(report.summary.blocked).toBeGreaterThanOrEqual(1);
    expect(report.summary.warning).toBeGreaterThanOrEqual(2);
    expect(report.summary.externalRequired).toBeGreaterThanOrEqual(5);
    expect(Object.keys(gatesById)).toEqual(
      expect.arrayContaining([
        "source-release",
        "project-provenance",
        "license-ip-review",
        "customer-demo-deployment-lineage",
        "cloudrun-deployment-template",
        "judge-access-readiness",
        "business-evidence-readiness"
      ])
    );
    expect(["published", "ready-to-commit"]).toContain(gatesById["source-release"].rawStatus);
    expect(["passed", "warning"]).toContain(gatesById["source-release"].status);
    expect(gatesById["source-release"].externalRequired).toBe(false);
    expect(gatesById["project-provenance"]).toMatchObject({
      rawStatus: "blocked",
      status: "blocked",
      externalRequired: true
    });
    expect(gatesById["project-provenance"].evidence).toContain("project-created-after-start attestation false");
    expect(gatesById["license-ip-review"]).toMatchObject({
      rawStatus: "warning",
      status: "warning",
      externalRequired: true
    });
    expect(gatesById["cloudrun-deployment-template"]).toMatchObject({
      rawStatus: "template-needs-values",
      status: "warning",
      externalRequired: true
    });
    expect(gatesById["customer-demo-deployment-lineage"]).toMatchObject({
      rawStatus: "blocked",
      status: "blocked",
      externalRequired: true
    });
    expect(gatesById["customer-demo-deployment-lineage"].evidence).toContain("Product URL");
    expect(gatesById["judge-access-readiness"]).toMatchObject({
      rawStatus: "blocked",
      status: "blocked",
      externalRequired: true
    });
    expect(gatesById["judge-access-readiness"].evidence).toContain("Product URL");
    expect(gatesById["business-evidence-readiness"]).toMatchObject({
      rawStatus: "blocked",
      status: "blocked",
      externalRequired: true
    });
    expect(gatesById["business-evidence-readiness"].evidence).toContain("Revenue");
    expect(report.remainingBlockers.join(" ")).toContain("human-attestation");
    expect(report.nextActions.join(" ")).toContain("XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED");
    expect(report.phasePlan.recommendedNextPhaseId).toBe("human-attestation-review");
    expect(report.phasePlan.recommendedNextCodeControllablePhaseId).toBe("cloudrun-render-dry-run");
    expect(report.phasePlan.recommendedNextCodeControllableAction).toMatchObject({
      phaseId: "cloudrun-render-dry-run",
      bucket: "code-controllable",
      owner: "engineering",
      priority: 5
    });
    expect(report.phasePlan.recommendedNextCodeControllableAction.action).toContain("release-prefilled private Cloud Run render-values file");
    expect(report.phasePlan.recommendedNextCodeControllableAction.action).toContain("Prepare and verify");
    expect(report.phasePlan.recommendedNextCodeControllableAction.action).toContain("remaining non-secret production values");
    expect(report.phasePlan.recommendedNextCodeControllableAction.action).toContain("verify the render-evidence owner packet");
    expect(report.phasePlan.recommendedNextCodeControllableAction.action).toContain("operator handoff");
    expect(report.phasePlan.recommendedNextCodeControllableAction.commands.join(" ")).toContain(
      "prepare:cloudrun-render-handoff"
    );
    expect(report.phasePlan.recommendedNextCodeControllableAction.commands.join(" ")).toContain(
      "verify:cloudrun-render-handoff"
    );
    expect(report.phasePlan.recommendedNextCodeControllableAction.commands.join(" ")).toContain("audit:cloudrun-values");
    expect(report.phasePlan.recommendedNextCodeControllableAction.commands.join(" ")).toContain(
      "verify:cloudrun-render-evidence"
    );
    expect(
      report.phasePlan.recommendedNextCodeControllableAction.commands.findIndex((command) =>
        command.includes("prepare:cloudrun-render-handoff")
      )
    ).toBeLessThan(
      report.phasePlan.recommendedNextCodeControllableAction.commands.findIndex((command) =>
        command.includes("verify:cloudrun-render-handoff")
      )
    );
    expect(
      report.phasePlan.recommendedNextCodeControllableAction.commands.findIndex((command) =>
        command.includes("verify:cloudrun-render-handoff")
      )
    ).toBeLessThan(
      report.phasePlan.recommendedNextCodeControllableAction.commands.findIndex((command) =>
        command.includes("audit:cloudrun-values")
      )
    );
    expect(
      report.phasePlan.recommendedNextCodeControllableAction.commands.findIndex((command) =>
        command.includes("audit:cloudrun-values")
      )
    ).toBeLessThan(
      report.phasePlan.recommendedNextCodeControllableAction.commands.findIndex((command) =>
        command.includes("verify:cloudrun-render-evidence")
      )
    );
    expect(
      report.phasePlan.recommendedNextCodeControllableAction.commands.findIndex((command) =>
        command.includes("verify:cloudrun-render-evidence")
      )
    ).toBeLessThan(
      report.phasePlan.recommendedNextCodeControllableAction.commands.findIndex((command) =>
        command.includes("render:cloudrun-manifest")
      )
    );
    expect(report.phasePlan.recommendedNextCodeControllableAction.privateArtifactPaths).toContain(
      "/secure/local/cloudrun-render-values.json"
    );
    expect(report.phasePlan.recommendedNextCodeControllableAction.privateArtifactPaths).toEqual(
      expect.arrayContaining([
        "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-handoff.json",
        "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-handoff.md",
        "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-handoff-verifier.json",
        "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-values-audit.json",
        "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-evidence-packet-verifier.json",
        "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-dry-run-preflight-packet.json",
        "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-dry-run-packet-verifier.json"
      ])
    );
    expect(report.phasePlan.recommendedNextCodeControllableAction.proofBoundary).toContain("Code-controllable preparation only");
    expect(report.phasePlan.phases.map((phase) => phase.id)).toContain("customer-demo-deployment");
    expect(report.phasePlan.confidenceBoundary).toContain("not a win-probability estimate");
    expect(report.phasePlan.sourceGateStatus).toMatch(/passed|warning/);
    expect(report.manualInterventionPlan.status).toBe("manual-intervention-required");
    expect(report.manualInterventionPlan.generatedFrom).toBe("verify-local-submission");
    expect(report.manualInterventionPlan.confidenceBoundary).toContain("not proof");
    expect(report.manualInterventionPlan.summary.total).toBeGreaterThan(0);
    expect(report.manualInterventionPlan.summary.byBucket["human-attestation"]).toBeGreaterThan(0);
    expect(report.manualInterventionPlan.summary.byBucket["external-proof"]).toBeGreaterThan(0);
    expect(report.manualInterventionPlan.summary.byOwner["founder/legal"]).toBeGreaterThan(0);
    expect(report.manualInterventionPlan.summary.highestPriority).toBe(5);
    expect(report.manualInterventionPlan.nextOwner).not.toBe("none");
    expect(report.manualInterventionPlan.phaseFocusPlan.generatedFrom).toBe("verify-local-submission");
    expect(report.manualInterventionPlan.phaseFocusPlan.confidenceBoundary).toContain("not win probability");
    expect(report.manualInterventionPlan.phaseFocusPlan.rows.map((row) => row.phaseId)).toEqual(report.phasePlan.phases.map((phase) => phase.id));
    expect(report.manualInterventionPlan.phaseFocusPlan.rows.every((row) => row.ratingOutOf5 >= 1 && row.ratingOutOf5 <= 5)).toBe(true);
    expect(report.manualInterventionPlan.phaseFocusPlan.rows.every((row) => row.successChecklist.length > 0)).toBe(true);
    expect(report.manualInterventionPlan.phaseFocusPlan.rows.every((row) => row.bestPracticeNotes.length > 0)).toBe(true);
    expect(
      report.manualInterventionPlan.phaseFocusPlan.rows
        .find((row) => row.phaseId === "cloudrun-render-dry-run")
        ?.successChecklist.join(" ")
    ).toContain("Secret Manager");
    expect(report.manualInterventionPlan.bestPracticeSourceUrls).toEqual(
      expect.arrayContaining([
        "https://docs.cloud.google.com/run/docs/configuring/services/secrets",
        "https://docs.cloud.google.com/run/docs/securing/service-identity",
        "https://docs.cloud.google.com/nat/docs/nat-product-interactions",
        "https://docs.cloud.google.com/docs/authentication/api-keys"
      ])
    );
    expect(
      report.manualInterventionPlan.phaseFocusPlan.rows
        .find((row) => row.phaseId === "cloudrun-render-dry-run")
        ?.bestPracticeNotes.join(" ")
    ).toContain("Private Google Access");
    expect(report.phasePlan.phases.map((phase) => phase.id)).toEqual([
      "human-attestation-review",
      "cloudrun-render-dry-run",
      "hosted-proof-capture",
      "customer-demo-deployment",
      "business-traction-proof"
    ]);
    expect(report.phasePlan.phases.every((phase) => phase.priority >= 1 && phase.priority <= 5)).toBe(true);
    expect(report.phaseProgressChart.generatedFrom).toBe("verify-local-submission");
    expect(report.phaseProgressChart.scale).toContain("1=blocked");
    expect(report.phaseProgressChart.overallGoalRemainingBasis).toContain("phase-specific evidence-gate");
    expect(report.phaseProgressChart.rows.map((row) => row.phaseId)).toEqual(report.phasePlan.phases.map((phase) => phase.id));
    expect(report.phaseProgressChart.rows.every((row) => row.ratingOutOf5 >= 1 && row.ratingOutOf5 <= 5)).toBe(true);
    expect(report.phaseProgressChart.rows.every((row) => row.overallGoalRemainingPercent === report.phaseProgressChart.overallGoalRemainingPercent)).toBe(true);
    expect(report.phaseProgressChart.rows.every((row) => row.progressBasis.includes("not a win-probability estimate"))).toBe(true);
    expect(report.phaseProgressChart.rows.find((row) => row.phaseId === "human-attestation-review")).toMatchObject({
      bucket: "human-attestation",
      ratingOutOf5: 1
    });
    expect(
      report.phaseProgressChart.rows.find((row) => row.phaseId === "human-attestation-review")?.currentPhaseRemainingPercent
    ).toBeGreaterThan(0);
    expect(report.phaseProgressChart.rows.find((row) => row.phaseId === "cloudrun-render-dry-run")).toMatchObject({
      bucket: "code-controllable",
      ratingOutOf5: 2
    });
    expect(
      report.phaseProgressChart.rows.find((row) => row.phaseId === "cloudrun-render-dry-run")?.currentPhaseRemainingPercent
    ).toBeGreaterThan(0);
    expect(report.phaseProgressChart.rows.find((row) => row.phaseId === "hosted-proof-capture")).toMatchObject({
      bucket: "external-proof",
      ratingOutOf5: 1
    });
    expect(report.manualInterventionPlan.stopConditions.join(" ")).toContain("Do not set manual XPRIZE");
    expect(report.manualInterventionPlan.privateHandling.join(" ")).toContain("/secure/local");
    expect(report.stopConditions.join(" ")).toContain("does not deploy Cloud Run");
    expect(report.stopConditions.join(" ")).toContain("does not prove live Gemini API usage");
    expect(report.disclaimer).toContain("not legal advice");
    expect(report.sourceUrls).toEqual(
      expect.arrayContaining(["https://xprize.devpost.com/rules", "https://www.geminixprize.com/rules"])
    );
  });

  it("writes a private JSON packet and fails strict mode while blockers remain", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-local-submission-"));
    const outPath = join(tempDir, "local-submission-readiness.json");

    try {
      const report = runVerifier(["--out", outPath]);

      expect(readFileSync(outPath, "utf8")).toContain('"overallStatus": "blocked"');
      expect(report.gates.map((gate) => gate.id)).toContain("license-ip-review");
      expect(readdirSync(tempDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
      expect(() => runVerifier(["--strict"])).toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("replaces existing private JSON and Markdown outputs without stale bytes or temp leftovers", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-local-submission-existing-output-"));
    const outPath = join(tempDir, "local-submission-readiness.json");
    const markdownPath = join(tempDir, "local-submission-summary.md");

    try {
      writeFileSync(outPath, `{"overallStatus":"stale","padding":"${"x".repeat(1000)}"}\n`, "utf8");
      writeFileSync(markdownPath, `# Stale\n\n${"y".repeat(1000)}\n`, "utf8");

      const report = runVerifier(["--out", outPath, "--markdown-out", markdownPath]);
      const outJson = readFileSync(outPath, "utf8");
      const markdown = readFileSync(markdownPath, "utf8");

      expect(report.overallStatus).toBe("blocked");
      expect(JSON.parse(outJson)).toHaveProperty("phaseProgressChart");
      expect(markdown).toContain("# Local Submission Readiness Summary");
      expect(outJson).not.toContain('"overallStatus":"stale"');
      expect(`${outJson}${markdown}`).not.toContain("padding");
      expect(`${outJson}${markdown}`).not.toContain("# Stale");
      expect(readdirSync(tempDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("writes private owner-routed Markdown manual intervention packets", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-manual-packets-"));

    try {
      const report = runVerifier(["--manual-packets-dir", tempDir]);
      const indexMarkdown = readFileSync(join(tempDir, "manual-intervention-index.md"), "utf8");
      const engineeringMarkdown = readFileSync(join(tempDir, "engineering.md"), "utf8");
      const founderLegalMarkdown = readFileSync(join(tempDir, "founder-legal.md"), "utf8");
      const founderSalesMarkdown = readFileSync(join(tempDir, "founder-sales.md"), "utf8");
      const manifest = JSON.parse(readFileSync(join(tempDir, "manual-intervention-manifest.json"), "utf8")) as {
        status: string;
        digestAlgorithm: string;
        proofBoundary: string;
        phaseFocusPlan?: {
          rows: Array<{ phaseId: string; successChecklist: string[]; bestPracticeNotes: string[] }>;
        };
        bestPracticeSourceUrls?: string[];
        files: Array<{ owner: string; path: string; sha256: string; bytes: number; actionCount: number }>;
      };

      expect(report.manualInterventionPlan.packetFiles?.proofBoundary).toContain("private execution aids only");
      expect(report.manualInterventionPlan.packetFiles?.manifestPath).toBe(join(tempDir, "manual-intervention-manifest.json"));
      expect(report.manualInterventionPlan.packetFiles?.digestAlgorithm).toBe("sha256");
      expect(report.manualInterventionPlan.packetFiles?.packetFileCount).toBe(4);
      expect(report.manualInterventionPlan.packetFiles?.ownerPacketPaths.map((file) => file.owner)).toEqual(
        expect.arrayContaining(["engineering", "founder/legal", "founder/sales"])
      );
      expect(report.manualInterventionPlan.packetFiles?.ownerPacketPaths.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256))).toBe(true);
      expect(report.manualInterventionPlan.packetFiles?.ownerPacketPaths.every((file) => file.bytes > 0)).toBe(true);
      expect(manifest.status).toBe("manual-intervention-required");
      expect(manifest.digestAlgorithm).toBe("sha256");
      expect(manifest.proofBoundary).toContain("private packet integrity only");
      expect(manifest.phaseFocusPlan?.rows.map((row) => row.phaseId)).toEqual(
        expect.arrayContaining(["human-attestation-review", "cloudrun-render-dry-run", "hosted-proof-capture", "business-traction-proof"])
      );
      expect(manifest.phaseFocusPlan?.rows.every((row) => row.successChecklist.length > 0 && row.bestPracticeNotes.length > 0)).toBe(true);
      expect(manifest.bestPracticeSourceUrls).toEqual(
        expect.arrayContaining(["https://docs.cloud.google.com/run/docs/configuring/services/secrets"])
      );
      expect(manifest.files.map((file) => file.owner)).toEqual(expect.arrayContaining(["index", "engineering", "founder/legal", "founder/sales"]));
      expect(manifest.files.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256))).toBe(true);
      expect(manifest.files.every((file) => file.bytes > 0 && file.path.startsWith(tempDir))).toBe(true);
      expect(indexMarkdown).toContain("# Manual Intervention Plan");
      expect(indexMarkdown).toContain("These packets are step-by-step instructions only");
      expect(indexMarkdown).toContain("## Phase Focus Plan");
      expect(indexMarkdown).toContain("Success checklist");
      expect(indexMarkdown).toContain("## Best-Practice Sources");
      expect(indexMarkdown).toContain("founder/legal");
      expect(engineeringMarkdown).toContain("# Manual Intervention Packet: engineering");
      expect(engineeringMarkdown).toContain("## Phase Focus Context");
      expect(engineeringMarkdown).toContain("Best-practice notes");
      expect(engineeringMarkdown).toContain("user-managed service account");
      expect(engineeringMarkdown).toContain("Private Google Access");
      expect(engineeringMarkdown).toContain("## Step-by-step Actions");
      expect(engineeringMarkdown).toContain("Cloud Run");
      expect(engineeringMarkdown).toContain("/secure/local/cloudrun-render-values.json");
      expect(engineeringMarkdown).toContain("Checklist:");
      expect(engineeringMarkdown).toContain("Fill only non-secret production values");
      expect(engineeringMarkdown).toContain("stop on the first blocker before any gcloud dry-run");
      expect(founderLegalMarkdown).toContain("XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED");
      expect(founderLegalMarkdown).toContain("human review");
      expect(founderSalesMarkdown).toContain("invoice/payment");
      expect(founderSalesMarkdown).toContain("/secure/local/business-evidence.json");
      expect([indexMarkdown, engineeringMarkdown, founderLegalMarkdown, founderSalesMarkdown].join("\n")).not.toContain("Bearer ");
      expect([indexMarkdown, engineeringMarkdown, founderLegalMarkdown, founderSalesMarkdown].join("\n")).not.toContain("password:");
      expect(readdirSync(tempDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("writes a concise private Markdown readiness summary with phase ratings and owner actions", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-local-summary-"));
    const markdownPath = join(tempDir, "local-submission-summary.md");

    try {
      const report = runVerifier(["--markdown-out", markdownPath]);
      const markdown = readFileSync(markdownPath, "utf8");

      expect(report.markdownSummaryPath).toBe(markdownPath);
      expect(markdown).toContain("# Local Submission Readiness Summary");
      expect(markdown).toContain("Overall goal remaining:");
      expect(markdown).toContain("## Gate Summary");
      expect(markdown).toContain("## Phase Progress Chart");
      expect(markdown).toContain("## Phase Focus Checklist");
      expect(markdown).toContain("## Operational Best-Practice Sources");
      expect(markdown).toContain("## Next Code-Controllable Action");
      expect(markdown).toContain("Prepare and verify the Cloud Run render handoff");
      expect(markdown).toContain("Secret Manager");
      expect(markdown).toContain("user-managed service account");
      expect(markdown).toContain("Private Google Access");
      expect(markdown).toContain("## Manual Intervention Owners");
      expect(markdown).toContain("Rating");
      expect(markdown).toContain("Phase remaining");
      expect(markdown).toContain("Overall remaining");
      expect(markdown).toContain("Human attestation and disclosure review");
      expect(markdown).toContain("Cloud Run render and dry-run preflight");
      expect(markdown).toContain("Hosted Cloud Run and Gemini proof capture");
      expect(markdown).toContain("Paid pilot, user, revenue, and judge-access proof");
      expect(markdown).toContain("not a win-probability estimate");
      expect(markdown).toContain("private execution aid only");
      expect(markdown).toContain("prepare:submission-summary");
      expect(markdown).toContain("prepare:manual-intervention");
      expect(markdown).toContain("verify:manual-intervention");
      expect(markdown).not.toContain("Bearer ");
      expect(markdown).not.toContain("password:");
      expect(readdirSync(tempDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("fails closed when a private local-submission output parent is a user-created symlink", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-local-submission-symlink-parent-"));
    const realOutputDir = join(tempDir, "real-output");
    const linkedOutputDir = join(tempDir, "linked-output");
    const outPath = join(linkedOutputDir, "local-submission-readiness.json");
    const realTargetPath = join(realOutputDir, "local-submission-readiness.json");

    try {
      mkdirSync(realOutputDir);
      symlinkSync(realOutputDir, linkedOutputDir, "dir");

      expect(() => runVerifier(["--out", outPath])).toThrow(/symbolic link/u);
      expect(existsSync(realTargetPath)).toBe(false);
      expect(readdirSync(realOutputDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("fails closed when manual-intervention packet output directory is a user-created symlink", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-manual-packets-symlink-parent-"));
    const realOutputDir = join(tempDir, "real-output");
    const linkedOutputDir = join(tempDir, "linked-output");

    try {
      mkdirSync(realOutputDir);
      symlinkSync(realOutputDir, linkedOutputDir, "dir");

      expect(() => runVerifier(["--manual-packets-dir", linkedOutputDir])).toThrow(/symbolic link/u);
      expect(existsSync(join(realOutputDir, "manual-intervention-index.md"))).toBe(false);
      expect(existsSync(join(realOutputDir, "manual-intervention-manifest.json"))).toBe(false);
      expect(readdirSync(realOutputDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("writes a private local-submission bundle with verified owner packets", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-local-bundle-"));

    try {
      const report = runVerifier(["--bundle-dir", tempDir]);
      const bundle = report.localSubmissionBundle;

      expect(bundle).toMatchObject({
        directory: tempDir,
        status: "ready-for-private-owner-review",
        reportPath: join(tempDir, "local-submission-readiness.json"),
        markdownSummaryPath: join(tempDir, "local-submission-summary.md"),
        manualPacketsDir: join(tempDir, "manual-intervention-packets"),
        manifestPath: join(tempDir, "manual-intervention-packets", "manual-intervention-manifest.json"),
        manifestVerificationPath: join(tempDir, "manual-intervention-manifest-verification.json"),
        bundleManifestPath: join(tempDir, "local-submission-bundle-manifest.json"),
        digestAlgorithm: "sha256"
      });
      expect(bundle?.proofBoundary).toContain("not hosted Cloud Run proof");
      expect(bundle?.fileCount).toBeGreaterThanOrEqual(7);
      expect(report.manualInterventionPlan.packetFiles?.manifestPath).toBe(bundle?.manifestPath);

      const readinessJson = JSON.parse(readFileSync(join(tempDir, "local-submission-readiness.json"), "utf8")) as LocalSubmissionReport;
      const summaryMarkdown = readFileSync(join(tempDir, "local-submission-summary.md"), "utf8");
      const manifestVerification = JSON.parse(readFileSync(join(tempDir, "manual-intervention-manifest-verification.json"), "utf8")) as ManualManifestVerificationReport;
      const bundleManifest = JSON.parse(readFileSync(join(tempDir, "local-submission-bundle-manifest.json"), "utf8")) as {
        status: string;
        localSubmissionStatus: string;
        digestAlgorithm: string;
        fileCount: number;
        files: Array<{ id: string; path: string; sha256: string; bytes: number }>;
        proofBoundary: string;
        stopConditions: string[];
        privateHandling: string[];
        phaseProgress?: {
          recommendedNextCodeControllablePhaseId?: string;
          recommendedNextCodeControllableAction?: {
            phaseId: string;
            action: string;
            actionDetails?: Array<{
              key: string;
              status: string;
              source: string;
              owner: string;
              derivationHint?: string;
              fix: string;
              acceptedProof: string;
            }>;
            commands: string[];
            privateArtifactPaths: string[];
          };
        };
        manualInterventionSummary?: {
          total: number;
        };
        phaseFocusPlan?: {
          rows: Array<{ phaseId: string; successChecklist: string[]; bestPracticeNotes: string[] }>;
        };
        bestPracticeSourceUrls?: string[];
      };
      const combined = [
        readFileSync(join(tempDir, "local-submission-readiness.json"), "utf8"),
        summaryMarkdown,
        readFileSync(join(tempDir, "manual-intervention-manifest-verification.json"), "utf8"),
        readFileSync(join(tempDir, "local-submission-bundle-manifest.json"), "utf8")
      ].join("\n");

      expect(readinessJson.overallStatus).toBe("blocked");
      expect(summaryMarkdown).toContain("# Local Submission Readiness Summary");
      expect(manifestVerification.overallStatus).toBe("verified");
      expect(bundleManifest).toMatchObject({
        status: "ready-for-private-owner-review",
        localSubmissionStatus: "blocked",
        digestAlgorithm: "sha256"
      });
      expect(bundleManifest.fileCount).toBe(bundleManifest.files.length);
      expect(bundleManifest.files.map((file) => file.id)).toEqual(
        expect.arrayContaining([
          "local-submission-readiness",
          "local-submission-summary",
          "manual-intervention-manifest",
          "manual-intervention-manifest-verification"
        ])
      );
      expect(bundleManifest.files.every((file) => file.path.startsWith(tempDir))).toBe(true);
      expect(bundleManifest.files.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256) && file.bytes > 0)).toBe(true);
      expect(bundleManifest.proofBoundary).toContain("not hosted Cloud Run proof");
      expect(bundleManifest.phaseProgress?.recommendedNextCodeControllablePhaseId).toBe("cloudrun-render-dry-run");
      expect(bundleManifest.phaseProgress?.recommendedNextCodeControllableAction?.action).toContain(
        "release-prefilled private Cloud Run render-values file"
      );
      expect(bundleManifest.phaseProgress?.recommendedNextCodeControllableAction?.commands.join(" ")).toContain(
        "prepare:cloudrun-render-handoff"
      );
      expect(bundleManifest.phaseProgress?.recommendedNextCodeControllableAction?.commands.join(" ")).toContain(
        "verify:cloudrun-render-handoff"
      );
      expect(bundleManifest.phaseProgress?.recommendedNextCodeControllableAction?.action).toContain("operator handoff");
      expect(bundleManifest.phaseProgress?.recommendedNextCodeControllableAction?.commands.join(" ")).toContain(
        "audit:cloudrun-values"
      );
      expect(bundleManifest.phaseProgress?.recommendedNextCodeControllableAction?.privateArtifactPaths).toEqual(
        expect.arrayContaining([
          "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-dry-run-preflight-packet.json",
          "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-dry-run-packet-verifier.json"
        ])
      );
      expect(bundleManifest.phaseFocusPlan?.rows.find((row) => row.phaseId === "cloudrun-render-dry-run")?.successChecklist.join(" ")).toContain(
        "Secret Manager"
      );
      expect(bundleManifest.bestPracticeSourceUrls).toEqual(
        expect.arrayContaining([
          "https://docs.cloud.google.com/run/docs/securing/service-identity",
          "https://docs.cloud.google.com/nat/docs/nat-product-interactions"
        ])
      );
      expect(bundleManifest.manualInterventionSummary?.total).toBeGreaterThan(0);
      expect(bundleManifest.stopConditions.join(" ")).toContain("Do not set XPRIZE");
      expect(bundleManifest.privateHandling.join(" ")).toContain("/secure/local");
      expect(combined).not.toContain("Bearer ");
      expect(combined).not.toContain("password:");
      expect(readdirSync(tempDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
      expect(readdirSync(join(tempDir, "manual-intervention-packets")).filter((path) => path.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("verifies local-submission bundle integrity and blocks tampered handoff files", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-local-bundle-verify-"));
    const outsideDir = mkdtempSync(join(tmpdir(), "sentinel-local-bundle-outside-"));
    const bundleManifestPath = join(tempDir, "local-submission-bundle-manifest.json");

    try {
      const report = runVerifier(["--bundle-dir", tempDir]);
      const verification = runLocalBundleVerifier(bundleManifestPath);

      expect(report.localSubmissionBundle?.bundleManifestPath).toBe(bundleManifestPath);
      expect(verification).toMatchObject({
        overallStatus: "verified",
        generatedFrom: "verify-local-submission --verify-bundle",
        manifestPath: bundleManifestPath,
        digestAlgorithm: "sha256"
      });
      expect(verification.summary.fileCount).toBeGreaterThanOrEqual(7);
      expect(verification.summary.blocked).toBe(0);
      expect(verification.checks.map((check) => check.id)).toEqual(
        expect.arrayContaining([
          "bundle-readiness-status-match",
          "bundle-readiness-proof-boundary",
          "bundle-manual-manifest-verifies",
          "bundle-stored-manual-verification-status"
        ])
      );
      expect(verification.proofBoundary).toContain("does not prove hosted Cloud Run");
      expect(verification.proofBoundary).toContain("live Gemini");
      expect(verification.stopConditions.join(" ")).toContain("Do not set XPRIZE");
      expect(verification.stopConditions.join(" ")).toContain("Regenerate the local-submission bundle");

      writeFileSync(join(tempDir, "local-submission-summary.md"), `${readFileSync(join(tempDir, "local-submission-summary.md"), "utf8")}\nTampered after bundle manifest.\n`);
      const tampered = runLocalBundleVerifier(bundleManifestPath);

      expect(tampered.overallStatus).toBe("blocked");
      expect(tampered.blockers.join(" ")).toContain("bundle-file-2-sha256");
      expect(() => runLocalBundleVerifier(bundleManifestPath, ["--strict"])).toThrow();

      const escapedContent = "# Outside bundle\n";
      const escapedPath = join(outsideDir, "outside.md");
      writeFileSync(escapedPath, escapedContent);
      const bundleManifest = JSON.parse(readFileSync(bundleManifestPath, "utf8")) as {
        files: Array<{
          id: string;
          path: string;
          relativePath?: string;
          sha256: string;
          bytes: number;
        }>;
      };
      bundleManifest.files[0] = {
        ...bundleManifest.files[0],
        path: escapedPath,
        relativePath: undefined,
        sha256: sha256Hex(escapedContent),
        bytes: Buffer.byteLength(escapedContent, "utf8")
      };
      writeFileSync(bundleManifestPath, `${JSON.stringify(bundleManifest, null, 2)}\n`);
      const escaped = runLocalBundleVerifier(bundleManifestPath);

      expect(escaped.overallStatus).toBe("blocked");
      expect(escaped.blockers.join(" ")).toContain("bundle-file-1-path-boundary");
      expect(escaped.blockers.join(" ")).toContain("escapes bundle directory");

      const symlinkPath = join(tempDir, "symlinked-readiness.md");
      symlinkSync(escapedPath, symlinkPath);
      bundleManifest.files[0] = {
        ...bundleManifest.files[0],
        path: symlinkPath,
        relativePath: "symlinked-readiness.md",
        sha256: sha256Hex(escapedContent),
        bytes: Buffer.byteLength(escapedContent, "utf8")
      };
      writeFileSync(bundleManifestPath, `${JSON.stringify(bundleManifest, null, 2)}\n`);
      const symlinked = runLocalBundleVerifier(bundleManifestPath);

      expect(symlinked.overallStatus).toBe("blocked");
      expect(symlinked.blockers.join(" ")).toContain("bundle-file-1-realpath-boundary");
      expect(symlinked.blockers.join(" ")).toContain("symbolic link");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("verifies local-submission bundles generated with a non-default private root", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-local-bundle-private-root-"));
    const privateRoot = join(tempDir, "private-root");
    const bundleDir = join(privateRoot, "local-submission-bundle");
    const bundleManifestPath = join(bundleDir, "local-submission-bundle-manifest.json");

    try {
      const report = runVerifier(["--bundle-dir", bundleDir], { SENTINEL_PRIVATE_ROOT: privateRoot });
      const bundleManifest = JSON.parse(readFileSync(bundleManifestPath, "utf8")) as {
        privateHandling: string[];
      };
      const verification = runLocalBundleVerifier(bundleManifestPath, ["--strict"]);

      expect(report.privateRoot).toBe(privateRoot);
      expect(report.localSubmissionBundle?.bundleManifestPath).toBe(bundleManifestPath);
      expect(bundleManifest.privateHandling.join(" ")).toContain(privateRoot);
      expect(verification.overallStatus).toBe("verified");
      expect(verification.summary.blocked).toBe(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("verifies manual-intervention packet manifest integrity and blocks tampered packets", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-manual-manifest-"));
    const outsideDir = mkdtempSync(join(tmpdir(), "sentinel-manual-outside-"));
    const manifestPath = join(tempDir, "manual-intervention-manifest.json");

    try {
      const report = runVerifier(["--manual-packets-dir", tempDir]);
      const verification = runManualManifestVerifier(manifestPath);

      expect(report.manualInterventionPlan.packetFiles?.manifestPath).toBe(manifestPath);
      expect(verification).toMatchObject({
        overallStatus: "verified",
        generatedFrom: "verify-local-submission --verify-manifest",
        manifestPath,
        digestAlgorithm: "sha256"
      });
      expect(verification.summary.fileCount).toBe(4);
      expect(verification.summary.blocked).toBe(0);
      expect(verification.proofBoundary).toContain("does not prove hosted Cloud Run");
      expect(verification.stopConditions.join(" ")).toContain("Do not set XPRIZE");

      writeFileSync(join(tempDir, "engineering.md"), `${readFileSync(join(tempDir, "engineering.md"), "utf8")}\nTampered after manifest.\n`);
      const tampered = runManualManifestVerifier(manifestPath);

      expect(tampered.overallStatus).toBe("blocked");
      expect(tampered.blockers.join(" ")).toContain("file-2-sha256");
      expect(() => runManualManifestVerifier(manifestPath, ["--strict"])).toThrow();

      const escapedContent = "# Outside manual packet\n";
      const escapedPath = join(outsideDir, "outside.md");
      writeFileSync(escapedPath, escapedContent);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        files: Array<{
          owner: string;
          path: string;
          relativePath?: string;
          sha256: string;
          bytes: number;
        }>;
      };
      manifest.files[1] = {
        ...manifest.files[1],
        path: escapedPath,
        relativePath: undefined,
        sha256: sha256Hex(escapedContent),
        bytes: Buffer.byteLength(escapedContent, "utf8")
      };
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      const escaped = runManualManifestVerifier(manifestPath);

      expect(escaped.overallStatus).toBe("blocked");
      expect(escaped.blockers.join(" ")).toContain("file-2-path-boundary");
      expect(escaped.blockers.join(" ")).toContain("escapes manifest directory");

      const symlinkPath = join(tempDir, "symlinked-engineering.md");
      symlinkSync(escapedPath, symlinkPath);
      manifest.files[1] = {
        ...manifest.files[1],
        path: symlinkPath,
        relativePath: "symlinked-engineering.md",
        sha256: sha256Hex(escapedContent),
        bytes: Buffer.byteLength(escapedContent, "utf8")
      };
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      const symlinked = runManualManifestVerifier(manifestPath);

      expect(symlinked.overallStatus).toBe("blocked");
      expect(symlinked.blockers.join(" ")).toContain("file-2-realpath-boundary");
      expect(symlinked.blockers.join(" ")).toContain("symbolic link");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("emits a stop-gated execution plan for external evidence without overclaiming proof", () => {
    const report = runVerifier();
    const phasesById = Object.fromEntries(report.phasePlan.phases.map((phase) => [phase.id, phase]));

    expect(phasesById["human-attestation-review"].commands.join(" ")).toContain("prepare:xprize-attestation");
    expect(phasesById["human-attestation-review"].stopConditions.join(" ")).toContain(
      "Do not set XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED=true"
    );
    expect(phasesById["cloudrun-render-dry-run"].commands.join(" ")).toContain("prepare:cloudrun-render-handoff");
    expect(phasesById["cloudrun-render-dry-run"].commands.join(" ")).toContain("verify:cloudrun-render-handoff");
    expect(phasesById["cloudrun-render-dry-run"].commands.join(" ")).toContain("audit:cloudrun-values");
    expect(phasesById["cloudrun-render-dry-run"].commands.join(" ")).toContain("verify:cloudrun-render-evidence");
    expect(phasesById["cloudrun-render-dry-run"].commands.join(" ")).toContain("verify:cloudrun-dry-run-packet");
    expect(phasesById["cloudrun-render-dry-run"].stopConditions.join(" ")).toContain("Do not run gcloud dry-run");
    expect(phasesById["hosted-proof-capture"]).toMatchObject({
      status: "external-required",
      bucket: "external-proof"
    });
    expect(phasesById["hosted-proof-capture"].currentPhaseRemainingPercent).toBeGreaterThan(0);
    expect(phasesById["hosted-proof-capture"].commands.join(" ")).toContain("verify:judge-access");
    expect(phasesById["hosted-proof-capture"].commands.join(" ")).toContain("verify:business-evidence");
    expect(phasesById["hosted-proof-capture"].commands.join(" ")).toContain(
      "/secure/local/cloudrun/$SENTINEL_RELEASE_ID/cloudrun-dry-run.log"
    );
    expect(phasesById["hosted-proof-capture"].commands).toContain(
      "npm run verify:production -- --url $NEXT_PUBLIC_PRODUCT_URL --release-id $SENTINEL_RELEASE_ID --strict --out /secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-readonly.json"
    );
    expect(phasesById["hosted-proof-capture"].commands).toContain(
      "npm run verify:production -- --url $NEXT_PUBLIC_PRODUCT_URL --release-id $SENTINEL_RELEASE_ID --strict --include-write-checks --out /secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-write.json"
    );
    expect(phasesById["hosted-proof-capture"].commands).toContain(
      "npm run collect:hosted-proof -- --url $NEXT_PUBLIC_PRODUCT_URL --release-id $SENTINEL_RELEASE_ID --include-write-checks --strict"
    );
    expect(phasesById["hosted-proof-capture"].relatedGateIds).toContain("judge-access-readiness");
    expect(phasesById["hosted-proof-capture"].evidenceNeeded.join(" ")).toContain("provider=gemini-api");
    expect(phasesById["hosted-proof-capture"].evidenceNeeded.join(" ")).toContain("business-evidence readiness packet");
    expect(phasesById["hosted-proof-capture"].evidenceNeeded.join(" ")).toContain("judge-access readiness packet");
    expect(phasesById["customer-demo-deployment"]).toMatchObject({
      status: "external-required",
      owner: "engineering"
    });
    expect(phasesById["customer-demo-deployment"].commands.join(" ")).toContain("verify:vercel-deployment");
    expect(phasesById["customer-demo-deployment"].commands.join(" ")).toContain("npx vercel deploy --prod --yes");
    expect(phasesById["customer-demo-deployment"].relatedGateIds).toContain("customer-demo-deployment-lineage");
    expect(phasesById["customer-demo-deployment"].stopConditions.join(" ")).toContain("Do not treat Vercel");
    expect(phasesById["business-traction-proof"]).toMatchObject({
      status: "external-required",
      owner: "founder/sales"
    });
    expect(phasesById["business-traction-proof"].commands.join(" ")).toContain("verify:business-evidence");
    expect(phasesById["business-traction-proof"].relatedGateIds).toContain("business-evidence-readiness");
    expect(phasesById["business-traction-proof"].stopConditions.join(" ")).toContain("Do not count mock pilots");
  });

  it("emits owner-routed manual intervention rows with private artifacts and proof boundaries", () => {
    const report = runVerifier();
    const rowsByPhase = report.manualInterventionPlan.actionRows.reduce<Record<string, LocalSubmissionReport["manualInterventionPlan"]["actionRows"]>>(
      (groups, row) => {
        groups[row.phaseId] = [...(groups[row.phaseId] ?? []), row];
        return groups;
      },
      {}
    );
    const ownerPacketsByOwner = Object.fromEntries(report.manualInterventionPlan.ownerPackets.map((packet) => [packet.owner, packet]));
    const humanRows = rowsByPhase["human-attestation-review"] ?? [];
    const cloudRunRows = rowsByPhase["cloudrun-render-dry-run"] ?? [];
    const hostedRows = rowsByPhase["hosted-proof-capture"] ?? [];
    const customerDemoRows = rowsByPhase["customer-demo-deployment"] ?? [];
    const businessRows = rowsByPhase["business-traction-proof"] ?? [];

    expect(humanRows.some((row) => row.action.includes("project-created-after-start"))).toBe(true);
    expect(humanRows.every((row) => row.proofBoundary.includes("human review"))).toBe(true);
    expect(cloudRunRows.some((row) => row.privateArtifactPaths.includes("/secure/local/cloudrun-render-values.json"))).toBe(true);
    expect(
      cloudRunRows.some((row) =>
        row.privateArtifactPaths.includes("artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-handoff.json")
      )
    ).toBe(true);
    expect(
      cloudRunRows.some((row) =>
        row.privateArtifactPaths.includes("artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-handoff-verifier.json")
      )
    ).toBe(true);
    expect(cloudRunRows.some((row) => row.status === "private-values-required")).toBe(true);
    expect(
      cloudRunRows.some((row) =>
        row.checklist?.some((item) => item.includes("Fill only non-secret production values"))
      )
    ).toBe(true);
    expect(
      cloudRunRows.some((row) =>
        row.privateArtifactPaths.includes("artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-dry-run-preflight-packet.json")
      )
    ).toBe(true);
    expect(
      cloudRunRows.some((row) =>
        row.privateArtifactPaths.includes("artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-summary.json")
      )
    ).toBe(true);
    expect(cloudRunRows.some((row) => row.commands.join(" ").includes("audit:cloudrun-values"))).toBe(true);
    expect(hostedRows.some((row) => row.action.includes("Cloud Run service URL"))).toBe(true);
    expect(
      hostedRows.some((row) =>
        row.privateArtifactPaths.includes("/secure/local/cloudrun/$SENTINEL_RELEASE_ID/cloudrun-dry-run.log")
      )
    ).toBe(true);
    expect(hostedRows.every((row) => row.proofBoundary.includes("external artifact evidence"))).toBe(true);
    expect(customerDemoRows.some((row) => row.action.includes("Vercel production deployment"))).toBe(true);
    expect(customerDemoRows.some((row) => row.privateArtifactPaths.includes("/secure/local/vercel-deployments.json"))).toBe(
      true
    );
    expect(customerDemoRows.every((row) => row.proofBoundary.includes("external artifact evidence"))).toBe(true);
    expect(businessRows.some((row) => row.action.includes("invoice/payment"))).toBe(true);
    expect(businessRows.some((row) => row.privateArtifactPaths.includes("/secure/local/business-evidence.json"))).toBe(true);
    expect(ownerPacketsByOwner.engineering.privateArtifactPaths).toEqual(
      expect.arrayContaining([
        "/secure/local/cloudrun-render-values.json",
        "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-handoff.json",
        "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-handoff-verifier.json",
        "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-render-summary.json",
        "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-dry-run-preflight-packet.json",
        "/secure/local/cloudrun/$SENTINEL_RELEASE_ID/cloudrun-dry-run.log"
      ])
    );
    expect(ownerPacketsByOwner["founder/sales"].rows.some((row) => row.action.includes("invoice"))).toBe(true);
    expect(JSON.stringify(report.manualInterventionPlan)).not.toContain("Bearer ");
    expect(JSON.stringify(report.manualInterventionPlan)).not.toContain("password:");
  });

  it("emits a phase progress chart with done, pending, ratings, and remaining percentages", () => {
    const report = runVerifier();
    const rowsById = Object.fromEntries(report.phaseProgressChart.rows.map((row) => [row.phaseId, row]));

    expect(report.phaseProgressChart.overallGoalRemainingPercent).toBeGreaterThan(0);
    expect(report.phaseProgressChart.overallGoalRemainingPercent).toBeLessThanOrEqual(100);
    expect([...rowsById["human-attestation-review"].done, ...rowsById["human-attestation-review"].pending].join(" ")).toContain(
      "Source release guard:"
    );
    expect(rowsById["human-attestation-review"].pending.join(" ")).toContain("project-created-after-start");
    expect(rowsById["human-attestation-review"].successCheckpoints.join(" ")).toContain("prepare:xprize-attestation");
    expect(rowsById["cloudrun-render-dry-run"].done.join(" ")).toContain("Cloud Run deployment evidence template: partial/scaffolded");
    expect(rowsById["cloudrun-render-dry-run"].pending.join(" ")).toContain("release-prefilled private render-values file");
    expect(rowsById["cloudrun-render-dry-run"].evidence).not.toContain("judge-access-readiness");
    expect(rowsById["hosted-proof-capture"].pending.join(" ")).toContain("hosted live Gemini API call evidence");
    expect(rowsById["customer-demo-deployment"].pending.join(" ")).toContain("Vercel production deployment");
    expect(rowsById["customer-demo-deployment"].evidence).toContain("customer-demo-deployment-lineage");
    expect(rowsById["business-traction-proof"].pending.join(" ")).toContain("invoice/payment");
    expect(rowsById["business-traction-proof"].evidence).not.toContain("project-provenance");
    expect(rowsById["business-traction-proof"].evidence).not.toContain("license-ip-review");
    expect(rowsById["business-traction-proof"].pending.join(" ")).not.toContain("project-created-after-start");
  });

  it("passes Vercel deployment lineage inputs into the customer demo gate and blocks stale deployments", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-local-submission-vercel-stale-"));
    const deploymentsPath = join(tempDir, "vercel-deployments.json");
    const expectedCommit = "1111111111111111111111111111111111111111";
    const staleCommit = "2222222222222222222222222222222222222222";

    try {
      writeFileSync(deploymentsPath, JSON.stringify(buildVercelDeploymentExport({ sha: staleCommit }), null, 2), "utf8");
      const report = runVerifier([
        "--vercel-deployments-json",
        deploymentsPath,
        "--vercel-url",
        "https://sme-workspace-sentinel.vercel.app",
        "--vercel-expected-commit",
        expectedCommit
      ]);
      const gatesById = Object.fromEntries(report.gates.map((gate) => [gate.id, gate]));
      const phase = report.phasePlan.phases.find((item) => item.id === "customer-demo-deployment");

      expect(gatesById["customer-demo-deployment-lineage"].command).toContain(`--deployments-json ${deploymentsPath}`);
      expect(gatesById["customer-demo-deployment-lineage"].command).toContain("--url https://sme-workspace-sentinel.vercel.app");
      expect(gatesById["customer-demo-deployment-lineage"].command).toContain(`--expected-commit ${expectedCommit}`);
      expect(gatesById["customer-demo-deployment-lineage"]).toMatchObject({
        rawStatus: "blocked",
        status: "blocked",
        externalRequired: true
      });
      expect(gatesById["customer-demo-deployment-lineage"].evidence).toContain(`expected ${expectedCommit}`);
      expect(gatesById["customer-demo-deployment-lineage"].evidence).toContain(`deployed ${staleCommit}`);
      expect(gatesById["customer-demo-deployment-lineage"].blockers.join(" ")).toContain(
        "Production deployment source lineage"
      );
      expect(phase?.status).toBe("external-required");
      expect(
        report.manualInterventionPlan.actionRows.some(
          (row) => row.phaseId === "customer-demo-deployment" && row.action.includes("Redeploy")
        )
      ).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("marks customer demo deployment phase passed when Vercel lineage matches expected source", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-local-submission-vercel-current-"));
    const deploymentsPath = join(tempDir, "vercel-deployments.json");
    const expectedCommit = "3333333333333333333333333333333333333333";

    try {
      writeFileSync(deploymentsPath, JSON.stringify(buildVercelDeploymentExport({ sha: expectedCommit }), null, 2), "utf8");
      const report = runVerifier([
        "--vercel-deployments-json",
        deploymentsPath,
        "--vercel-url",
        "https://sme-workspace-sentinel.vercel.app",
        "--vercel-expected-commit",
        expectedCommit
      ]);
      const gatesById = Object.fromEntries(report.gates.map((gate) => [gate.id, gate]));
      const phase = report.phasePlan.phases.find((item) => item.id === "customer-demo-deployment");

      expect(gatesById["customer-demo-deployment-lineage"]).toMatchObject({
        rawStatus: "verified",
        status: "passed",
        externalRequired: false
      });
      expect(phase?.status).toBe("passed");
      expect(report.manualInterventionPlan.actionRows.some((row) => row.phaseId === "customer-demo-deployment")).toBe(
        false
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("passes a rendered Cloud Run manifest into the deployment gate without claiming hosted proof", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-local-submission-cloudrun-current-"));
    const manifestPath = join(tempDir, "cloudrun.service.rendered.yaml");

    try {
      writeFileSync(manifestPath, renderProductionCandidateManifest(), "utf8");
      const report = runVerifier(["--cloudrun-manifest", manifestPath]);
      const gatesById = Object.fromEntries(report.gates.map((gate) => [gate.id, gate]));
      const phase = report.phasePlan.phases.find((item) => item.id === "cloudrun-render-dry-run");

      expect(gatesById["cloudrun-deployment-template"].command).toContain(`--manifest=${manifestPath}`);
      expect(gatesById["cloudrun-deployment-template"]).toMatchObject({
        rawStatus: "ready-to-dry-run",
        status: "warning",
        externalRequired: true
      });
      expect(gatesById["cloudrun-deployment-template"].blockers).toEqual([]);
      expect(gatesById["cloudrun-deployment-template"].nextActions.join(" ")).toContain("dry-run/deploy/describe");
      expect(phase?.status).toBe("ready-to-dry-run");
      expect(report.remainingBlockers.join(" ")).toContain("human-attestation");
      expect(report.remainingBlockers.join(" ")).toContain("Private business evidence file");
      expect(report.stopConditions.join(" ")).toContain("does not prove live Gemini API usage");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("passes a hosted URL into judge-access readiness without treating judge access as proven", () => {
    const report = runVerifier(["--url", "https://sme-workspace-sentinel.vercel.app/"]);
    const gatesById = Object.fromEntries(report.gates.map((gate) => [gate.id, gate]));

    expect(report.overallStatus).toBe("blocked");
    expect(gatesById["judge-access-readiness"].command).toContain(
      "npm run verify:judge-access -- --url https://sme-workspace-sentinel.vercel.app"
    );
    expect(gatesById["judge-access-readiness"].evidence).toContain(
      "Product URL https://sme-workspace-sentinel.vercel.app"
    );
    expect(gatesById["judge-access-readiness"].evidence).not.toContain("Product URL missing");
    expect(gatesById["judge-access-readiness"].blockers.join(" ")).toContain(
      "XPRIZE_WORKING_PROJECT_ACCESS_CONFIGURED=true only after private proof exists"
    );
    expect(report.remainingBlockers.join(" ")).toContain("Private judge testing instructions");
  });

  it("passes private signed-out hosted proof into judge-access readiness without approving judge flags", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-local-submission-hosted-proof-"));
    const proofPath = join(tempDir, "signed-out-proof.json");
    const productUrl = "https://sme-workspace-sentinel.example.com";

    try {
      writeFileSync(
        proofPath,
        JSON.stringify(
          {
            checkedAt: "2026-05-28T07:45:00.000Z",
            sourceUrl: productUrl,
            signedOut: true,
            checks: [
              { id: "homepage", status: "passed", httpStatus: 200 },
              { id: "judge-access-pack", status: "passed", httpStatus: 200 },
              { id: "submission-gate", status: "passed", httpStatus: 200 },
              { id: "claim-guard", status: "passed", httpStatus: 200 }
            ]
          },
          null,
          2
        ),
        "utf8"
      );

      const report = runVerifier(["--url", productUrl, "--judge-hosted-proof", proofPath]);
      const gatesById = Object.fromEntries(report.gates.map((gate) => [gate.id, gate]));

      expect(gatesById["judge-access-readiness"].command).toContain(`--hosted-proof ${proofPath}`);
      expect(gatesById["judge-access-readiness"].evidence).toContain("5 missing or blocked access check(s)");
      expect(gatesById["judge-access-readiness"].blockers.join(" ")).not.toContain("Hosted product URL:");
      expect(gatesById["judge-access-readiness"].blockers.join(" ")).toContain("Private judge testing instructions:");
      expect(report.remainingBlockers.join(" ")).not.toContain("Hosted product URL: Deploy");
      expect(report.remainingBlockers.join(" ")).toContain("Public demo video access");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("passes private testing-instructions proof into judge-access readiness without approving demo or business proof", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-local-submission-testing-proof-"));
    const proofPath = join(tempDir, "private-testing-proof.json");
    const productUrl = "https://sme-workspace-sentinel.example.com";

    try {
      writeFileSync(
        proofPath,
        JSON.stringify(
          {
            productUrl,
            repositoryUrl: "https://github.com/sanjabh11/sme-compliance-sentinel.git",
            reviewedAt: "2026-05-28T08:15:00.000Z",
            testingInstructionsConfigured: true,
            judgeAccessConfigured: true,
            freeAccessThroughJudgingConfirmed: true,
            judgingPeriodEndAt: "2026-09-15T17:00:00-07:00",
            repositoryAccessConfigured: true,
            sourceCodeCompleteConfirmed: true,
            evidenceResponsePrivateContactConfigured: true,
            evidenceResponseSlaBusinessDays: 2,
            credentialHandling: "devpost-private-field",
            testAccountPath: "Private Devpost instructions point judges to the hosted seeded demo flow.",
            expectedWorkflow: [
              "Open the hosted product URL.",
              "Run the seeded Workspace risk scan demo.",
              "Open Evidence Vault and Claim Guard."
            ]
          },
          null,
          2
        ),
        "utf8"
      );

      const report = runVerifier(["--url", productUrl, "--judge-testing-proof", proofPath]);
      const gatesById = Object.fromEntries(report.gates.map((gate) => [gate.id, gate]));

      expect(gatesById["judge-access-readiness"].command).toContain(`--testing-instructions-proof ${proofPath}`);
      expect(gatesById["judge-access-readiness"].evidence).toContain("2 missing or blocked access check(s)");
      expect(gatesById["judge-access-readiness"].blockers.join(" ")).not.toContain("Private judge testing instructions:");
      expect(gatesById["judge-access-readiness"].blockers.join(" ")).not.toContain("Repository access:");
      expect(gatesById["judge-access-readiness"].blockers.join(" ")).toContain("Hosted product URL:");
      expect(gatesById["judge-access-readiness"].blockers.join(" ")).toContain("Public demo video access:");
      expect(report.remainingBlockers.join(" ")).toContain("Business viability evidence packet");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reflects verified Cloud Run handoff artifacts without treating them as hosted proof", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-local-submission-cloudrun-artifacts-"));
    const valuesPath = join(tempDir, "cloudrun-render-values.json");
    const outDir = join(tempDir, "deployment");
    const releaseId = "release-20260525-deadbee";
    const releaseDir = join(outDir, releaseId);

    try {
      mkdirSync(releaseDir, { recursive: true });
      writeFileSync(
        valuesPath,
        `${JSON.stringify(
          {
            SENTINEL_RELEASE_ID: releaseId,
            SENTINEL_SOURCE_COMMIT: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
            SENTINEL_SOURCE_COMMIT_AT: "2026-05-25T02:00:00.000Z",
            SENTINEL_SOURCE_BRANCH: "origin/main",
            XPRIZE_REPOSITORY_URL: "https://github.com/sanjabh11/sme-compliance-sentinel.git"
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      writeFileSync(join(releaseDir, "cloudrun-render-handoff.json"), `${JSON.stringify({ overallStatus: "ready-for-private-values", releaseId }, null, 2)}\n`, "utf8");
      writeFileSync(join(releaseDir, "cloudrun-render-handoff.md"), "# Cloud Run Render Handoff\n", "utf8");
      writeFileSync(join(releaseDir, "cloudrun-render-handoff-verifier.json"), `${JSON.stringify({ overallStatus: "verified", releaseId }, null, 2)}\n`, "utf8");
      writeFileSync(
        join(releaseDir, "cloudrun-render-values-audit.json"),
        `${JSON.stringify(
          {
            status: "needs-values",
            readyForStrictRender: false,
            releaseId,
            missingStrictKeys: [
              "GOOGLE_CLOUD_PROJECT",
              "NEXT_PUBLIC_PRODUCT_URL",
              "SENTINEL_CLOUD_RUN_IMAGE",
              "SENTINEL_CLOUD_RUN_SERVICE_ACCOUNT_EMAIL",
              "SENTINEL_PRIVATE_EVIDENCE_BUCKET",
              "GOOGLE_CLOUD_BILLING_ACCOUNT_ID",
              "SENTINEL_GCP_BUDGET_ID",
              "SENTINEL_BUDGET_PUBSUB_TOPIC",
              "SENTINEL_GEMINI_API_KEY_ID"
            ],
            placeholderKeys: ["GOOGLE_CLOUD_PROJECT", "SENTINEL_GCP_BUDGET_SHORT_ID", "SENTINEL_CLOUD_RUN_IMAGE"],
            valueConsistencyBlockers: [
              {
                key: "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS",
                fix: "Use concrete server IPv4 addresses."
              }
            ],
            renderValueIntake: [
              {
                key: "GOOGLE_CLOUD_PROJECT",
                owner: "engineering",
                status: "placeholder",
                source: "values-file",
                fix: "Fill GOOGLE_CLOUD_PROJECT with the reviewed Google Cloud project id.",
                acceptedProof: "Reviewed Google Cloud project metadata."
              },
              {
                key: "NEXT_PUBLIC_PRODUCT_URL",
                owner: "engineering",
                status: "missing",
                source: "missing",
                fix: "Fill NEXT_PUBLIC_PRODUCT_URL with the HTTPS Cloud Run URL after deployment.",
                acceptedProof: "Signed-out hosted product smoke proof."
              },
              {
                key: "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS",
                owner: "engineering",
                status: "blocked",
                source: "values-file",
                fix: "Use concrete server IPv4 addresses.",
                acceptedProof: "Gemini API key server restriction proof."
              },
              {
                key: "SENTINEL_GCP_BUDGET_SHORT_ID",
                owner: "engineering",
                status: "placeholder",
                source: "values-file",
                fix: "Fill SENTINEL_GCP_BUDGET_SHORT_ID with the reviewed Cloud Billing budget short id.",
                acceptedProof: "Cloud Billing budget id proof."
              }
            ]
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      writeFileSync(join(releaseDir, "cloudrun-render-values-audit.md"), "# Cloud Run Render Values Audit\n", "utf8");
      writeFileSync(join(releaseDir, "cloudrun-render-evidence-packet.json"), `${JSON.stringify({ overallStatus: "needs-values", releaseId }, null, 2)}\n`, "utf8");
      writeFileSync(join(releaseDir, "cloudrun-render-evidence-packet.md"), "# Cloud Run Render Evidence Packet\n", "utf8");
      writeFileSync(join(releaseDir, "cloudrun-render-evidence-packet-verifier.json"), `${JSON.stringify({ overallStatus: "verified", releaseId }, null, 2)}\n`, "utf8");

      const summaryPath = join(tempDir, "local-submission-summary.md");
      const report = runVerifier(["--markdown-out", summaryPath], {
        SENTINEL_CLOUD_RUN_VALUES_PATH: valuesPath,
        SENTINEL_CLOUD_RUN_RENDER_OUT_DIR: outDir,
        SENTINEL_RELEASE_ID: releaseId
      });
      const summaryMarkdown = readFileSync(summaryPath, "utf8");
      const row = report.phaseProgressChart.rows.find((item) => item.phaseId === "cloudrun-render-dry-run");
      const progressRows = report.manualInterventionPlan.actionRows.filter(
        (item) => item.phaseId === "cloudrun-render-dry-run" && item.source === "phase-progress"
      );
      const engineeringPacket = report.manualInterventionPlan.ownerPackets.find((packet) => packet.owner === "engineering");

      expect(row?.done.join(" ")).toContain("release-prefilled private render-values file");
      expect(row?.done.join(" ")).toContain("cloudrun-render-handoff JSON/Markdown");
      expect(row?.done.join(" ")).toContain("cloudrun-render-handoff-verifier JSON");
      expect(row?.done.join(" ")).toContain("render-values audit JSON/Markdown");
      expect(row?.pending.join(" ")).toContain("Fill 4 direct non-secret Cloud Run render input(s)");
      expect(row?.pending.join(" ")).toContain("Derived Cloud Run render value(s) should be generated");
      expect(row?.pending.join(" ")).toContain("SENTINEL_GEMINI_API_KEY_ID");
      expect(row?.pending.join(" ")).not.toContain("+1 more");
      expect(row?.pending.join(" ")).toContain("SENTINEL_GCP_BUDGET_SHORT_ID");
      expect(row?.pending.join(" ")).not.toContain("Replace 3 placeholder render value(s)");
      expect(report.phasePlan.recommendedNextCodeControllableAction.action).toContain(
        "Fill 4 direct non-secret Cloud Run render input(s)"
      );
      expect(report.phasePlan.recommendedNextCodeControllableAction.action).toContain("GOOGLE_CLOUD_BILLING_ACCOUNT_ID");
      expect(report.phasePlan.recommendedNextCodeControllableAction.action).toContain("SENTINEL_GCP_BUDGET_SHORT_ID");
      expect(report.phasePlan.recommendedNextCodeControllableAction.action).not.toContain("SENTINEL_GEMINI_API_KEY_ID");
      expect(report.phasePlan.recommendedNextCodeControllableAction.action).not.toContain("Prepare and verify");
      expect(report.phasePlan.recommendedNextCodeControllableAction.actionDetails).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "GOOGLE_CLOUD_PROJECT",
            status: "placeholder",
            fix: "Fill GOOGLE_CLOUD_PROJECT with the reviewed Google Cloud project id."
          }),
          expect.objectContaining({
            key: "NEXT_PUBLIC_PRODUCT_URL",
            status: "missing",
            acceptedProof: "Signed-out hosted product smoke proof."
          })
        ])
      );
      expect(summaryMarkdown).toContain("Action details:");
      expect(summaryMarkdown).toContain("GOOGLE_CLOUD_PROJECT");
      expect(summaryMarkdown).toContain("Derivation / Override Guidance");
      expect(summaryMarkdown).toContain("Signed-out hosted product smoke proof.");
      expect(row?.pending.join(" ")).toContain("Resolve render-value consistency blocker SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS");
      expect(row?.pending.join(" ")).toContain("Generate the dry-run preflight packet only after the render-values audit is ready-to-render");
      expect(row?.evidence).toContain("private-artifact:render-values-audit=blocked");
      expect(row?.evidence).toContain("private-artifact=done");
      expect(progressRows.map((item) => item.action).join(" ")).toContain("Fill 4 direct non-secret Cloud Run render input(s)");
      expect(progressRows.map((item) => item.action).join(" ")).toContain("Derived Cloud Run render value(s) should be generated");
      expect(progressRows.map((item) => item.action).join(" ")).toContain("SENTINEL_GEMINI_API_KEY_ID");
      expect(progressRows.map((item) => item.action).join(" ")).toContain("SENTINEL_GCP_BUDGET_SHORT_ID");
      expect(progressRows.map((item) => item.action).join(" ")).not.toContain("+1 more");
      expect(progressRows.map((item) => item.action).join(" ")).not.toContain("Replace 3 placeholder render value(s)");
      expect(progressRows.map((item) => item.action).join(" ")).toContain("Resolve render-value consistency blocker");
      expect(progressRows.every((item) => item.status === "private-values-required")).toBe(true);
      expect(progressRows.every((item) => item.owner === "engineering")).toBe(true);
      expect(progressRows.some((item) => item.commands.join(" ").includes("audit:cloudrun-values"))).toBe(true);
      expect(
        progressRows.some((item) => item.checklist?.some((entry) => entry.includes("Fill only non-secret production values")))
      ).toBe(true);
      expect(progressRows.find((item) => item.action.includes("direct non-secret"))?.actionDetails).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "GOOGLE_CLOUD_PROJECT",
            status: "placeholder",
            fix: "Fill GOOGLE_CLOUD_PROJECT with the reviewed Google Cloud project id."
          }),
          expect.objectContaining({
            key: "NEXT_PUBLIC_PRODUCT_URL",
            status: "missing",
            acceptedProof: "Signed-out hosted product smoke proof."
          }),
          expect.objectContaining({
            key: "SENTINEL_GCP_BUDGET_SHORT_ID",
            status: "placeholder",
            fix: "Fill SENTINEL_GCP_BUDGET_SHORT_ID with the reviewed Cloud Billing budget short id."
          })
        ])
      );
      expect(progressRows.find((item) => item.action.includes("Derived Cloud Run render value"))?.actionDetails).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "SENTINEL_GEMINI_API_KEY_ID",
            derivationHint: expect.stringContaining("GOOGLE_CLOUD_PROJECT_NUMBER"),
            fix: expect.stringContaining("normally derived")
          })
        ])
      );
      expect(progressRows.some((item) => item.action.includes("placeholder render value"))).toBe(false);
      expect(progressRows.find((item) => item.action.includes("consistency blocker"))?.actionDetails).toEqual([
        expect.objectContaining({
          key: "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS",
          status: "blocked",
          acceptedProof: "Gemini API key server restriction proof."
        })
      ]);
      expect(engineeringPacket?.nextAction).toContain("Fill 4 direct non-secret Cloud Run render input(s)");
      expect(engineeringPacket?.nextAction).toContain("SENTINEL_GCP_BUDGET_SHORT_ID");
      expect(engineeringPacket?.nextAction).not.toContain("SENTINEL_GEMINI_API_KEY_ID");
      expect(engineeringPacket?.nextAction).not.toContain("+1 more");
      expect(report.phasePlan.phases.find((phase) => phase.id === "hosted-proof-capture")?.status).toBe("external-required");
      expect(report.overallStatus).toBe("blocked");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts verified Cloud Run dry-run packet status fields in the phase progress chart", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-local-submission-dry-run-status-"));
    const valuesPath = join(tempDir, "cloudrun-render-values.json");
    const outDir = join(tempDir, "deployment");
    const releaseId = "release-20260525-dryrun1";
    const releaseDir = join(outDir, releaseId);

    try {
      mkdirSync(releaseDir, { recursive: true });
      writeFileSync(
        valuesPath,
        `${JSON.stringify(
          {
            SENTINEL_RELEASE_ID: releaseId,
            SENTINEL_SOURCE_COMMIT: "1111111111111111111111111111111111111111",
            SENTINEL_SOURCE_COMMIT_AT: "2026-05-25T03:00:00.000Z",
            SENTINEL_SOURCE_BRANCH: "origin/main",
            XPRIZE_REPOSITORY_URL: "https://github.com/sanjabh11/sme-compliance-sentinel.git"
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      writeFileSync(
        join(releaseDir, "cloudrun-render-values-audit.json"),
        `${JSON.stringify({ status: "ready-to-render", readyForStrictRender: true, releaseId, missingStrictKeys: [], placeholderKeys: [], valueConsistencyBlockers: [] }, null, 2)}\n`,
        "utf8"
      );
      writeFileSync(join(releaseDir, "cloudrun-render-values-audit.md"), "# Cloud Run Render Values Audit\n", "utf8");
      writeFileSync(join(releaseDir, "cloudrun-render-evidence-packet.json"), `${JSON.stringify({ status: "ready-for-dry-run-claim-review-pending", releaseId }, null, 2)}\n`, "utf8");
      writeFileSync(join(releaseDir, "cloudrun-render-evidence-packet.md"), "# Cloud Run Render Evidence Packet\n", "utf8");
      writeFileSync(join(releaseDir, "cloudrun-render-evidence-packet-verifier.json"), `${JSON.stringify({ overallStatus: "verified", releaseId }, null, 2)}\n`, "utf8");
      writeFileSync(join(releaseDir, "cloudrun-dry-run-preflight-packet.json"), `${JSON.stringify({ status: "ready-to-dry-run", readyForDryRun: true, releaseId }, null, 2)}\n`, "utf8");
      writeFileSync(join(releaseDir, "cloudrun-dry-run-packet-verifier.json"), `${JSON.stringify({ status: "verified", readyForDryRun: true, releaseId }, null, 2)}\n`, "utf8");

      const report = runVerifier([], {
        SENTINEL_CLOUD_RUN_VALUES_PATH: valuesPath,
        SENTINEL_CLOUD_RUN_RENDER_OUT_DIR: outDir,
        SENTINEL_RELEASE_ID: releaseId
      });
      const row = report.phaseProgressChart.rows.find((item) => item.phaseId === "cloudrun-render-dry-run");

      expect(row?.done.join(" ")).toContain("dry-run preflight packet and digest verifier");
      expect(row?.pending.join(" ")).not.toContain("Rerun prepare:cloudrun-dry-run and verify:cloudrun-dry-run-packet");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not re-recommend Cloud Run prep after local render and dry-run artifacts are complete", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-local-submission-cloudrun-complete-"));
    const valuesPath = join(tempDir, "cloudrun-render-values.json");
    const outDir = join(tempDir, "deployment");
    const releaseId = "release-20260525-cloudrun-complete";
    const releaseDir = join(outDir, releaseId);

    try {
      mkdirSync(releaseDir, { recursive: true });
      writeFileSync(
        valuesPath,
        `${JSON.stringify(
          {
            SENTINEL_RELEASE_ID: releaseId,
            SENTINEL_SOURCE_COMMIT: "2222222222222222222222222222222222222222",
            SENTINEL_SOURCE_COMMIT_AT: "2026-05-25T04:00:00.000Z",
            SENTINEL_SOURCE_BRANCH: "origin/main",
            XPRIZE_REPOSITORY_URL: "https://github.com/sanjabh11/sme-compliance-sentinel.git"
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      writeFileSync(join(releaseDir, "cloudrun-render-handoff.json"), `${JSON.stringify({ overallStatus: "ready-to-render", releaseId }, null, 2)}\n`, "utf8");
      writeFileSync(join(releaseDir, "cloudrun-render-handoff.md"), "# Cloud Run Render Handoff\n", "utf8");
      writeFileSync(join(releaseDir, "cloudrun-render-handoff-verifier.json"), `${JSON.stringify({ overallStatus: "verified", releaseId }, null, 2)}\n`, "utf8");
      writeFileSync(
        join(releaseDir, "cloudrun-render-values-audit.json"),
        `${JSON.stringify({ status: "ready-to-render", readyForStrictRender: true, releaseId, missingStrictKeys: [], placeholderKeys: [], valueConsistencyBlockers: [] }, null, 2)}\n`,
        "utf8"
      );
      writeFileSync(join(releaseDir, "cloudrun-render-values-audit.md"), "# Cloud Run Render Values Audit\n", "utf8");
      writeFileSync(join(releaseDir, "cloudrun-render-evidence-packet.json"), `${JSON.stringify({ status: "ready-for-dry-run-claim-review-pending", releaseId }, null, 2)}\n`, "utf8");
      writeFileSync(join(releaseDir, "cloudrun-render-evidence-packet.md"), "# Cloud Run Render Evidence Packet\n", "utf8");
      writeFileSync(join(releaseDir, "cloudrun-render-evidence-packet-verifier.json"), `${JSON.stringify({ overallStatus: "verified", releaseId }, null, 2)}\n`, "utf8");
      writeFileSync(join(releaseDir, "cloudrun-dry-run-preflight-packet.json"), `${JSON.stringify({ status: "ready-to-dry-run", readyForDryRun: true, releaseId }, null, 2)}\n`, "utf8");
      writeFileSync(join(releaseDir, "cloudrun-dry-run-packet-verifier.json"), `${JSON.stringify({ status: "verified", readyForDryRun: true, releaseId }, null, 2)}\n`, "utf8");

      const report = runVerifier([], {
        SENTINEL_CLOUD_RUN_VALUES_PATH: valuesPath,
        SENTINEL_CLOUD_RUN_RENDER_OUT_DIR: outDir,
        SENTINEL_RELEASE_ID: releaseId
      });
      const row = report.phaseProgressChart.rows.find((item) => item.phaseId === "cloudrun-render-dry-run");
      const phase = report.phasePlan.phases.find((item) => item.id === "cloudrun-render-dry-run");
      const focusRow = report.manualInterventionPlan.phaseFocusPlan.rows.find(
        (item) => item.phaseId === "cloudrun-render-dry-run"
      );

      expect(row?.ratingOutOf5).toBe(5);
      expect(row?.pending).toEqual([]);
      expect(phase?.status).toBe("local-ready-for-external-dry-run");
      expect(report.phasePlan.recommendedNextCodeControllablePhaseId).toBe("");
      expect(report.phasePlan.recommendedNextCodeControllableAction).toMatchObject({
        phaseId: "",
        status: "not-needed",
        owner: "engineering"
      });
      expect(report.phasePlan.recommendedNextCodeControllableAction.action).toContain("external proof collection");
      expect(report.manualInterventionPlan.actionRows.some((item) => item.phaseId === "cloudrun-render-dry-run")).toBe(false);
      expect(focusRow?.currentFocus).toBe("No open action.");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("uses private hosted proof inputs to remove completed Cloud Run and Gemini rows from manual packets", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-local-submission-hosted-production-proof-"));
    const cloudRunProofPath = join(tempDir, "cloudrun-deployment-transcript-packet.json");
    const productionProofPath = join(tempDir, "verify-production-write.json");
    const productUrl = "https://sme-workspace-sentinel.example.com";

    try {
      writeFileSync(
        cloudRunProofPath,
        `${JSON.stringify(
          {
            status: "ready-for-hosted-verification",
            readyForHostedVerification: true,
            releaseId: "release-test",
            describeSummary: {
              url: productUrl,
              latestReadyRevisionName: "sme-workspace-sentinel-00023-test",
              serviceAccountName: "sentinel-runtime@example.iam.gserviceaccount.com"
            },
            checks: [
              { id: "service-url-present", status: "passed", evidence: productUrl },
              { id: "ready-revision-present", status: "passed", evidence: "sme-workspace-sentinel-00023-test" }
            ],
            blockers: []
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      writeFileSync(
        productionProofPath,
        `${JSON.stringify(
          {
            overallStatus: "needs-review",
            baseUrl: productUrl,
            releaseId: "release-test",
            releaseLineage: { status: "passed" },
            results: [
              {
                id: "gemini-smoke-write-through",
                status: "passed",
                detail: "gemini-api on gemini-3.5-flash; hosted smoke proof captured."
              },
              {
                id: "persistence-write-through",
                status: "blocked",
                detail: "6 persistence check(s)."
              },
              {
                id: "workspace-bootstrap",
                status: "blocked",
                detail: "1 bootstrap check(s); attempted live API false."
              },
              {
                id: "workspace-watch-renewal",
                status: "blocked",
                detail: "1 renewal check(s); attempted live API false."
              }
            ],
            blockers: ["persistence-write-through: blocked", "workspace-bootstrap: blocked"]
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const report = runVerifier([
        "--url",
        productUrl,
        "--cloudrun-deployment-proof",
        cloudRunProofPath,
        "--production-proof",
        productionProofPath
      ]);
      const progress = report.phaseProgressChart.rows.find((row) => row.phaseId === "hosted-proof-capture");
      const cloudRunPrepProgress = report.phaseProgressChart.rows.find((row) => row.phaseId === "cloudrun-render-dry-run");
      const cloudRunPrepPhase = report.phasePlan.phases.find((row) => row.id === "cloudrun-render-dry-run");
      const hostedActions = report.manualInterventionPlan.actionRows
        .filter((row) => row.phaseId === "hosted-proof-capture")
        .map((row) => row.action)
        .join(" ");
      const cloudRunPrepActions = report.manualInterventionPlan.actionRows
        .filter((row) => row.phaseId === "cloudrun-render-dry-run")
        .map((row) => row.action)
        .join(" ");

      expect(progress?.done.join(" ")).toContain("Cloud Run service URL, revision, release id");
      expect(progress?.done.join(" ")).toContain("hosted live Gemini API call evidence");
      expect(progress?.pending.join(" ")).not.toContain("Cloud Run service URL, revision, release id");
      expect(progress?.pending.join(" ")).not.toContain("hosted live Gemini API call evidence");
      expect(cloudRunPrepProgress?.ratingOutOf5).toBe(5);
      expect(cloudRunPrepProgress?.pending).toEqual([]);
      expect(cloudRunPrepPhase?.status).toBe("local-ready-for-external-dry-run");
      expect(report.phasePlan.recommendedNextCodeControllableAction.status).toBe("not-needed");
      expect(cloudRunPrepActions).toBe("");
      expect(hostedActions).not.toContain("Cloud Run service URL, revision, release id");
      expect(hostedActions).not.toContain("hosted live Gemini API call evidence");
      expect(hostedActions).toContain("hosted GCP persistence and Workspace OAuth/sync proof");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("routes private artifact instructions through SENTINEL_PRIVATE_ROOT when configured", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-local-submission-private-root-"));
    const privateRoot = join(tempDir, "private-root");

    try {
      const report = runVerifier([], { SENTINEL_PRIVATE_ROOT: privateRoot });
      const reportText = JSON.stringify(report);

      expect(report.privateRoot).toBe(privateRoot);
      expect(reportText).toContain(`${privateRoot}/cloudrun-render-values.json`);
      expect(report.phasePlan.recommendedNextCodeControllableAction.commands.join(" ")).toContain(
        `${privateRoot}/cloudrun-render-values.json`
      );
      expect(report.manualInterventionPlan.privateHandling.join(" ")).toContain(privateRoot);
      expect(reportText).not.toContain("/secure/local");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects raw secret-shaped CLI arguments", () => {
    expect(() => runVerifier(["--api-key=raw-secret"])).toThrow();
    expect(() => runVerifier(["--url", "https://user:pass@example.com"])).toThrow(/must not include credentials/u);
    expect(() => runVerifier(["--url", "https://example.com/?token=secret"])).toThrow(/must not include credentials/u);
  });
});

function runVerifier(args: string[] = [], envOverrides: Partial<NodeJS.ProcessEnv> = {}) {
  const output = execFileSync(process.execPath, ["scripts/verify-local-submission.mjs", ...args], {
    cwd: process.cwd(),
    env: { ...localSubmissionEnv, ...envOverrides },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  return JSON.parse(output) as LocalSubmissionReport;
}

function runManualManifestVerifier(manifestPath: string, args: string[] = []) {
  const output = execFileSync(process.execPath, ["scripts/verify-local-submission.mjs", "--verify-manifest", manifestPath, ...args], {
    cwd: process.cwd(),
    env: localSubmissionEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  return JSON.parse(output) as ManualManifestVerificationReport;
}

function runLocalBundleVerifier(bundleManifestPath: string, args: string[] = []) {
  const output = execFileSync(process.execPath, ["scripts/verify-local-submission.mjs", "--verify-bundle", bundleManifestPath, ...args], {
    cwd: process.cwd(),
    env: localSubmissionEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  return JSON.parse(output) as LocalBundleVerificationReport;
}

function buildVercelDeploymentExport({ sha }: { sha: string }) {
  return {
    deployments: {
      deployments: [
        {
          id: "dpl_current",
          name: "sme-workspace-sentinel",
          url: "sme-workspace-sentinel.vercel.app",
          created: 1779950615088,
          state: "READY",
          target: "production",
          meta: {
            githubCommitSha: sha,
            githubCommitRef: "main",
            githubCommitMessage: "test deployment"
          }
        }
      ]
    }
  };
}

function renderProductionCandidateManifest() {
  return readFileSync(join(process.cwd(), "cloudrun.service.yaml"), "utf8")
    .replace("REGION-docker.pkg.dev/PROJECT_ID/sentinel/web:RELEASE_ID", "us-central1-docker.pkg.dev/sentinel-prod/sentinel/web:release-20260523-001")
    .replace("sentinel-runtime@PROJECT_ID.iam.gserviceaccount.com", "sentinel-runtime@sentinel-prod.iam.gserviceaccount.com")
    .replaceAll("https://YOUR-SERVICE-URL", "https://sme-workspace-sentinel-abc-uc.a.run.app")
    .replace("https://youtu.be/YOUR_VIDEO", "https://youtu.be/sentinel-demo")
    .replace('name: SENTINEL_RELEASE_ID\n              value: "RELEASE_ID"', 'name: SENTINEL_RELEASE_ID\n              value: "release-20260523-001"')
    .replace(
      'name: SENTINEL_SOURCE_COMMIT\n              value: "SOURCE_COMMIT"',
      'name: SENTINEL_SOURCE_COMMIT\n              value: "0123456789abcdef0123456789abcdef01234567"'
    )
    .replace(
      'name: SENTINEL_SOURCE_COMMIT_AT\n              value: "SOURCE_COMMIT_AT"',
      'name: SENTINEL_SOURCE_COMMIT_AT\n              value: "2026-05-23T17:24:17.894Z"'
    )
    .replace(
      'name: SENTINEL_PRIVATE_EVIDENCE_BUCKET\n              value: "gs://PROJECT_ID-sentinel-private-evidence"',
      'name: SENTINEL_PRIVATE_EVIDENCE_BUCKET\n              value: "gs://sentinel-prod-sentinel-private-evidence"'
    )
    .replace('name: GOOGLE_CLOUD_PROJECT\n              value: "PROJECT_ID"', 'name: GOOGLE_CLOUD_PROJECT\n              value: "sentinel-prod"')
    .replace(
      'name: GOOGLE_CLOUD_PROJECT_NUMBER\n              value: "PROJECT_NUMBER"',
      'name: GOOGLE_CLOUD_PROJECT_NUMBER\n              value: "123456789012"'
    )
    .replaceAll("projects/PROJECT_NUMBER/secrets/", "projects/123456789012/secrets/")
    .replace(
      'name: GOOGLE_CLOUD_BILLING_ACCOUNT_ID\n              value: "BILLING_ACCOUNT_ID"',
      'name: GOOGLE_CLOUD_BILLING_ACCOUNT_ID\n              value: "000000-111111-222222"'
    )
    .replace(
      'name: SENTINEL_GCP_BUDGET_ID\n              value: "billingAccounts/BILLING_ACCOUNT_ID/budgets/BUDGET_ID"',
      'name: SENTINEL_GCP_BUDGET_ID\n              value: "billingAccounts/000000-111111-222222/budgets/budget-123"'
    )
    .replaceAll("projects/PROJECT_ID/", "projects/sentinel-prod/")
    .replace("workspace-push@PROJECT_ID.iam.gserviceaccount.com", "workspace-push@sentinel-prod.iam.gserviceaccount.com")
    .replace("YOUR_OAUTH_CLIENT_ID.apps.googleusercontent.com", "123456789012-abcdef.apps.googleusercontent.com")
    .replace(
      "projects/PROJECT_NUMBER/locations/global/keys/GEMINI_API_KEY_ID",
      "projects/123456789012/locations/global/keys/gemini-key-123"
    )
    .replace('name: XPRIZE_ENTRANT_TYPE\n              value: ""', 'name: XPRIZE_ENTRANT_TYPE\n              value: "team"')
    .replace(
      'name: SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS\n              value: ""',
      'name: SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS\n              value: "34.10.10.10"'
    );
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
