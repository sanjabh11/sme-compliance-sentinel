/* global AbortController, URL, clearTimeout, console, fetch, process, setTimeout */

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { runProductionReadinessVerification } from "./verify-production-readiness.mjs";

const defaultOutDir = "artifacts/hosted-proof";
const defaultTimeoutMs = 15000;
const defaultAdminTokenEnv = "SENTINEL_ADMIN_ACTION_TOKEN";
const adminTokenHeader = "x-sentinel-admin-token";

const bundleEndpoints = [
  {
    id: "launch-readiness",
    path: "/api/production/launch-readiness",
    privateHandling:
      "Hosted production command center; use only redacted env/proof status and keep credentials, invoices, and customer evidence private."
  },
  {
    id: "deployment-packet",
    path: "/api/production/deployment-packet",
    privateHandling: "Release-bound deployment artifact plan; keep raw command outputs private."
  },
  {
    id: "hosted-evidence",
    path: "/api/production/hosted-evidence",
    privateHandling: "Hosted proof checklist; keep raw logs, screenshots, invoices, and customer evidence private."
  },
  {
    id: "judge-access-pack",
    path: "/api/xprize/judge-access-pack",
    privateHandling: "Non-secret judge access plan; credentials belong only in private Devpost fields or approved private channels."
  },
  {
    id: "source-release",
    path: "/api/xprize/source-release",
    privateHandling: "Repository release guard; review before sharing source status or provenance notes externally."
  },
  {
    id: "project-provenance",
    path: "/api/xprize/provenance",
    privateHandling: "Repository provenance report; verify pushed HEAD and disclosure status before judge sharing."
  },
  {
    id: "license-manifest",
    path: "/api/xprize/license-manifest",
    privateHandling: "Third-party dependency and API-use review packet; keep final human legal/IP review notes private."
  },
  {
    id: "submission-binder",
    path: "/api/xprize/submission-binder",
    privateHandling: "Private judge-readiness manifest; review for customer/security leakage before sharing."
  },
  {
    id: "devpost-pack",
    path: "/api/xprize/devpost-pack",
    privateHandling: "Public copy draft; human-review before pasting into Devpost."
  },
  {
    id: "demo-video-pack",
    path: "/api/xprize/demo-video-pack",
    privateHandling: "Public video plan; use seeded or redacted data and preserve asset-clearance proof privately."
  },
  {
    id: "evidence-intake",
    path: "/api/evidence/vault?view=intake",
    privateHandling: "Private proof intake queue; do not publish raw artifact sources."
  },
  {
    id: "workspace-sync-status",
    path: "/api/workspace/sync/status",
    privateHandling: "Workspace cursor, channel, and renewal state; redact tenant ids, mailbox details, channel tokens, and customer names."
  },
  {
    id: "claim-guard",
    path: "/api/compliance/claims",
    privateHandling: "Claim-safety report; attach to final public-copy review."
  }
];

export function parseArgs(argv) {
  const args = {
    url: "",
    outDir: defaultOutDir,
    releaseId: process.env.SENTINEL_RELEASE_ID ?? "",
    includeWriteChecks: false,
    strict: false,
    timeoutMs: defaultTimeoutMs,
    adminTokenEnv: defaultAdminTokenEnv,
    adminToken: "",
    refreshExisting: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--url") {
      args.url = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--url=")) {
      args.url = arg.slice("--url=".length);
      continue;
    }

    if (arg === "--out-dir") {
      args.outDir = argv[index + 1] ?? defaultOutDir;
      index += 1;
      continue;
    }

    if (arg.startsWith("--out-dir=")) {
      args.outDir = arg.slice("--out-dir=".length) || defaultOutDir;
      continue;
    }

    if (arg === "--release-id") {
      args.releaseId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--release-id=")) {
      args.releaseId = arg.slice("--release-id=".length);
      continue;
    }

    if (arg === "--include-write-checks") {
      args.includeWriteChecks = true;
      continue;
    }

    if (arg === "--refresh-existing") {
      args.refreshExisting = true;
      continue;
    }

    if (arg === "--strict") {
      args.strict = true;
      continue;
    }

    if (arg === "--timeout-ms") {
      args.timeoutMs = parseTimeout(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--timeout-ms=")) {
      args.timeoutMs = parseTimeout(arg.slice("--timeout-ms=".length));
      continue;
    }

    if (arg === "--admin-token-env") {
      args.adminTokenEnv = argv[index + 1] ?? defaultAdminTokenEnv;
      index += 1;
      continue;
    }

    if (arg.startsWith("--admin-token-env=")) {
      args.adminTokenEnv = arg.slice("--admin-token-env=".length) || defaultAdminTokenEnv;
    }
  }

  args.url ||= process.env.NEXT_PUBLIC_PRODUCT_URL ?? "";
  args.releaseId ||= `release-${new Date().toISOString().replace(/[:.]/gu, "-")}`;
  args.adminToken = process.env[args.adminTokenEnv] ?? "";
  return args;
}

