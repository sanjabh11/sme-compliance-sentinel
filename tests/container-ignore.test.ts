import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function readIgnoreFile(path: string) {
  const content = await readFile(path, "utf8");
  return new Set(
    content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
  );
}

describe("container and Cloud Build ignore files", () => {
  it("keeps local build, private deployment, and tool artifacts out of Docker contexts", async () => {
    const dockerIgnore = await readIgnoreFile(".dockerignore");
    const requiredPatterns = [
      ".git",
      ".next",
      ".vercel",
      ".codex/config.toml",
      "artifacts",
      "node_modules",
      "*.tsbuildinfo",
      ".env",
      ".env.local",
      ".env.*.local",
      "!.env.example"
    ];

    for (const pattern of requiredPatterns) {
      expect(dockerIgnore.has(pattern), `.dockerignore should include ${pattern}`).toBe(true);
    }
  });

  it("keeps local/private artifacts out of gcloud source uploads while retaining the example env file", async () => {
    const gcloudIgnore = await readIgnoreFile(".gcloudignore");
    const requiredPatterns = [
      ".git",
      ".next",
      ".vercel",
      ".codex/config.toml",
      "artifacts",
      "node_modules",
      "*.tsbuildinfo",
      ".env",
      ".env.local",
      ".env.*.local",
      "!.env.example"
    ];

    for (const pattern of requiredPatterns) {
      expect(gcloudIgnore.has(pattern), `.gcloudignore should include ${pattern}`).toBe(true);
    }
  });
});
