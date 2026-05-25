import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface GeminiModelReadinessModule {
  buildGeminiModelReadinessReport: (options?: { now?: string }) => {
    overallStatus: string;
    selectedModel: string;
    sdkPackage: string;
    allowlistModels: string[];
    checks: Array<{ id: string; status: string; evidence: string; fix: string }>;
    proofBoundary: string;
  };
}

describe("Gemini model and SDK readiness verifier", () => {
  it("passes current local SDK/model config against the reviewed official-doc snapshot", async () => {
    const readinessModule = await importGeminiModelReadiness();
    const report = readinessModule.buildGeminiModelReadinessReport({ now: "2026-05-24T12:00:00.000Z" });
    const checksById = Object.fromEntries(report.checks.map((check) => [check.id, check]));

    expect(report.overallStatus).toBe("passed");
    expect(report.sdkPackage).toBe("@google/genai");
    expect(report.selectedModel).toBe("gemini-3.5-flash");
    expect(report.allowlistModels).toEqual(["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-pro"]);
    expect(checksById["current-genai-sdk-direct-dependency"]).toMatchObject({ status: "passed" });
    expect(checksById["legacy-generative-ai-sdk-removed"]).toMatchObject({ status: "passed" });
    expect(checksById["allowlist-excludes-deprecated-preview-latest"]).toMatchObject({ status: "passed" });
    expect(report.proofBoundary).toContain("does not call Gemini");
  });

  it("CLI writes a non-secret JSON readiness packet", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-gemini-model-"));
    const outPath = join(tempDir, "gemini-model-readiness.json");

    try {
      const output = execFileSync(process.execPath, ["scripts/verify-gemini-model-readiness.mjs", "--out", outPath, "--strict"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      const report = JSON.parse(output) as { overallStatus: string; checks: Array<{ id: string; status: string }> };

      expect(report.overallStatus).toBe("passed");
      expect(report.checks.find((check) => check.id === "cloudrun-model-aligned")).toMatchObject({
        status: "passed"
      });
      expect(readFileSync(outPath, "utf8")).toContain('"sdkPackage": "@google/genai"');
      expect(readdirSync(tempDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("replaces existing readiness output without stale bytes or temp leftovers", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-gemini-model-existing-output-"));
    const outPath = join(tempDir, "gemini-model-readiness.json");

    try {
      writeFileSync(outPath, `{"overallStatus":"stale","padding":"${"x".repeat(1000)}"}\n`, "utf8");

      const output = execFileSync(process.execPath, ["scripts/verify-gemini-model-readiness.mjs", "--out", outPath, "--strict"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      const outJson = readFileSync(outPath, "utf8");

      expect(JSON.parse(output)).toMatchObject({ overallStatus: "passed" });
      expect(JSON.parse(outJson)).toMatchObject({ overallStatus: "passed" });
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

    const tempDir = mkdtempSync("/tmp/sentinel-gemini-model-tmp-alias-");
    const outPath = join(tempDir, "gemini-model-readiness.json");

    try {
      const output = execFileSync(process.execPath, ["scripts/verify-gemini-model-readiness.mjs", "--out", outPath, "--strict"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });

      expect(JSON.parse(output)).toMatchObject({ overallStatus: "passed" });
      expect(JSON.parse(readFileSync(outPath, "utf8"))).toMatchObject({ overallStatus: "passed" });
      expect(readdirSync(tempDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("fails closed when the readiness output parent is a user-created symlink", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-gemini-model-symlink-parent-"));
    const realOutputDir = join(tempDir, "real-output");
    const linkedOutputDir = join(tempDir, "linked-output");
    const outPath = join(linkedOutputDir, "gemini-model-readiness.json");
    const realTargetPath = join(realOutputDir, "gemini-model-readiness.json");

    try {
      mkdirSync(realOutputDir);
      symlinkSync(realOutputDir, linkedOutputDir, "dir");

      expect(() =>
        execFileSync(process.execPath, ["scripts/verify-gemini-model-readiness.mjs", "--out", outPath, "--strict"], {
          cwd: process.cwd(),
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

  it("fails closed when the readiness output path is a symlink", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-gemini-model-symlink-output-"));
    const outPath = join(tempDir, "gemini-model-readiness.json");
    const targetPath = join(tempDir, "reviewed-gemini-model-readiness.json");

    try {
      writeFileSync(targetPath, "{\"kept\":true}\n", "utf8");
      symlinkSync(targetPath, outPath);

      expect(() =>
        execFileSync(process.execPath, ["scripts/verify-gemini-model-readiness.mjs", "--out", outPath, "--strict"], {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"]
        })
      ).toThrow(/symbolic link/u);
      expect(readFileSync(targetPath, "utf8")).toBe("{\"kept\":true}\n");
      expect(readdirSync(tempDir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

async function importGeminiModelReadiness() {
  // @ts-expect-error The Gemini readiness verifier is an executable ESM script without a TypeScript declaration file.
  return (await import("../scripts/verify-gemini-model-readiness.mjs")) as GeminiModelReadinessModule;
}
