import { afterEach, describe, expect, it, vi } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import { buildJudgeAccessPack } from "@/lib/judge-access";
import { GET } from "@/app/api/xprize/judge-access-pack/route";

describe("judge access pack", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("blocks final access when hosted URL, private judge access, free access, and demo proof are missing", () => {
    const pack = buildJudgeAccessPack();
    const checksById = Object.fromEntries(pack.accessChecks.map((check) => [check.id, check]));

    expect(pack.overallStatus).toBe("blocked");
    expect(pack.productUrl).toBe("missing");
    expect(pack.repositoryUrl).toContain("github.com/sanjabh11/sme-compliance-sentinel");
    expect(checksById["hosted-product-url"].status).toBe("missing");
    expect(checksById["judge-testing-instructions"].status).toBe("missing");
    expect(checksById["free-judging-period-access"].status).toBe("missing");
    expect(checksById["repository-access"].status).toBe("missing");
    expect(checksById["support-and-evidence-response"].status).toBe("missing");
    expect(checksById["demo-reset-and-seeded-data"].status).toBe("ready");
    expect(pack.blockers.join(" ")).toContain("Deploy the app");
    expect(pack.privateCredentialRules.join(" ")).toContain("Do not commit judge usernames");
    expect(JSON.stringify(pack)).not.toContain("password:");
    expect(JSON.stringify(pack)).not.toContain("Bearer ");
  });

  it("prepares safe walkthrough and smoke commands without requiring secrets in source", () => {
    const pack = buildJudgeAccessPack();

    expect(pack.walkthrough.map((step) => step.id)).toEqual(
      expect.arrayContaining(["open-dashboard", "reset-demo", "hybrid-scan", "hitl-remediation", "evidence-surfaces"])
    );
    expect(pack.walkthrough.find((step) => step.id === "hybrid-scan")?.proofBoundary).toContain("provider=gemini-api");
    expect(pack.smokeCommands.map((command) => command.id)).toEqual(
      expect.arrayContaining(["homepage", "readiness", "submission-gate", "judge-access-pack", "claim-guard"])
    );
    expect(pack.smokeCommands.find((command) => command.id === "judge-access-pack")?.command).toContain(
      "/api/xprize/judge-access-pack"
    );
    expect(pack.evidenceResponsePlan.map((item) => item.id)).toEqual(
      expect.arrayContaining(["judge-login-support", "hosted-url-proof", "demo-video-access-proof", "free-access-proof"])
    );
  });

  it("moves into ready status only when every access confirmation is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRODUCT_URL", "https://sentinel.example.com");
    vi.stubEnv("XPRIZE_REPOSITORY_ACCESS_CONFIGURED", "true");
    vi.stubEnv("XPRIZE_SOURCE_CODE_COMPLETE_CONFIRMED", "true");
    vi.stubEnv("XPRIZE_WORKING_PROJECT_ACCESS_CONFIGURED", "true");
    vi.stubEnv("XPRIZE_TESTING_INSTRUCTIONS_CONFIGURED", "true");
    vi.stubEnv("XPRIZE_JUDGE_ACCESS_CONFIGURED", "true");
    vi.stubEnv("XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED", "true");
    vi.stubEnv("XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS", "2");
    vi.stubEnv("XPRIZE_EVIDENCE_RESPONSE_PRIVATE_CONTACT_CONFIGURED", "true");
    vi.stubEnv("XPRIZE_DEMO_VIDEO_URL", "https://youtu.be/sentinel-demo");
    vi.stubEnv("XPRIZE_DEMO_VIDEO_UNDER_3_MIN_CONFIRMED", "true");
    vi.stubEnv("XPRIZE_DEMO_VIDEO_PUBLICLY_ACCESSIBLE_CONFIRMED", "true");
    vi.stubEnv("XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED", "true");
    vi.stubEnv("XPRIZE_DEMO_VIDEO_CUSTOMER_DATA_REDACTED_CONFIRMED", "true");
    vi.stubEnv("XPRIZE_DEMO_VIDEO_ENGLISH_OR_SUBTITLED_CONFIRMED", "true");
    vi.resetModules();

    const { buildJudgeAccessPack } = await import("@/lib/judge-access");
    const pack = buildJudgeAccessPack();

    expect(pack.overallStatus).toBe("ready");
    expect(pack.productUrl).toBe("https://sentinel.example.com");
    expect(pack.accessChecks.every((check) => check.status !== "missing")).toBe(true);
    expect(pack.nextActions[0]).toContain("Smoke-test the hosted URL");
  });

  it("serves the packet from the API route", async () => {
    const response = await GET();
    const pack = await response.json();

    expect(pack.overallStatus).toBe("blocked");
    expect(pack.smokeCommands.length).toBeGreaterThanOrEqual(5);
  });

  it("keeps judge access copy inside the claim guard boundary", () => {
    const pack = buildJudgeAccessPack();
    const violations = scanClaimText({
      artifact: "judge-access-pack",
      text: JSON.stringify(pack, null, 2)
    });

    expect(violations).toEqual([]);
  });
});
