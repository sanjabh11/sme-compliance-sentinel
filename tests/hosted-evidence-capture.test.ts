import { describe, expect, it, beforeEach } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import { buildHostedEvidenceCapturePacket } from "@/lib/hosted-evidence-capture";
import { getDashboardSnapshot, resetState } from "@/lib/store";

describe("hosted evidence capture packet", () => {
  beforeEach(() => {
    resetState();
  });

  it("keeps local and mock evidence out of production proof status", () => {
    const packet = buildHostedEvidenceCapturePacket(getDashboardSnapshot());

    expect(packet.overallStatus).toBe("needs-hosted-proof");
    expect(packet.productUrl).toBe("missing");
    expect(packet.evidenceMode).toBe("mock");
    expect(packet.storageMode).toBe("memory");
    expect(packet.checks.find((check) => check.id === "production-readiness-readonly")?.status).toBe("mock-only");
    expect(packet.checks.find((check) => check.id === "gcp-persistence-proof")?.status).toBe("mock-only");
    expect(packet.checks.find((check) => check.id === "workspace-oauth-sync-proof")?.status).toBe("mock-only");
    expect(packet.checks.find((check) => check.id === "paid-pilot-proof")?.status).toBe("mock-only");
    expect(packet.checks.find((check) => check.id === "hosted-product-url")?.status).toBe("missing");
    expect(packet.blockers).toEqual([]);
    expect(packet.nextActions[0]).toContain("Deploy to Cloud Run");
  });

  it("lists the hosted capture commands and private artifact templates judges will need", () => {
    const packet = buildHostedEvidenceCapturePacket(getDashboardSnapshot());

    expect(packet.captureCommands.map((command) => command.id)).toEqual(
      expect.arrayContaining(["cloudrun-template-strict", "hosted-readonly", "hosted-write-through", "hosted-evidence-packet"])
    );
    expect(packet.captureCommands.find((command) => command.id === "hosted-readonly")?.command).toContain(
      "--release-id $SENTINEL_RELEASE_ID --strict --out /secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-readonly.json"
    );
    expect(packet.captureCommands.find((command) => command.id === "hosted-write-through")?.mutatesProduction).toBe(true);
    expect(packet.captureCommands.find((command) => command.id === "hosted-write-through")?.command).toContain(
      "--release-id $SENTINEL_RELEASE_ID --strict --include-write-checks --out /secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-write.json"
    );
    expect(packet.privateArtifactTemplates.map((template) => template.id)).toEqual(
      expect.arrayContaining([
        "cloud-run-url",
        "cloudrun-deployment-evidence",
        "production-readiness-json",
        "live-gemini-log",
        "firestore-bigquery-secret-proof",
        "workspace-oauth-install",
        "cloud-billing-budget",
        "paid-pilot-financial-proof",
        "judge-access-proof"
      ])
    );
    expect(packet.privateHandling.join(" ")).toContain("Local memory, mock Gemini, template manifests, and seeded pilots");
  });

  it("keeps hosted evidence language inside the claim guard boundary", () => {
    const packet = buildHostedEvidenceCapturePacket(getDashboardSnapshot());
    const violations = scanClaimText({
      artifact: "hosted-evidence-capture",
      text: JSON.stringify(packet, null, 2)
    });

    expect(violations).toEqual([]);
  });
});
