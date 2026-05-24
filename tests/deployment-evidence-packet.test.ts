import { describe, expect, it } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import { buildDeploymentEvidencePacket } from "@/lib/deployment-evidence-packet";
import { GET } from "@/app/api/production/deployment-packet/route";

describe("deployment evidence packet", () => {
  it("keeps the checked-in template in setup-needed status without claiming hosted proof", () => {
    const packet = buildDeploymentEvidencePacket();

    expect(packet.status).toBe("template-needs-values");
    expect(packet.deploymentStatus).toBe("template-needs-values");
    expect(packet.releaseId).toBe("RELEASE_ID");
    expect(packet.productUrl).toBe("https://YOUR-CLOUD-RUN-URL");
    expect(packet.privateEvidenceBucket).toBe("gs://PROJECT_ID-sentinel-private-evidence");
    expect(packet.blockers).toEqual([]);
    expect(packet.nextActions).toEqual(
      expect.arrayContaining([
        "SENTINEL_RELEASE_ID must be replaced with the release id used for Cloud Run and source proof.",
        "NEXT_PUBLIC_PRODUCT_URL must be set to the hosted Cloud Run URL before hosted proof capture.",
        "SENTINEL_PRIVATE_EVIDENCE_BUCKET must point to the private store for logs, screenshots, invoices, and judge artifacts.",
        "SENTINEL_ADMIN_ACTION_TOKEN must be configured in Secret Manager before write-through proof capture or hosted Evidence Vault imports."
      ])
    );
    expect(packet.disclaimer).toContain("Deployment evidence remains pending");
  });

  it("builds a complete artifact and command sequence for the private judge packet", () => {
    const packet = buildDeploymentEvidencePacket();

    expect(packet.artifactManifest.map((artifact) => artifact.id)).toEqual(
      expect.arrayContaining([
        "local-quality-gates-log",
        "cloudrun-render-values-audit-json",
        "cloudrun-render-evidence-packet-json",
        "cloudrun-render-summary-json",
        "cloudrun-manifest-verifier-json",
        "cloudrun-dry-run-preflight-json",
        "cloudrun-dry-run-packet-verifier-json",
        "cloudrun-dry-run-log",
        "cloudrun-deploy-log",
        "cloudrun-describe-json",
        "cloudrun-deployment-transcript-packet-json",
        "verify-production-readonly-json",
        "verify-production-write-json",
        "hosted-evidence-json",
        "hosted-proof-bundle-manifest-json",
        "hosted-proof-release-evidence-json",
        "evidence-vault-import-request-json",
        "deployment-command-results-template-json",
        "deployment-execution-checklist-json",
        "evidence-vault-import-response-json",
        "source-release-json",
        "provenance-json"
      ])
    );
    expect(packet.commandSequence.map((command) => command.id)).toEqual(
      expect.arrayContaining([
        "cloudrun-render-values-audit",
        "cloudrun-render-manifest",
        "cloudrun-template-strict",
        "cloudrun-dry-run-preflight",
        "cloudrun-dry-run-packet-verify",
        "cloudrun-dry-run",
        "cloudrun-deploy",
        "cloudrun-deployment-transcript-collect",
        "hosted-readonly",
        "hosted-write-through",
        "hosted-proof-bundle",
        "hosted-proof-import-dry-run",
        "deployment-execution-checklist",
        "hosted-proof-import-confirm",
        "source-release",
        "provenance"
      ])
    );
    expect(packet.commandSequence.find((command) => command.id === "hosted-write-through")?.requiresAdminToken).toBe(true);
    expect(packet.commandSequence.find((command) => command.id === "cloudrun-render-values-audit")?.command).toContain(
      "npm run audit:cloudrun-values"
    );
    expect(packet.commandSequence.find((command) => command.id === "cloudrun-render-manifest")?.command).toContain(
      "npm run render:cloudrun-manifest"
    );
    expect(packet.commandSequence.find((command) => command.id === "cloudrun-dry-run-preflight")?.command).toContain(
      "npm run prepare:cloudrun-dry-run"
    );
    expect(packet.commandSequence.find((command) => command.id === "cloudrun-dry-run-packet-verify")?.command).toContain(
      "npm run verify:cloudrun-dry-run-packet"
    );
    expect(packet.commandSequence.find((command) => command.id === "cloudrun-dry-run-packet-verify")?.expectedArtifactId).toBe(
      "cloudrun-dry-run-packet-verifier-json"
    );
    expect(packet.commandSequence.find((command) => command.id === "cloudrun-dry-run")?.command).toContain(
      "artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun.service.rendered.yaml"
    );
    expect(packet.commandSequence.find((command) => command.id === "cloudrun-deployment-transcript-collect")?.command).toContain(
      "npm run collect:cloudrun-deployment"
    );
    expect(packet.commandSequence.find((command) => command.id === "cloudrun-deployment-transcript-collect")?.expectedArtifactId).toBe(
      "cloudrun-deployment-transcript-packet-json"
    );
    expect(packet.artifactManifest.find((artifact) => artifact.id === "verify-production-readonly-json")?.sourceCommand).toContain(
      "--out /secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-readonly.json"
    );
    expect(packet.artifactManifest.find((artifact) => artifact.id === "verify-production-write-json")?.sourceCommand).toContain(
      "--out /secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-write.json"
    );
    expect(packet.commandSequence.find((command) => command.id === "hosted-readonly")?.command).toContain(
      "--release-id $SENTINEL_RELEASE_ID --strict --out /secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-readonly.json"
    );
    expect(packet.commandSequence.find((command) => command.id === "hosted-write-through")?.command).toContain(
      "--release-id $SENTINEL_RELEASE_ID --strict --include-write-checks --out /secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-write.json"
    );
    expect(packet.commandSequence.map((command) => command.id)).not.toContain("vault-import");
    expect(packet.commandSequence.find((command) => command.id === "hosted-proof-bundle")?.command).toContain(
      "npm run collect:hosted-proof"
    );
    expect(packet.commandSequence.find((command) => command.id === "hosted-proof-bundle")?.mutatesProduction).toBe(true);
    expect(packet.commandSequence.find((command) => command.id === "hosted-proof-bundle")?.requiresAdminToken).toBe(true);
    expect(packet.commandSequence.find((command) => command.id === "hosted-proof-import-dry-run")?.command).toContain(
      "npm run import:hosted-proof"
    );
    expect(packet.commandSequence.find((command) => command.id === "hosted-proof-import-dry-run")?.command).toContain("--dry-run");
    expect(packet.commandSequence.find((command) => command.id === "deployment-execution-checklist")?.command).toContain(
      "npm run prepare:deployment-execution-checklist"
    );
    expect(packet.commandSequence.find((command) => command.id === "deployment-execution-checklist")?.expectedArtifactId).toBe(
      "deployment-execution-checklist-json"
    );
    expect(packet.commandSequence.find((command) => command.id === "deployment-execution-checklist")?.command).not.toContain("Bearer ");
    expect(packet.commandSequence.find((command) => command.id === "deployment-execution-checklist")?.command).not.toContain(
      "x-sentinel-admin-token"
    );
    expect(packet.commandSequence.findIndex((command) => command.id === "hosted-proof-import-dry-run")).toBeLessThan(
      packet.commandSequence.findIndex((command) => command.id === "deployment-execution-checklist")
    );
    expect(packet.commandSequence.findIndex((command) => command.id === "deployment-execution-checklist")).toBeLessThan(
      packet.commandSequence.findIndex((command) => command.id === "hosted-proof-import-confirm")
    );
    expect(packet.commandSequence.find((command) => command.id === "hosted-proof-import-confirm")?.command).toContain(
      "--confirm-import"
    );
    expect(packet.commandSequence.find((command) => command.id === "hosted-proof-import-confirm")?.requiresAdminToken).toBe(true);
    expect(packet.commandSequence.find((command) => command.id === "hosted-proof-import-confirm")?.command).not.toContain("Bearer ");
    expect(packet.commandSequence.find((command) => command.id === "hosted-proof-import-confirm")?.command).not.toContain(
      "x-sentinel-admin-token"
    );
    expect(packet.redactionChecklist.join(" ")).toContain("OAuth client secrets");
  });

  it("turns commands and artifacts into a stop-gated private deployment runbook", () => {
    const packet = buildDeploymentEvidencePacket();

    expect(packet.runbook.map((step) => step.id)).toEqual([
      "local-release-preflight",
      "render-and-verify-manifest",
      "dry-run-and-deploy-cloudrun",
      "hosted-production-proof",
      "redacted-evidence-vault-import"
    ]);
    expect(packet.runbook[0]).toMatchObject({
      phase: "local-preflight",
      externalProofRequired: false
    });
    expect(packet.runbook[1]).toMatchObject({
      phase: "manifest-render",
      requiredArtifactIds: [
        "cloudrun-render-values-audit-json",
        "cloudrun-render-evidence-packet-json",
        "cloudrun-render-summary-json",
        "cloudrun-manifest-verifier-json",
        "cloudrun-dry-run-preflight-json",
        "cloudrun-dry-run-packet-verifier-json"
      ]
    });
    expect(packet.runbook[1].proofFiles).toEqual(
      expect.arrayContaining([
        "gs://PROJECT_ID-sentinel-private-evidence/releases/RELEASE_ID/cloudrun-render-values-audit.json",
        "gs://PROJECT_ID-sentinel-private-evidence/releases/RELEASE_ID/cloudrun-render-evidence-packet.json",
        "gs://PROJECT_ID-sentinel-private-evidence/releases/RELEASE_ID/cloudrun-render-summary.json",
        "gs://PROJECT_ID-sentinel-private-evidence/releases/RELEASE_ID/cloudrun-manifest-verifier.json",
        "gs://PROJECT_ID-sentinel-private-evidence/releases/RELEASE_ID/cloudrun-dry-run-preflight-packet.json",
        "gs://PROJECT_ID-sentinel-private-evidence/releases/RELEASE_ID/cloudrun-dry-run-packet-verifier.json"
      ])
    );
    expect(packet.runbook[2].stopCondition).toContain("dry-run fails");
    expect(packet.runbook[2].requiredArtifactIds).toEqual(
      expect.arrayContaining([
        "cloudrun-dry-run-log",
        "cloudrun-deploy-log",
        "cloudrun-describe-json",
        "cloudrun-deployment-transcript-packet-json"
      ])
    );
    expect(packet.runbook[2].proofFiles).toEqual(
      expect.arrayContaining([
        "gs://PROJECT_ID-sentinel-private-evidence/releases/RELEASE_ID/cloudrun-deployment-transcript-packet.json"
      ])
    );
    expect(packet.runbook[3].requiredArtifactIds).toEqual(
      expect.arrayContaining(["hosted-proof-bundle-manifest-json", "hosted-proof-release-evidence-json"])
    );
    expect(packet.runbook[3].proofFiles).toEqual(
      expect.arrayContaining([
        "gs://PROJECT_ID-sentinel-private-evidence/releases/RELEASE_ID/hosted-proof-bundle/manifest.json",
        "gs://PROJECT_ID-sentinel-private-evidence/releases/RELEASE_ID/hosted-proof-bundle/release-evidence-manifest.json"
      ])
    );
    expect(packet.runbook[3].stopCondition).toContain("provider=gemini-api");
    expect(packet.runbook[3].stopCondition).toContain("release integrity is not passed");
    expect(packet.runbook[4].requiredArtifactIds).toEqual(
      expect.arrayContaining([
        "deployment-command-results-template-json",
        "deployment-execution-checklist-json",
        "evidence-vault-import-request-json",
        "evidence-vault-import-response-json"
      ])
    );
    expect(packet.runbook[4].proofFiles).toEqual(
      expect.arrayContaining([
        "gs://PROJECT_ID-sentinel-private-evidence/releases/RELEASE_ID/hosted-proof-bundle/deployment-command-results.json",
        "gs://PROJECT_ID-sentinel-private-evidence/releases/RELEASE_ID/hosted-proof-bundle/deployment-execution-checklist.json"
      ])
    );
    expect(packet.runbook[4].stopCondition).toContain("deployment execution checklist");
    expect(packet.runbook[4].stopCondition).toContain("release integrity is not passed");
    expect(packet.runbook[4].redactionCheck).toContain("checksums");
    expect(packet.runbook.filter((step) => step.externalProofRequired)).toHaveLength(3);
  });

  it("prepares an import template without replacing real hosted proof JSON", () => {
    const packet = buildDeploymentEvidencePacket();

    expect(packet.evidenceVaultImportTemplate.source).toBe("verify-production");
    expect(packet.evidenceVaultImportTemplate.redacted).toBe(true);
    expect(packet.evidenceVaultImportTemplate.sourceUrl).toBe("https://YOUR-CLOUD-RUN-URL");
    expect(packet.evidenceVaultImportTemplate.ownerNote).toContain("Replace payload with redacted hosted verify:production JSON");
    expect(packet.evidenceVaultImportTemplate.payload).toMatchObject({
      baseUrl: "https://YOUR-CLOUD-RUN-URL",
      strict: true,
      summary: {
        total: 0,
        passedTransport: 0,
        failedTransport: 0,
        blockedOrNeedsReview: 0
      },
      results: []
    });
  });

  it("serves the packet from the production API route", async () => {
    const response = await GET();
    const packet = await response.json();

    expect(packet.status).toBe("template-needs-values");
    expect(packet.commandSequence.length).toBeGreaterThan(8);
    expect(packet.runbook.length).toBe(5);
  });

  it("keeps packet copy inside the claim guard boundary", () => {
    const packet = buildDeploymentEvidencePacket();
    const violations = scanClaimText({
      artifact: "deployment-evidence-packet",
      text: JSON.stringify(packet, null, 2)
    });

    expect(violations).toEqual([]);
  });
});
