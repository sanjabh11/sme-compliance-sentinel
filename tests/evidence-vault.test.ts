import { afterEach, describe, expect, it, vi } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import { buildEvidenceIntakeQueue } from "@/lib/evidence-intake";
import { buildEvidenceVault } from "@/lib/evidence-vault";
import { getDashboardSnapshot, registerEvidenceVaultArtifact, resetState } from "@/lib/store";

describe("private evidence vault", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a private proof register for business, AI, and submission artifacts", () => {
    resetState();

    const vault = buildEvidenceVault(getDashboardSnapshot());

    expect(vault.evidenceMode).toBe("mock");
    expect(vault.requiredArtifacts.length).toBeGreaterThanOrEqual(15);
    expect(vault.summary.missing).toBeGreaterThan(0);
    expect(vault.summary["mock-only"]).toBeGreaterThan(0);
    expect(vault.requiredArtifacts.map((artifact) => artifact.id)).toContain("vault_product_url_proof");
    expect(vault.requiredArtifacts.some((artifact) => artifact.kind === "pilot-invoice" && artifact.status === "missing")).toBe(true);
    expect(vault.blockers.join(" ")).toContain("Evidence Vault artifacts are not persisted");
    expect(vault.disclaimer).toContain("private proof register");
  });

  it("lets admins register redacted artifacts without treating local mode as production proof", () => {
    resetState();

    const { artifact, snapshot } = registerEvidenceVaultArtifact({
      id: "vault_invoice_pilot_founder_ops_003",
      kind: "pilot-invoice",
      label: "Founder-led operations team invoice/payment proof",
      status: "verified",
      ownerRole: "finance",
      redacted: true,
      checksumSha256: "a".repeat(64),
      sourceDescription: "Private payment export checksum stored in admin vault.",
      linkedPilotId: "pilot_founder_ops_003",
      amountUsd: 199
    });
    const vault = snapshot.readiness.evidenceVault;
    const registered = vault.requiredArtifacts.find((candidate) => candidate.id === artifact.id);

    expect(artifact.status).toBe("verified");
    expect(registered?.status).toBe("verified");
    expect(registered?.blocker).toBeUndefined();
    expect(vault.summary.verified).toBeGreaterThanOrEqual(1);
    expect(vault.blockers.join(" ")).toContain("SENTINEL_EVIDENCE_MODE");
    expect(snapshot.auditEvents[0].type).toBe("risk_score_snapshot_created");
    expect(snapshot.auditEvents.some((event) => event.type === "evidence_vault_artifact_registered")).toBe(true);
  });

  it("prioritizes private proof intake from conversion and submission blockers", () => {
    resetState();

    const queue = buildEvidenceIntakeQueue(getDashboardSnapshot());
    const queueText = [
      queue.disclaimer,
      ...queue.claimBoundaries,
      ...queue.items.flatMap((item) => [item.whyNeeded, item.nextAction, ...item.acceptedProof, ...item.redactionChecklist])
    ].join("\n");

    expect(queue.overallStatus).toBe("blocked");
    expect(queue.evidenceMode).toBe("mock");
    expect(queue.proofQualityScore).toBeGreaterThanOrEqual(0);
    expect(queue.criticalMissing).toBeGreaterThan(0);
    expect(queue.items.map((item) => item.kind)).toEqual(expect.arrayContaining(["pilot-consent", "pilot-invoice", "payment-export", "active-user-log"]));
    expect(queue.items.filter((item) => item.priority === "p0").length).toBeGreaterThanOrEqual(4);
    expect(queue.items[0].registrationPayload.status).toBe("requested");
    expect(queue.nextActions.join(" ")).toContain("priority-zero");
    expect(scanClaimText({ artifact: "evidence-intake-queue", text: queueText })).toEqual([]);
  });

  it("does not treat configured product or demo URLs as complete proof without access and clearance confirmations", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRODUCT_URL", "https://sentinel.example.com");
    vi.stubEnv("XPRIZE_DEMO_VIDEO_URL", "https://youtu.be/sentinel-demo");
    vi.resetModules();

    const { buildEvidenceVault } = await import("@/lib/evidence-vault");
    const { getDashboardSnapshot, resetState } = await import("@/lib/store");

    resetState();
    const vault = buildEvidenceVault(getDashboardSnapshot());
    const productUrlProof = vault.requiredArtifacts.find((artifact) => artifact.id === "vault_product_url_proof");
    const demoVideoProof = vault.requiredArtifacts.find((artifact) => artifact.id === "vault_demo_video_proof");

    expect(productUrlProof?.status).toBe("missing");
    expect(productUrlProof?.sourceDescription).toContain("judge access missing");
    expect(productUrlProof?.sourceDescription).toContain("free judging-period access missing");
    expect(demoVideoProof?.status).toBe("missing");
    expect(demoVideoProof?.sourceDescription).toContain("under 3 minutes missing");
    expect(demoVideoProof?.sourceDescription).toContain("customer-data redaction missing");
  });
});
