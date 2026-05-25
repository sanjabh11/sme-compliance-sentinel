import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

interface CloudRunRenderValuesAuditModule {
  parseArgs: (argv: string[]) => {
    valuesPath: string;
    outDir: string;
    releaseId: string;
    verifyPacketPath: string;
    strict: boolean;
  };
  writeCloudRunRenderValuesAudit: (options: {
    valuesPath: string;
    outDir?: string;
    releaseId?: string;
    strict?: boolean;
  }) => Promise<{
    status: string;
    readyForStrictRender: boolean;
    outputDirectory: string;
    auditPath: string;
    markdownPath: string;
    evidencePacketPath: string;
    evidencePacketMarkdownPath: string;
    evidencePacket: {
      status: string;
      readiness: {
        readyForStrictRender: boolean;
        requiredBeforeDryRunPending: number;
        claimFlagsPending: number;
        missingStrictKeyCount: number;
        placeholderKeyCount: number;
        valueConsistencyBlockerCount: number;
      };
      phaseProgress: {
        phaseId: string;
        ratingOutOf5: number;
        currentSliceRemainingPercent: number;
      };
      commandSequence: Array<{
        id: string;
        owner: string;
        command: string;
        expectedArtifact: string;
        stopCondition: string;
      }>;
      requiredBeforeDryRun: Array<{ key: string; owner: string; status: string; fix: string }>;
      publicClaimEvidenceQueue: Array<{ key: string; owner: string; status: string; acceptedProof: string }>;
      ownerQueues: Array<{
        owner: string;
        total: number;
        requiredBeforeDryRun: number;
        publicClaimEvidence: number;
        rows: Array<{ key: string; status: string; category: string; fix: string }>;
      }>;
      artifactRequests: Array<{
        category: string;
        owner: string;
        keyCount: number;
        keys: string[];
        requiredBeforeDryRun: string[];
        requiredBeforePublicClaim: string[];
        acceptedProof: string;
        privateHandling: string;
      }>;
      manualInterventions: Array<{
        owner: string;
        key: string;
        requiredBefore: string;
        action: string;
        acceptedProof: string;
        privateHandling: string;
      }>;
      stopConditions: string[];
      redactionChecklist: string[];
      nextActions: string[];
      disclaimer: string;
    };
    missingStrictKeys: string[];
    placeholderKeys: string[];
    valueConsistencyChecks: Array<{ id: string; key: string; status: string; fix: string }>;
    valueConsistencyBlockers: Array<{ id: string; key: string; status: string; fix: string }>;
    derivedValues: Array<{ key: string; status: string }>;
    manualReviewFlags: Array<{ key: string; status: string }>;
    secretVersionKeys: Array<{ envName: string; versionKey: string; status: string }>;
    renderValueIntakeSummary: {
      total: number;
      ready: number;
      attested: number;
      manualReview: number;
      missing: number;
      placeholder: number;
      blocked: number;
      pending: number;
      byCategory: Record<string, number>;
      readyForStrictRender: boolean;
      claimFlagsPending: number;
    };
    renderValueIntake: Array<{
      key: string;
      label: string;
      category: string;
      owner: string;
      status: string;
      source: string;
      valuePreview: string;
      safeToStoreInValuesFile: boolean;
      requiredBeforeDryRun: boolean;
      requiredBeforePublicClaim: boolean;
      acceptedProof: string;
      privateHandling: string;
      fix: string;
    }>;
    releaseIdConsistency: {
      status: string;
      blocking: boolean;
      requestedReleaseId: string;
      valueReleaseId: string;
      normalizedRequestedReleaseId: string;
      normalizedValueReleaseId: string;
      fix: string;
    };
    redactionChecklist: string[];
    stopConditions: string[];
    nextActions: string[];
  }>;
  verifyCloudRunRenderEvidencePacket: (path: string) => Promise<{
    overallStatus: "verified" | "blocked";
    generatedFrom: string;
    packetPath: string;
    verificationPath: string;
    releaseId: string;
    packetStatus: string;
    auditStatus: string;
    summary: {
      passed: number;
      blocked: number;
      fileCount: number;
    };
    checks: Array<{ id: string; status: "passed" | "blocked"; evidence: string }>;
    blockers: string[];
    proofBoundary: string;
    stopConditions: string[];
  }>;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Cloud Run render-values audit", () => {
  it("parses safe args and rejects raw secret-shaped CLI args", async () => {
    const { parseArgs } = await loadAudit();

    expect(
      parseArgs([
        "--values",
        "/secure/local/cloudrun-render-values.json",
        "--out-dir=/tmp/sentinel-render-audit",
        "--release-id",
        "release-1",
        "--strict"
      ])
    ).toEqual({
      valuesPath: "/secure/local/cloudrun-render-values.json",
      outDir: "/tmp/sentinel-render-audit",
      releaseId: "release-1",
      verifyPacketPath: "",
      strict: true
    });
    expect(parseArgs(["--verify-packet", "/secure/local/cloudrun-render-evidence-packet.json", "--strict"])).toMatchObject({
      verifyPacketPath: "/secure/local/cloudrun-render-evidence-packet.json",
      strict: true
    });
    expect(() => parseArgs(["--values", "/tmp/values.json", "--oauth-client-secret=secret"])).toThrow(/Raw secret CLI args/u);
  });

