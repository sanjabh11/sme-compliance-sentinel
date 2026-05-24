import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import contract from "../docs/deployment/cloudrun-deployment-contract.json";

interface CloudRunDeploymentTranscriptModule {
  collectCloudRunDeploymentTranscript: (options: {
    releaseId: string;
    outDir: string;
    dryRunLogPath?: string;
    deployLogPath?: string;
    describeJsonPath?: string;
    strict?: boolean;
  }) => Promise<{
    status: string;
    readyForHostedVerification: boolean;
    releaseId: string;
    outputDirectory: string;
    blockers: string[];
    inputs: Array<{ role: string; status: string; sha256: string; redactionCount: number }>;
    describeSummary: {
      url: string;
      latestReadyRevisionName: string;
      serviceAccountName: string;
      image: string;
      releaseIdEnvValue: string;
      cloudRunVpcConnectorEnvValue: string;
      cloudRunVpcEgressEnvValue: string;
      vpcConnectorAnnotation: string;
      vpcEgressAnnotation: string;
      secretEnvNames: string[];
    };
    deploymentContractChecks: Array<{ id: string; status: string; evidence: string }>;
    redactedArtifacts: Array<{ role: string; redactedText: string }>;
  }>;
  parseArgs: (argv: string[]) => {
    releaseId: string;
    outDir: string;
    dryRunLogPath: string;
    deployLogPath: string;
    describeJsonPath: string;
    strict: boolean;
  };
}

