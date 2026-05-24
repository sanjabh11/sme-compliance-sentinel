import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const runVitestScript = readFileSync(join(process.cwd(), "scripts/run-vitest.mjs"), "utf8");

describe("package verification scripts", () => {
  it("keeps standard verification commands on stable local runner paths", () => {
    expect(packageJson.scripts.test).toBe("node scripts/run-vitest.mjs");
    expect(packageJson.scripts.build).toBe("node scripts/run-next-build.mjs");
    expect(packageJson.scripts["verify:local-submission"]).toBe("node scripts/verify-local-submission.mjs");
    expect(packageJson.scripts["verify:source-release"]).toBe("node scripts/verify-source-release.mjs");
    expect(packageJson.scripts["verify:provenance"]).toBe("node scripts/verify-project-provenance.mjs");
    expect(packageJson.scripts["verify:license-manifest"]).toBe("node scripts/verify-license-manifest.mjs");
    expect(packageJson.scripts["verify:cloudrun-deployment"]).toBe("node scripts/verify-cloudrun-deployment.mjs");
    expect(packageJson.scripts["verify:cloudrun-render-evidence"]).toBe("node scripts/audit-cloudrun-render-values.mjs --verify-packet");
    expect(packageJson.scripts["verify:judge-access"]).toBe("node scripts/verify-judge-access-pack.mjs");
    expect(packageJson.scripts["verify:business-evidence"]).toBe("node scripts/verify-business-evidence.mjs");
    expect(packageJson.scripts["prepare:local-submission-bundle"]).toBe("node scripts/verify-local-submission.mjs --bundle-dir");
    expect(packageJson.scripts["prepare:submission-summary"]).toBe("node scripts/verify-local-submission.mjs --markdown-out");
    expect(packageJson.scripts["prepare:manual-intervention"]).toBe("node scripts/verify-local-submission.mjs --manual-packets-dir");
    expect(packageJson.scripts["verify:manual-intervention"]).toBe("node scripts/verify-local-submission.mjs --verify-manifest");
    expect(packageJson.scripts["verify:local-submission-bundle"]).toBe("node scripts/verify-local-submission.mjs --verify-bundle");
    expect(packageJson.scripts["prepare:xprize-attestation"]).toBe("node scripts/prepare-xprize-attestation-packet.mjs");
  });

  it("keeps Vitest temp files in an ignored repo-local directory", () => {
    expect(runVitestScript).toContain('join(process.cwd(), ".tmp", "vitest")');
    expect(runVitestScript).toContain("process.env.TMPDIR = testTempDir");
    expect(runVitestScript).toContain("--testTimeout=30000");
    expect(runVitestScript).toContain("--hookTimeout=30000");
    expect(readFileSync(join(process.cwd(), ".gitignore"), "utf8")).toContain(".tmp/");
  });
});
