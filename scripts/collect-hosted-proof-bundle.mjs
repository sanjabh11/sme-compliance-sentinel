/* global AbortController, URL, clearTimeout, console, fetch, process, setTimeout */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runProductionReadinessVerification } from "./verify-production-readiness.mjs";

const defaultOutDir = "artifacts/hosted-proof";
const defaultTimeoutMs = 15000;
const defaultAdminTokenEnv = "SENTINEL_ADMIN_ACTION_TOKEN";
const adminTokenHeader = "x-sentinel-admin-token";

const bundleEndpoints = [
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
    adminToken: ""
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
  const outputDirectory = join(options.outDir ?? defaultOutDir, releaseId);
  await mkdir(outputDirectory, { recursive: true });

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
    releaseIntegrity
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
  await writeFile(absolutePath, `${JSON.stringify(redactedPayload, null, 2)}\n`, "utf8");

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

  return {
    generatedAt: new Date().toISOString(),
    releaseId: input.releaseId,
    baseUrl: input.baseUrl,
    outputDirectory: input.outputDirectory,
    mode: input.includeWriteChecks ? "read-and-write-through" : "read-only",
    strict: input.strict,
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
        (input.releaseIntegrity.status === "passed" ? 0 : 1),
      releaseEvidenceStatus: input.releaseEvidenceManifest.overallStatus,
      releaseIntegrityStatus: input.releaseIntegrity.status,
      releaseEvidenceSlots: input.releaseEvidenceManifest.summary
    },
    releaseIntegrity: input.releaseIntegrity,
    releaseEvidence: {
      artifact: "release-evidence-manifest.json",
      overallStatus: input.releaseEvidenceManifest.overallStatus,
      summary: input.releaseEvidenceManifest.summary
    },
    artifacts: input.artifacts.map((artifact) => ({
      id: artifact.id,
      fileName: artifact.fileName,
      source: artifact.source,
      redacted: artifact.redacted,
      privateHandling: artifact.privateHandling,
      status: artifact.status
    })),
    blockers: [
      ...(failedArtifacts.length ? [`Transport failed for ${failedArtifacts.map((artifact) => artifact.id).join(", ")}.`] : []),
      ...(blockedArtifacts.length
        ? [`Blocked or review status remains for ${blockedArtifacts.map((artifact) => artifact.id).join(", ")}.`]
        : []),
      ...(releaseIntegrityBlocked ? input.releaseIntegrity.blockers : [])
    ],
    nextActions: [
      "Review every JSON artifact for redaction before sharing with judges or importing into the Evidence Vault.",
      "Import only after release integrity passes and the redacted verify-production JSON matches this bundle release id.",
      "Use release-evidence-manifest.json as the release-level proof index; do not treat missing or mock-only slots as complete.",
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
    const evidence = slot.sources.map((source) => evidenceForSource(source, rowsById, artifactsById));
    const status = releaseSlotStatus(evidence);

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
        : summary["transport-error"] > 0
        ? "blocked"
        : summary.missing + summary["mock-only"] + summary["needs-review"] > 0
          ? "needs-proof"
          : "ready-for-private-review",
    summary,
    slots,
    nextActions: [
      "Clear missing and mock-only slots with hosted Cloud Run, live Gemini, durable GCP, Workspace, financial, user, cost/CAC, demo, judge-access, repository, and license/IP proof.",
      "Keep customer names, security findings, OAuth artifacts, invoices, payment records, CAC receipts, raw logs, and credentials in the private evidence store.",
      "Rerun collect:hosted-proof after each deployment or proof import and keep the release evidence manifest with the private judge packet."
    ],
    disclaimer:
      "This manifest groups proof status for one release. It is not a guarantee of winning, certification, legal advice, audit assurance, or compliance status."
  };
}

function releaseEvidenceSlotDefinitions() {
  return [
    {
      id: "cloud-run-deployment",
      label: "Hosted Cloud Run product proof",
      ruleBucket: "Working product URL and Google Cloud usage",
      sources: [rowSource("cloudrun-deployment-evidence"), rowSource("deployment-evidence-packet"), artifactSource("deployment-packet")],
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

function evidenceForSource(source, rowsById, artifactsById) {
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

  const artifact = artifactsById.get(source.id);
  return {
    id: source.id,
    source: artifact?.source ?? "bundle-artifact",
    type: "artifact",
    status: artifact ? String(artifact.status ?? "unknown") : "missing-source",
    fileName: artifact?.fileName,
    detail: artifact ? "Redacted artifact captured in this bundle." : "Artifact was not captured in this release bundle."
  };
}

function releaseSlotStatus(evidence) {
  const statuses = evidence.map((item) => normalizeStatus(item.status));

  if (statuses.includes("transport-error")) {
    return "transport-error";
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
  await writeFile(join(outputDirectory, "README.md"), `${lines.join("\n")}\n`, "utf8");
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
