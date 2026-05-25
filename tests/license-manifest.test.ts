import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import { buildThirdPartyManifest } from "@/lib/license-manifest";

describe("third-party license manifest", () => {
  it("summarizes direct dependencies, transitive packages, and Google API integrations", () => {
    const manifest = buildThirdPartyManifest();

    expect(manifest.packageManager).toBe("npm");
    expect(manifest.lockfileVersion).toBeGreaterThanOrEqual(3);
    expect(manifest.summary.totalPackages).toBeGreaterThan(10);
    expect(manifest.summary.directRuntimeDependencies).toBeGreaterThanOrEqual(5);
    expect(manifest.packages.some((item) => item.name === "next" && item.direct && item.scope === "runtime")).toBe(true);
    expect(manifest.packages.some((item) => item.name === "@google/genai" && item.direct)).toBe(true);
    expect(manifest.integrations.map((item) => item.name)).toEqual(
      expect.arrayContaining(["Gemini API", "Google Cloud", "Google Workspace APIs"])
    );
    expect(manifest.summary.status).toBe("warning");
    expect(manifest.summary.restrictedLicenseReviewCount).toBe(0);
    expect(manifest.summary.obligationReviewCount).toBeGreaterThan(0);
    expect(manifest.summary.licenseNeedsReviewCount).toBeGreaterThan(0);
    expect(manifest.blockers).toEqual([]);
    expect(manifest.packages.filter((item) => item.reviewStatus === "obligation-review").map((item) => item.name)).toEqual(
      expect.arrayContaining(["@img/sharp-libvips-darwin-arm64"])
    );
    expect(
      manifest.packages.find((item) => item.name === "@img/sharp-libvips-darwin-arm64")?.notes
    ).toContain("LGPL-style obligations");
    expect(manifest.disclosureText.join(" ")).toContain("package.json");
    expect(manifest.nextActions.join(" ")).toContain("LGPL-style package obligations");
    expect(manifest.nextActions.join(" ")).toContain("XPRIZE_THIRD_PARTY_REVIEW_APPROVED");
    expect(manifest.reviewPacket.sourceDigests.packageJsonSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(manifest.reviewPacket.sourceDigests.packageLockSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(manifest.reviewPacket.approvalEnvFlags).toEqual(
      expect.arrayContaining(["XPRIZE_THIRD_PARTY_REVIEW_APPROVED", "XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED"])
    );
    expect(manifest.reviewPacket.ruleTraceability.map((item) => item.ruleArea)).toEqual(
      expect.arrayContaining(["third-party-use", "ip-ownership", "demo-assets", "repository-licensing"])
    );
    expect(manifest.reviewPacket.requiredPrivateArtifacts.join(" ")).toContain("OAuth consent-screen");
    expect(manifest.reviewPacket.clearanceChecklist.find((item) => item.id === "source-digest-inventory")).toMatchObject({
      status: "passed",
      ownerRole: "engineering"
    });
    expect(manifest.reviewPacket.clearanceChecklist.find((item) => item.id === "restricted-or-unknown-license-screen")).toMatchObject({
      status: "passed",
      ownerRole: "legal"
    });
    expect(manifest.reviewPacket.clearanceChecklist.find((item) => item.id === "notice-and-obligation-review")).toMatchObject({
      status: "needs-review",
      ruleArea: "repository-licensing"
    });
    expect(manifest.reviewPacket.clearanceChecklist.find((item) => item.id === "demo-and-screenshot-asset-clearance")).toMatchObject({
      status: "needs-review",
      ruleArea: "demo-assets"
    });
  });

  it("keeps manifest language inside the claim guard boundary", () => {
    const manifest = buildThirdPartyManifest();
    const violations = scanClaimText({
      artifact: "license-manifest",
      text: JSON.stringify(manifest, null, 2)
    });

    expect(violations).toEqual([]);
  });

  it("CLI verifier emits a hash-bound review packet and fails strict mode while review is pending", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-license-manifest-"));
    const outPath = join(tempDir, "license-manifest.json");

    try {
      const output = execFileSync(process.execPath, ["scripts/verify-license-manifest.mjs", "--out", outPath], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          XPRIZE_THIRD_PARTY_REVIEW_APPROVED: "false",
          XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED: "false",
          XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED: "false",
          XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED: "false"
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      const report = JSON.parse(output) as {
        overallStatus: string;
        sourceDigests: { packageJsonSha256: string; packageLockSha256: string };
        summary: {
          totalPackages: number;
          restrictedLicenseReviewCount: number;
          obligationReviewCount: number;
          licenseNeedsReviewCount: number;
        };
        checks: Array<{ id: string; status: string; evidence: string }>;
        blockers: string[];
      };
      const checksById = Object.fromEntries(report.checks.map((check) => [check.id, check]));

      expect(report.overallStatus).toBe("warning");
      expect(report.sourceDigests.packageJsonSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(report.sourceDigests.packageLockSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(report.summary.totalPackages).toBeGreaterThan(10);
      expect(report.summary.restrictedLicenseReviewCount).toBe(0);
      expect(report.summary.obligationReviewCount).toBeGreaterThan(0);
      expect(report.summary.licenseNeedsReviewCount).toBeGreaterThan(0);
      expect(report.blockers).toEqual([]);
      expect(checksById["restricted-or-unknown-license-screen"]).toMatchObject({ status: "passed" });
      expect(checksById["notice-and-obligation-review"]).toMatchObject({ status: "warning" });
      expect(checksById["google-api-terms-review"]).toMatchObject({ status: "warning" });
      expect(checksById["demo-and-screenshot-asset-clearance"]).toMatchObject({ status: "warning" });
      expect(readFileSync(outPath, "utf8")).toContain('"overallStatus": "warning"');
      expect(readdirSync(tempDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);

      expect(() =>
        execFileSync(process.execPath, ["scripts/verify-license-manifest.mjs", "--strict"], {
          cwd: process.cwd(),
          env: { ...process.env, XPRIZE_THIRD_PARTY_REVIEW_APPROVED: "false" },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"]
        })
      ).toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("CLI verifier replaces existing private review packets without stale bytes or temp leftovers", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-license-manifest-existing-output-"));
    const outPath = join(tempDir, "license-manifest.json");

    try {
      writeFileSync(outPath, `{"overallStatus":"stale","padding":"${"x".repeat(1000)}"}\n`, "utf8");

      const output = execFileSync(process.execPath, ["scripts/verify-license-manifest.mjs", "--out", outPath], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          XPRIZE_THIRD_PARTY_REVIEW_APPROVED: "false",
          XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED: "false",
          XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED: "false",
          XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED: "false"
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      const outJson = readFileSync(outPath, "utf8");

      expect(JSON.parse(output)).toMatchObject({ overallStatus: "warning" });
      expect(JSON.parse(outJson)).toMatchObject({ overallStatus: "warning" });
      expect(outJson).not.toContain("stale");
      expect(outJson).not.toContain("padding");
      expect(readdirSync(tempDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("CLI verifier accepts the standard /tmp system alias on macOS without temp leftovers", () => {
    if (process.platform !== "darwin") {
      return;
    }

    const tempDir = mkdtempSync("/tmp/sentinel-license-manifest-tmp-alias-");
    const outPath = join(tempDir, "license-manifest.json");

    try {
      const output = execFileSync(process.execPath, ["scripts/verify-license-manifest.mjs", "--out", outPath], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          XPRIZE_THIRD_PARTY_REVIEW_APPROVED: "false",
          XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED: "false",
          XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED: "false",
          XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED: "false"
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });

      expect(JSON.parse(output)).toMatchObject({ overallStatus: "warning" });
      expect(JSON.parse(readFileSync(outPath, "utf8"))).toMatchObject({ overallStatus: "warning" });
      expect(readdirSync(tempDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("CLI verifier fails closed when the private review packet parent is a user-created symlink", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-license-manifest-symlink-parent-"));
    const realOutputDir = join(tempDir, "real-output");
    const linkedOutputDir = join(tempDir, "linked-output");
    const outPath = join(linkedOutputDir, "license-manifest.json");
    const realTargetPath = join(realOutputDir, "license-manifest.json");

    try {
      mkdirSync(realOutputDir);
      symlinkSync(realOutputDir, linkedOutputDir, "dir");

      expect(() =>
        execFileSync(process.execPath, ["scripts/verify-license-manifest.mjs", "--out", outPath], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            XPRIZE_THIRD_PARTY_REVIEW_APPROVED: "false",
            XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED: "false",
            XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED: "false",
            XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED: "false"
          },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"]
        })
      ).toThrow(/symbolic link/u);
      expect(existsSync(realTargetPath)).toBe(false);
      expect(readdirSync(realOutputDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("CLI verifier fails closed when the private review packet path is a symlink", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-license-manifest-symlink-"));
    const outPath = join(tempDir, "license-manifest.json");
    const targetPath = join(tempDir, "reviewed-license-manifest.json");

    try {
      writeFileSync(targetPath, "{}", "utf8");
      symlinkSync(targetPath, outPath);

      expect(() =>
        execFileSync(process.execPath, ["scripts/verify-license-manifest.mjs", "--out", outPath], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            XPRIZE_THIRD_PARTY_REVIEW_APPROVED: "false",
            XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED: "false",
            XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED: "false",
            XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED: "false"
          },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"]
        })
      ).toThrow(/symbolic link/u);
      expect(readFileSync(targetPath, "utf8")).toBe("{}");
      expect(readdirSync(tempDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("CLI verifier rejects missing output paths and unsupported arguments", () => {
    expect(() =>
      execFileSync(process.execPath, ["scripts/verify-license-manifest.mjs", "--out"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      })
    ).toThrow(/--out requires/u);

    expect(() =>
      execFileSync(process.execPath, ["scripts/verify-license-manifest.mjs", "--not-supported"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      })
    ).toThrow(/Unsupported argument/u);
  });
});
