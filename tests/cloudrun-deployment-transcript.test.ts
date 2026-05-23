import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
      secretEnvNames: string[];
    };
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
    writeFileSync(
      describeJsonPath,
      JSON.stringify(
        {
          metadata: {
            name: "sme-workspace-sentinel"
          },
          spec: {
            template: {
              spec: {
                serviceAccountName: "sentinel-runtime@example-project.iam.gserviceaccount.com",
                containers: [
                  {
                    image: "us-central1-docker.pkg.dev/example-project/sentinel/web:release-20260524",
                    env: [
                      { name: "SENTINEL_RELEASE_ID", value: "release-20260524" },
                      {
                        name: "GEMINI_API_KEY",
                        valueFrom: {
                          secretKeyRef: {
                            name: "gemini-api-key",
                            key: "1"
                          }
                        }
                      }
                    ]
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
        },
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
        describeJsonPath,
        strict: true
      });
      const packetText = JSON.stringify(packet);

      expect(packet.status).toBe("ready-for-hosted-verification");
      expect(packet.readyForHostedVerification).toBe(true);
      expect(packet.describeSummary.url).toBe("https://sme-workspace-sentinel-example.a.run.app");
      expect(packet.describeSummary.latestReadyRevisionName).toBe("sme-workspace-sentinel-00001-abc");
      expect(packet.describeSummary.secretEnvNames).toEqual(["GEMINI_API_KEY"]);
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
