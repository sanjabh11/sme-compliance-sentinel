/* global AbortController, URL, clearTimeout, console, fetch, process, setTimeout */

const defaultTimeoutMs = 15000;

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
  }
];

export function parseArgs(argv) {
  const args = {
    url: "",
    strict: false,
    includeWriteChecks: false,
    timeoutMs: defaultTimeoutMs
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

    if (arg === "--strict") {
      args.strict = true;
      continue;
    }

    if (arg === "--include-write-checks") {
      args.includeWriteChecks = true;
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
  return args;
}

export async function runProductionReadinessVerification(options) {
  const baseUrl = normalizeBaseUrl(options.url);
  const checks = options.includeWriteChecks ? [...readOnlyChecks, ...writeThroughChecks] : readOnlyChecks;
  const results = [];

  for (const check of checks) {
    results.push(await runCheck(baseUrl, check, options.timeoutMs ?? defaultTimeoutMs));
  }

  const failed = results.filter((result) => result.ok === false);
  const blocked = results.filter((result) => isBlockedStatus(result.status));

  return {
    generatedAt: new Date().toISOString(),
    baseUrl,
    mode: options.includeWriteChecks ? "read-and-write-through" : "read-only",
    strict: Boolean(options.strict),
    summary: {
      total: results.length,
      passedTransport: results.length - failed.length,
      failedTransport: failed.length,
      blockedOrNeedsReview: blocked.length
    },
    results,
    recommendedNextActions: buildNextActions(failed, blocked)
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

async function runCheck(baseUrl, check, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${baseUrl}${check.path}`;

  try {
    const response = await fetch(url, {
      method: check.method,
      headers: { accept: "application/json" },
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
      detail: summary.detail
    };
  } catch (error) {
    return {
      id: check.id,
      method: check.method,
      path: check.path,
      httpStatus: 0,
      ok: false,
      status: "transport-error",
      detail: error instanceof Error ? error.message : "Unknown request failure."
    };
  } finally {
    clearTimeout(timeout);
  }
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

function buildNextActions(failed, blocked) {
  return [
    ...(failed.length ? [`Fix transport/auth failures for: ${failed.map((result) => result.id).join(", ")}.`] : []),
    ...(blocked.length ? [`Clear blocked or review statuses for: ${blocked.map((result) => result.id).join(", ")}.`] : []),
    "Run with --include-write-checks only after production service credentials and private evidence handling are configured.",
    "Attach this JSON output to the private launch packet after every hosted deployment verification run."
  ];
}

function shouldFail(report) {
  return report.summary.failedTransport > 0 || (report.strict && report.summary.blockedOrNeedsReview > 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = await runProductionReadinessVerification(options);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = shouldFail(report) ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
