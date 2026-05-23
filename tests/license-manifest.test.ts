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
    expect(manifest.packages.some((item) => item.name === "@google/generative-ai" && item.direct)).toBe(true);
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
  });

  it("keeps manifest language inside the claim guard boundary", () => {
    const manifest = buildThirdPartyManifest();
    const violations = scanClaimText({
      artifact: "license-manifest",
      text: JSON.stringify(manifest, null, 2)
    });

    expect(violations).toEqual([]);
  });
});
