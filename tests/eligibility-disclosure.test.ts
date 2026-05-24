import { describe, expect, it } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import { buildEligibilityDisclosurePacket } from "@/lib/eligibility-disclosure";
import { buildProjectProvenanceReport } from "@/lib/project-provenance";
import type { ProjectProvenanceGitSignals, ThirdPartyManifest } from "@/lib/types";

const cleanGitSignals: ProjectProvenanceGitSignals = {
  gitAvailable: true,
  commitCount: 3,
  headCommit: "abc123",
  remoteUrl: "https://github.com/example/sme-compliance-sentinel.git",
  upstreamBranch: "origin/main",
  remoteHeadCommit: "abc123",
  firstCommitAt: "2026-05-20T10:00:00.000Z",
  headCommitAt: "2026-05-23T09:00:00.000Z",
  trackedFileCount: 120,
  untrackedPaths: []
};

const cleanThirdPartyManifest: ThirdPartyManifest = {
  generatedAt: "2026-05-23T09:00:00.000Z",
  packageManager: "npm",
  lockfileVersion: 3,
  summary: {
    status: "passed",
    totalPackages: 20,
    productionPackages: 12,
    directRuntimeDependencies: 6,
    directDevDependencies: 5,
    unknownLicenseCount: 0,
    licenseNeedsReviewCount: 0,
    obligationReviewCount: 0,
    restrictedLicenseReviewCount: 0,
    integrationsNeedingReview: 0
  },
  packages: [],
  integrations: [
    {
      name: "Gemini API",
      provider: "Google",
      purpose: "Tier 2 semantic risk classification.",
      status: "configured",
      authorizationBasis: "Gemini API key and applicable Google API terms.",
      dataBoundary: "Only selected redacted snippets are routed to Gemini."
    }
  ],
  reviewPacket: {
    sourceDigests: {
      packageJsonSha256: "0".repeat(64),
      packageLockSha256: "1".repeat(64)
    },
    approvalEnvFlags: ["XPRIZE_THIRD_PARTY_REVIEW_APPROVED", "XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED"],
    approvalBoundary: "Human review required before approval flags are set.",
    requiredPrivateArtifacts: ["Dependency license review notes.", "Google API terms review notes."],
    ruleTraceability: [
      {
        ruleArea: "third-party-use",
        source: "Build with Gemini XPRIZE rules",
        requirement: "Third-party SDK/API use requires authorization.",
        manifestEvidence: "Clean test fixture."
      }
    ],
    clearanceChecklist: [
      {
        id: "source-digest-inventory",
        label: "Package inventory is hash-bound",
        ruleArea: "third-party-use",
        status: "passed",
        evidence: "Test fixture includes hashes.",
        requiredPrivateArtifact: "Manifest JSON.",
        ownerRole: "engineering",
        fix: "No action."
      }
    ]
  },
  disclosureText: ["Built with Next.js, React, TypeScript, Google APIs, and npm dependencies."],
  blockers: [],
  nextActions: ["Retain human reviewer notes outside the repository."],
  disclaimer: "Generated dependency evidence for submission review."
};

describe("eligibility disclosure packet", () => {
  it("is ready for human review when mechanical source evidence is clean without claiming attestations are done", () => {
    const packet = buildEligibilityDisclosurePacket({
      projectProvenance: buildProjectProvenanceReport(cleanGitSignals),
      thirdPartyManifest: cleanThirdPartyManifest,
      generatedAt: "2026-05-23T10:00:00.000Z"
    });

    const checksById = Object.fromEntries(packet.checks.map((check) => [check.id, check]));

    expect(packet.overallStatus).toBe("ready-for-review");
    expect(packet.repositoryUrl).toBe("https://github.com/example/sme-compliance-sentinel");
    expect(packet.provenanceSummary.firstCommitAt).toBe("2026-05-20T10:00:00.000Z");
    expect(checksById["source-repository-ready"].status).toBe("passed");
    expect(checksById["project-created-after-start-review"].status).toBe("needs-review");
    expect(checksById["pre-existing-work-disclosure-review"].status).toBe("needs-review");
    expect(packet.reviewerAttestations.find((item) => item.envFlag === "XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED")?.currentValue).toBe(false);
    expect(packet.nextActions.join(" ")).toContain("human-reviewed");
  });

  it("blocks when the repository source evidence is not committed, pushed, and shareable", () => {
    const packet = buildEligibilityDisclosurePacket({
      projectProvenance: buildProjectProvenanceReport({
        gitAvailable: true,
        commitCount: 0,
        trackedFileCount: 0,
        untrackedPaths: ["app/page.tsx"],
        error: "No commits are available."
      }),
      thirdPartyManifest: cleanThirdPartyManifest
    });

    expect(packet.overallStatus).toBe("blocked");
    expect(packet.blockers[0]).toContain("Repository source evidence");
  });

  it("blocks restricted-license manifests before final disclosure review", () => {
    const packet = buildEligibilityDisclosurePacket({
      projectProvenance: buildProjectProvenanceReport(cleanGitSignals),
      thirdPartyManifest: {
        ...cleanThirdPartyManifest,
        summary: {
          ...cleanThirdPartyManifest.summary,
          status: "blocked",
          obligationReviewCount: 0,
          restrictedLicenseReviewCount: 1
        },
        blockers: ["1 package has restricted-license review status."]
      }
    });

    expect(packet.overallStatus).toBe("blocked");
    expect(packet.checks.find((check) => check.id === "third-party-api-license-review")?.status).toBe("blocked");
    expect(packet.blockers.join(" ")).toContain("restricted-license");
  });

  it("keeps packet language inside claim guard boundaries", () => {
    const packet = buildEligibilityDisclosurePacket({
      projectProvenance: buildProjectProvenanceReport(cleanGitSignals),
      thirdPartyManifest: cleanThirdPartyManifest
    });
    const violations = scanClaimText({
      artifact: "eligibility-disclosure",
      text: JSON.stringify(packet, null, 2)
    });

    expect(violations).toEqual([]);
  });
});
