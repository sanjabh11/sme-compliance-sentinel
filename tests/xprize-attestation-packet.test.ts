import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import contract from "../docs/deployment/cloudrun-deployment-contract.json";

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
    ownerRole: string;
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
    expect(packet.flagDecisionRegister.map((flag) => flag.envFlag)).toEqual(contract.manualReviewEnv);
    expect(new Set(packet.flagDecisionRegister.map((flag) => flag.envFlag)).size).toBe(contract.manualReviewEnv.length);
    expect(flagsByName.XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED.setWhen).toContain("deployed Gemini API call");
    expect(flagsByName.XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED.setWhen).toContain("free of charge");
    expect(flagsByName.XPRIZE_DEMO_VIDEO_CUSTOMER_DATA_REDACTED_CONFIRMED.ownerRole).toBe("marketing");
    expect(flagsByName.GOOGLE_OAUTH_SCOPE_REVIEW_CONFIRMED.ownerRole).toBe("engineering");
    expect(flagsByName.SENTINEL_GEMINI_QUOTA_EVIDENCE_CONFIRMED.setWhen).toContain("quota settings");
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
      expect(readdirSync(tempDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
      expect(() => runPacket(["--strict"])).toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("replaces existing private review artifacts without stale bytes or temp leftovers", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-xprize-attestation-existing-output-"));
    const jsonPath = join(tempDir, "xprize-human-attestation-packet.json");
    const markdownPath = join(tempDir, "xprize-human-attestation-packet.md");

    try {
      writeFileSync(jsonPath, `{"overallStatus":"stale","padding":"${"x".repeat(1000)}"}\n`, "utf8");
      writeFileSync(markdownPath, `# Stale\n\n${"y".repeat(1000)}\n`, "utf8");

      const packet = runPacket(["--out-dir", tempDir]);
      const jsonText = readFileSync(jsonPath, "utf8");
      const markdownText = readFileSync(markdownPath, "utf8");

      expect(packet.outputFiles).toMatchObject({ jsonPath, markdownPath });
      expect(JSON.parse(jsonText)).toHaveProperty("flagDecisionRegister");
      expect(markdownText).toContain("# XPRIZE Human Attestation Packet");
      expect(`${jsonText}${markdownText}`).not.toContain("stale");
      expect(`${jsonText}${markdownText}`).not.toContain("padding");
      expect(`${jsonText}${markdownText}`).not.toContain("# Stale");
      expect(readdirSync(tempDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts the standard /tmp system alias on macOS without temp leftovers", () => {
    if (process.platform !== "darwin") {
      return;
    }

    const tempDir = mkdtempSync("/tmp/sentinel-xprize-attestation-tmp-alias-");

    try {
      const packet = runPacket(["--out-dir", tempDir]);

      expect(packet.outputFiles?.jsonPath).toBe(join(tempDir, "xprize-human-attestation-packet.json"));
      expect(readFileSync(packet.outputFiles?.jsonPath ?? "", "utf8")).toContain('"flagDecisionRegister"');
      expect(readdirSync(tempDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
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

  it("fails closed when the output directory or packet files are symlinks", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-xprize-attestation-symlink-"));
    const symlinkedOutDir = join(tempDir, "symlinked-output");
    const realOutDir = join(tempDir, "reviewed-output");
    const packetOutDir = join(tempDir, "packet-output");
    const jsonTargetPath = join(tempDir, "reviewed-xprize-human-attestation-packet.json");
    const markdownTargetPath = join(tempDir, "reviewed-xprize-human-attestation-packet.md");

    try {
      mkdirSync(realOutDir);
      symlinkSync(realOutDir, symlinkedOutDir);

      expect(() => runPacket(["--out-dir", symlinkedOutDir])).toThrow(/symbolic link/u);
      expect(existsSync(join(realOutDir, "xprize-human-attestation-packet.json"))).toBe(false);
      expect(existsSync(join(realOutDir, "xprize-human-attestation-packet.md"))).toBe(false);
      expect(readdirSync(realOutDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);

      mkdirSync(packetOutDir);
      writeFileSync(jsonTargetPath, "{\"kept\":true}\n", "utf8");
      symlinkSync(jsonTargetPath, join(packetOutDir, "xprize-human-attestation-packet.json"));

      expect(() => runPacket(["--out-dir", packetOutDir])).toThrow(/symbolic link/u);
      expect(readFileSync(jsonTargetPath, "utf8")).toBe("{\"kept\":true}\n");
      expect(readdirSync(packetOutDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);

      rmSync(join(packetOutDir, "xprize-human-attestation-packet.json"), { force: true });
      writeFileSync(markdownTargetPath, "# Reviewed\n", "utf8");
      symlinkSync(markdownTargetPath, join(packetOutDir, "xprize-human-attestation-packet.md"));

      expect(() => runPacket(["--out-dir", packetOutDir])).toThrow(/symbolic link/u);
      expect(readFileSync(markdownTargetPath, "utf8")).toBe("# Reviewed\n");
      expect(readdirSync(packetOutDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
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
