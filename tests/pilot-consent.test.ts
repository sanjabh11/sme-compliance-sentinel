import { describe, expect, it } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import { buildPilotConsentPacket } from "@/lib/pilot-consent";
import { getDashboardSnapshot, registerEvidenceVaultArtifact, resetState } from "@/lib/store";

describe("pilot consent and scope packet", () => {
  it("generates a fixed-scope consent packet before Workspace OAuth access", () => {
    resetState();

    const packet = buildPilotConsentPacket(getDashboardSnapshot());

    expect(packet.packetTitle).toContain("Google Workspace risk scan consent");
    expect(packet.status).toBe("blocked");
    expect(packet.targetProspect?.fitScore).toBeGreaterThanOrEqual(80);
    expect(packet.oauthScopes.map((scope) => scope.scope)).toContain("https://www.googleapis.com/auth/drive.metadata.readonly");
    expect(packet.oauthScopes.find((scope) => scope.scope === "https://www.googleapis.com/auth/drive")?.status).toBe("deferred");
    expect(packet.evidenceArtifacts.map((artifact) => artifact.kind)).toEqual(
      expect.arrayContaining(["pilot-consent", "workspace-oauth-log", "gemini-usage-log", "pilot-invoice", "payment-export"])
    );
    expect(packet.consentChecklist.map((item) => item.evidenceArtifactKind)).toContain("pilot-consent");
    expect(packet.blockers.join(" ")).toContain("OAuth client credentials");
    expect(scanClaimText({ artifact: "pilot-consent-packet", text: packet.exportText })).toEqual([]);
  });

  it("recognizes signed redacted consent without treating missing OAuth as ready", () => {
    resetState();
    registerEvidenceVaultArtifact({
      id: "signed_pilot_consent",
      kind: "pilot-consent",
      label: "Signed pilot consent",
      status: "verified",
      ownerRole: "legal",
      redacted: true,
      checksumSha256: "b".repeat(64),
      sourceDescription: "Signed customer scope packet stored privately."
    });

    const packet = buildPilotConsentPacket(getDashboardSnapshot());
    const signatureStep = packet.consentChecklist.find((item) => item.id === "signature");

    expect(signatureStep?.status).toBe("ready");
    expect(packet.status).toBe("needs-proof");
    expect(packet.nextActions.join(" ")).toContain("Configure Google OAuth");
  });
});