export async function collectHostedProofBundle(options) {
  const baseUrl = normalizeBaseUrl(options.url);
  const releaseId = sanitizePathSegment(options.releaseId || `release-${new Date().toISOString()}`);
  const outputDirectory = resolve(options.outDir ?? defaultOutDir, releaseId);
  await assertDirectoryPathSafe(outputDirectory, "Hosted proof bundle output directory");
  await mkdir(outputDirectory, { recursive: true });
  await assertDirectoryExistsSafe(outputDirectory, "Hosted proof bundle output directory");
  if (options.refreshExisting) {
    await assertDirectoryRefreshable(outputDirectory, "Hosted proof bundle output directory");
  } else {
    await assertDirectoryEmpty(outputDirectory, "Hosted proof bundle output directory");
  }

  const verifyReport = await runProductionReadinessVerification(
    {
      url: baseUrl,
      includeWriteChecks: Boolean(options.includeWriteChecks),
      strict: Boolean(options.strict),
      timeoutMs: options.timeoutMs ?? defaultTimeoutMs,
      releaseId,
      adminTokenEnv: options.adminTokenEnv ?? defaultAdminTokenEnv,
      adminToken: options.adminToken ?? process.env[options.adminTokenEnv ?? defaultAdminTokenEnv] ?? ""
    }
  );
  const artifacts = [];
  artifacts.push(
    await writeJsonArtifact(outputDirectory, {
      id: "verify-production",
      fileName: "verify-production.json",
      source: "npm run verify:production",
      payload: verifyReport,
      privateHandling:
        "Hosted read-only/write-through verification output; import only after redaction and keep full source JSON private."
    })
  );

  const endpointPayloads = new Map();
  for (const endpoint of bundleEndpoints) {
    const payload = await fetchEndpoint(baseUrl, endpoint, options.timeoutMs ?? defaultTimeoutMs);
    endpointPayloads.set(endpoint.id, payload);
    artifacts.push(
      await writeJsonArtifact(outputDirectory, {
        id: endpoint.id,
        fileName: `${endpoint.id}.json`,
        source: endpoint.path,
        payload,
        privateHandling: endpoint.privateHandling
      })
    );
  }
  artifacts.push(
    ...(await buildDeploymentExecutionEvidenceArtifacts({
      endpointPayloads,
      outputDirectory,
      releaseId,
      baseUrl
    }))
  );

  const releaseIntegrity = buildReleaseIntegrity({
    baseUrl,
    releaseId,
    verifyReport,
    endpointPayloads
  });
  const releaseEvidenceManifest = buildReleaseEvidenceManifest({
    baseUrl,
    releaseId,
    verifyReport,
    artifacts,
    releaseIntegrity,
    endpointPayloads
  });
  artifacts.push(
    await writeJsonArtifact(outputDirectory, {
      id: "release-evidence-manifest",
      fileName: "release-evidence-manifest.json",
      source: "collect-hosted-proof-bundle:release-evidence",
      payload: releaseEvidenceManifest,
      privateHandling:
        "Release-level evidence map; safe for judge workflow only after checking missing-proof statuses and redaction."
    })
  );

  const manifest = buildManifest({
    baseUrl,
    releaseId,
    outputDirectory,
    includeWriteChecks: Boolean(options.includeWriteChecks),
    strict: Boolean(options.strict),
    refreshExisting: Boolean(options.refreshExisting),
    adminTokenEnv: options.adminTokenEnv ?? defaultAdminTokenEnv,
    adminTokenConfigured: Boolean(options.adminToken),
    verifyReport,
    artifacts,
    releaseEvidenceManifest,
    releaseIntegrity
  });
  const manifestArtifact = await writeJsonArtifact(outputDirectory, {
    id: "manifest",
    fileName: "manifest.json",
    source: "collect-hosted-proof-bundle",
    payload: manifest,
    privateHandling: "Bundle manifest; safe to share only after checking artifact statuses and redaction."
  });
  await writeMarkdownSummary(outputDirectory, manifest);

  return {
    ...manifest,
    artifacts: [...artifacts, manifestArtifact]
  };
}

