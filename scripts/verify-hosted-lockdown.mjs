#!/usr/bin/env node
/* global AbortSignal, console, fetch, process, URL */

import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const publicRoutes = [
  { id: "customer-root", path: "/" },
  { id: "customer-demo", path: "/demo/customer" },
  { id: "judge-access-pack", path: "/api/xprize/judge-access-pack" },
  { id: "submission-gate", path: "/api/xprize/submission-gate" },
  { id: "claim-guard", path: "/api/compliance/claims" }
];

const lockedRoutes = [
  { id: "readiness", path: "/api/readiness" },
  { id: "strategy", path: "/api/strategy" },
  { id: "evidence-export", path: "/api/evidence/export" },
  { id: "evidence-vault", path: "/api/evidence/vault" },
  { id: "financial-evidence", path: "/api/financial-evidence/ledger" },
  { id: "production-gemini-smoke", path: "/api/production/gemini-smoke", method: "POST" }
];

const prohibitedCliPatterns = [
  /(^|-)password($|=)/iu,
  /(^|-)secret($|=)/iu,
  /api[_-]?key=/iu,
  /authorization=/iu,
  /bearer\s+/iu
];

const secretTextPatterns = [
  /\bpassword\s*[:=]/iu,
  /\btoken\s*[:=]\s*[A-Za-z0-9._~+/=-]{12,}/iu,
  /\bapi[_-]?key\s*[:=]/iu,
  /\bauthorization\s*[:=]/iu,
  /\bbearer\s+[a-z0-9._~+/=-]{12,}/iu
];

