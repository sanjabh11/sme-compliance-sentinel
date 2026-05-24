/* global AbortController, URL, clearTimeout, console, fetch, process, setTimeout */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const defaultTimeoutMs = 15000;
const defaultAdminTokenEnv = "SENTINEL_ADMIN_ACTION_TOKEN";
const adminTokenHeader = "x-sentinel-admin-token";

const readOnlyChecks = [
  {
    id: "readiness",
    method: "GET",
    path: "/api/readiness",
    summarize: (payload) => ({
      status: payload?.xprizeGate?.overallStatus ?? "unknown",
      detail: `${payload?.xprizeGate?.blockingSummary?.length ?? "unknown"} submission blocker(s).`
    })
  },
  {
    id: "launch-readiness",
    method: "GET",
    path: "/api/production/launch-readiness",
    summarize: (payload) => ({
      status: payload?.overallStatus ?? "unknown",
      detail: `${payload?.blockers?.length ?? "unknown"} launch blocker(s); score ${payload?.readinessScore ?? "unknown"}.`
    })
  },
  {
    id: "cloudrun-deployment-evidence",
    method: "GET",
    path: "/api/production/deployment-evidence",
    summarize: (payload) => ({
      status: payload?.overallStatus ?? "unknown",
      detail: `${payload?.replacementFindings?.length ?? "unknown"} replacement finding(s); ${payload?.blockers?.length ?? "unknown"} blocker(s).`
    })
  },
  {
    id: "deployment-evidence-packet",
    method: "GET",
    path: "/api/production/deployment-packet",
    summarize: (payload) => ({
      status: payload?.status ?? "unknown",
      detail: `${payload?.artifactManifest?.length ?? "unknown"} artifact(s); ${payload?.commandSequence?.length ?? "unknown"} command(s); ${payload?.blockers?.length ?? "unknown"} blocker(s).`
    })
  },
  {
    id: "project-provenance",
    method: "GET",
    path: "/api/xprize/provenance",
    summarize: (payload) => ({
      status: payload?.overallStatus ?? payload?.status ?? "unknown",
      detail: `HEAD ${payload?.git?.headCommit?.slice?.(0, 7) ?? "unknown"}; upstream ${payload?.git?.remoteHeadCommit?.slice?.(0, 7) ?? "unknown"}; ${payload?.blockers?.length ?? "unknown"} blocker(s).`
    })
  },
  {
    id: "hosted-evidence-capture",
    method: "GET",
    path: "/api/production/hosted-evidence",
    summarize: (payload) => ({
      status: payload?.overallStatus ?? "unknown",
      detail: `${payload?.checks?.filter?.((check) => check?.status !== "captured")?.length ?? "unknown"} pending production artifact(s); ${payload?.blockers?.length ?? "unknown"} blocker(s).`
    })
  },
  {
    id: "gemini-proof-status",
    method: "GET",
    path: "/api/production/gemini-smoke",
    summarize: (payload) => ({
      status: payload?.status ?? "unknown",
      detail: `${payload?.provider ?? "no-provider"} on ${payload?.model ?? "unknown-model"}; ${payload?.decisionSummary ?? "No Gemini proof summary."}`
    })
  },
  {
    id: "submission-gate",
    method: "GET",
    path: "/api/xprize/submission-gate",
    summarize: (payload) => ({
      status: payload?.overallStatus ?? "unknown",
      detail: `${payload?.blockingSummary?.length ?? "unknown"} blocker(s); confidence ${payload?.factualWinConfidence ?? "unknown"}.`
    })
  },
  {
    id: "submission-compliance",
    method: "GET",
    path: "/api/xprize/submission-compliance",
    summarize: (payload) => ({
      status: payload?.overallStatus ?? "unknown",
      detail: `${payload?.summary?.blocked ?? "unknown"} blocked, ${payload?.summary?.warning ?? "unknown"} warning.`
    })
  },
  {
    id: "eligibility-disclosure",
    method: "GET",
    path: "/api/xprize/eligibility-disclosure",
    summarize: (payload) => ({
      status: payload?.overallStatus ?? "unknown",
      detail: `${payload?.blockers?.length ?? "unknown"} blocker(s); ${payload?.reviewerAttestations?.length ?? "unknown"} attestation flag(s).`
    })
  },
  {
    id: "devpost-pack",
    method: "GET",
    path: "/api/xprize/devpost-pack",
    summarize: (payload) => ({
      status: payload?.overallStatus ?? "unknown",
      detail: `${payload?.blockers?.length ?? "unknown"} blocker(s); ${payload?.demoVideoScript?.length ?? "unknown"} demo scene(s).`
    })
  },
  {
    id: "demo-video-pack",
    method: "GET",
    path: "/api/xprize/demo-video-pack",
    summarize: (payload) => ({
      status: payload?.overallStatus ?? "unknown",
      detail: `${payload?.plannedDurationSeconds ?? "unknown"}/${payload?.maximumAllowedSeconds ?? "unknown"}s planned; ${payload?.blockers?.length ?? "unknown"} blocker(s).`
    })
  },
  {
    id: "source-release",
    method: "GET",
    path: "/api/xprize/source-release",
    summarize: (payload) => ({
      status: payload?.overallStatus ?? "unknown",
      detail: `${payload?.releasableFileCount ?? "unknown"} releasable file(s); ${payload?.secretFindings?.length ?? "unknown"} possible secret finding(s).`
    })
  },
  {
    id: "license-manifest",
    method: "GET",
    path: "/api/xprize/license-manifest",
    summarize: (payload) => ({
      status: payload?.summary?.status ?? "unknown",
      detail: `${payload?.summary?.restrictedLicenseReviewCount ?? "unknown"} restricted-review, ${payload?.summary?.obligationReviewCount ?? "unknown"} obligation-review, ${payload?.summary?.licenseNeedsReviewCount ?? "unknown"} license-review package(s).`
    })
  },
  {
    id: "judge-access-pack",
    method: "GET",
    path: "/api/xprize/judge-access-pack",
    summarize: (payload) => ({
      status: payload?.overallStatus ?? "unknown",
      detail: `${payload?.accessChecks?.filter?.((check) => check?.status === "missing")?.length ?? "unknown"} missing access check(s); ${payload?.walkthrough?.length ?? "unknown"} walkthrough step(s).`
    })
  },
  {
    id: "claim-guard",
    method: "GET",
    path: "/api/compliance/claims",
    summarize: (payload) => ({
      status: payload?.status ?? "unknown",
      detail: `${payload?.violations?.length ?? "unknown"} violation(s), ${payload?.warnings?.length ?? "unknown"} warning(s).`
    })
  }
];