async function fetchEndpoint(baseUrl, endpoint, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${baseUrl}${endpoint.path}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    const text = await response.text();

    return {
      generatedAt: new Date().toISOString(),
      endpoint: endpoint.path,
      httpStatus: response.status,
      ok: response.ok,
      payload: parseJson(text)
    };
  } catch (error) {
    return {
      generatedAt: new Date().toISOString(),
      endpoint: endpoint.path,
      httpStatus: 0,
      ok: false,
      payload: {
        status: "transport-error",
        detail: error instanceof Error ? error.message : "Unknown request failure."
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function writeJsonArtifact(outputDirectory, artifact) {
  const redactedPayload = redact(artifact.payload);
  const absolutePath = join(outputDirectory, artifact.fileName);
  await writeTextFileAtomic(absolutePath, `${JSON.stringify(redactedPayload, null, 2)}\n`, "Hosted proof bundle JSON artifact");

  return {
    id: artifact.id,
    fileName: artifact.fileName,
    source: artifact.source,
    redacted: true,
    privateHandling: artifact.privateHandling,
    status: statusFromPayload(redactedPayload),
    path: absolutePath
  };
}

async function buildDeploymentExecutionEvidenceArtifacts(input) {
  const deploymentPacket = input.endpointPayloads.get("deployment-packet")?.payload ?? {};
  const packetArtifacts = new Map(
    (Array.isArray(deploymentPacket.artifactManifest) ? deploymentPacket.artifactManifest : [])
      .filter((artifact) => artifact && typeof artifact === "object")
      .map((artifact) => [String(artifact.id ?? ""), artifact])
  );

  return [
    await expectedPrivateArtifact({
      id: "deployment-command-results-template-json",
      fallbackFileName: "deployment-command-results.json",
      fallbackSource:
        "npm run prepare:deployment-execution-checklist -- --write-results-template /secure/local/deployment-command-results.json",
      fallbackPrivateHandling:
        "Expected private command-results template; keep outside source and fill only from reviewed operator command output.",
      packetArtifact: packetArtifacts.get("deployment-command-results-template-json"),
      outputDirectory: input.outputDirectory,
      releaseId: input.releaseId,
      baseUrl: input.baseUrl,
      verifier: verifyDeploymentCommandResults
    }),
    await expectedPrivateArtifact({
      id: "deployment-execution-checklist-json",
      fallbackFileName: "deployment-execution-checklist.json",
      fallbackSource:
        "npm run prepare:deployment-execution-checklist -- --results /secure/local/deployment-command-results.json --strict",
      fallbackPrivateHandling:
        "Expected private deployment execution checklist; generated after the command-results template is filled and before confirmed Evidence Vault import.",
      packetArtifact: packetArtifacts.get("deployment-execution-checklist-json"),
      outputDirectory: input.outputDirectory,
      releaseId: input.releaseId,
      baseUrl: input.baseUrl,
      verifier: verifyDeploymentExecutionChecklist
    })
  ];
}

async function expectedPrivateArtifact(input) {
  const packetArtifact = input.packetArtifact ?? {};
  const fileName = fileNameFromPrivatePath(packetArtifact.privateStorePath, input.fallbackFileName);
  const existing = await readExistingPrivateProofArtifact({
    outputDirectory: input.outputDirectory,
    fileName,
    releaseId: input.releaseId,
    baseUrl: input.baseUrl,
    verifier: input.verifier
  });

  return {
    id: input.id,
    fileName,
    source: cleanString(packetArtifact.sourceCommand) || input.fallbackSource || `deployment-packet:artifactManifest:${input.id}`,
    redacted: Boolean(existing),
    expectedOnly: !existing,
    privateHandling:
      existing?.privateHandling ||
      cleanString(packetArtifact.nextAction) ||
      cleanString(packetArtifact.evidenceVaultTarget) ||
      input.fallbackPrivateHandling,
    status:
      existing?.status ??
      (normalizeStatus(packetArtifact.status) === "missing" ? "external-required" : cleanString(packetArtifact.status) || "external-required"),
    path: existing?.path
  };
}

function fileNameFromPrivatePath(privateStorePath, fallback) {
  const path = cleanString(privateStorePath);
  const segment = path.split("/").filter(Boolean).pop();
  return segment || fallback;
}

async function readExistingPrivateProofArtifact(input) {
  const path = join(input.outputDirectory, input.fileName);

  try {
    await assertRegularFileIfExists(path, "Hosted proof bundle existing private artifact");
    const text = await readFile(path, "utf8");
    const payload = parseJson(text);
    const verification = input.verifier(payload, {
      releaseId: input.releaseId,
      baseUrl: input.baseUrl,
      text
    });

    return {
      path,
      status: verification.status,
      privateHandling: verification.privateHandling
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function verifyDeploymentCommandResults(payload, context) {
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const blockers = [
    ...(cleanString(payload.releaseId) === context.releaseId
      ? []
      : [`releaseId ${cleanString(payload.releaseId) || "missing"} does not match ${context.releaseId}.`]),
    ...(cleanString(payload.sourceUrl) === context.baseUrl
      ? []
      : [`sourceUrl ${cleanString(payload.sourceUrl) || "missing"} does not match ${context.baseUrl}.`]),
    ...(entries.length ? [] : ["command results must include at least one entry."]),
    ...entries
      .filter((entry) => normalizeStatus(entry?.status) !== "passed")
      .map((entry) => `${cleanString(entry?.commandId) || "unknown-command"} status is ${cleanString(entry?.status) || "missing"}, not passed.`),
    ...(hasUnsafeText(context.text) ? ["command results contain secret-shaped text."] : [])
  ];

  return {
    status: blockers.length ? "needs-review" : "verified",
    privateHandling: blockers.length
      ? `Existing deployment command-results artifact needs review before it can satisfy release evidence: ${blockers.slice(0, 3).join(" ")}`
      : "Existing deployment command-results artifact is release-matched, URL-matched, passed, and secret-scan clean; keep it in the private evidence store."
  };
}

function verifyDeploymentExecutionChecklist(payload, context) {
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const summary = payload.summary && typeof payload.summary === "object" ? payload.summary : {};
  const blockers = [
    ...(payload.overallStatus === "passed" ? [] : [`overallStatus is ${cleanString(payload.overallStatus) || "missing"}, not passed.`]),
    ...(cleanString(payload.releaseId) === context.releaseId
      ? []
      : [`releaseId ${cleanString(payload.releaseId) || "missing"} does not match ${context.releaseId}.`]),
    ...(cleanString(payload.sourceUrl) === context.baseUrl
      ? []
      : [`sourceUrl ${cleanString(payload.sourceUrl) || "missing"} does not match ${context.baseUrl}.`]),
    ...(entries.length ? [] : ["deployment execution checklist must include at least one entry."]),
    ...(Number(summary.total ?? entries.length) === entries.length
      ? []
      : [`summary.total is ${summary.total}, but the checklist has ${entries.length} entries.`]),
    ...(Number(summary.passed ?? 0) === entries.length ? [] : [`summary.passed is ${summary.passed}, expected ${entries.length}.`]),
    ...(Number(summary.blocked ?? 0) === 0 ? [] : [`summary.blocked is ${summary.blocked}, not 0.`]),
    ...(Number(summary.needsReview ?? 0) === 0 ? [] : [`summary.needsReview is ${summary.needsReview}, not 0.`]),
    ...entries
      .filter((entry) => normalizeStatus(entry?.status) !== "passed" || (Array.isArray(entry?.blockers) && entry.blockers.length > 0))
      .map((entry) => `${cleanString(entry?.commandId) || "unknown-command"} is not a passed, blocker-free entry.`),
    ...(hasUnsafeText(context.text) ? ["deployment execution checklist contains secret-shaped text."] : [])
  ];

  return {
    status: blockers.length ? "needs-review" : "verified",
    privateHandling: blockers.length
      ? `Existing deployment execution checklist needs review before it can satisfy release evidence: ${blockers.slice(0, 3).join(" ")}`
      : "Existing deployment execution checklist is release-matched, URL-matched, passed, blocker-free, and secret-scan clean; keep it in the private evidence store."
  };
}

function buildReleaseIntegrity(input) {
  const deploymentPacket = input.endpointPayloads.get("deployment-packet")?.payload ?? {};
  const projectProvenance = input.endpointPayloads.get("project-provenance")?.payload ?? {};
  const checks = [
    exactReleaseCheck({
      id: "verify-production-release-id",
      label: "Verify-production release id",
      expected: input.releaseId,
      actual: input.verifyReport?.releaseId,
      missingDetail:
        "verify-production.json is missing releaseId. Rerun the collector or verifier with --release-id $SENTINEL_RELEASE_ID before importing evidence."
    }),
    exactReleaseCheck({
      id: "verify-production-base-url",
      label: "Verify-production base URL",
      expected: input.baseUrl,
      actual: input.verifyReport?.baseUrl,
      missingDetail: "verify-production.json is missing baseUrl. Rerun hosted verification against the deployed product URL."
    }),
    exactReleaseCheck({
      id: "deployment-packet-release-id",
      label: "Deployment packet release id",
      expected: input.releaseId,
      actual: deploymentPacket.releaseId,
      missingDetail:
        "deployment-packet.json is missing releaseId. Set SENTINEL_RELEASE_ID in the deployed environment and recapture the bundle."
    }),
    exactReleaseCheck({
      id: "deployment-packet-product-url",
      label: "Deployment packet product URL",
      expected: input.baseUrl,
      actual: deploymentPacket.productUrl,
      missingDetail:
        "deployment-packet.json is missing productUrl. Set NEXT_PUBLIC_PRODUCT_URL in the deployed environment and recapture the bundle."
    }),
    exactReleaseCheck({
      id: "evidence-vault-template-release-id",
      label: "Evidence Vault import template release id",
      expected: input.releaseId,
      actual: deploymentPacket.evidenceVaultImportTemplate?.payload?.releaseId,
      missingDetail:
        "deployment-packet evidenceVaultImportTemplate is missing payload.releaseId. Recapture after deployment packet configuration is fixed."
    }),
    exactReleaseCheck({
      id: "evidence-vault-template-source-url",
      label: "Evidence Vault import template source URL",
      expected: input.baseUrl,
      actual: deploymentPacket.evidenceVaultImportTemplate?.sourceUrl,
      missingDetail:
        "deployment-packet evidenceVaultImportTemplate is missing sourceUrl. Recapture after hosted URL configuration is fixed."
    }),
    pushedHeadCheck(projectProvenance)
  ];
  const blockers = checks
    .filter((check) => check.status === "blocked")
    .map((check) => `${check.label}: ${check.detail}`);
  const needsReview = checks.filter((check) => check.status === "needs-review");

  return {
    generatedAt: new Date().toISOString(),
    status: blockers.length ? "blocked" : needsReview.length ? "needs-review" : "passed",
    expected: {
      releaseId: input.releaseId,
      baseUrl: input.baseUrl
    },
    checks,
    blockers,
    nextAction: blockers.length
      ? "Fix release/base URL mismatches or missing provenance, redeploy if needed, then rerun collect:hosted-proof before importing."
      : needsReview.length
        ? "Review release provenance warnings before treating this bundle as final judge evidence."
        : "Release id, hosted URL, deployment packet, import template, and pushed-source provenance are aligned.",
    disclaimer:
      "Release integrity only proves that collected proof artifacts belong to the same declared release; it does not prove external revenue, user, Cloud Run, Gemini, Workspace, or judging outcomes."
  };
}

function exactReleaseCheck(input) {
  const expected = cleanString(input.expected);
  const actual = cleanString(input.actual);

  if (!actual) {
    return {
      id: input.id,
      label: input.label,
      status: "blocked",
      expected,
      actual: "",
      detail: input.missingDetail
    };
  }

  if (actual !== expected) {
    return {
      id: input.id,
      label: input.label,
      status: "blocked",
      expected,
      actual,
      detail: `Expected ${expected}, received ${actual}.`
    };
  }

  return {
    id: input.id,
    label: input.label,
    status: "passed",
    expected,
    actual,
    detail: "Matched."
  };
}

function pushedHeadCheck(projectProvenance) {
  const headCommit = cleanString(projectProvenance?.git?.headCommit);
  const remoteHeadCommit = cleanString(projectProvenance?.git?.remoteHeadCommit);
  const upstreamBranch = cleanString(projectProvenance?.git?.upstreamBranch);

  if (!headCommit || !remoteHeadCommit) {
    return {
      id: "project-provenance-pushed-head",
      label: "Project provenance pushed HEAD",
      status: "blocked",
      expected: "local HEAD equals upstream HEAD",
      actual: `HEAD ${headCommit || "missing"}; upstream ${upstreamBranch || "missing"} ${remoteHeadCommit || "missing"}`,
      detail: "Project provenance is missing local or upstream commit evidence. Push the release commit and recapture provenance."
    };
  }

  if (headCommit !== remoteHeadCommit) {
    return {
      id: "project-provenance-pushed-head",
      label: "Project provenance pushed HEAD",
      status: "blocked",
      expected: headCommit,
      actual: remoteHeadCommit,
      detail: "The hosted provenance artifact does not show the same commit at local HEAD and upstream HEAD."
    };
  }

  return {
    id: "project-provenance-pushed-head",
    label: "Project provenance pushed HEAD",
    status: "passed",
    expected: headCommit,
    actual: remoteHeadCommit,
    detail: `Matched on ${upstreamBranch || "upstream branch"}.`
  };
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildManifest(input) {
  const failedArtifacts = input.artifacts.filter((artifact) => artifact.status === "transport-error");
  const blockedArtifacts = input.artifacts.filter((artifact) => isBlockedStatus(artifact.status));
  const releaseIntegrityBlocked = input.releaseIntegrity.status === "blocked";
  const proofFlagBlocked = input.releaseEvidenceManifest.proofFlagChecks.filter((check) => check.status === "blocked");
  const proofFlagNeedsReview = input.releaseEvidenceManifest.proofFlagChecks.filter((check) => check.status === "needs-review");

  return {
    generatedAt: new Date().toISOString(),
    releaseId: input.releaseId,
    baseUrl: input.baseUrl,
    outputDirectory: input.outputDirectory,
    mode: input.includeWriteChecks ? "read-and-write-through" : "read-only",
    strict: input.strict,
    bundleUpdateMode: input.refreshExisting ? "refresh-existing" : "new-directory",
    writeAuth: {
      required: input.includeWriteChecks,
      configured: input.adminTokenConfigured,
      tokenEnv: input.adminTokenEnv,
      headerName: adminTokenHeader
    },
    summary: {
      artifactCount: input.artifacts.length,
      failedTransport: failedArtifacts.length + (input.verifyReport?.summary?.failedTransport ?? 0),
      blockedOrNeedsReview:
        blockedArtifacts.length +
        (input.verifyReport?.summary?.blockedOrNeedsReview ?? 0) +
        (input.releaseIntegrity.status === "passed" ? 0 : 1) +
        proofFlagBlocked.length +
        proofFlagNeedsReview.length,
      releaseEvidenceStatus: input.releaseEvidenceManifest.overallStatus,
      releaseIntegrityStatus: input.releaseIntegrity.status,
      proofFlagStatus: input.releaseEvidenceManifest.proofFlagStatus,
      releaseEvidenceSlots: input.releaseEvidenceManifest.summary
    },
    releaseIntegrity: input.releaseIntegrity,
    releaseEvidence: {
      artifact: "release-evidence-manifest.json",
      overallStatus: input.releaseEvidenceManifest.overallStatus,
      summary: input.releaseEvidenceManifest.summary,
      proofFlagStatus: input.releaseEvidenceManifest.proofFlagStatus,
      proofFlagChecks: input.releaseEvidenceManifest.proofFlagChecks
    },
    artifacts: input.artifacts.map((artifact) => ({
      id: artifact.id,
      fileName: artifact.fileName,
      source: artifact.source,
      redacted: artifact.redacted,
      privateHandling: artifact.privateHandling,
      status: artifact.status,
      expectedOnly: Boolean(artifact.expectedOnly)
    })),
    blockers: [
      ...(failedArtifacts.length ? [`Transport failed for ${failedArtifacts.map((artifact) => artifact.id).join(", ")}.`] : []),
      ...(blockedArtifacts.length
        ? [`Blocked or review status remains for ${blockedArtifacts.map((artifact) => artifact.id).join(", ")}.`]
        : []),
      ...(releaseIntegrityBlocked ? input.releaseIntegrity.blockers : []),
      ...input.releaseEvidenceManifest.proofFlagBlockers
    ],
    nextActions: [
      "Review every JSON artifact for redaction before sharing with judges or importing into the Evidence Vault.",
      "Import only after release integrity passes and the redacted verify-production JSON matches this bundle release id.",
      "Use release-evidence-manifest.json as the release-level proof index; do not treat missing or mock-only slots as complete.",
      "Generate the deployment command-results template and passed execution checklist before confirmed Evidence Vault import.",
      "If any XPRIZE proof flag is true in hosted launch readiness, matching repository, Google Cloud, and provider=gemini-api proof must be present before import.",
      "Attach Cloud Run revision, Gemini usage, GCP persistence, Workspace sync, revenue, cost, CAC, user, demo-video, and judge-access proof privately.",
      "Rerun this collector after every hosted deployment or evidence-status change."
    ],
    privateHandling: [
      "This bundle is local operator evidence and should not be committed.",
      "Generated artifacts may contain route names, internal ids, status details, and customer-proof metadata; inspect before sharing.",
      "The collector redacts common secret-shaped keys defensively, but human review is still required before judge distribution.",
      "Release evidence statuses describe proof readiness only; they do not certify compliance, audit readiness, revenue validity, or judging outcome.",
      "Admin tokens are read only from the configured environment variable and are never written to bundle output."
    ],
    disclaimer:
      "This bundle collects hosted evidence surfaces. It does not create Cloud Run, Gemini, Workspace, revenue, user, cost, CAC, demo-video, or judge-access proof by itself."
  };
}

function buildReleaseEvidenceManifest(input) {
  const rowsById = new Map(
    (Array.isArray(input.verifyReport?.results) ? input.verifyReport.results : [])
      .filter((row) => row && typeof row === "object")
      .map((row) => [String(row.id ?? ""), row])
  );
  const artifactsById = new Map(input.artifacts.map((artifact) => [artifact.id, artifact]));
  const slots = releaseEvidenceSlotDefinitions().map((slot) => {
    const evidence = slot.sources.map((source) => evidenceForSource(source, rowsById, artifactsById, input.endpointPayloads));
    const status = releaseSlotStatus(evidence, slot);

    return {
      id: slot.id,
      label: slot.label,
      ruleBucket: slot.ruleBucket,
      status,
      evidence,
      missingProof: missingProofForSlot(status, evidence),
      nextAction: status === "verified" ? "Keep the redacted artifact and checksum available for private judge follow-up." : slot.nextAction,
      privateHandling: slot.privateHandling
    };
  });
  const proofFlagChecks = buildProofFlagChecks({
    rowsById,
    slots,
    artifactsById,
    endpointPayloads: input.endpointPayloads
  });
  const proofFlagBlockers = proofFlagChecks
    .filter((check) => check.status === "blocked")
    .map((check) => `${check.envName}: ${check.detail}`);
  const proofFlagNeedsReview = proofFlagChecks.filter((check) => check.status === "needs-review");
  const summary = slots.reduce(
    (accumulator, slot) => ({
      ...accumulator,
      [slot.status]: (accumulator[slot.status] ?? 0) + 1
    }),
    {
      verified: 0,
      "needs-review": 0,
      missing: 0,
      "mock-only": 0,
      "transport-error": 0
    }
  );

  return {
    generatedAt: new Date().toISOString(),
    releaseId: input.releaseId,
    baseUrl: input.baseUrl,
    releaseIntegrity: input.releaseIntegrity,
    overallStatus:
      input.releaseIntegrity.status === "blocked"
        ? "blocked"
        : proofFlagBlockers.length
          ? "blocked"
        : summary["transport-error"] > 0
        ? "blocked"
        : summary.missing + summary["mock-only"] + summary["needs-review"] > 0 || proofFlagNeedsReview.length > 0
          ? "needs-proof"
          : "ready-for-private-review",
    summary,
    slots,
    proofFlagStatus: proofFlagBlockers.length ? "blocked" : proofFlagNeedsReview.length ? "needs-review" : "passed",
    proofFlagChecks,
    proofFlagBlockers,
    nextActions: [
      "Clear missing and mock-only slots with hosted Cloud Run, live Gemini, durable GCP, Workspace, financial, user, cost/CAC, demo, judge-access, repository, and license/IP proof.",
      "Keep XPRIZE proof flags false until the matching repository, Google Cloud, Gemini, business, category-impact, AI-native, IP, and evidence-response checks pass.",
      "Keep customer names, security findings, OAuth artifacts, invoices, payment records, CAC receipts, raw logs, and credentials in the private evidence store.",
      "Rerun collect:hosted-proof after each deployment or proof import and keep the release evidence manifest with the private judge packet."
    ],
    disclaimer:
      "This manifest groups proof status for one release. It is not a guarantee of winning, certification, legal advice, audit assurance, or compliance status."
  };
}

function buildProofFlagChecks(input) {
  const launchReadiness = input.endpointPayloads.get("launch-readiness")?.payload ?? {};
  const envMatrix = Array.isArray(launchReadiness.envMatrix) ? launchReadiness.envMatrix : [];
  const slotsById = new Map(input.slots.map((slot) => [slot.id, slot]));
  const definitions = [
    {
      envName: "XPRIZE_REPOSITORY_ACCESS_CONFIGURED",
      label: "Repository access proof flag",
      ruleBucket: "Repository source access",
      evidenceIds: ["repository-source"],
      passed: () => slotVerified(slotsById, "repository-source"),
      requiredEvidence:
        "repository-source release slot verified from source-release and project-provenance artifacts."
    },
    {
      envName: "XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED",
      label: "Google Cloud product proof flag",
      ruleBucket: "Google Cloud product usage",
      evidenceIds: ["cloud-run-deployment", "gcp-persistence"],
      passed: () => slotVerified(slotsById, "cloud-run-deployment") || slotVerified(slotsById, "gcp-persistence"),
      requiredEvidence:
        "cloud-run-deployment or gcp-persistence release slot verified from hosted Cloud Run/GCP evidence."
    },
    {
      envName: "XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED",
      label: "Deployed Gemini API-call proof flag",
      ruleBucket: "Gemini API usage",
      evidenceIds: ["live-gemini"],
      passed: () => hasGeminiApiProof(input.rowsById),
      requiredEvidence:
        "gemini-proof-status or gemini-smoke-write-through row passed with provider=gemini-api in the hosted report."
    },
    {
      envName: "XPRIZE_BUSINESS_MODEL_EVIDENCE_CONFIGURED",
      label: "Business model evidence proof flag",
      ruleBucket: "Business viability",
      evidenceIds: ["business-viability"],
      passed: () => slotVerified(slotsById, "business-viability"),
      requiredEvidence:
        "business-viability release slot verified from hosted evidence and evidence-intake artifacts."
    },
    {
      envName: "XPRIZE_CATEGORY_IMPACT_EVIDENCE_CONFIGURED",
      label: "Category impact evidence proof flag",
      ruleBucket: "Category impact",
      evidenceIds: ["business-viability", "devpost-submission"],
      passed: () => slotsVerified(slotsById, ["business-viability", "devpost-submission"]),
      requiredEvidence:
        "business-viability and devpost-submission release slots verified with category rationale and customer-impact evidence."
    },
    {
      envName: "XPRIZE_AI_NATIVE_OPERATIONS_EVIDENCE_CONFIGURED",
      label: "AI-native operations evidence proof flag",
      ruleBucket: "AI-Native Operations",
      evidenceIds: ["live-gemini", "production-readiness", "workspace-sync"],
      passed: () => hasGeminiApiProof(input.rowsById) && slotsVerified(slotsById, ["production-readiness", "workspace-sync"]),
      requiredEvidence:
        "live Gemini provider evidence plus production-readiness and workspace-sync release slots verified from hosted production."
    },
    {
      envName: "XPRIZE_IP_OWNERSHIP_REVIEW_APPROVED",
      label: "IP ownership review proof flag",
      ruleBucket: "IP ownership and third-party authorization",
      evidenceIds: ["license-ip"],
      passed: () => slotVerified(slotsById, "license-ip"),
      requiredEvidence:
        "license-ip release slot verified from license manifest and human IP/third-party review evidence."
    },
    {
      envName: "XPRIZE_EVIDENCE_RESPONSE_READY",
      label: "Evidence response readiness proof flag",
      ruleBucket: "Judge follow-up evidence response",
      evidenceIds: ["judge-access", "devpost-submission", "deployment-execution-control"],
      passed: () => slotsVerified(slotsById, ["judge-access", "devpost-submission", "deployment-execution-control"]),
      requiredEvidence:
        "judge-access, devpost-submission, and deployment-execution-control release slots verified with private follow-up response materials ready."
    }
  ];

  return definitions.map((definition) => {
    const env = envMatrix.find((item) => item?.name === definition.envName);
    const claimed = envFlagClaimed(env);
    const evidence = definition.evidenceIds.map((id) => ({
      id,
      status: slotsById.get(id)?.status ?? "missing-source",
      missingProof: slotsById.get(id)?.missingProof ?? [`${id}: missing-source`]
    }));

    if (!env) {
      return {
        envName: definition.envName,
        label: definition.label,
        ruleBucket: definition.ruleBucket,
        status: "needs-review",
        claimStatus: "unknown",
        currentValue: "missing-source",
        requiredEvidence: definition.requiredEvidence,
        evidence,
        detail:
          "launch-readiness.json did not include this env flag, so the hosted proof bundle cannot cross-check whether the flag is being claimed.",
        nextAction:
          "Recapture the hosted proof bundle after /api/production/launch-readiness exposes the XPRIZE proof flag matrix."
      };
    }

    if (!claimed) {
      return {
        envName: definition.envName,
        label: definition.label,
        ruleBucket: definition.ruleBucket,
        status: "not-claimed",
        claimStatus: "not-claimed",
        currentValue: cleanString(env.currentValue || env.status),
        requiredEvidence: definition.requiredEvidence,
        evidence,
        detail: "The hosted launch readiness payload does not claim this proof flag yet.",
        nextAction: "Keep this flag false until the matching private evidence has been captured and reviewed."
      };
    }

    if (!definition.passed()) {
      return {
        envName: definition.envName,
        label: definition.label,
        ruleBucket: definition.ruleBucket,
        status: "blocked",
        claimStatus: "claimed",
        currentValue: cleanString(env.currentValue || env.status),
        requiredEvidence: definition.requiredEvidence,
        evidence,
        detail: `Hosted launch readiness claims ${definition.envName}=true, but the bundle is missing ${definition.requiredEvidence}`,
        nextAction: `Do not import this bundle as final proof. Set ${definition.envName}=false or recapture after the matching hosted evidence exists.`
      };
    }

    return {
      envName: definition.envName,
      label: definition.label,
      ruleBucket: definition.ruleBucket,
      status: "passed",
      claimStatus: "claimed",
      currentValue: cleanString(env.currentValue || env.status),
      requiredEvidence: definition.requiredEvidence,
      evidence,
      detail: `Hosted launch readiness claims ${definition.envName}=true and matching release evidence is present.`,
      nextAction: "Keep the redacted artifacts and checksums in the private judge packet."
    };
  });
}

function slotVerified(slotsById, id) {
  return slotsById.get(id)?.status === "verified";
}

function slotsVerified(slotsById, ids) {
  return ids.every((id) => slotVerified(slotsById, id));
}

function hasGeminiApiProof(rowsById) {
  return ["gemini-proof-status", "gemini-smoke-write-through"].some((id) => {
    const row = rowsById.get(id);
    return Boolean(row && verifiedStatuses().includes(normalizeStatus(row.status)) && /gemini-api/iu.test(String(row.detail ?? "")));
  });
}

function envFlagClaimed(env) {
  if (!env || typeof env !== "object") {
    return false;
  }

  const currentValue = cleanString(env.currentValue).toLowerCase();
  return currentValue === "true" || (env.status === "configured" && currentValue !== "missing");
}

function releaseEvidenceSlotDefinitions() {
  return [
    {
      id: "cloud-run-deployment",
      label: "Hosted Cloud Run product proof",
      ruleBucket: "Working product URL and Google Cloud usage",
      satisfaction: "any-verified",
      verifiedSourceIds: ["cloudrun-deployment-output"],
      sources: [
        hostedEvidenceCheckSource("cloudrun-deployment-output"),
        rowSource("cloudrun-deployment-evidence"),
        rowSource("deployment-evidence-packet"),
        artifactSource("deployment-packet")
      ],
      nextAction: "Attach Cloud Run dry-run/deploy output, revision URL, hosted screenshot, and successful deployment-packet status.",
      privateHandling: "Redact project ids only if required by customer policy; never include service-account keys or admin tokens."
    },
    {
      id: "production-readiness",
      label: "Hosted production readiness report",
      ruleBucket: "Product-running evidence and follow-up readiness",
      sources: [artifactSource("verify-production"), rowSource("hosted-evidence-capture"), artifactSource("hosted-evidence")],
      nextAction: "Rerun verify:production against the hosted URL and import only the redacted JSON after blocked rows are cleared.",
      privateHandling: "Keep raw logs and screenshots private; share redacted status summaries only."
    },
    {
      id: "live-gemini",
      label: "Live Gemini API proof",
      ruleBucket: "Gemini API usage",
      sources: [rowSource("gemini-proof-status"), rowSource("gemini-smoke-write-through")],
      nextAction: "Run the hosted Gemini smoke and write-through proof until provider=gemini-api is recorded with cost/token metadata.",
      privateHandling: "Do not include prompts, source documents, customer text, or API keys in judge-facing artifacts."
    },
    {
      id: "gcp-persistence",
      label: "Durable GCP persistence proof",
      ruleBucket: "Google Cloud product usage",
      sources: [rowSource("persistence-write-through")],
      nextAction: "Attach Firestore, BigQuery, and Secret Manager write-through output from the hosted app.",
      privateHandling: "Keep raw database row data private; expose only redacted operation status and checksums."
    },
    {
      id: "workspace-sync",
      label: "Google Workspace OAuth and watch lifecycle proof",
      ruleBucket: "AI-native operations and real-user workflow",
      sources: [
        rowSource("workspace-bootstrap"),
        rowSource("workspace-reconcile"),
        rowSource("workspace-watch-renewal"),
        artifactSource("workspace-sync-status")
      ],
      nextAction: "Attach consented OAuth install, Drive/Gmail cursor bootstrap, reconciliation, and watch-renewal proof from hosted production.",
      privateHandling: "Redact OAuth token metadata, channel tokens, file names, mailbox details, customer names, and security findings."
    },
    {
      id: "cloud-cost-controls",
      label: "Cloud Billing and Gemini cost-control proof",
      ruleBucket: "Costs and CAC support",
      sources: [rowSource("cost-controls-write-through")],
      nextAction: "Attach budget, alert, quota, key-restriction, Gemini token/cost, operating cost, and CAC receipt proof.",
      privateHandling: "Keep billing account identifiers, receipts, and invoices private unless explicitly consented for judge review."
    },
    {
      id: "business-viability",
      label: "Revenue, cost, CAC, active-user, and consent proof",
      ruleBucket: "Revenue, costs, CAC, and real-user evidence",
      sources: [artifactSource("hosted-evidence"), artifactSource("evidence-intake")],
      nextAction: "Register paid pilot invoices, payment records, active-user logs, cost/CAC receipts, consent records, and approved testimonials.",
      privateHandling: "Never publish customer names, invoices, payment records, or testimonials without explicit consent."
    },
    {
      id: "judge-access",
      label: "Judge access and free judging-period proof",
      ruleBucket: "Testing instructions and product access",
      sources: [rowSource("judge-access-pack"), artifactSource("judge-access-pack")],
      nextAction: "Configure the hosted judge walkthrough, private credentials, free judging-period access, and signed-out smoke screenshots.",
      privateHandling: "Credentials belong only in private Devpost fields or approved private channels, never in generated repository artifacts."
    },
    {
      id: "deployment-execution-control",
      label: "Deployment execution command-result gate",
      ruleBucket: "Evidence import controls and operator command proof",
      sources: [
        artifactSource("deployment-command-results-template-json"),
        artifactSource("deployment-execution-checklist-json")
      ],
      nextAction:
        "Generate the command-results template, fill it from reviewed private operator output, then create a passed deployment execution checklist before confirmed Evidence Vault import.",
      privateHandling:
        "Keep command results, raw terminal output, private evidence paths, customer proof, invoices, and credentials in the private evidence store."
    },
    {
      id: "demo-video",
      label: "Public demo video proof",
      ruleBucket: "Public demo video under three minutes",
      sources: [rowSource("demo-video-pack"), artifactSource("demo-video-pack")],
      nextAction: "Record the final public video with English/subtitles, under-three-minute runtime, asset clearance, and redacted customer data.",
      privateHandling: "Keep raw recording assets and clearance notes private; publish only approved demo media."
    },
    {
      id: "repository-source",
      label: "Repository source and provenance proof",
      ruleBucket: "Repository access and source sharing",
      sources: [rowSource("source-release"), artifactSource("source-release"), artifactSource("project-provenance")],
      nextAction: "Keep the pushed repository URL, source-release output, and provenance report ready for Devpost and private judge follow-up.",
      privateHandling: "Do not include private evidence bundles, generated artifacts, credentials, or customer data in the repository."
    },
    {
      id: "license-ip",
      label: "Third-party license, API, asset, and IP review proof",
      ruleBucket: "IP ownership, third-party API authorization, and asset clearance",
      sources: [rowSource("license-manifest"), artifactSource("license-manifest")],
      nextAction: "Complete human dependency/API/asset/IP review and keep approval notes private before setting clearance flags.",
      privateHandling: "Human review notes and API terms analysis stay private; public copy should state only reviewed, accurate disclosures."
    },
    {
      id: "devpost-submission",
      label: "Devpost submission packet and claim-safety proof",
      ruleBucket: "Submission logistics and public-safe claims",
      sources: [artifactSource("devpost-pack"), artifactSource("submission-binder"), artifactSource("claim-guard")],
      nextAction: "Resolve blocked submission fields, run Claim Guard on final copy, and keep the private response queue ready for evidence requests.",
      privateHandling: "Separate public Devpost copy from private evidence; avoid customer/security data and overclaiming."
    }
  ];
}

function rowSource(id) {
  return { kind: "verify-row", id };
}

function artifactSource(id) {
  return { kind: "artifact", id };
}

function hostedEvidenceCheckSource(id) {
  return { kind: "hosted-evidence-check", id };
}

function evidenceForSource(source, rowsById, artifactsById, endpointPayloads) {
  if (source.kind === "verify-row") {
    const row = rowsById.get(source.id);
    return {
      id: source.id,
      source: "verify-production",
      type: "verify-row",
      status: row ? String(row.status ?? "unknown") : "missing-source",
      detail: row?.detail ? String(row.detail).slice(0, 300) : "Verification row was not present in this release report."
    };
  }

  if (source.kind === "hosted-evidence-check") {
    const hostedEvidence = endpointPayloads.get("hosted-evidence")?.payload ?? {};
    const checks = Array.isArray(hostedEvidence.checks) ? hostedEvidence.checks : [];
    const check = checks.find((item) => item && typeof item === "object" && String(item.id ?? "") === source.id);

    return {
      id: source.id,
      source: "/api/production/hosted-evidence",
      type: "hosted-evidence-check",
      status: check ? String(check.status ?? "unknown") : "missing-source",
      detail: check?.evidence
        ? String(check.evidence).slice(0, 300)
        : check?.fix
          ? String(check.fix).slice(0, 300)
          : "Hosted evidence check was not present in this release bundle."
    };
  }

  const artifact = artifactsById.get(source.id);
  return {
    id: source.id,
    source: artifact?.source ?? "bundle-artifact",
    type: "artifact",
    status: artifact ? String(artifact.status ?? "unknown") : "missing-source",
    fileName: artifact?.fileName,
    detail: artifact?.expectedOnly
      ? "Expected private artifact declared for this release; the collector does not capture the filled operator evidence."
      : artifact
        ? "Redacted artifact captured in this bundle."
        : "Artifact was not captured in this release bundle."
  };
}

function releaseSlotStatus(evidence, slot = {}) {
  const statuses = evidence.map((item) => normalizeStatus(item.status));

  if (statuses.includes("transport-error")) {
    return "transport-error";
  }

  if (
    slot.satisfaction === "any-verified" &&
    evidence.some(
      (item) =>
        (!Array.isArray(slot.verifiedSourceIds) || slot.verifiedSourceIds.includes(item.id)) &&
        verifiedStatuses().includes(normalizeStatus(item.status))
    )
  ) {
    return "verified";
  }

  if (statuses.includes("missing-source") || statuses.includes("missing") || statuses.includes("external-required")) {
    return "missing";
  }

  if (statuses.some((status) => mockStatuses().includes(status))) {
    return "mock-only";
  }

  if (statuses.some((status) => reviewStatuses().includes(status))) {
    return "needs-review";
  }

  return statuses.every((status) => verifiedStatuses().includes(status)) ? "verified" : "needs-review";
}

function missingProofForSlot(status, evidence) {
  if (status === "verified") {
    return [];
  }

  return evidence
    .filter((item) => !verifiedStatuses().includes(normalizeStatus(item.status)))
    .map((item) => `${item.id}: ${item.status}`);
}

function normalizeStatus(status) {
  return String(status ?? "unknown").toLowerCase();
}

function verifiedStatuses() {
  return ["passed", "ready", "verified", "captured", "published"];
}

function reviewStatuses() {
  return ["blocked", "failed", "needs-hosted-proof", "needs-review", "ready-for-review", "ready-to-record", "ready-to-commit", "warning", "unknown"];
}

function mockStatuses() {
  return ["mock", "mock-only", "simulated", "template-needs-values", "ready-to-capture", "ready-to-dry-run", "local-mock"];
}

async function writeMarkdownSummary(outputDirectory, manifest) {
  const lines = [
    "# Hosted Proof Bundle",
    "",
    `Generated: ${manifest.generatedAt}`,
    `Release: ${manifest.releaseId}`,
    `Base URL: ${manifest.baseUrl}`,
    `Mode: ${manifest.mode}`,
    "",
    "## Summary",
    "",
    `- Artifacts: ${manifest.summary.artifactCount}`,
    `- Failed transport: ${manifest.summary.failedTransport}`,
    `- Blocked or needs review: ${manifest.summary.blockedOrNeedsReview}`,
    `- Release evidence status: ${manifest.releaseEvidence.overallStatus}`,
    `- Release integrity: ${manifest.releaseIntegrity.status}`,
    "",
    "## Release Integrity",
    "",
    ...manifest.releaseIntegrity.checks.map((check) => `- ${check.label}: ${check.status} (${check.detail})`),
    "",
    "## Release Evidence Manifest",
    "",
    `- Artifact: ${manifest.releaseEvidence.artifact}`,
    ...Object.entries(manifest.releaseEvidence.summary).map(([status, count]) => `- ${status}: ${count}`),
    `- proof flags: ${manifest.releaseEvidence.proofFlagStatus}`,
    "",
    "## XPRIZE Proof Flag Checks",
    "",
    ...manifest.releaseEvidence.proofFlagChecks.map((check) => `- ${check.envName}: ${check.status} (${check.detail})`),
    "",
    "## Artifacts",
    "",
    ...manifest.artifacts.map((artifact) => `- ${artifact.fileName}: ${artifact.status} (${artifact.source})`),
    "",
    "## Private Handling",
    "",
    ...manifest.privateHandling.map((item) => `- ${item}`),
    ""
  ];
  await writeTextFileAtomic(join(outputDirectory, "README.md"), `${lines.join("\n")}\n`, "Hosted proof bundle Markdown summary");
}

async function writeTextFileAtomic(path, content, label) {
  const parentDirectory = dirname(path);
  await assertDirectoryPathSafe(parentDirectory, `${label} parent directory`);
  await assertRegularFileIfExists(path, label);
  const tempPath = join(parentDirectory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);

  try {
    await writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function assertDirectoryPathSafe(path, label) {
  const directories = [];
  let cursor = resolve(path);

  while (true) {
    directories.push(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  for (const directory of directories.reverse()) {
    let fileStat;

    try {
      fileStat = await lstat(directory);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    if (fileStat.isSymbolicLink()) {
      throw new Error(`${label} ${directory} is a symbolic link; use a regular private directory before hosted proof bundle collection.`);
    }

    if (!fileStat.isDirectory()) {
      throw new Error(`${label} ${directory} is not a directory; use a regular private directory before hosted proof bundle collection.`);
    }
  }
}

async function assertDirectoryExistsSafe(path, label) {
  const fileStat = await lstat(path);

  if (fileStat.isSymbolicLink()) {
    throw new Error(`${label} ${path} is a symbolic link; use a regular private directory before hosted proof bundle collection.`);
  }

  if (!fileStat.isDirectory()) {
    throw new Error(`${label} ${path} is not a directory; use a regular private directory before hosted proof bundle collection.`);
  }
}

async function assertDirectoryEmpty(path, label) {
  const entries = await readdir(path);

  if (entries.length > 0) {
    throw new Error(`${label} ${path} already contains files; use a new release id or empty private directory before hosted proof bundle collection.`);
  }
}

async function assertDirectoryRefreshable(path, label) {
  const entries = await readdir(path);

  for (const entry of entries) {
    const entryPath = join(path, entry);
    const fileStat = await lstat(entryPath);

    if (fileStat.isSymbolicLink()) {
      throw new Error(`${label} ${entryPath} is a symbolic link; copy reviewed artifacts into regular files before hosted proof bundle refresh.`);
    }

    if (!fileStat.isFile()) {
      throw new Error(`${label} ${entryPath} is not a regular file; use a regular private bundle directory before refresh.`);
    }
  }
}

async function assertRegularFileIfExists(path, label) {
  let fileStat;

  try {
    fileStat = await lstat(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  if (fileStat.isSymbolicLink()) {
    throw new Error(`${label} ${path} is a symbolic link; use a regular private file path before hosted proof bundle collection.`);
  }

  if (!fileStat.isFile()) {
    throw new Error(`${label} ${path} is not a regular file; use a regular private file path before hosted proof bundle collection.`);
  }
}

function redact(value) {
  if (Array.isArray(value)) {
    return value.map(redact);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        isSecretKey(key) ? "[REDACTED]" : redact(nested)
      ])
    );
  }

  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gu, "Bearer [REDACTED]")
      .replace(/(x-sentinel-admin-token['":\s]+)[A-Za-z0-9._~+/=-]+/giu, "$1[REDACTED]")
      .replace(/(api[_-]?key['":\s]+)[A-Za-z0-9._~+/=-]+/giu, "$1[REDACTED]");
  }

  return value;
}

function hasUnsafeText(value) {
  return [
    /Bearer\s+(?!\[REDACTED\])[\w.~+/=-]+/iu,
    /\bAIza[0-9A-Za-z_-]{20,}/u,
    /GOCSPX-[0-9A-Za-z_-]{20,}/u,
    /private-admin-token/u,
    /refresh[_-]?token["':\s]+(?!\[REDACTED\])[\w.~+/=-]+/iu,
    /access[_-]?token["':\s]+(?!\[REDACTED\])[\w.~+/=-]+/iu
  ].some((pattern) => pattern.test(String(value ?? "")));
}

function isSecretKey(key) {
  return /(token|secret|password|credential|authorization|cookie|apiKey|api_key|refresh|accessToken|adminAction)/iu.test(key);
}

function statusFromPayload(payload) {
  const direct =
    payload?.overallStatus ??
    payload?.status ??
    payload?.summary?.status ??
    payload?.payload?.overallStatus ??
    payload?.payload?.status ??
    payload?.payload?.summary?.status;

  if (direct) {
    return String(direct);
  }

  if (payload?.ok === false) {
    return "transport-error";
  }

  return "captured";
}

function isBlockedStatus(status) {
  return [
    "blocked",
    "missing",
    "external-required",
    "needs-hosted-proof",
    "template-needs-values",
    "needs-review",
    "ready-for-review",
    "ready-to-record",
    "ready-to-commit",
    "mock-only",
    "transport-error"
  ].includes(String(status));
}

function parseJson(text) {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function normalizeBaseUrl(rawUrl) {
  if (!rawUrl) {
    throw new Error("Set NEXT_PUBLIC_PRODUCT_URL or pass --url https://your-cloud-run-url");
  }

  const parsed = new URL(rawUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("URL must start with http:// or https://");
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/u, "");
}

function parseTimeout(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : defaultTimeoutMs;
}

function sanitizePathSegment(value) {
  return String(value || "release")
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120) || "release";
}

function shouldFail(manifest) {
  return manifest.summary.failedTransport > 0 || (manifest.strict && manifest.summary.blockedOrNeedsReview > 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const manifest = await collectHostedProofBundle(options);
    console.log(JSON.stringify(manifest, null, 2));
    process.exitCode = shouldFail(manifest) ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
