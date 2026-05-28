import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type JudgeAccessCliReport = {
  overallStatus: "blocked" | "needs-review" | "ready";
  productUrl: string;
  repositoryUrl: string;
  demoVideoUrl: string;
  testingInstructionsSummary: string;
  accessChecks: Array<{
    id: string;
    status: "missing" | "blocked" | "private-on-request" | "ready";
    evidence: string;
    fix: string;
    requiredBeforeSubmit: boolean;
  }>;
  smokeCommands: Array<{ id: string; command: string; redactionRequired: boolean }>;
  blockers: string[];
  stopConditions: string[];
  sourceUrls: string[];
  disclaimer: string;
};

const baseEnv = {
  ...process.env,
  NEXT_PUBLIC_PRODUCT_URL: "",
  XPRIZE_REPOSITORY_ACCESS_CONFIGURED: "false",
  XPRIZE_SOURCE_CODE_COMPLETE_CONFIRMED: "false",
  XPRIZE_WORKING_PROJECT_ACCESS_CONFIGURED: "false",
  XPRIZE_TESTING_INSTRUCTIONS_CONFIGURED: "false",
  XPRIZE_JUDGE_ACCESS_CONFIGURED: "false",
  XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED: "false",
  XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS: "2",
  XPRIZE_EVIDENCE_RESPONSE_PRIVATE_CONTACT_CONFIGURED: "false",
  XPRIZE_DEMO_VIDEO_URL: "",
  XPRIZE_DEMO_VIDEO_UNDER_3_MIN_CONFIRMED: "false",
  XPRIZE_DEMO_VIDEO_PUBLICLY_ACCESSIBLE_CONFIRMED: "false",
  XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED: "false",
  XPRIZE_DEMO_VIDEO_CUSTOMER_DATA_REDACTED_CONFIRMED: "false",
  XPRIZE_DEMO_VIDEO_ENGLISH_OR_SUBTITLED_CONFIRMED: "false",
  XPRIZE_JUDGING_PERIOD_END_AT: "2026-09-15T17:00:00-07:00",
  XPRIZE_TESTING_INSTRUCTIONS: "Provide hosted URL and private test access in Devpost testing instructions."
};

