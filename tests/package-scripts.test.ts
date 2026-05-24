import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("package verification scripts", () => {
  it("keeps standard verification commands on stable local runner paths", () => {
    expect(packageJson.scripts.test).toBe("node scripts/run-vitest.mjs");
    expect(packageJson.scripts.build).toBe("node scripts/run-next-build.mjs");
    expect(packageJson.scripts["verify:local-submission"]).toBe("node scripts/verify-local-submission.mjs");
    expect(packageJson.scripts["verify:source-release"]).toBe("node scripts/verify-source-release.mjs");
    expect(packageJson.scripts["verify:provenance"]).toBe("node scripts/verify-project-provenance.mjs");
    expect(packageJson.scripts["verify:license-manifest"]).toBe("node scripts/verify-license-manifest.mjs");
    expect(packageJson.scripts["verify:cloudrun-deployment"]).toBe("node scripts/verify-cloudrun-deployment.mjs");
  });
});