function parseArgs(argv) {
  const args = {
    baseUrl: "",
    outPath: "",
    operatorFilePath: "",
    strict: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (prohibitedCliPatterns.some((pattern) => pattern.test(arg))) {
      throw new Error("Raw secret CLI args are not supported. Use a private operator file, not credential arguments.");
    }

    if (arg === "--strict") {
      args.strict = true;
      continue;
    }

    if (arg === "--url") {
      args.baseUrl = normalizeBaseUrl(argv[index + 1] ?? "", arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--url=")) {
      args.baseUrl = normalizeBaseUrl(arg.slice("--url=".length), "--url");
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

    if (arg === "--operator-file") {
      args.operatorFilePath = argv[index + 1] ?? "";
      if (!args.operatorFilePath) {
        throw new Error("--operator-file requires a private file path.");
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--operator-file=")) {
      args.operatorFilePath = arg.slice("--operator-file=".length);
      continue;
    }

    throw new Error(`Unsupported argument: ${arg}`);
  }

  args.baseUrl = args.baseUrl || normalizeBaseUrl(process.env.NEXT_PUBLIC_PRODUCT_URL || "", "NEXT_PUBLIC_PRODUCT_URL");

  return args;
}

async function buildReport(args) {
  const operatorToken = args.operatorFilePath ? readPrivateOperatorToken(args.operatorFilePath) : "";
  const publicResults = await Promise.all(publicRoutes.map((route) => inspectPublicRoute(args.baseUrl, route)));
  const adminResult = await inspectAdminRoute(args.baseUrl);
  const lockedResults = await Promise.all(lockedRoutes.map((route) => inspectLockedRoute(args.baseUrl, route)));
  const operatorResult = operatorToken ? await inspectOperatorRoute(args.baseUrl, operatorToken) : missingOperatorResult();
  const sections = [...publicResults, adminResult, ...lockedResults, operatorResult];
  const blockers = sections.flatMap((section) =>
    section.checks.filter((check) => check.status === "blocked").map((check) => `${section.id}: ${check.label}: ${check.fix}`)
  );

  return {
    generatedAt: new Date().toISOString(),
    overallStatus: blockers.length ? "blocked" : "verified",
    baseUrl: args.baseUrl,
    operatorFile: args.operatorFilePath ? { status: "provided", path: resolve(args.operatorFilePath) } : { status: "not-provided" },
    sections,
    blockers,
    nextActions: blockers.length
      ? ["Fix the listed hosted lockdown issues, redeploy, and rerun this verifier before using the app for public outreach."]
      : [
          "Preserve this hosted lockdown packet with deployment proof.",
          "Keep SENTINEL_ADMIN_ACTION_TOKEN private and rotate it before sharing operator access."
        ],
    proofBoundary:
      "This verifies hosted public-surface lockdown only. It is not Cloud Run proof, live Gemini proof, Workspace OAuth proof, revenue proof, judge access, legal advice, certification, organizer approval, or a guarantee of judging outcome."
  };
}

async function inspectPublicRoute(baseUrl, route) {
  const fetched = await fetchRoute(baseUrl, route.path);

  return section(route.id, route.path, [
    check({
      id: "http-2xx",
      label: "Public route response",
      status: fetched.status >= 200 && fetched.status < 400 ? "ready" : "blocked",
      evidence: `HTTP ${fetched.status}`,
      fix: "Keep customer and signed-out judge smoke routes reachable without an operator token."
    })
  ]);
}

async function inspectAdminRoute(baseUrl) {
  const fetched = await fetchRoute(baseUrl, "/admin");
  const text = normalizeText(fetched.body);
  const dashboardVisible = /Readiness Command Center|MVP Outreach Command|Private Evidence Room|Winning Strategy Room/iu.test(text);
  const lockVisible = /Admin console locked|admin-unlock|Operator access|Unlock admin console/iu.test(text);

  return section("admin-signed-out", "/admin", [
    check({
      id: "http-2xx",
      label: "Admin route response",
      status: fetched.status >= 200 && fetched.status < 400 ? "ready" : "blocked",
      evidence: `HTTP ${fetched.status}`,
      fix: "Keep /admin reachable as a locked shell so operators can unlock it."
    }),
    check({
      id: "dashboard-hidden",
      label: "Internal dashboard hidden signed out",
      status: dashboardVisible ? "blocked" : "ready",
      evidence: dashboardVisible ? "dashboard text visible signed out" : "dashboard text absent signed out",
      fix: "Show only the admin unlock surface until an operator session is established."
    }),
    check({
      id: "unlock-visible",
      label: "Unlock surface visible",
      status: lockVisible ? "ready" : "blocked",
      evidence: lockVisible ? "lock copy or unlock shell present" : "lock copy missing",
      fix: "Render an explicit locked-admin state for signed-out visitors."
    }),
    check({
      id: "no-store",
      label: "Admin cache policy",
      status: /no-store/iu.test(fetched.cacheControl) ? "ready" : "blocked",
      evidence: fetched.cacheControl || "missing",
      fix: "Set Cache-Control: no-store or equivalent private no-cache policy on /admin."
    })
  ]);
}

async function inspectLockedRoute(baseUrl, route) {
  const fetched = await fetchRoute(baseUrl, route.path, { method: route.method || "GET" });
  const locked = [401, 403].includes(fetched.status);

  return section(route.id, route.path, [
    check({
      id: "signed-out-blocked",
      label: "Signed-out access blocked",
      status: locked ? "ready" : "blocked",
      evidence: `HTTP ${fetched.status}`,
      fix: "Require x-sentinel-admin-token, Bearer token, or admin session before returning internal proof JSON."
    }),
    check({
      id: "no-store",
      label: "Internal API cache policy",
      status: /no-store/iu.test(fetched.cacheControl) ? "ready" : "blocked",
      evidence: fetched.cacheControl || "missing",
      fix: "Set Cache-Control: no-store on locked internal proof responses."
    }),
    check({
      id: "no-secret-shaped-body",
      label: "Blocked response redaction",
      status: secretTextPatterns.some((pattern) => pattern.test(fetched.body)) ? "blocked" : "ready",
      evidence: secretTextPatterns.some((pattern) => pattern.test(fetched.body)) ? "secret-shaped text detected" : "no secret-shaped text",
      fix: "Return only minimal blocked-response JSON and never echo credentials or private proof."
    })
  ]);
}

async function inspectOperatorRoute(baseUrl, operatorToken) {
  const fetched = await fetchRoute(baseUrl, "/api/readiness", {
    headers: { "x-sentinel-admin-token": operatorToken }
  });

  return section("operator-readiness", "/api/readiness", [
    check({
      id: "operator-authorized",
      label: "Operator token authorizes internal API",
      status: fetched.status >= 200 && fetched.status < 300 ? "ready" : "blocked",
      evidence: `HTTP ${fetched.status}`,
      fix: "Verify SENTINEL_ADMIN_ACTION_TOKEN matches the private operator token and redeploy if needed."
    }),
    check({
      id: "operator-no-store",
      label: "Operator response cache policy",
      status: /no-store/iu.test(fetched.cacheControl) ? "ready" : "blocked",
      evidence: fetched.cacheControl || "missing",
      fix: "Set Cache-Control: no-store on authorized internal proof responses."
    })
  ]);
}

function missingOperatorResult() {
  return section("operator-readiness", "/api/readiness", [
    check({
      id: "operator-file",
      label: "Operator token check",
      status: "ready",
      evidence: "Skipped; no --operator-file path provided.",
      fix: "Provide --operator-file from private storage when operator access needs hosted verification."
    })
  ]);
}

async function fetchRoute(baseUrl, path, init = {}) {
  const url = new URL(path, baseUrl).toString();

  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      ...init
    });
    const body = await response.text();

    return {
      url,
      status: response.status,
      cacheControl: response.headers.get("cache-control") || "",
      body
    };
  } catch (error) {
    return {
      url,
      status: 0,
      cacheControl: "",
      body: error instanceof Error ? error.message : String(error)
    };
  }
}