const writeThroughChecks = [
  {
    id: "gemini-smoke-write-through",
    method: "POST",
    path: "/api/production/gemini-smoke",
    summarize: (payload) => ({
      status: payload?.status ?? "unknown",
      detail: `${payload?.provider ?? "no-provider"} on ${payload?.model ?? "unknown-model"}; ${payload?.proofSummary ?? "No Gemini proof summary."}`
    })
  },
  {
    id: "persistence-write-through",
    method: "POST",
    path: "/api/production/persistence",
    summarize: (payload) => ({
      status: payload?.overallStatus ?? payload?.status ?? "unknown",
      detail: `${payload?.checks?.length ?? "unknown"} persistence check(s).`
    })
  },
  {
    id: "cost-controls-write-through",
    method: "POST",
    path: "/api/production/cost-controls",
    summarize: (payload) => ({
      status: payload?.overallStatus ?? payload?.status ?? "unknown",
      detail: `${payload?.checks?.length ?? "unknown"} cost-control check(s).`
    })
  },
  {
    id: "workspace-reconcile",
    method: "POST",
    path: "/api/workspace/sync/reconcile",
    summarize: (payload) => ({
      status: payload?.status ?? payload?.mode ?? "unknown",
      detail: payload?.message ?? payload?.blocker ?? "Workspace reconcile response received."
    })
  },
  {
    id: "workspace-bootstrap",
    method: "POST",
    path: "/api/workspace/sync/bootstrap",
    summarize: (payload) => ({
      status: payload?.result?.status ?? payload?.status ?? "unknown",
      detail: `${payload?.result?.checks?.length ?? "unknown"} bootstrap check(s); attempted live API ${payload?.result?.attemptedLiveApi ?? "unknown"}.`
    })
  },
  {
    id: "workspace-watch-renewal",
    method: "POST",
    path: "/api/workspace/sync/renew",
    summarize: (payload) => ({
      status: payload?.result?.status ?? payload?.status ?? "unknown",
      detail: `${payload?.result?.checks?.length ?? "unknown"} renewal check(s); attempted live API ${payload?.result?.attemptedLiveApi ?? "unknown"}.`
    })
  }
];