  it("writes a ready private audit packet without leaking secret values", async () => {
    const { writeCloudRunRenderValuesAudit } = await loadAudit();
    const tempDir = await makeTempDir();
    const valuesPath = await writeValues(tempDir, safeRenderValues());

    const packet = await writeCloudRunRenderValuesAudit({
      valuesPath,
      outDir: tempDir,
      releaseId: "release-20260523-001",
      strict: true
    });
    const packetJson = JSON.parse(await readFile(packet.auditPath, "utf8")) as { status: string };
    const markdown = await readFile(packet.markdownPath, "utf8");
    const evidencePacketJson = JSON.parse(await readFile(packet.evidencePacketPath, "utf8")) as {
      status: string;
      publicClaimEvidenceQueue: Array<{ key: string; status: string }>;
    };
    const evidenceMarkdown = await readFile(packet.evidencePacketMarkdownPath, "utf8");

    expect(packet.status).toBe("ready-to-render");
    expect(packet.readyForStrictRender).toBe(true);
    expect(packet.missingStrictKeys).toEqual([]);
    expect(packet.placeholderKeys).toEqual([]);
    expect(packet.valueConsistencyBlockers).toEqual([]);
    expect(packet.valueConsistencyChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "source-commit-shape", status: "passed" }),
        expect.objectContaining({ id: "hosted-product-url", status: "passed" }),
        expect.objectContaining({ id: "cloud-run-vpc-egress", status: "passed" }),
        expect.objectContaining({ id: "oauth-redirect-product-url", status: "passed" }),
        expect.objectContaining({ id: "budget-resource-billing-account", status: "passed" }),
        expect.objectContaining({ id: "gemini-ip-allowlist", status: "passed" })
      ])
    );
    expect(packet.releaseIdConsistency).toMatchObject({
      status: "matched",
      blocking: false,
      normalizedRequestedReleaseId: "release-20260523-001",
      normalizedValueReleaseId: "release-20260523-001"
    });
    expect(packet.derivedValues).toEqual(
      expect.arrayContaining([
        { key: "SENTINEL_CLOUD_RUN_IMAGE", status: "derived" },
        { key: "SENTINEL_CLOUD_RUN_SERVICE_ACCOUNT_EMAIL", status: "derived" },
        { key: "SENTINEL_GCP_BUDGET_SHORT_ID", status: "provided" },
        { key: "SENTINEL_GEMINI_API_KEY_SHORT_ID", status: "provided" }
      ])
    );
    expect(packet.secretVersionKeys.every((item) => item.status === "version-set")).toBe(true);
    expect(packet.manualReviewFlags.find((item) => item.key === "XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED")).toMatchObject({
      status: "not-attested"
    });
    expect(packet.renderValueIntakeSummary).toMatchObject({
      missing: 0,
      placeholder: 0,
      blocked: 0,
      readyForStrictRender: true
    });
    expect(packet.renderValueIntakeSummary.manualReview).toBeGreaterThan(0);
    expect(packet.renderValueIntakeSummary.claimFlagsPending).toBeGreaterThan(0);
    expect(packet.evidencePacket).toMatchObject({
      status: "ready-for-dry-run-claim-review-pending",
      readiness: {
        readyForStrictRender: true,
        requiredBeforeDryRunPending: 0,
        missingStrictKeyCount: 0,
        placeholderKeyCount: 0,
        valueConsistencyBlockerCount: 0
      },
      phaseProgress: {
        phaseId: "cloudrun-render-dry-run",
        ratingOutOf5: 3
      }
    });
    expect(packet.evidencePacket.phaseProgress.currentSliceRemainingPercent).toBeGreaterThan(0);
    expect(packet.evidencePacket.commandSequence.map((command) => command.id)).toEqual([
      "fill-private-render-values",
      "verify-render-handoff",
      "audit-render-values",
      "render-cloudrun-manifest",
      "prepare-dry-run-preflight"
    ]);
    expect(packet.evidencePacket.commandSequence.find((command) => command.id === "verify-render-handoff")).toMatchObject({
      command: expect.stringContaining("verify:cloudrun-render-handoff"),
      expectedArtifact: expect.stringContaining("cloudrun-render-handoff-verifier.json"),
      stopCondition: expect.stringContaining("handoff verifier")
    });
    expect(packet.evidencePacket.requiredBeforeDryRun).toEqual([]);
    expect(packet.evidencePacket.publicClaimEvidenceQueue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED",
          owner: "founder/sales",
          status: "manual-review"
        }),
        expect.objectContaining({
          key: "XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED",
          owner: "engineering",
          status: "manual-review"
        })
      ])
    );
    expect(packet.evidencePacket.ownerQueues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          owner: "engineering",
          requiredBeforeDryRun: 0
        }),
        expect.objectContaining({
          owner: "founder/sales",
          publicClaimEvidence: expect.any(Number)
        })
      ])
    );
    expect(packet.evidencePacket.artifactRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "google-cloud-proof",
          requiredBeforePublicClaim: expect.arrayContaining(["XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED"])
        }),
        expect.objectContaining({
          category: "business-evidence",
          requiredBeforePublicClaim: expect.arrayContaining(["XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED"])
        })
      ])
    );
    expect(packet.evidencePacket.manualInterventions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED",
          requiredBefore: "public-or-judge-claim"
        })
      ])
    );
    expect(packet.renderValueIntake).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "GOOGLE_CLOUD_PROJECT",
          category: "gcp-foundation",
          owner: "engineering",
          status: "ready",
          source: "values-file",
          valuePreview: "sentinel-prod",
          requiredBeforeDryRun: true
        }),
        expect.objectContaining({
          key: "GEMINI_API_KEY_VERSION",
          category: "secret-manager-version",
          status: "ready",
          valuePreview: "version-set",
          safeToStoreInValuesFile: true
        }),
        expect.objectContaining({
          key: "XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED",
          category: "business-evidence",
          owner: "founder/sales",
          status: "manual-review",
          requiredBeforePublicClaim: true
        }),
        expect.objectContaining({
          key: "GOOGLE_CLOUD_BILLING_ACCOUNT_ID",
          category: "cost-controls",
          owner: "engineering"
        }),
        expect.objectContaining({
          key: "XPRIZE_WORKING_PROJECT_ACCESS_CONFIGURED",
          category: "judge-access",
          owner: "founder/legal"
        }),
        expect.objectContaining({
          key: "XPRIZE_TESTING_INSTRUCTIONS",
          category: "judge-access",
          valuePreview: "instructions-present"
        }),
        expect.objectContaining({
          key: "XPRIZE_TESTING_INSTRUCTIONS_CONFIGURED",
          category: "judge-access",
          valuePreview: "missing"
        }),
        expect.objectContaining({
          key: "XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED",
          category: "google-cloud-proof",
          owner: "engineering",
          status: "manual-review"
        }),
        expect.objectContaining({
          key: "XPRIZE_PRODUCT_RUNNING_EVIDENCE_CONFIGURED",
          category: "hosted-product-proof",
          owner: "engineering",
          status: "manual-review"
        }),
        expect.objectContaining({
          key: "XPRIZE_AI_NATIVE_OPERATIONS_EVIDENCE_CONFIGURED",
          category: "ai-native-operations",
          owner: "engineering",
          status: "manual-review"
        }),
        expect.objectContaining({
          key: "XPRIZE_AGENT_EXECUTION_LOGS_CONFIGURED",
          category: "ai-native-operations",
          owner: "engineering",
          status: "manual-review"
        }),
        expect.objectContaining({
          key: "XPRIZE_CATEGORY_IMPACT_EVIDENCE_CONFIGURED",
          category: "category-impact",
          owner: "founder/sales",
          status: "manual-review"
        }),
        expect.objectContaining({
          key: "XPRIZE_CATEGORY",
          category: "category-impact",
          owner: "founder/sales",
          status: "ready"
        })
      ])
    );
    expect(packet.redactionChecklist.join(" ")).toContain("filled render-values file");
    expect(packet.nextActions.join(" ")).toContain("render:cloudrun-manifest");
    expect(packetJson.status).toBe("ready-to-render");
    expect(markdown).toContain("Ready for strict render: yes");
    expect(markdown).toContain("## Render Value Intake");
    expect(markdown).toContain("## Cloud Run Evidence Packet");
    expect(markdown).toContain("XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED [manual-review/business-evidence/founder/sales]");
    expect(markdown).toContain("Status: matched");
    expect(markdown).toContain("Value consistency blockers: 0");
    expect(evidencePacketJson.status).toBe("ready-for-dry-run-claim-review-pending");
    expect(evidencePacketJson.publicClaimEvidenceQueue).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED" })])
    );
    expect(evidenceMarkdown).toContain("Cloud Run Render Evidence Packet");
    expect(evidenceMarkdown).toContain("## Public Claim Evidence Queue");
    expect(evidenceMarkdown).toContain("XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED");
    expect(JSON.stringify(packet)).not.toContain("AIza");
    expect(JSON.stringify(packet)).not.toContain("private-admin-token");
  });

  it("verifies Cloud Run render evidence packet integrity and blocks tampered packet files", async () => {
    const { verifyCloudRunRenderEvidencePacket, writeCloudRunRenderValuesAudit } = await loadAudit();
    const tempDir = await makeTempDir();

    const packet = await writeCloudRunRenderValuesAudit({
      valuesPath: "docs/deployment/cloudrun-render-values.template.json",
      outDir: tempDir
    });
    const verification = await verifyCloudRunRenderEvidencePacket(packet.evidencePacketPath);

    expect(verification).toMatchObject({
      overallStatus: "verified",
      generatedFrom: "audit-cloudrun-render-values --verify-packet",
      packetPath: packet.evidencePacketPath,
      releaseId: "RELEASE_ID",
      packetStatus: "needs-values",
      auditStatus: "needs-values"
    });
    expect(verification.summary.fileCount).toBe(4);
    expect(verification.summary.blocked).toBe(0);
    expect(verification.verificationPath).toContain("cloudrun-render-evidence-packet-verifier.json");
    expect(await readFile(verification.verificationPath, "utf8")).toContain('"overallStatus": "verified"');
    expect(verification.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "evidence-packet-json",
        "audit-evidence-packet-match",
        "audit-status-alignment",
        "evidence-command-sequence",
        "evidence-markdown-regenerated"
      ])
    );
    expect(verification.proofBoundary).toContain("does not deploy Cloud Run");
    expect(verification.stopConditions.join(" ")).toContain("Do not run Cloud Run dry-run");

    await writeFile(packet.evidencePacketMarkdownPath, `${await readFile(packet.evidencePacketMarkdownPath, "utf8")}\nTampered after audit.\n`);
    const tampered = await verifyCloudRunRenderEvidencePacket(packet.evidencePacketPath);

    expect(tampered.overallStatus).toBe("blocked");
    expect(tampered.blockers.join(" ")).toContain("evidence-markdown-regenerated");

    const symlinkedPacket = await writeCloudRunRenderValuesAudit({
      valuesPath: "docs/deployment/cloudrun-render-values.template.json",
      outDir: tempDir
    });
    const symlinkTargetPath = join(tempDir, "reviewed-render-evidence-packet.json");
    await writeFile(symlinkTargetPath, await readFile(symlinkedPacket.evidencePacketPath, "utf8"), "utf8");
    await rm(symlinkedPacket.evidencePacketPath, { force: true });
    await symlink(symlinkTargetPath, symlinkedPacket.evidencePacketPath);
    const symlinkTargetContent = await readFile(symlinkTargetPath, "utf8");
    const symlinked = await verifyCloudRunRenderEvidencePacket(symlinkedPacket.evidencePacketPath);

    expect(symlinked.overallStatus).toBe("blocked");
    expect(symlinked.blockers.join(" ")).toContain("symbolic link");

    const realOutDir = join(tempDir, "reviewed-render-values-audit-output");
    const symlinkedOutDir = join(tempDir, "symlinked-render-values-audit-output");
    await mkdir(realOutDir);
    await symlink(realOutDir, symlinkedOutDir);
    await expect(
      writeCloudRunRenderValuesAudit({
        valuesPath: "docs/deployment/cloudrun-render-values.template.json",
        outDir: symlinkedOutDir
      })
    ).rejects.toThrow(/symbolic link/u);

    await expect(
      writeCloudRunRenderValuesAudit({
        valuesPath: "docs/deployment/cloudrun-render-values.template.json",
        outDir: tempDir
      })
    ).rejects.toThrow(/symbolic link/u);
    expect(await readFile(symlinkTargetPath, "utf8")).toBe(symlinkTargetContent);
  });

  it("fails closed before partial writes when audit outputs or verifier input parents are symlinked", async () => {
    const { verifyCloudRunRenderEvidencePacket, writeCloudRunRenderValuesAudit } = await loadAudit();
    const tempDir = await makeTempDir();
    const packet = await writeCloudRunRenderValuesAudit({
      valuesPath: "docs/deployment/cloudrun-render-values.template.json",
      outDir: tempDir
    });
    const originalAuditJson = await readFile(packet.auditPath, "utf8");
    const markdownTargetPath = join(tempDir, "reviewed-render-values-audit.md");
    await writeFile(markdownTargetPath, "unchanged-markdown\n", "utf8");
    await rm(packet.markdownPath, { force: true });
    await symlink(markdownTargetPath, packet.markdownPath);

    await expect(
      writeCloudRunRenderValuesAudit({
        valuesPath: "docs/deployment/cloudrun-render-values.template.json",
        outDir: tempDir
      })
    ).rejects.toThrow(/symbolic link/u);
    expect(await readFile(packet.auditPath, "utf8")).toBe(originalAuditJson);
    expect(await readFile(markdownTargetPath, "utf8")).toBe("unchanged-markdown\n");
    expect((await readdir(packet.outputDirectory)).filter((path) => path.endsWith(".tmp"))).toEqual([]);

    const realPacketDir = dirname(packet.evidencePacketPath);
    const symlinkedPacketDir = join(tempDir, "symlinked-render-evidence-parent");
    const verifierPath = join(realPacketDir, "cloudrun-render-evidence-packet-verifier.json");
    await rm(verifierPath, { force: true });
    await symlink(realPacketDir, symlinkedPacketDir);

    await expect(verifyCloudRunRenderEvidencePacket(join(symlinkedPacketDir, "cloudrun-render-evidence-packet.json"))).rejects.toThrow(
      /symbolic link/u
    );
    await expect(readFile(verifierPath, "utf8")).rejects.toThrow(/ENOENT/u);
  });

  it("blocks mismatched CLI and values-file release ids before rendering", async () => {
    const { writeCloudRunRenderValuesAudit } = await loadAudit();
    const tempDir = await makeTempDir();
    const valuesPath = await writeValues(tempDir, safeRenderValues());

    const packet = await writeCloudRunRenderValuesAudit({
      valuesPath,
      outDir: tempDir,
      releaseId: "release-20260523-other"
    });

    expect(packet.status).toBe("release-id-mismatch");
    expect(packet.readyForStrictRender).toBe(false);
    expect(packet.releaseIdConsistency).toMatchObject({
      status: "mismatch",
      blocking: true,
      normalizedRequestedReleaseId: "release-20260523-other",
      normalizedValueReleaseId: "release-20260523-001"
    });
    expect(packet.stopConditions.join(" ")).toContain("SENTINEL_RELEASE_ID");
    expect(packet.nextActions.join(" ")).toContain("same non-placeholder release id");
    await expect(
      writeCloudRunRenderValuesAudit({
        valuesPath,
        outDir: tempDir,
        releaseId: "release-20260523-other",
        strict: true
      })
    ).rejects.toThrow(/release-id-mismatch/u);
  });

  it("reports missing placeholders before strict rendering", async () => {
    const { writeCloudRunRenderValuesAudit } = await loadAudit();
    const tempDir = await makeTempDir();

    const packet = await writeCloudRunRenderValuesAudit({
      valuesPath: "docs/deployment/cloudrun-render-values.template.json",
      outDir: tempDir
    });

    expect(packet.status).toBe("needs-values");
    expect(packet.readyForStrictRender).toBe(false);
    expect(packet.missingStrictKeys).toEqual(
      expect.arrayContaining([
        "GOOGLE_CLOUD_PROJECT",
        "SENTINEL_SOURCE_COMMIT",
        "NEXT_PUBLIC_PRODUCT_URL",
        "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS"
      ])
    );
    expect(packet.placeholderKeys).toEqual(expect.arrayContaining(["GOOGLE_CLOUD_PROJECT", "SENTINEL_RELEASE_ID"]));
    expect(packet.renderValueIntakeSummary).toMatchObject({
      readyForStrictRender: false
    });
    expect(packet.renderValueIntakeSummary.placeholder).toBeGreaterThan(0);
    expect(packet.evidencePacket).toMatchObject({
      status: "needs-values",
      readiness: {
        readyForStrictRender: false
      }
    });
    expect(packet.evidencePacket.phaseProgress.ratingOutOf5).toBe(2);
    expect(packet.evidencePacket.requiredBeforeDryRun).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "GOOGLE_CLOUD_PROJECT",
          status: "placeholder"
        }),
        expect.objectContaining({
          key: "NEXT_PUBLIC_PRODUCT_URL",
          status: "placeholder"
        })
      ])
    );
    expect(packet.evidencePacket.ownerQueues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          owner: "engineering",
          requiredBeforeDryRun: expect.any(Number)
        }),
        expect.objectContaining({
          owner: "founder/legal",
          requiredBeforeDryRun: expect.any(Number)
        })
      ])
    );
    expect(packet.renderValueIntake).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "GOOGLE_CLOUD_PROJECT",
          category: "gcp-foundation",
          status: "placeholder",
          fix: expect.stringContaining("Fill GOOGLE_CLOUD_PROJECT")
        }),
        expect.objectContaining({
          key: "NEXT_PUBLIC_PRODUCT_URL",
          category: "judge-access",
          status: "placeholder"
        }),
        expect.objectContaining({
          key: "SENTINEL_RELEASE_ID",
          category: "release-integrity",
          status: "placeholder"
        })
      ])
    );
    expect(packet.nextActions.join(" ")).toContain("Fill the missing non-secret values");
    expect(packet.auditPath).toContain("cloudrun-render-values-audit.json");
    expect(packet.evidencePacketPath).toContain("cloudrun-render-evidence-packet.json");
  });

  it("blocks stale production values before strict rendering", async () => {
    const { writeCloudRunRenderValuesAudit } = await loadAudit();
    const tempDir = await makeTempDir();
    const valuesPath = await writeValues(tempDir, {
      ...safeRenderValues(),
      SENTINEL_SOURCE_COMMIT: "short-sha",
      SENTINEL_CLOUD_RUN_VPC_EGRESS: "private-ranges-only",
      NEXT_PUBLIC_PRODUCT_URL: "http://127.0.0.1:3000",
      XPRIZE_DEMO_VIDEO_URL: "https://example.com/sentinel-demo",
      XPRIZE_SUBMISSION_CLOSE_AT: "2026-08-18T13:00:00-07:00",
      XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS: "3",
      XPRIZE_CATEGORY: "Professional Services Access",
      GOOGLE_OAUTH_REDIRECT_URI: "https://old.example.com/api/oauth/google/callback",
      WORKSPACE_DRIVE_WEBHOOK_URL: "https://old.example.com/api/webhooks/pubsub/drive",
      WORKSPACE_GMAIL_TOPIC: "projects/old-project/topics/workspace-gmail-updates",
      SENTINEL_GCP_BUDGET_ID: "billingAccounts/old-billing/budgets/budget-123",
      SENTINEL_GEMINI_API_KEY_ID: "projects/999999999999/locations/global/keys/gemini-key-123",
      SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS: "0.0.0.0,*",
      GEMINI_API_KEY_VERSION: "latest"
    });

    const packet = await writeCloudRunRenderValuesAudit({
      valuesPath,
      outDir: tempDir,
      releaseId: "release-20260523-001"
    });

    expect(packet.status).toBe("value-consistency-blocked");
    expect(packet.readyForStrictRender).toBe(false);
    expect(packet.valueConsistencyBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "source-commit-shape", key: "SENTINEL_SOURCE_COMMIT" }),
        expect.objectContaining({ id: "cloud-run-vpc-egress", key: "SENTINEL_CLOUD_RUN_VPC_EGRESS" }),
        expect.objectContaining({ id: "hosted-product-url", key: "NEXT_PUBLIC_PRODUCT_URL" }),
        expect.objectContaining({ id: "demo-video-host", key: "XPRIZE_DEMO_VIDEO_URL" }),
        expect.objectContaining({ id: "submission-close", key: "XPRIZE_SUBMISSION_CLOSE_AT" }),
        expect.objectContaining({ id: "evidence-response-sla", key: "XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS" }),
        expect.objectContaining({ id: "category-fit", key: "XPRIZE_CATEGORY" }),
        expect.objectContaining({ id: "oauth-redirect-product-url", key: "GOOGLE_OAUTH_REDIRECT_URI" }),
        expect.objectContaining({ id: "drive-webhook-product-url", key: "WORKSPACE_DRIVE_WEBHOOK_URL" }),
        expect.objectContaining({ id: "gmail-topic-project", key: "WORKSPACE_GMAIL_TOPIC" }),
        expect.objectContaining({ id: "budget-resource-billing-account", key: "SENTINEL_GCP_BUDGET_ID" }),
        expect.objectContaining({ id: "gemini-api-key-project-number", key: "SENTINEL_GEMINI_API_KEY_ID" }),
        expect.objectContaining({ id: "gemini-ip-allowlist", key: "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS" }),
        expect.objectContaining({ id: "secret-version-gemini_api_key_version", key: "GEMINI_API_KEY_VERSION" })
      ])
    );
    expect(packet.renderValueIntakeSummary.blocked).toBeGreaterThan(0);
    expect(packet.evidencePacket.status).toBe("blocked");
    expect(packet.evidencePacket.phaseProgress.ratingOutOf5).toBe(1);
    expect(packet.evidencePacket.requiredBeforeDryRun).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "NEXT_PUBLIC_PRODUCT_URL",
          status: "blocked"
        }),
        expect.objectContaining({
          key: "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS",
          status: "blocked"
        })
      ])
    );
    expect(packet.evidencePacket.stopConditions.join(" ")).toContain("Do not move to Cloud Run dry-run");
    expect(packet.renderValueIntake).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "NEXT_PUBLIC_PRODUCT_URL",
          category: "judge-access",
          status: "blocked",
          fix: expect.stringContaining("public HTTPS Cloud Run")
        }),
        expect.objectContaining({
          key: "SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS",
          category: "gemini-controls",
          status: "blocked",
          fix: expect.stringContaining("comma-separated allowlist")
        }),
        expect.objectContaining({
          key: "GEMINI_API_KEY_VERSION",
          category: "secret-manager-version",
          status: "blocked",
          fix: expect.stringContaining("positive numeric Secret Manager version")
        })
      ])
    );
    expect(packet.stopConditions.join(" ")).toContain("stale, mismatched, or invalid");
    await expect(
      writeCloudRunRenderValuesAudit({
        valuesPath,
        outDir: tempDir,
        releaseId: "release-20260523-001",
        strict: true
      })
    ).rejects.toThrow(/value-consistency-blocked/u);
  });

  it("fails strict mode when render values are not ready", async () => {
    const { writeCloudRunRenderValuesAudit } = await loadAudit();
    const tempDir = await makeTempDir();

    await expect(
      writeCloudRunRenderValuesAudit({
        valuesPath: "docs/deployment/cloudrun-render-values.template.json",
        outDir: tempDir,
        strict: true
      })
    ).rejects.toThrow(/render-values audit is needs-values/u);
  });
});

