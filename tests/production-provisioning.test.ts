import { describe, expect, it } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import { buildProductionProvisioningPack } from "@/lib/production-provisioning";

describe("production provisioning pack", () => {
  it("turns Cloud Run deployment into a non-secret operator runbook", () => {
    const pack = buildProductionProvisioningPack();

    expect(pack.status).toBe("needs-values");
    expect(pack.manifestPath).toBe("cloudrun.service.yaml");
    expect(pack.renderValuesTemplatePath).toBe("docs/deployment/cloudrun-render-values.template.json");
    expect(pack.serviceName).toBe("sme-workspace-sentinel");
    expect(pack.requiredApis).toEqual(
      expect.arrayContaining([
        "run.googleapis.com",
        "secretmanager.googleapis.com",
        "firestore.googleapis.com",
        "bigquery.googleapis.com",
        "pubsub.googleapis.com",
        "storage.googleapis.com",
        "dlp.googleapis.com",
        "generativelanguage.googleapis.com"
      ])
    );
    expect(pack.secretNames).toEqual(
      expect.arrayContaining([
        "gemini-api-key",
        "sentinel-admin-action-token",
        "google-oauth-client-secret",
        "sentinel-evidence-signing-secret",
        "workspace-drive-channel-token"
      ])
    );
    expect(pack.commands.map((command) => command.id)).toEqual(
      expect.arrayContaining([
        "enable-apis",
        "create-runtime-service-account",
        "grant-pubsub-token-creator",
        "create-private-evidence-bucket",
        "dry-run-cloudrun",
        "deploy-cloudrun",
        "describe-cloudrun"
      ])
    );
    expect(pack.dryRunCommand).toContain("--dry-run");
    expect(pack.deployCommand).toContain("gcloud run services replace artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun.service.rendered.yaml");
    expect(pack.commands.find((command) => command.id === "build-container")?.command).toContain(
      "us-central1-docker.pkg.dev/PROJECT_ID/sentinel/web:$SENTINEL_RELEASE_ID"
    );
    expect(pack.commands.find((command) => command.id === "create-artifact-repository")?.command).toContain(
      "--location us-central1"
    );
    expect(pack.verificationSequence.map((command) => command.id)).toEqual(
      expect.arrayContaining([
        "local-quality-gates",
        "write-render-values-template",
        "audit-render-values",
        "render-cloudrun-manifest",
        "prepare-cloudrun-dry-run",
        "verify-cloudrun-dry-run-packet",
        "manifest-regression",
        "collect-cloudrun-deployment-transcript",
        "hosted-smoke",
        "write-through-smoke"
      ])
    );
    expect(pack.verificationSequence.findIndex((command) => command.id === "audit-render-values")).toBeLessThan(
      pack.verificationSequence.findIndex((command) => command.id === "render-cloudrun-manifest")
    );
    expect(pack.verificationSequence.findIndex((command) => command.id === "render-cloudrun-manifest")).toBeLessThan(
      pack.verificationSequence.findIndex((command) => command.id === "prepare-cloudrun-dry-run")
    );
    expect(pack.verificationSequence.findIndex((command) => command.id === "prepare-cloudrun-dry-run")).toBeLessThan(
      pack.verificationSequence.findIndex((command) => command.id === "verify-cloudrun-dry-run-packet")
    );
    expect(pack.verificationSequence.findIndex((command) => command.id === "verify-cloudrun-dry-run-packet")).toBeLessThan(
      pack.verificationSequence.findIndex((command) => command.id === "manifest-regression")
    );
    expect(pack.verificationSequence.findIndex((command) => command.id === "manifest-regression")).toBeLessThan(
      pack.verificationSequence.findIndex((command) => command.id === "collect-cloudrun-deployment-transcript")
    );
    expect(pack.verificationSequence.findIndex((command) => command.id === "collect-cloudrun-deployment-transcript")).toBeLessThan(
      pack.verificationSequence.findIndex((command) => command.id === "hosted-smoke")
    );
    expect(pack.verificationSequence.find((command) => command.id === "audit-render-values")?.command).toContain(
      "npm run audit:cloudrun-values"
    );
    expect(pack.verificationSequence.find((command) => command.id === "audit-render-values")?.expectedProof).toContain(
      "ready-to-render"
    );
    expect(pack.verificationSequence.find((command) => command.id === "prepare-cloudrun-dry-run")?.command).toContain(
      "npm run prepare:cloudrun-dry-run"
    );
    expect(pack.verificationSequence.find((command) => command.id === "prepare-cloudrun-dry-run")?.expectedProof).toContain(
      "ready-to-dry-run"
    );
    expect(pack.verificationSequence.find((command) => command.id === "verify-cloudrun-dry-run-packet")?.command).toContain(
      "cloudrun-dry-run-preflight-packet.json"
    );
    expect(pack.verificationSequence.find((command) => command.id === "verify-cloudrun-dry-run-packet")?.expectedProof).toContain(
      "cloudrun-dry-run-packet-verifier.json"
    );
    expect(pack.verificationSequence.find((command) => command.id === "collect-cloudrun-deployment-transcript")?.command).toContain(
      "npm run collect:cloudrun-deployment"
    );
    expect(pack.verificationSequence.find((command) => command.id === "collect-cloudrun-deployment-transcript")?.expectedProof).toContain(
      "cloudrun-deployment-transcript-packet.json"
    );
    expect(pack.verificationSequence.map((command) => command.id)).toContain("import-hosted-proof");
  });

  it("keeps secrets and XPRIZE attestations inside explicit safety boundaries", () => {
    const pack = buildProductionProvisioningPack();
    const allCommands = pack.commands.map((command) => command.command).join("\n");

    expect(allCommands).not.toContain("GEMINI_API_KEY=");
    expect(allCommands).not.toContain("GOOGLE_OAUTH_CLIENT_SECRET=");
    expect(allCommands).not.toContain("WORKSPACE_DRIVE_CHANNEL_TOKEN=");
    expect(allCommands).not.toContain("SENTINEL_EVIDENCE_SIGNING_SECRET=");
    expect(allCommands).not.toContain("SENTINEL_ADMIN_ACTION_TOKEN=");
    expect(allCommands).not.toContain("GOOGLE_CLOUD_ACCESS_TOKEN");
    expect(allCommands).not.toContain("REGION-docker.pkg.dev");
    expect(allCommands).not.toContain("/web:latest");
    expect(pack.commands.filter((command) => command.requiresSecretInput).every((command) => command.command.includes("--data-file="))).toBe(true);
    expect(pack.verificationSequence.find((command) => command.id === "import-hosted-proof")?.command).toContain(
      "x-sentinel-admin-token: $SENTINEL_ADMIN_ACTION_TOKEN"
    );
    expect(pack.checklist.find((item) => item.id === "human-attestations")?.status).toBe("manual-review");
    expect(pack.checklist.find((item) => item.id === "xprize-category")?.status).toBe("configured");
    expect(pack.checklist.find((item) => item.id === "xprize-business-evidence-attestations")?.status).toBe(
      "manual-review"
    );
    expect(pack.checklist.find((item) => item.id === "admin-action-token")?.status).toBe("missing");
    expect(pack.checklist.find((item) => item.id === "source-revision-metadata")?.status).toBe("missing");
    expect(pack.privateHandlingRules.join(" ")).toContain("Secret Manager");
    expect(pack.privateHandlingRules.join(" ")).toContain("cloudrun-render-values.template.json");
    expect(pack.privateHandlingRules.join(" ")).toContain("audit:cloudrun-values");
    expect(pack.privateHandlingRules.join(" ")).toContain("verify:cloudrun-dry-run-packet");
    expect(pack.privateHandlingRules.join(" ")).toContain("collect:cloudrun-deployment");

    const violations = scanClaimText({
      artifact: "production-provisioning",
      text: JSON.stringify(pack, null, 2)
    });

    expect(violations).toEqual([]);
  });
});
