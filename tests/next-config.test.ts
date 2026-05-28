import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Next.js deployment packaging", () => {
  it("bundles the Cloud Run manifest template for hosted proof APIs", async () => {
    const configText = await readFile("next.config.mjs", "utf8");
    const proofRoutes = [
      "/api/production/deployment-evidence",
      "/api/production/deployment-packet",
      "/api/production/hosted-evidence"
    ];

    for (const route of proofRoutes) {
      expect(configText).toContain(`"${route}": ["./cloudrun.service.yaml"]`);
    }
  });
});