async function loadAudit() {
  // @ts-expect-error The audit helper is an executable ESM script without a TypeScript declaration file.
  return (await import("../scripts/audit-cloudrun-render-values.mjs")) as CloudRunRenderValuesAuditModule;
}

async function makeTempDir() {
  const path = await mkdtemp(join(tmpdir(), "sentinel-cloudrun-values-audit-"));
  tempDirs.push(path);
  return path;
}

async function writeValues(tempDir: string, values: Record<string, string>, fileName = "render-values.json") {
  const path = join(tempDir, fileName);
  await writeFile(path, `${JSON.stringify(values, null, 2)}\n`, "utf8");
  return path;
}

function safeRenderValues() {
  return {
    GOOGLE_CLOUD_PROJECT: "sentinel-prod",
    GOOGLE_CLOUD_PROJECT_NUMBER: "123456789012",
    SENTINEL_CLOUD_RUN_REGION: "us-central1",
    SENTINEL_CLOUD_RUN_VPC_CONNECTOR: "sentinel-egress",
    SENTINEL_CLOUD_RUN_VPC_EGRESS: "all-traffic",
    SENTINEL_RELEASE_ID: "release-20260523-001",
    SENTINEL_SOURCE_COMMIT: "0123456789abcdef0123456789abcdef01234567",
    SENTINEL_SOURCE_COMMIT_AT: "2026-05-23T17:24:17.894Z",
    SENTINEL_SOURCE_BRANCH: "origin/main",
    NEXT_PUBLIC_PRODUCT_URL: "https://sme-workspace-sentinel-abc-uc.a.run.app",
    XPRIZE_DEMO_VIDEO_URL: "https://youtu.be/sentinel-demo",
    XPRIZE_REPOSITORY_URL: "https://github.com/sanjabh11/sme-compliance-sentinel",
    XPRIZE_REPOSITORY_ACCESS_MODE: "private-shared",
    XPRIZE_REPOSITORY_JUDGE_ACCESS_EMAILS: "testing@devpost.com,judging@hacker.fund",
    XPRIZE_SUBMISSION_CLOSE_AT: "2026-08-17T13:00:00-07:00",
    XPRIZE_CATEGORY: "Small Business Services",
    XPRIZE_JUDGING_PERIOD_END_AT: "2026-09-15T17:00:00-07:00",
    XPRIZE_EVIDENCE_RESPONSE_SLA_BUSINESS_DAYS: "2",
    XPRIZE_TESTING_INSTRUCTIONS: "Use the private Devpost testing instructions; do not place credentials in source.",
    GOOGLE_CLOUD_BILLING_ACCOUNT_ID: "000000-111111-222222",
    SENTINEL_GCP_BUDGET_SHORT_ID: "budget-123",
    GOOGLE_OAUTH_CLIENT_ID: "123456789012-abcdef.apps.googleusercontent.com",
    GOOGLE_OAUTH_REQUESTED_SCOPES: "https://www.googleapis.com/auth/drive.metadata.readonly,https://www.googleapis.com/auth/gmail.metadata",
    GOOGLE_OAUTH_DEFERRED_RESTRICTED_SCOPES: "https://www.googleapis.com/auth/drive",
    GOOGLE_OAUTH_SCOPE_REVIEW_CONFIRMED: "false",
    SENTINEL_GEMINI_API_KEY_SHORT_ID: "gemini-key-123",
    SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS: "34.10.10.10",
    XPRIZE_ENTRANT_TYPE: "team",
    SENTINEL_ADMIN_ACTION_TOKEN_VERSION: "2",
    GEMINI_API_KEY_VERSION: "2",
    GOOGLE_OAUTH_CLIENT_SECRET_VERSION: "2",
    SENTINEL_EVIDENCE_SIGNING_SECRET_VERSION: "2",
    WORKSPACE_DRIVE_CHANNEL_TOKEN_VERSION: "2"
  };
}
