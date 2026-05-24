import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import contract from "../docs/deployment/cloudrun-deployment-contract.json";
import { buildCloudRunDeploymentEvidence, collectCloudRunDeploymentEvidence } from "@/lib/cloudrun-deployment";

interface CloudRunRenderModule {
  getCloudRunRenderContractSummary: () => {
    renderValueKeys: string[];
    manualReviewValueKeys: string[];
    secretVersionKeys: string[];
    secretVersionEnvNames: Record<string, string>;
    prohibitedRawSecretKeys: string[];
  };
  writeRenderValuesTemplate: (outputPath?: string) => Promise<{
    keyCount: number;
  }>;
}

const manifestPath = join(process.cwd(), "cloudrun.service.yaml");
const manifest = readFileSync(manifestPath, "utf8");

describe("Cloud Run deployment contract", () => {
  it("keeps the checked-in manifest aligned with the required non-secret and Secret Manager env contract", () => {
    const entries = parseEnvEntries(manifest);
    const nonSecretNames = contract.requiredNonSecretEnv;
    const secretRefs = contract.requiredSecretEnv;
    const secretNames = secretRefs.map((entry) => entry.envName);

    expect(contract.requiredServiceShape).toMatchObject({
      ingress: "all",
      maxScale: "5",
      executionEnvironment: "gen2",
      startupCpuBoost: "true",
      containerConcurrency: "80",
      timeoutSeconds: "60",
      containerPort: "3000",
      cpu: "1",
      memory: "1Gi"
    });
    expect(entries.map((entry) => entry.name)).toEqual([...nonSecretNames, ...secretNames]);

    for (const name of nonSecretNames) {
      const entry = entries.find((item) => item.name === name);
      expect(entry, `${name} must exist in cloudrun.service.yaml`).toBeDefined();
      expect(entry?.value, `${name} must be a non-secret env value`).toBeDefined();
      expect(entry?.secretName, `${name} must not use Secret Manager`).toBeUndefined();
    }

    for (const secretRef of secretRefs) {
      const entry = entries.find((item) => item.name === secretRef.envName);
      expect(entry, `${secretRef.envName} must exist in cloudrun.service.yaml`).toBeDefined();
      expect(entry?.value, `${secretRef.envName} must not expose a raw value`).toBeUndefined();
      expect(entry?.secretName).toBe(secretRef.secretName);
      expect(entry?.secretVersion).toMatch(/^[1-9][0-9]*$/u);
      expect(manifest).toContain(`${secretRef.secretName}:projects/PROJECT_NUMBER/secrets/${secretRef.secretName}`);
    }

    for (const name of contract.prohibitedCredentialEnv) {
      expect(entries.map((entry) => entry.name)).not.toContain(name);
    }

    for (const dependency of contract.evidenceFlagDependencies) {
      expect(contract.manualReviewEnv).toContain(dependency.flag);
      expect(dependency.evidence).toMatch(/\S/u);
      dependency.requires.forEach((name) => {
        expect(contract.manualReviewEnv).toContain(name);
      });
    }
  });

  it("keeps the TypeScript verifier and CLI verifier enforcing the same deployment contract", () => {
    const libraryReport = collectCloudRunDeploymentEvidence();
    const cliReport = JSON.parse(execFileSync("node", ["scripts/verify-cloudrun-deployment.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8"
    })) as {
      overallStatus: string;
      envChecks: Array<{ name: string; status: string }>;
      manualReviewFlags: string[];
      secretRefs: Array<{ envName: string; secretName: string; version: string }>;
      blockers: string[];
    };
    const requiredCheckNames = [
      ...contract.requiredNonSecretEnv,
      ...contract.requiredSecretEnv.map((entry) => entry.envName),
      ...contract.requiredSecretEnv.map((entry) => `${entry.envName}_SECRET_ANNOTATION`),
      "CLOUD_RUN_run.googleapis.com/ingress",
      "CLOUD_RUN_autoscaling.knative.dev/maxScale",
      "CLOUD_RUN_run.googleapis.com/execution-environment",
      "CLOUD_RUN_run.googleapis.com/startup-cpu-boost",
      "CLOUD_RUN_containerConcurrency",
      "CLOUD_RUN_timeoutSeconds",
      "CLOUD_RUN_containerPort",
      "CLOUD_RUN_cpu",
      "CLOUD_RUN_memory"
    ];

    expect(libraryReport.overallStatus).toBe("template-needs-values");
    expect(cliReport.overallStatus).toBe("template-needs-values");
    expect(libraryReport.blockers).toEqual([]);
    expect(cliReport.blockers).toEqual([]);
    expect(libraryReport.envChecks.map((check) => check.name)).toEqual(expect.arrayContaining(requiredCheckNames));
    expect(cliReport.envChecks.map((check) => check.name)).toEqual(expect.arrayContaining(requiredCheckNames));
    expect(libraryReport.manualReviewFlags).toEqual(expect.arrayContaining(contract.manualReviewEnv));
    expect(cliReport.manualReviewFlags).toEqual(expect.arrayContaining(contract.manualReviewEnv));
    expect(libraryReport.secretRefs).toEqual(
      expect.arrayContaining(
        contract.requiredSecretEnv.map((entry) => ({
          envName: entry.envName,
          secretName: entry.secretName,
          version: "1"
        }))
      )
    );
    expect(cliReport.secretRefs).toEqual(
      expect.arrayContaining(
        contract.requiredSecretEnv.map((entry) => ({
          envName: entry.envName,
          secretName: entry.secretName,
          version: "1"
        }))
      )
    );
  });

  it("keeps the private render-values template aligned with manual-review and secret-version contract fields", async () => {
    const { getCloudRunRenderContractSummary, writeRenderValuesTemplate } = await loadRenderer();
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-cloudrun-contract-"));
    const valuesPath = join(tempDir, "cloudrun-render-values.template.json");
    const rendererContract = getCloudRunRenderContractSummary();

    try {
      const summary = await writeRenderValuesTemplate(valuesPath);
      const values = JSON.parse(readFileSync(valuesPath, "utf8")) as Record<string, string>;

      expect(summary.keyCount).toBe(Object.keys(values).length);
      expect(rendererContract.renderValueKeys).toEqual(contract.requiredNonSecretEnv);
      expect(rendererContract.manualReviewValueKeys).toEqual(contract.manualReviewEnv);
      expect(rendererContract.secretVersionKeys).toEqual(contract.requiredSecretEnv.map((entry) => entry.versionKey));
      expect(rendererContract.secretVersionEnvNames).toEqual(
        Object.fromEntries(contract.requiredSecretEnv.map((entry) => [entry.versionKey, entry.envName]))
      );
      expect(rendererContract.prohibitedRawSecretKeys).toEqual([
        ...contract.requiredSecretEnv.map((entry) => entry.envName),
        ...contract.prohibitedCredentialEnv
      ]);
      for (const name of contract.manualReviewEnv) {
        expect(values[name], `${name} must remain explicitly false until private proof exists`).toBe("false");
      }
      for (const secretRef of contract.requiredSecretEnv) {
        expect(values[secretRef.envName], `${secretRef.envName} must not be accepted as a raw render value`).toBeUndefined();
        expect(values[secretRef.versionKey], `${secretRef.versionKey} must pin a Secret Manager version`).toMatch(/^[1-9][0-9]*$/u);
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks a manifest if a required evidence flag or secret reference is removed", () => {
    const missingEvidenceFlag = removeEnv(manifest, "XPRIZE_AGENT_EXECUTION_LOGS_CONFIGURED");
    const missingSecret = removeEnv(manifest, "GEMINI_API_KEY");

    expect(buildCloudRunDeploymentEvidence(missingEvidenceFlag).overallStatus).toBe("blocked");
    expect(buildCloudRunDeploymentEvidence(missingEvidenceFlag).blockers.join(" ")).toContain("XPRIZE_AGENT_EXECUTION_LOGS_CONFIGURED");
    expect(buildCloudRunDeploymentEvidence(missingSecret).overallStatus).toBe("blocked");
    expect(buildCloudRunDeploymentEvidence(missingSecret).blockers.join(" ")).toContain("GEMINI_API_KEY");

    expect(buildCloudRunDeploymentEvidence(missingEvidenceFlag).envChecks.find((check) => check.name === "XPRIZE_AGENT_EXECUTION_LOGS_CONFIGURED")).toMatchObject({
      status: "blocked",
      currentValue: "missing"
    });
    expect(buildCloudRunDeploymentEvidence(missingSecret).envChecks.find((check) => check.name === "GEMINI_API_KEY")).toMatchObject({
      status: "blocked",
      currentValue: "missing"
    });
  });
});

async function loadRenderer() {
  // @ts-expect-error The renderer is an executable ESM script without a TypeScript declaration file.
  return (await import("../scripts/render-cloudrun-manifest.mjs")) as CloudRunRenderModule;
}

function parseEnvEntries(source: string) {
  const envStart = source.indexOf("\n          env:");
  const entryPattern = /\n\s+- name: ([A-Z0-9_]+)\n([\s\S]*?)(?=\n\s+- name: [A-Z0-9_]+\n|$)/gu;

  return [...source.slice(envStart).matchAll(entryPattern)].map((match) => {
    const block = match[2] ?? "";

    return {
      name: match[1],
      value: block.match(/(?:^|\n)\s+value: "([^"]*)"/u)?.[1],
      secretName: block.match(/secretKeyRef:\n\s+name: ([^\n]+)\n/u)?.[1]?.trim(),
      secretVersion: block.match(/secretKeyRef:\n\s+name: [^\n]+\n\s+key: "([^"]+)"/u)?.[1]
    };
  });
}

function removeEnv(source: string, name: string) {
  return source.replace(
    new RegExp(`\\n\\s+- name: ${escapeRegExp(name)}\\n[\\s\\S]*?(?=\\n\\s+- name: [A-Z0-9_]+\\n|$)`, "u"),
    ""
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