describe("judge access CLI verifier", () => {
  it("blocks submission access until hosted URL, repository, demo, judge access, and private response proof exist", () => {
    const report = runVerifier(baseEnv);
    const checksById = Object.fromEntries(report.accessChecks.map((check) => [check.id, check]));

    expect(report.overallStatus).toBe("blocked");
    expect(report.productUrl).toBe("missing");
    expect(report.repositoryUrl).toContain("github.com/sanjabh11/sme-compliance-sentinel");
    expect(checksById["hosted-product-url"].status).toBe("missing");
    expect(checksById["private-testing-instructions"].status).toBe("missing");
    expect(checksById["judge-access-window"].status).toBe("missing");
    expect(checksById["repository-access"].status).toBe("missing");
    expect(checksById["demo-video-access"].status).toBe("missing");
    expect(checksById["evidence-response-owner"].status).toBe("missing");
    expect(report.blockers.join(" ")).toContain("Deploy the Cloud Run URL");
    expect(report.smokeCommands.map((command) => command.id)).toEqual(
      expect.arrayContaining(["homepage", "judge-access-pack", "submission-gate", "claim-guard"])
    );
    expect(JSON.stringify(report)).not.toContain("password:");
    expect(JSON.stringify(report)).not.toContain("Bearer ");
    expect(report.stopConditions.join(" ")).toContain("does not create hosted access");
    expect(report.sourceUrls).toEqual(
      expect.arrayContaining(["https://xprize.devpost.com/rules", "https://www.geminixprize.com/rules"])
    );
    expect(report.disclaimer).toContain("not hosted proof");
  });

  it("writes a private JSON packet and fails strict mode while access blockers remain", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-judge-access-"));
    const outPath = join(tempDir, "judge-access-readiness.json");

    try {
      const report = runVerifier(baseEnv, ["--out", outPath]);

      expect(readFileSync(outPath, "utf8")).toContain('"overallStatus": "blocked"');
      expect(report.blockers.length).toBeGreaterThan(0);
      expect(readdirSync(tempDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
      expect(() => runVerifier(baseEnv, ["--strict"])).toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts a non-secret hosted URL argument without treating access as proven", () => {
    const report = runVerifier(baseEnv, ["--url", "https://sme-workspace-sentinel.vercel.app/"]);
    const checksById = Object.fromEntries(report.accessChecks.map((check) => [check.id, check]));

    expect(report.overallStatus).toBe("blocked");
    expect(report.productUrl).toBe("https://sme-workspace-sentinel.vercel.app");
    expect(checksById["hosted-product-url"]).toMatchObject({
      status: "missing",
      evidence: expect.stringContaining("Product URL configured; HTTPS confirmed; working project access missing")
    });
    expect(report.smokeCommands.find((command) => command.id === "homepage")?.command).toBe(
      "curl -I https://sme-workspace-sentinel.vercel.app/"
    );
    expect(report.blockers.join(" ")).toContain("set XPRIZE_WORKING_PROJECT_ACCESS_CONFIGURED=true only after private proof exists");
  });

  it("falls back to Vercel hosted URL env vars when NEXT_PUBLIC_PRODUCT_URL is not set", () => {
    const report = runVerifier({
      ...baseEnv,
      VERCEL_PROJECT_PRODUCTION_URL: "sme-workspace-sentinel.vercel.app"
    });

    expect(report.productUrl).toBe("https://sme-workspace-sentinel.vercel.app");
    expect(report.smokeCommands.find((command) => command.id === "judge-access-pack")?.command).toContain(
      "https://sme-workspace-sentinel.vercel.app/api/xprize/judge-access-pack"
    );
  });

  it("replaces existing private output without stale bytes or temp leftovers", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-judge-access-existing-output-"));
    const outPath = join(tempDir, "judge-access-readiness.json");

    try {
      writeFileSync(outPath, `{"overallStatus":"stale","padding":"${"x".repeat(1000)}"}\n`, "utf8");

      const report = runVerifier(baseEnv, ["--out", outPath]);
      const outJson = readFileSync(outPath, "utf8");

      expect(report.overallStatus).toBe("blocked");
      expect(JSON.parse(outJson)).toMatchObject({ overallStatus: "blocked" });
      expect(outJson).not.toContain("stale");
      expect(outJson).not.toContain("padding");
      expect(readdirSync(tempDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts the standard /tmp system alias on macOS without temp leftovers", () => {
    if (process.platform !== "darwin") {
      return;
    }

    const tempDir = mkdtempSync("/tmp/sentinel-judge-access-tmp-alias-");
    const outPath = join(tempDir, "judge-access-readiness.json");

    try {
      const report = runVerifier(baseEnv, ["--out", outPath]);

      expect(report.overallStatus).toBe("blocked");
      expect(JSON.parse(readFileSync(outPath, "utf8"))).toMatchObject({ overallStatus: "blocked" });
      expect(readdirSync(tempDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("fails closed when the private output parent is a user-created symlink", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-judge-access-symlink-parent-"));
    const realOutputDir = join(tempDir, "real-output");
    const linkedOutputDir = join(tempDir, "linked-output");
    const outPath = join(linkedOutputDir, "judge-access-readiness.json");
    const realTargetPath = join(realOutputDir, "judge-access-readiness.json");

    try {
      mkdirSync(realOutputDir);
      symlinkSync(realOutputDir, linkedOutputDir, "dir");

      expect(() => runVerifier(baseEnv, ["--out", outPath])).toThrow(/symbolic link/u);
      expect(existsSync(realTargetPath)).toBe(false);
      expect(readdirSync(realOutputDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("passes only when non-secret judge access, demo, free access, and response signals are configured", () => {
    const report = runVerifier({
      ...baseEnv,
      NEXT_PUBLIC_PRODUCT_URL: "https://sentinel.example.com",
      XPRIZE_REPOSITORY_ACCESS_CONFIGURED: "true",
      XPRIZE_SOURCE_CODE_COMPLETE_CONFIRMED: "true",
      XPRIZE_WORKING_PROJECT_ACCESS_CONFIGURED: "true",
      XPRIZE_TESTING_INSTRUCTIONS_CONFIGURED: "true",
      XPRIZE_JUDGE_ACCESS_CONFIGURED: "true",
      XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED: "true",
      XPRIZE_EVIDENCE_RESPONSE_PRIVATE_CONTACT_CONFIGURED: "true",
      XPRIZE_DEMO_VIDEO_URL: "https://youtu.be/sentinel-demo",
      XPRIZE_DEMO_VIDEO_UNDER_3_MIN_CONFIRMED: "true",
      XPRIZE_DEMO_VIDEO_PUBLICLY_ACCESSIBLE_CONFIRMED: "true",
      XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED: "true",
      XPRIZE_DEMO_VIDEO_CUSTOMER_DATA_REDACTED_CONFIRMED: "true",
      XPRIZE_DEMO_VIDEO_ENGLISH_OR_SUBTITLED_CONFIRMED: "true"
    });

    expect(report.overallStatus).toBe("ready");
    expect(report.accessChecks.filter((check) => check.status === "missing" || check.status === "blocked")).toEqual([]);
    expect(report.accessChecks.find((check) => check.id === "private-testing-instructions")?.status).toBe("private-on-request");
    expect(report.accessChecks.find((check) => check.id === "evidence-response-owner")?.status).toBe("private-on-request");
    expect(report.smokeCommands.find((command) => command.id === "homepage")?.command).toBe(
      "curl -I https://sentinel.example.com/"
    );
  });

  it("blocks secret-shaped testing instruction text and rejects secret-shaped CLI arguments", () => {
    const report = runVerifier({
      ...baseEnv,
      XPRIZE_TESTING_INSTRUCTIONS_CONFIGURED: "true",
      XPRIZE_TESTING_INSTRUCTIONS: "password: do-not-store-here"
    });

    expect(report.accessChecks.find((check) => check.id === "private-testing-instructions")).toMatchObject({
      status: "blocked"
    });
    expect(() => runVerifier(baseEnv, ["--api-key=raw-secret"])).toThrow();
    expect(() => runVerifier(baseEnv, ["--url", "https://user:pass@example.com"])).toThrow(/must not include credentials/u);
    expect(() => runVerifier(baseEnv, ["--url", "https://example.com/?token=secret"])).toThrow(/must not include credentials/u);
  });

  it("fails closed when the private packet output path is a symlink", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-judge-access-symlink-"));
    const outPath = join(tempDir, "judge-access-readiness.json");
    const targetPath = join(tempDir, "reviewed-judge-access-readiness.json");

    try {
      writeFileSync(targetPath, "{\"kept\":true}\n", "utf8");
      symlinkSync(targetPath, outPath);

      expect(() => runVerifier(baseEnv, ["--out", outPath])).toThrow(/symbolic link/u);
      expect(readFileSync(targetPath, "utf8")).toBe("{\"kept\":true}\n");
      expect(readdirSync(tempDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function runVerifier(env: NodeJS.ProcessEnv, args: string[] = []) {
  const output = execFileSync(process.execPath, ["scripts/verify-judge-access-pack.mjs", ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  return JSON.parse(output) as JudgeAccessCliReport;
}
