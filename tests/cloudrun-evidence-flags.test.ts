import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import contract from "../docs/deployment/cloudrun-deployment-contract.json";
import { buildCloudRunDeploymentEvidence } from "@/lib/cloudrun-deployment";

const manifest = readFileSync(join(process.cwd(), "cloudrun.service.yaml"), "utf8");
const renderValuesTemplate = JSON.parse(
  readFileSync(join(process.cwd(), "docs/deployment/cloudrun-render-values.template.json"), "utf8")
) as Record<string, string>;

const requiredBusinessEvidenceFlags = [
  "XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED",
  "XPRIZE_CATEGORY_IMPACT_EVIDENCE_CONFIGURED",
  "XPRIZE_AI_NATIVE_OPERATIONS_EVIDENCE_CONFIGURED",
  "XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED",
  "XPRIZE_EVIDENCE_RESPONSE_READY"
];

describe("Cloud Run XPRIZE evidence flags", () => {
  it("keeps business, category, AI-native, IP, and evidence-response flags in the deployment contract", () => {
    expect(contract.requiredNonSecretEnv).toEqual(expect.arrayContaining(requiredBusinessEvidenceFlags));
    expect(contract.manualReviewEnv).toEqual(expect.arrayContaining(requiredBusinessEvidenceFlags));

    for (const flag of requiredBusinessEvidenceFlags) {
      expect(manifest).toMatch(new RegExp(`- name: ${flag}\\n\\s+value: "false"`));
      expect(renderValuesTemplate[flag]).toBe("false");
    }
  });

  it("keeps the new evidence flags manual-review even when an operator sets them true", () => {
    const attestedManifest = requiredBusinessEvidenceFlags.reduce(
      (source, flag) => source.replace(`name: ${flag}\n              value: "false"`, `name: ${flag}\n              value: "true"`),
      manifest
    );
    const evidence = buildCloudRunDeploymentEvidence(attestedManifest);
    const checksByName = Object.fromEntries(evidence.envChecks.map((check) => [check.name, check]));

    for (const flag of requiredBusinessEvidenceFlags) {
      expect(checksByName[flag]).toMatchObject({
        status: "manual-review",
        currentValue: "true"
      });
    }
  });
});
