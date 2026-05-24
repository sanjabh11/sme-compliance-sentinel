import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";

type AttestationPacket = {
  overallStatus: "blocked" | "ready-for-human-review" | "ready-to-apply-reviewed-flags";
  summary: {
    blocked: number;
    needsReview: number;
    externalRequired: number;
    passed: number;
  };
  localSubmission: {
    overallStatus: string;
  };
  reviewGates: Array<{
    id: string;
    status: "blocked" | "needs-review" | "external-required" | "passed";
    ownerRole: string;
    requiredEvidence: string[];
  }>;
  flagDecisionRegister: Array<{
    envFlag: string;
    currentValue: boolean;
    recommendedAction: string;
    setWhen: string;
  }>;
  devpostDisclosureDraft: {
    publicSafeDraft: string[];
    privateOnlyNotes: string[];
  };
  outputFiles?: {
    jsonPath: string;
    markdownPath: string;
  };
  disclaimer: string;
};

const attestationEnv = {
  ...process.env,
  XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED: "false",
  XPRIZE_THIRD_PARTY_REVIEW_APPROVED: "false",
  XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED: "false",
  XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED: "false"
};

describe("XPRIZE human attestation packet CLI", () => {
  it("builds a private human-review packet without approving XPRIZE flags", () => {
    const packet = runPacket();
    const gatesById = Object.fromEntries(packet.reviewGates.map((gate) => [gate.id, gate]));
    const flagsByName = Object.fromEntries(packet.flagDecisionRegister.map((flag) => [flag.envFlag, flag]));

    expect(["blocked", "ready-for-human-review"]).toContain(packet.overallStatus);
    expect(packet.localSubmission.overallStatus).toBe("blocked");
    expect(gatesById["project-created-after-start-attestation"]).toBeDefined();
    expect(gatesById["third-party-license-api-review"]).toMatchObject({
      status: "needs-review",
      ownerRole: "legal"
    });
    expect(gatesById["hosted-production-proof-boundary"]).toMatchObject({
      status: "external-required",
      ownerRole: "engineering"
    });
    expect(flagsByName.XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED).toMatchObject({
      currentValue: false,
      recommendedAction: "keep-false-until-reviewed"
    });
    expect(flagsByName.XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED.setWhen).toContain("deployed Gemini API call");
    expect(packet.devpostDisclosureDraft.publicSafeDraft.join(" ")).toContain("Small Business Services");
    expect(packet.devpostDisclosureDraft.privateOnlyNotes.join(" ")).toContain("Do not claim SOC2 compliance");
    expect(packet.disclaimer).toContain("not legal advice");
  });

  it("writes JSON and Markdown review artifacts to a private output directory", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-xprize-attestation-"));

    try {
      const packet = runPacket(["--out-dir", tempDir]);

      expect(packet.outputFiles?.jsonPath).toBe(join(tempDir, "xprize-human-attestation-packet.json"));
      expect(packet.outputFiles?.markdownPath).toBe(join(tempDir, "xprize-human-attestation-packet.md"));
      expect(readFileSync(packet.outputFiles?.jsonPath ?? "", "utf8")).toContain('"flagDecisionRegister"');
      expect(readFileSync(packet.outputFiles?.markdownPath ?? "", "utf8")).toContain("# XPRIZE Human Attestation Packet");
      expect(() => runPacket(["--strict"])).toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects secret-shaped CLI arguments and keeps generated language claim-safe", () => {
    expect(() => runPacket(["--token=raw-token"])).toThrow();

    const packet = runPacket();
    const violations = scanClaimText({
      artifact: "xprize-attestation-packet",
      text: JSON.stringify(packet, null, 2)
    });

    expect(violations).toEqual([]);
  });
});

function runPacket(args: string[] = []) {
  const output = execFileSync(process.execPath, ["scripts/prepare-xprize-attestation-packet.mjs", ...args], {
    cwd: process.cwd(),
    env: attestationEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  return JSON.parse(output) as AttestationPacket;
}
