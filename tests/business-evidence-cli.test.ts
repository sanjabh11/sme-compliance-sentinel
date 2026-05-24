import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type BusinessEvidenceReport = {
  overallStatus: "blocked" | "needs-review" | "ready";
  evidencePath: string;
  summary: {
    totalRevenueUsd: number;
    activeUsers: number;
    paidPilotCount: number;
    artifactBucketsReady: number;
  };
  checks: Array<{
    id: string;
    status: "missing" | "blocked" | "needs-review" | "ready";
    evidence: string;
    requiredBeforeSubmit: boolean;
  }>;
  blockers: string[];
  requiredPrivateArtifacts: string[];
  stopConditions: string[];
  sourceUrls: string[];
  disclaimer: string;
};

const baseEnv = {
  ...process.env,
  XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED: "false",
  XPRIZE_REVENUE_BY_MONTH_EVIDENCE_CONFIGURED: "false",
  XPRIZE_TOTAL_COSTS_EVIDENCE_CONFIGURED: "false",
  XPRIZE_CAC_SPEND_EVIDENCE_CONFIGURED: "false",
  XPRIZE_REAL_USER_EVIDENCE_CONFIGURED: "false",
  XPRIZE_TESTIMONIAL_CONSENT_CONFIRMED: "false",
  XPRIZE_RELATED_PARTY_REVENUE_REVIEWED: "false",
  XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED: "false"
};

describe("business evidence CLI verifier", () => {
  it("blocks when no private business evidence file is supplied", () => {
    const report = runVerifier(baseEnv);
    const checksById = Object.fromEntries(report.checks.map((check) => [check.id, check]));

    expect(report.overallStatus).toBe("blocked");
    expect(report.evidencePath).toBe("missing");
    expect(checksById["business-evidence-file"]).toMatchObject({ status: "missing" });
    expect(report.blockers.join(" ")).toContain("write-template");
    expect(report.requiredPrivateArtifacts).toEqual(
      expect.arrayContaining(["invoices", "paymentRecords", "activeUserLogs", "costRecords", "cacReceipts", "relatedPartyReview"])
    );
    expect(report.stopConditions.join(" ")).toContain("does not create customers");
    expect(report.disclaimer).toContain("not financial advice");
    expect(report.sourceUrls).toEqual(
      expect.arrayContaining(["https://xprize.devpost.com/rules", "https://www.geminixprize.com/rules"])
    );
  });

  it("writes a private template and fails strict mode while evidence is missing", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-business-evidence-"));
    const templatePath = join(tempDir, "business-evidence-template.json");
    const outPath = join(tempDir, "business-evidence-readiness.json");

    try {
      const report = runVerifier(baseEnv, ["--write-template", templatePath, "--out", outPath]);

      expect(readFileSync(templatePath, "utf8")).toContain('"schema": "sme-sentinel-business-evidence-v1"');
      expect(readFileSync(outPath, "utf8")).toContain('"overallStatus": "blocked"');
      expect(report.overallStatus).toBe("blocked");
      expect(() => runVerifier(baseEnv, ["--strict"])).toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("passes with redacted paid-pilot revenue, monthly revenue, cost, user, consent, and related-party proof", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-business-ready-"));
    const evidencePath = join(tempDir, "business-evidence.json");

    try {
      writeFileSync(evidencePath, JSON.stringify(readyEvidence(), null, 2), "utf8");
      const report = runVerifier(baseEnv, ["--evidence", evidencePath]);
      const checksById = Object.fromEntries(report.checks.map((check) => [check.id, check]));

      expect(report.overallStatus).toBe("ready");
      expect(report.summary.totalRevenueUsd).toBe(398);
      expect(report.summary.activeUsers).toBe(4);
      expect(report.summary.artifactBucketsReady).toBe(6);
      expect(checksById["arms-length-revenue"]).toMatchObject({ status: "ready" });
      expect(checksById["monthly-revenue-breakdown"]).toMatchObject({ status: "ready" });
      expect(checksById["costs-and-cac"]).toMatchObject({ status: "ready" });
      expect(checksById["real-user-evidence"]).toMatchObject({ status: "ready" });
      expect(checksById["testimonial-consent"]).toMatchObject({ status: "ready" });
      expect(checksById["related-party-revenue"]).toMatchObject({ status: "ready" });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks business claim flags when the private evidence file is incomplete", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-business-incomplete-"));
    const evidencePath = join(tempDir, "business-evidence.json");

    try {
      writeFileSync(evidencePath, JSON.stringify({ ...readyEvidence(), totalRevenueUsd: 0 }), "utf8");
      const report = runVerifier(
        {
          ...baseEnv,
          XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED: "true",
          XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED: "true"
        },
        ["--evidence", evidencePath]
      );

      expect(report.overallStatus).toBe("blocked");
      expect(report.checks.find((check) => check.id === "business-evidence-flag-boundary")).toMatchObject({
        status: "blocked"
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects secret-shaped CLI arguments", () => {
    expect(() => runVerifier(baseEnv, ["--api-key=raw-secret"])).toThrow();
  });
});

function readyEvidence() {
  return {
    schema: "sme-sentinel-business-evidence-v1",
    totalRevenueUsd: 398,
    revenueByMonth: { May: 0, June: 0, July: 199, August: 199 },
    totalCostsUsd: 83,
    costDescription: "Cloud hosting, Gemini API usage, and basic outreach tooling.",
    customerAcquisitionSpendUsd: 0,
    armsLengthCustomerCount: 2,
    paidPilotCount: 2,
    activeUsers: 4,
    userBreakdown: [{ segment: "seed-stage founder", count: 4 }],
    relatedPartyRevenueUsd: 0,
    relatedPartyNotes: "No related-party revenue is included in total revenue.",
    testimonials: [{ customerAlias: "Pilot A", quoteRedacted: "Reduced buyer-questionnaire prep time.", consentConfirmed: true }],
    artifacts: {
      invoices: [artifact("invoice")],
      paymentRecords: [artifact("payment")],
      activeUserLogs: [artifact("active-users")],
      costRecords: [artifact("costs")],
      cacReceipts: [artifact("cac-zero")],
      testimonialConsents: [artifact("testimonial-consent")],
      relatedPartyReview: [artifact("related-party")]
    }
  };
}

function artifact(id: string) {
  return {
    id,
    status: "verified",
    redacted: true,
    sha256: "a".repeat(64),
    privatePath: `/secure/local/${id}.json`,
    owner: "founder",
    reviewedAt: "2026-08-16T12:00:00Z"
  };
}

function runVerifier(env: NodeJS.ProcessEnv, args: string[] = []) {
  const output = execFileSync(process.execPath, ["scripts/verify-business-evidence.mjs", ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  return JSON.parse(output) as BusinessEvidenceReport;
}