describe("Cloud Run deployment transcript collector", () => {
  it("builds a redacted checksummed packet from gcloud dry-run, deploy, and describe outputs", async () => {
    const { collectCloudRunDeploymentTranscript } = await loadCollector();
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-cloudrun-transcript-"));
    const inputDir = join(tempDir, "input");
    const outDir = join(tempDir, "out");
    mkdirSync(inputDir);
    const dryRunLogPath = join(inputDir, "cloudrun-dry-run.log");
    const deployLogPath = join(inputDir, "cloudrun-deploy.log");
    const describeJsonPath = join(inputDir, "cloudrun-describe.json");
    const fakeGoogleApiKey = ["AI", "za", "SyA", "1".repeat(36)].join("");

    writeFileSync(
      dryRunLogPath,
      "Dry run succeeded for service sme-workspace-sentinel.\nAuthorization: Bearer ya29.private-access-token\n",
      "utf8"
    );
    writeFileSync(
      deployLogPath,
      `Deploying container to Cloud Run service [sme-workspace-sentinel].\nGEMINI_API_KEY=${fakeGoogleApiKey}\nDone.\n`,
      "utf8"
    );
    writeFileSync(describeJsonPath, JSON.stringify(buildDescribeService(), null, 2), "utf8");

    try {
      const packet = await collectCloudRunDeploymentTranscript({
        releaseId: "release-20260524",
        outDir,
        dryRunLogPath,
        deployLogPath,
        describeJsonPath,
        strict: true
      });
      const packetText = JSON.stringify(packet);

      expect(packet.status).toBe("ready-for-hosted-verification");
      expect(packet.readyForHostedVerification).toBe(true);
      expect(packet.describeSummary.url).toBe("https://sme-workspace-sentinel-example.a.run.app");
      expect(packet.describeSummary.latestReadyRevisionName).toBe("sme-workspace-sentinel-00001-abc");
      expect(packet.describeSummary.releaseIdEnvValue).toBe("release-20260524");
      expect(packet.describeSummary.cloudRunVpcConnectorEnvValue).toBe("sentinel-egress");
      expect(packet.describeSummary.cloudRunVpcEgressEnvValue).toBe("all-traffic");
      expect(packet.describeSummary.vpcConnectorAnnotation).toBe("sentinel-egress");
      expect(packet.describeSummary.vpcEgressAnnotation).toBe("all-traffic");
      expect(packet.describeSummary.secretEnvNames).toEqual(
        expect.arrayContaining(contract.requiredSecretEnv.map((entry) => entry.envName))
      );
      expect(packet.deploymentContractChecks.every((check) => check.status === "passed")).toBe(true);
      expect(packet.inputs.map((input) => input.role)).toEqual([
        "cloudrun-dry-run-log",
        "cloudrun-deploy-log",
        "cloudrun-describe-json"
      ]);
      expect(packet.inputs.every((input) => input.status === "captured" && input.sha256)).toBe(true);
      expect(packet.inputs.reduce((total, input) => total + input.redactionCount, 0)).toBeGreaterThan(0);
      expect(packetText).not.toContain("ya29.private-access-token");
      expect(packetText).not.toContain(fakeGoogleApiKey);
      expect(packetText).toContain("[REDACTED_GOOGLE_ACCESS_TOKEN]");
      expect(packetText).toContain("GEMINI_API_KEY=[REDACTED]");
      expect(packet.inputs.find((input) => input.role === "cloudrun-deploy-log")?.redactionCount).toBeGreaterThan(0);
      expect(readFileSync(join(packet.outputDirectory, "cloudrun-deployment-transcript-packet.json"), "utf8")).toContain(
        "ready-for-hosted-verification"
      );
      expect(readFileSync(join(packet.outputDirectory, "cloudrun-deployment-transcript-packet.md"), "utf8")).toContain(
        "Cloud Run Deployment Transcript Packet"
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks deployment transcript evidence when the deployed Cloud Run revision drifts from the manifest contract", async () => {
    const { collectCloudRunDeploymentTranscript } = await loadCollector();
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-cloudrun-transcript-drift-"));
    const inputDir = join(tempDir, "input");
    const outDir = join(tempDir, "out");
    mkdirSync(inputDir);
    const dryRunLogPath = join(inputDir, "cloudrun-dry-run.log");
    const deployLogPath = join(inputDir, "cloudrun-deploy.log");
    const describeJsonPath = join(inputDir, "cloudrun-describe.json");
    const driftedEnv = buildDescribeEnv("release-old")
      .filter((entry) => entry.name !== "XPRIZE_JUDGE_ACCESS_CONFIGURED")
      .map((entry) =>
        entry.name === "GEMINI_API_KEY"
          ? { name: "GEMINI_API_KEY", value: "AIza" + "1".repeat(36) }
          : entry
      );

    writeFileSync(dryRunLogPath, "Dry run succeeded.\n", "utf8");
    writeFileSync(deployLogPath, "Deploying service.\nDone.\n", "utf8");
    writeFileSync(
      describeJsonPath,
      JSON.stringify(
        buildDescribeService({
          releaseId: "release-old",
          serviceAccountName: "default@example-project.iam.gserviceaccount.com",
          image: "us-central1-docker.pkg.dev/example-project/sentinel/web:release-old",
          annotations: {
            "run.googleapis.com/vpc-access-connector": "wrong-egress",
            "run.googleapis.com/vpc-access-egress": "private-ranges-only"
          },
          env: driftedEnv
        }),
        null,
        2
      ),
      "utf8"
    );

    try {
      const packet = await collectCloudRunDeploymentTranscript({
        releaseId: "release-20260524",
        outDir,
        dryRunLogPath,
        deployLogPath,
        describeJsonPath
      });
      const checksById = Object.fromEntries(packet.deploymentContractChecks.map((check) => [check.id, check]));

      expect(packet.status).toBe("blocked");
      expect(packet.readyForHostedVerification).toBe(false);
      expect(checksById["cloudrun-required-env-present"]).toMatchObject({
        status: "blocked",
        evidence: expect.stringContaining("XPRIZE_JUDGE_ACCESS_CONFIGURED")
      });
      expect(checksById["cloudrun-required-secrets-use-secret-manager"]).toMatchObject({
        status: "blocked",
        evidence: expect.stringContaining("GEMINI_API_KEY")
      });
      expect(checksById["cloudrun-release-id-env-matches"]).toMatchObject({ status: "blocked" });
      expect(checksById["cloudrun-image-release-bound"]).toMatchObject({ status: "blocked" });
      expect(checksById["cloudrun-runtime-service-account-dedicated"]).toMatchObject({ status: "blocked" });
      expect(checksById["cloudrun-static-egress-connector-env-matches"]).toMatchObject({ status: "blocked" });
      expect(checksById["cloudrun-static-egress-all-traffic"]).toMatchObject({ status: "blocked" });
      expect(checksById["cloudrun-static-egress-env-matches"]).toMatchObject({ status: "blocked" });
      expect(packet.blockers.join(" ")).toContain("cloudrun-required-env-present");
      expect(JSON.stringify(packet)).not.toContain("AIza" + "1".repeat(36));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks strict collection when required Cloud Run transcript files are missing", async () => {
    const { collectCloudRunDeploymentTranscript } = await loadCollector();
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-cloudrun-transcript-missing-"));

    await expect(
      collectCloudRunDeploymentTranscript({
        releaseId: "release-20260524",
        outDir: tempDir,
        strict: true
      })
    ).rejects.toThrow("Cloud Run deployment transcript packet is blocked");

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("parses safe file-path args and rejects raw secret-shaped CLI args", async () => {
    const { parseArgs } = await loadCollector();

    expect(
      parseArgs([
        "--release-id",
        "release-20260524",
        "--dry-run-log",
        "/secure/local/cloudrun-dry-run.log",
        "--deploy-log=/secure/local/cloudrun-deploy.log",
        "--describe-json",
        "/secure/local/cloudrun-describe.json",
        "--strict"
      ])
    ).toMatchObject({
      releaseId: "release-20260524",
      dryRunLogPath: "/secure/local/cloudrun-dry-run.log",
      deployLogPath: "/secure/local/cloudrun-deploy.log",
      describeJsonPath: "/secure/local/cloudrun-describe.json",
      strict: true
    });

    expect(() => parseArgs(["--admin-token=secret"])).toThrow("Raw secret CLI args are not supported");
  });
});

async function loadCollector() {
  // @ts-expect-error The collector is an executable ESM script without a TypeScript declaration file.
  return (await import("../scripts/collect-cloudrun-deployment-transcript.mjs")) as CloudRunDeploymentTranscriptModule;
}

function buildDescribeService(input: {
  releaseId?: string;
  image?: string;
  serviceAccountName?: string;
  env?: Array<Record<string, unknown>>;
  annotations?: Record<string, string>;
} = {}) {
  const releaseId = input.releaseId ?? "release-20260524";

  return {
    metadata: {
      name: "sme-workspace-sentinel"
    },
    spec: {
      template: {
        metadata: {
          annotations: input.annotations ?? {
            "run.googleapis.com/vpc-access-connector": "sentinel-egress",
            "run.googleapis.com/vpc-access-egress": "all-traffic"
          }
        },
        spec: {
          serviceAccountName: input.serviceAccountName ?? "sentinel-runtime@example-project.iam.gserviceaccount.com",
          containers: [
            {
              image: input.image ?? "us-central1-docker.pkg.dev/example-project/sentinel/web:release-20260524",
              env: input.env ?? buildDescribeEnv(releaseId)
            }
          ]
        }
      }
    },
    status: {
      url: "https://sme-workspace-sentinel-example.a.run.app",
      latestCreatedRevisionName: "sme-workspace-sentinel-00001-abc",
      latestReadyRevisionName: "sme-workspace-sentinel-00001-abc"
    }
  };
}

function buildDescribeEnv(releaseId: string) {
  return [
    ...contract.requiredNonSecretEnv.map((name) => ({
      name,
      value: nonSecretValue(name, releaseId)
    })),
    ...contract.requiredSecretEnv.map((entry) => ({
      name: entry.envName,
      valueFrom: {
        secretKeyRef: {
          name: entry.secretName,
          key: "1"
        }
      }
    }))
  ];
}

function nonSecretValue(name: string, releaseId: string) {
  switch (name) {
    case "SENTINEL_RELEASE_ID":
      return releaseId;
    case "SENTINEL_SOURCE_COMMIT":
      return "0123456789abcdef0123456789abcdef01234567";
    case "SENTINEL_SOURCE_COMMIT_AT":
      return "2026-05-24T09:00:00.000Z";
    case "SENTINEL_SOURCE_BRANCH":
      return "origin/main";
    case "NEXT_PUBLIC_PRODUCT_URL":
      return "https://sme-workspace-sentinel-example.a.run.app";
    case "XPRIZE_SUBMISSION_CLOSE_AT":
      return "2026-08-17T13:00:00-07:00";
    case "XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS":
      return "2";
    case "XPRIZE_ENTRANT_TYPE":
      return "team";
    case "SENTINEL_CLOUD_RUN_VPC_CONNECTOR":
      return "sentinel-egress";
    case "SENTINEL_CLOUD_RUN_VPC_EGRESS":
      return "all-traffic";
    default:
      return name.endsWith("_CONFIGURED") ||
        name.endsWith("_CONFIRMED") ||
        name.endsWith("_APPROVED") ||
        name.endsWith("_READY")
        ? "false"
        : "contract-value";
  }
}
