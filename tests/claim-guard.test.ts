import { describe, expect, it } from "vitest";
import { buildClaimGuardResult, scanClaimText, scanRepositoryClaims } from "@/lib/claim-guard";

describe("claim guard", () => {
  it("blocks unqualified compliance and absolute win claims", () => {
    const violations = scanClaimText({
      artifact: "demo-copy",
      text: "We are SOC2 certified, fully compliant, and 100% confident this will win."
    });

    expect(violations.map((violation) => violation.phrase)).toEqual(
      expect.arrayContaining(["SOC2 certified", "fully compliant", "100% confident this will win"])
    );
    expect(violations.some((violation) => violation.severity === "critical")).toBe(true);
  });

  it("allows explicit boundary and questionnaire contexts", () => {
    const result = buildClaimGuardResult([
      {
        artifact: "safe-copy",
        text: [
          "The product provides SOC2 readiness evidence and risk detection.",
          "It does not provide audit assurance or legal advice.",
          "A redacted judge evidence packet is generated for review.",
          "Question: Are you SOC2 certified?"
        ].join("\n")
      }
    ]);

    expect(result.status).toBe("passed");
    expect(result.violations).toHaveLength(0);
  });

  it("passes the current repository submission copy", async () => {
    const result = await scanRepositoryClaims();

    expect(result.status).toBe("passed");
    expect(result.violations).toHaveLength(0);
    expect(result.scannedArtifacts).toBeGreaterThan(5);
  });
});