function section(id, path, checks) {
  return {
    id,
    path,
    status: checks.some((item) => item.status === "blocked") ? "blocked" : "ready",
    checks
  };
}

function check(input) {
  return input;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\\s+/gu, " ")
    .trim();
}

function readPrivateOperatorToken(path) {
  const absolutePath = resolve(path);
  assertRegularFile(absolutePath, "Operator token file");
  const value = readFileSync(absolutePath, "utf8").trim();

  if (!value) {
    throw new Error("Operator token file is empty.");
  }

  return value;
}

function normalizeBaseUrl(value, label) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${label} requires a URL.`);
  }

  let parsed;
  try {
    parsed = new URL(text.startsWith("http://") || text.startsWith("https://") ? text : `https://${text}`);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }

  if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error(`${label} must use HTTPS unless targeting localhost.`);
  }

  if (parsed.username || parsed.password || parsed.search) {
    throw new Error(`${label} must not include credentials or query parameters.`);
  }

  return parsed.origin;
}

function writeJson(path, value) {
  const absolutePath = resolve(path);
  const parentDirectory = dirname(absolutePath);
  mkdirSync(parentDirectory, { recursive: true });
  assertRegularFileIfExists(absolutePath, "Hosted lockdown output");

  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (secretTextPatterns.some((pattern) => pattern.test(text))) {
    throw new Error("Hosted lockdown report contains secret-shaped text and will not be written.");
  }

  const temporaryPath = resolve(parentDirectory, `.${basename(absolutePath)}.${process.pid}.tmp`);
  writeFileSync(temporaryPath, text, { encoding: "utf8", flag: "wx" });
  renameSync(temporaryPath, absolutePath);
}

function assertRegularFile(path, label) {
  const fileStat = lstatSync(path);
  if (fileStat.isSymbolicLink()) {
    throw new Error(`${label} ${path} is a symbolic link; use a regular private file.`);
  }
  if (!fileStat.isFile()) {
    throw new Error(`${label} ${path} is not a regular file.`);
  }
}

function assertRegularFileIfExists(path, label) {
  try {
    assertRegularFile(path, label);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildReport(args);

  if (args.outPath) {
    writeJson(args.outPath, report);
  }

  console.log(JSON.stringify(report, null, 2));

  if (args.strict && report.overallStatus !== "verified") {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