export function parseArgs(argv) {
  const args = {
    url: "",
    releaseId: process.env.SENTINEL_RELEASE_ID ?? "",
    strict: false,
    includeWriteChecks: false,
    timeoutMs: defaultTimeoutMs,
    adminTokenEnv: defaultAdminTokenEnv,
    adminToken: "",
    outPath: ""
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

    if (arg === "--release-id") {
      args.releaseId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--release-id=")) {
      args.releaseId = arg.slice("--release-id=".length);
      continue;
    }

    if (arg === "--strict") {
      args.strict = true;
      continue;
    }

    if (arg === "--include-write-checks") {
      args.includeWriteChecks = true;
      continue;
    }

    if (arg === "--admin-token-env") {
      args.adminTokenEnv = argv[index + 1] ?? defaultAdminTokenEnv;
      index += 1;
      continue;
    }

    if (arg.startsWith("--admin-token-env=")) {
      args.adminTokenEnv = arg.slice("--admin-token-env=".length) || defaultAdminTokenEnv;
      continue;
    }

    if (arg === "--out") {
      args.outPath = argv[index + 1] ?? "";
      if (!args.outPath) {
        throw new Error("--out requires a non-secret output path.");
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--out=")) {
      args.outPath = arg.slice("--out=".length);
      continue;
    }

    if (arg === "--timeout-ms") {
      args.timeoutMs = parseTimeout(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--timeout-ms=")) {
      args.timeoutMs = parseTimeout(arg.slice("--timeout-ms=".length));
    }
  }

  args.url ||= process.env.NEXT_PUBLIC_PRODUCT_URL ?? "";
  args.adminToken = process.env[args.adminTokenEnv] ?? "";
  return args;
}

export async function runProductionReadinessVerification(options) {
  if (!options.url) {
    return buildMissingHostedUrlReport(options);
  }

  const baseUrl = normalizeBaseUrl(options.url);
  const checks = options.includeWriteChecks ? [...readOnlyChecks, ...writeThroughChecks] : readOnlyChecks;
  const results = [];

  for (const check of checks) {
    results.push(await runCheck(baseUrl, check, options.timeoutMs ?? defaultTimeoutMs, options.adminToken ?? ""));
  }

  const failed = results.filter((result) => result.ok === false);
  const blocked = results.filter((result) => isBlockedStatus(result.status));
  const releaseLineage = buildReleaseLineage({ baseUrl, requestedReleaseId: options.releaseId ?? "", results });
  const lineageBlocked = releaseLineage.checks.filter((check) => check.status === "blocked");

  return {
    generatedAt: new Date().toISOString(),
    overallStatus: lineageBlocked.length ? "blocked" : failed.length ? "transport-error" : blocked.length ? "needs-review" : "passed",
    baseUrl,
    releaseId: options.releaseId ?? process.env.SENTINEL_RELEASE_ID ?? "",
    mode: options.includeWriteChecks ? "read-and-write-through" : "read-only",
    strict: Boolean(options.strict),
    writeAuth: {
      required: Boolean(options.includeWriteChecks),
      configured: Boolean(options.adminToken),
      tokenEnv: options.adminTokenEnv ?? defaultAdminTokenEnv,
      headerName: adminTokenHeader
    },
    summary: {
      total: results.length,
      passedTransport: results.length - failed.length,
      failedTransport: failed.length,
      blockedOrNeedsReview: blocked.length
    },
    results,
    blockers: [
      ...failed.map((result) => `${result.id}: ${result.detail}`),
      ...blocked.map((result) => `${result.id}: ${result.status}`),
      ...releaseLineage.blockers
    ],
    releaseLineage,
    proofBoundary:
      "This hosted verifier records HTTP/API readiness for a deployed product URL. It does not deploy Cloud Run, create revenue, approve human attestations, or guarantee judging outcome.",
    stopConditions: [
      "Do not set hosted product, Google Cloud, Gemini API, Workspace, judge-access, or business proof flags from this report unless the report was generated against the deployed Cloud Run URL and the matching private evidence exists.",
      "Do not run --include-write-checks until production credentials, Secret Manager-backed admin token, and private evidence storage are configured.",
      "Do not paste admin tokens, OAuth secrets, API keys, customer findings, invoices, or raw Workspace content into CLI arguments, URLs, or output files."
    ],
    recommendedNextActions: buildNextActions(failed, blocked, releaseLineage)
  };
}

function buildMissingHostedUrlReport(options) {
  const writeMode = Boolean(options.includeWriteChecks);
  const command = writeMode
    ? "npm run verify:production -- --url $NEXT_PUBLIC_PRODUCT_URL --strict --include-write-checks --out /secure/local/verify-production.json"
    : "npm run verify:production -- --url $NEXT_PUBLIC_PRODUCT_URL --strict --out /secure/local/verify-production.json";

  return {
    generatedAt: new Date().toISOString(),
    overallStatus: "blocked",
    baseUrl: "missing",
    releaseId: options.releaseId ?? process.env.SENTINEL_RELEASE_ID ?? "",
    mode: writeMode ? "read-and-write-through" : "read-only",
    strict: Boolean(options.strict),
    writeAuth: {
      required: writeMode,
      configured: Boolean(options.adminToken),
      tokenEnv: options.adminTokenEnv ?? defaultAdminTokenEnv,
      headerName: adminTokenHeader
    },
    summary: {
      total: 0,
      passedTransport: 0,
      failedTransport: 0,
      blockedOrNeedsReview: 1
    },
    results: [],
    blockers: [
      "NEXT_PUBLIC_PRODUCT_URL is missing. Deploy Cloud Run or pass --url with the hosted HTTPS service URL before hosted production verification."
    ],
    manualIntervention: {
      phaseId: "hosted-proof-capture",
      phaseLabel: "Hosted Cloud Run and Gemini proof capture",
      bucket: "external-proof",
      owner: "engineering",
      priority: 5,
      phaseRatingOutOf5: 1,
      currentPhaseRemainingPercent: 93,
      action: "Deploy Cloud Run, capture the HTTPS service URL, export NEXT_PUBLIC_PRODUCT_URL in a private operator shell, then rerun hosted verification.",
      commands: [
        "gcloud run services describe $SENTINEL_CLOUD_RUN_SERVICE_NAME --region $SENTINEL_CLOUD_RUN_REGION --format='value(status.url)'",
        "export NEXT_PUBLIC_PRODUCT_URL=https://YOUR-CLOUD-RUN-URL",
        command
      ],
      privateArtifactPaths: [
        "/secure/local/verify-production.json",
        "artifacts/hosted-proof/$SENTINEL_RELEASE_ID/verify-production.json"
      ],
      acceptedProof: [
        "Cloud Run service URL for the release",
        "Read-only verify:production JSON generated from the hosted URL",
        "Write-through verify:production JSON after admin-token and private evidence handling are configured",
        "Hosted proof bundle and deployment execution checklist before Evidence Vault import"
      ],
      stopCondition:
        "Stop before setting hosted, Gemini, Google Cloud, Workspace, judge-access, or business evidence flags until the hosted URL and matching private proof artifacts exist."
    },
    proofBoundary:
      "This structured blocker is an operator handoff only. It does not deploy Cloud Run, call Gemini, prove product availability, prove Workspace sync, prove revenue/users, approve human attestations, or guarantee judging outcome.",
    stopConditions: [
      "Do not treat this missing-URL report as hosted proof.",
      "Do not set XPRIZE_WORKING_PROJECT_ACCESS_CONFIGURED, XPRIZE_GOOGLE_CLOUD_PRODUCT_EVIDENCE_CONFIGURED, XPRIZE_GEMINI_API_CALL_EVIDENCE_CONFIGURED, or XPRIZE_PRODUCT_RUNNING_EVIDENCE_CONFIGURED from this report.",
      "Do not run --include-write-checks until production service credentials, Secret Manager-backed admin token, and private evidence handling are configured."
    ],
    recommendedNextActions: [
      "Complete the Cloud Run render and dry-run preflight with private values.",
      "Deploy the rendered Cloud Run service and preserve dry-run/deploy/describe logs in the private evidence store.",
      "Export NEXT_PUBLIC_PRODUCT_URL to the hosted HTTPS service URL, then rerun this verifier with --out /secure/local/verify-production.json.",
      "Run write-through checks only after the production admin token is available from Secret Manager or a private shell environment.",
      "Attach the hosted verification JSON to the private judge packet and hosted proof bundle after redaction review."
    ]
  };
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

async function runCheck(baseUrl, check, timeoutMs, adminToken) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${baseUrl}${check.path}`;
  const headers = {
    accept: "application/json",
    ...(check.method === "POST" && adminToken ? { [adminTokenHeader]: adminToken } : {})
  };

  try {
    const response = await fetch(url, {
      method: check.method,
      headers,
      signal: controller.signal
    });
    const text = await response.text();
    const payload = parseJson(text);
    const summary = check.summarize(payload);

    return {
      id: check.id,
      method: check.method,
      path: check.path,
      httpStatus: response.status,
      ok: response.ok,
      status: summary.status,
      detail: summary.detail,
      lineage: extractLineage(check.id, payload)
    };
  } catch (error) {
    return {
      id: check.id,
      method: check.method,
      path: check.path,
      httpStatus: 0,
      ok: false,
      status: "transport-error",
      detail: error instanceof Error ? error.message : "Unknown request failure.",
      lineage: {}
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractLineage(checkId, payload) {
  if (checkId === "deployment-evidence-packet") {
    return {
      releaseId: cleanString(payload?.releaseId),
      productUrl: normalizeUrlForComparison(payload?.productUrl),
      evidenceVaultPayloadReleaseId: cleanString(payload?.evidenceVaultImportTemplate?.payload?.releaseId),
      evidenceVaultTemplateSourceUrl: normalizeUrlForComparison(payload?.evidenceVaultImportTemplate?.sourceUrl)
    };
  }

  if (checkId === "project-provenance") {
    return {
      headCommit: cleanString(payload?.git?.headCommit),
      remoteHeadCommit: cleanString(payload?.git?.remoteHeadCommit),
      upstreamBranch: cleanString(payload?.git?.upstreamBranch)
    };
  }

  return {};
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

function buildReleaseLineage(input) {
  const requestedReleaseId = cleanString(input.requestedReleaseId);
  const deploymentLineage = input.results.find((result) => result.id === "deployment-evidence-packet")?.lineage ?? {};
  const provenanceLineage = input.results.find((result) => result.id === "project-provenance")?.lineage ?? {};
  const checks = [
    requestedReleaseId
      ? lineageCheck({
          id: "verify-production-release-id",
          label: "Verify-production requested release id",
          expected: requestedReleaseId,
          actual: requestedReleaseId,
          missingDetail: "Pass --release-id $SENTINEL_RELEASE_ID when generating hosted verification evidence."
        })
      : lineageNeedsReview({
          id: "verify-production-release-id",
          label: "Verify-production requested release id",
          detail: "No --release-id was provided. Rerun with the release id before importing this verifier output as judge evidence."
        }),
    lineageCheck({
      id: "verify-production-base-url",
      label: "Verify-production base URL",
      expected: input.baseUrl,
      actual: input.baseUrl,
      missingDetail: "Hosted verification base URL is missing."
    }),
    requestedReleaseId
      ? lineageCheck({
          id: "deployment-packet-release-id",
          label: "Deployment packet release id",
          expected: requestedReleaseId,
          actual: deploymentLineage.releaseId,
          missingDetail:
            "Deployment packet is missing releaseId. Set SENTINEL_RELEASE_ID in the deployed environment and rerun hosted verification."
        })
      : lineageNeedsReview({
          id: "deployment-packet-release-id",
          label: "Deployment packet release id",
          detail: "Release id comparison skipped until --release-id is provided."
        }),
    lineageCheck({
      id: "deployment-packet-product-url",
      label: "Deployment packet product URL",
      expected: input.baseUrl,
      actual: deploymentLineage.productUrl,
      missingDetail:
        "Deployment packet is missing productUrl. Set NEXT_PUBLIC_PRODUCT_URL in the deployed environment and rerun hosted verification."
    }),
    requestedReleaseId
      ? lineageCheck({
          id: "evidence-vault-template-release-id",
          label: "Evidence Vault import template release id",
          expected: requestedReleaseId,
          actual: deploymentLineage.evidenceVaultPayloadReleaseId,
          missingDetail:
            "Deployment packet evidenceVaultImportTemplate is missing payload.releaseId. Recapture after deployment packet configuration is fixed."
        })
      : lineageNeedsReview({
          id: "evidence-vault-template-release-id",
          label: "Evidence Vault import template release id",
          detail: "Evidence Vault template release comparison skipped until --release-id is provided."
        }),
    lineageCheck({
      id: "evidence-vault-template-source-url",
      label: "Evidence Vault import template source URL",
      expected: input.baseUrl,
      actual: deploymentLineage.evidenceVaultTemplateSourceUrl,
      missingDetail:
        "Deployment packet evidenceVaultImportTemplate is missing sourceUrl. Recapture after hosted URL configuration is fixed."
    }),
    pushedHeadCheck(provenanceLineage)
  ];
  const blockers = checks
    .filter((check) => check.status === "blocked")
    .map((check) => `${check.label}: ${check.detail}`);
  const needsReview = checks.filter((check) => check.status === "needs-review");

  return {
    status: blockers.length ? "blocked" : needsReview.length ? "needs-review" : "passed",
    expected: {
      releaseId: requestedReleaseId || "missing",
      baseUrl: input.baseUrl
    },
    checks,
    blockers,
    nextAction: blockers.length
      ? "Fix release/base URL mismatches or missing provenance, redeploy if needed, then rerun verify:production before collecting or importing hosted proof."
      : needsReview.length
        ? "Rerun verify:production with --release-id before treating this JSON as final judge evidence."
        : "Release id, hosted URL, deployment packet, import template, and pushed-source provenance are aligned.",
    disclaimer:
      "Release lineage only proves that hosted verifier artifacts identify the same declared release and product URL; it does not prove revenue, users, Workspace sync, legal/IP clearance, or judging outcome."
  };
}

function lineageCheck(input) {
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

function lineageNeedsReview(input) {
  return {
    id: input.id,
    label: input.label,
    status: "needs-review",
    expected: "release id supplied to verifier",
    actual: "missing",
    detail: input.detail
  };
}

function pushedHeadCheck(lineage) {
  const headCommit = cleanString(lineage?.headCommit);
  const remoteHeadCommit = cleanString(lineage?.remoteHeadCommit);
  const upstreamBranch = cleanString(lineage?.upstreamBranch);

  if (!headCommit || !remoteHeadCommit) {
    return {
      id: "project-provenance-pushed-head",
      label: "Project provenance pushed HEAD",
      status: "blocked",
      expected: "local HEAD equals upstream HEAD",
      actual: `HEAD ${headCommit || "missing"}; upstream ${upstreamBranch || "missing"} ${remoteHeadCommit || "missing"}`,
      detail: "Project provenance is missing local or upstream commit evidence. Push the release commit and rerun hosted verification."
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

function normalizeUrlForComparison(value) {
  const rawValue = cleanString(value);
  if (!rawValue) {
    return "";
  }

  try {
    const parsed = new URL(rawValue);
    parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/u, "");
  } catch {
    return rawValue.replace(/\/+$/u, "");
  }
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildNextActions(failed, blocked, releaseLineage) {
  return [
    ...(failed.length ? [`Fix transport/auth failures for: ${failed.map((result) => result.id).join(", ")}.`] : []),
    ...(blocked.length ? [`Clear blocked or review statuses for: ${blocked.map((result) => result.id).join(", ")}.`] : []),
    ...(releaseLineage.status !== "passed" ? [releaseLineage.nextAction] : []),
    `Run with --include-write-checks only after production service credentials, ${defaultAdminTokenEnv}, and private evidence handling are configured.`,
    "Attach this JSON output to the private launch packet after every hosted deployment verification run."
  ];
}

function shouldFail(report) {
  return report.overallStatus === "blocked" || report.summary.failedTransport > 0 || (report.strict && report.summary.blockedOrNeedsReview > 0);
}

async function writeJson(path, payload) {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return absolutePath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = await runProductionReadinessVerification(options);
    if (options.outPath) {
      report.outputPath = resolve(options.outPath);
      await writeJson(report.outputPath, report);
    }
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = shouldFail(report) ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
