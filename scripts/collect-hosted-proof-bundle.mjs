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

  for (const endpoint of bundleEndpoints) {
    const payload = await fetchEndpoint(baseUrl, endpoint, options.timeoutMs ?? defaultTimeoutMs);
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

  const manifest = buildManifest({
    baseUrl,
    releaseId,
    outputDirectory,
    includeWriteChecks: Boolean(options.includeWriteChecks),
    strict: Boolean(options.strict),
    adminTokenEnv: options.adminTokenEnv ?? defaultAdminTokenEnv,
    adminTokenConfigured: Boolean(options.adminToken),
    verifyReport,
    artifacts
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

function buildManifest(input) {
  const failedArtifacts = input.artifacts.filter((artifact) => artifact.status === "transport-error");
  const blockedArtifacts = input.artifacts.filter((artifact) => isBlockedStatus(artifact.status));

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
      blockedOrNeedsReview: blockedArtifacts.length + (input.verifyReport?.summary?.blockedOrNeedsReview ?? 0)
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
        : [])
    ],
    nextActions: [
      "Review every JSON artifact for redaction before sharing with judges or importing into the Evidence Vault.",
      "Import only redacted verify-production JSON through /api/evidence/vault/import after production proof is complete.",
      "Attach Cloud Run revision, Gemini usage, GCP persistence, Workspace sync, revenue, cost, CAC, user, demo-video, and judge-access proof privately.",
      "Rerun this collector after every hosted deployment or evidence-status change."
    ],
    privateHandling: [
      "This bundle is local operator evidence and should not be committed.",
      "Generated artifacts may contain route names, internal ids, status details, and customer-proof metadata; inspect before sharing.",
      "The collector redacts common secret-shaped keys defensively, but human review is still required before judge distribution.",
      "Admin tokens are read only from the configured environment variable and are never written to bundle output."
    ],
    disclaimer:
      "This bundle collects hosted evidence surfaces. It does not create Cloud Run, Gemini, Workspace, revenue, user, cost, CAC, demo-video, or judge-access proof by itself."
  };
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
