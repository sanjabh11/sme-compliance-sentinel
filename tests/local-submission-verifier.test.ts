import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type LocalSubmissionReport = {
  overallStatus: "passed" | "warning" | "blocked";
  summary: {
    passed: number;
    warning: number;
    blocked: number;
    externalRequired: number;
  };
  gates: Array<{
    id: string;
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
  XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED: "false"
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
    expect(report.phasePlan.phases.map((phase) => phase.id)).toEqual([
      "human-attestation-review",
      "cloudrun-render-dry-run",
      "hosted-proof-capture",
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
      expect(`${outJson}${markdown}`).not.toContain("stale");
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
      expect(manifest.files.map((file) => file.owner)).toEqual(expect.arrayContaining(["index", "engineering", "founder/legal", "founder/sales"]));
      expect(manifest.files.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256))).toBe(true);
      expect(manifest.files.every((file) => file.bytes > 0 && file.path.startsWith(tempDir))).toBe(true);
      expect(indexMarkdown).toContain("# Manual Intervention Plan");
      expect(indexMarkdown).toContain("These packets are step-by-step instructions only");
      expect(indexMarkdown).toContain("founder/legal");
      expect(engineeringMarkdown).toContain("# Manual Intervention Packet: engineering");
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
      expect(markdown).toContain("## Next Code-Controllable Action");
      expect(markdown).toContain("Prepare and verify the Cloud Run render handoff");
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
        phaseProgress?: {
          recommendedNextCodeControllablePhaseId?: string;
          recommendedNextCodeControllableAction?: {
            phaseId: string;
            action: string;
            commands: string[];
            privateArtifactPaths: string[];
          };
        };
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
      expect(bundleManifest.stopConditions.join(" ")).toContain("Do not set XPRIZE");
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
    expect(rowsById["business-traction-proof"].pending.join(" ")).toContain("invoice/payment");
    expect(rowsById["business-traction-proof"].evidence).not.toContain("project-provenance");
    expect(rowsById["business-traction-proof"].evidence).not.toContain("license-ip-review");
    expect(rowsById["business-traction-proof"].pending.join(" ")).not.toContain("project-created-after-start");
  });

  it("rejects raw secret-shaped CLI arguments", () => {
    expect(() => runVerifier(["--api-key=raw-secret"])).toThrow();
  });
});

function runVerifier(args: string[] = []) {
  const output = execFileSync(process.execPath, ["scripts/verify-local-submission.mjs", ...args], {
    cwd: process.cwd(),
    env: localSubmissionEnv,
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

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
