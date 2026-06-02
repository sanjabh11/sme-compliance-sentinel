#!/usr/bin/env node
/* global AbortSignal, console, fetch, process, URL */

import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const supportPath = "/support";
const policyPaths = ["/terms-of-service", "/privacy", "/cancellation-refund-policy"];
const defaultBaseUrl = "https://sme-workspace-sentinel.vercel.app";
const prohibitedCliPatterns = [
  /(^|-)token($|=)/iu,
  /(^|-)password($|=)/iu,
  /(^|-)secret($|=)/iu,
  /api[_-]?key=/iu,
  /authorization=/iu
];

function parseArgs(argv) {
  const args = {
    baseUrl: "",
    outPath: "",
    strict: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (prohibitedCliPatterns.some((pattern) => pattern.test(arg))) {
      throw new Error("Raw secret CLI args are not supported. Use non-secret URLs and private operator files only.");
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

    throw new Error(`Unsupported argument: ${arg}`);
  }

  args.baseUrl = args.baseUrl || normalizeBaseUrl(process.env.NEXT_PUBLIC_PRODUCT_URL || defaultBaseUrl, "NEXT_PUBLIC_PRODUCT_URL");
  return args;
}

async function buildReport(args) {
  const support = await inspectSupportPage(args.baseUrl);
  const policies = await Promise.all(policyPaths.map((path) => inspectPolicyPage(args.baseUrl, path)));
  const checks = [support, ...policies].flatMap((route) => route.checks);
  const blockedChecks = checks.filter((check) => check.status === "blocked");
  const manualChecks = checks.filter((check) => check.status === "manual");
  const overallStatus = blockedChecks.length ? "blocked" : manualChecks.length ? "owner-action-required" : "ready-for-stripe-submit";

  return {
    generatedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    overallStatus,
    routes: [support, ...policies],
    blockers: blockedChecks.map((check) => `${check.id}: ${check.fix}`),
    ownerActions: manualChecks.map((check) => `${check.id}: ${check.fix}`),
    stripeDashboardValues: {
      paymentMethods: ["Website", "Offline"],
      customerSupportUrl: new URL("/support", args.baseUrl).toString(),
      termsOfServiceUrl: new URL("/terms-of-service", args.baseUrl).toString(),
      privacyPolicyUrl: new URL("/privacy", args.baseUrl).toString(),
      cancellationRefundPolicyUrl: new URL("/cancellation-refund-policy", args.baseUrl).toString()
    },
    requiredPublicEnv: [
      "NEXT_PUBLIC_BUSINESS_LEGAL_NAME",
      "NEXT_PUBLIC_BUSINESS_REGISTERED_ADDRESS",
      "NEXT_PUBLIC_BUSINESS_SUPPORT_PHONE",
      "NEXT_PUBLIC_BUSINESS_SUPPORT_EMAIL",
      "NEXT_PUBLIC_PRODUCT_URL"
    ],
    nextActions:
      overallStatus === "ready-for-stripe-submit"
        ? ["Submit the listed URLs in Stripe test and live business-detail review."]
        : [
            "Set the listed public Vercel environment variables with owner-approved business details.",
            "Redeploy the production Vercel app.",
            "Rerun npm run verify:hosted-business-verification -- --strict before resubmitting Stripe business details."
          ],
    proofBoundary:
      "This verifies hosted Stripe business-detail page readiness only. It does not prove Stripe account acceptance, active capabilities, paid subscriptions, invoices, customer consent, or live scan delivery."
  };
}

async function inspectSupportPage(baseUrl) {
  const fetched = await fetchRoute(baseUrl, supportPath);
  const text = normalizeVisibleText(fetched.html);
  const html = String(fetched.html || "");
  const checks = [
    check({
      id: "support-http-status",
      label: "Support page HTTP response",
      status: fetched.ok ? "ready" : "blocked",
      evidence: `HTTP ${fetched.status}`,
      fix: "Deploy a working /support route before submitting it to Stripe."
    }),
    check({
      id: "support-business-verification-card",
      label: "Business verification checklist card deployed",
      status: html.includes("business-verification-card") && includesPhrase(text, "Stripe business verification status") ? "ready" : "blocked",
      evidence: html.includes("business-verification-card") ? "business-verification-card present" : "business-verification-card missing",
      fix: "Deploy the latest repo build so /support includes the Stripe business verification checklist."
    }),
    check({
      id: "registered-address-public",
      label: "Registered India business address configured",
      status: includesPhrase(text, "Owner must add the registered India business address") ? "manual" : "ready",
      evidence: includesPhrase(text, "Owner must add the registered India business address") ? "placeholder text visible" : "placeholder text absent",
      fix: "Set NEXT_PUBLIC_BUSINESS_REGISTERED_ADDRESS to the owner-approved registered India business address."
    }),
    check({
      id: "domestic-phone-public",
      label: "Domestic India support phone configured",
      status: includesPhrase(text, "Owner must add a domestic India support telephone") ? "manual" : "ready",
      evidence: includesPhrase(text, "Owner must add a domestic India support telephone") ? "placeholder text visible" : "placeholder text absent",
      fix: "Set NEXT_PUBLIC_BUSINESS_SUPPORT_PHONE to the owner-approved domestic India support telephone number."
    }),
    check({
      id: "support-email-public",
      label: "Monitored support email configured",
      status: includesPhrase(text, "Owner must add a monitored support email") ? "manual" : "ready",
      evidence: includesPhrase(text, "Owner must add a monitored support email") ? "placeholder text visible" : "placeholder text absent",
      fix: "Set NEXT_PUBLIC_BUSINESS_SUPPORT_EMAIL to the owner-approved monitored support email."
    })
  ];

  return summarizeRoute({ id: "support", path: supportPath, fetched, checks });
}

async function inspectPolicyPage(baseUrl, path) {
  const fetched = await fetchRoute(baseUrl, path);
  const text = normalizeVisibleText(fetched.html);
  const requiredPhrases =
    path === "/terms-of-service"
      ? ["Cancellation and refunds"]
      : path === "/privacy"
        ? ["Information we collect", "How we use information", "Disclosure and retention"]
        : ["Refund request process"];
  const checks = [
    check({
      id: `${slugify(path)}-http-status`,
      label: `${path} HTTP response`,
      status: fetched.ok ? "ready" : "blocked",
      evidence: `HTTP ${fetched.status}`,
      fix: `Deploy a working ${path} route before submitting it to Stripe.`
    }),
    check({
      id: `${slugify(path)}-required-copy`,
      label: `${path} Stripe review copy`,
      status: requiredPhrases.every((phrase) => includesPhrase(text, phrase)) ? "ready" : "blocked",
      evidence: requiredPhrases
        .map((phrase) => `${phrase}: ${includesPhrase(text, phrase) ? "present" : "missing"}`)
        .join("; "),
      fix: `Restore the required Stripe review copy on ${path}.`
    })
  ];

  return summarizeRoute({ id: slugify(path), path, fetched, checks });
}

function summarizeRoute({ id, path, fetched, checks }) {
  return {
    id,
    path,
    url: fetched.url,
    httpStatus: fetched.status,
    status: checks.some((item) => item.status === "blocked")
      ? "blocked"
      : checks.some((item) => item.status === "manual")
        ? "owner-action-required"
        : "ready",
    checks
  };
}

async function fetchRoute(baseUrl, path) {
  const url = new URL(path, baseUrl).toString();
  let response;

  try {
    response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    return {
      url,
      status: 0,
      ok: false,
      html: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }

  return {
    url,
    status: response.status,
    ok: response.ok,
    html: await response.text()
  };
}

function check(input) {
  return {
    id: input.id,
    label: input.label,
    status: input.status,
    evidence: input.evidence,
    fix: input.fix
  };
}

function normalizeVisibleText(html) {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<[^>]+>/gu, " ")
  )
    .replace(/\s+/gu, " ")
    .trim();
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, "\"")
    .replace(/&#39;/giu, "'");
}

function includesPhrase(text, phrase) {
  return text.toLocaleLowerCase().includes(phrase.toLocaleLowerCase());
}

function normalizeBaseUrl(value, label) {
  if (!value) {
    throw new Error(`${label} must be set to the hosted SME Workspace Sentinel URL.`);
  }

  const url = new URL(value);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${label} must use http or https.`);
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function slugify(value) {
  return String(value)
    .replace(/^\//u, "")
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-|-$/gu, "")
    .toLowerCase();
}

function writeJsonFile(path, content) {
  const absolutePath = resolve(path);
  const parentDirectory = dirname(absolutePath);
  mkdirSync(parentDirectory, { recursive: true });
  assertRegularParent(parentDirectory);
  const tempPath = `${absolutePath}.${basename(absolutePath)}.tmp`;

  try {
    writeFileSync(tempPath, `${JSON.stringify(content, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(tempPath, absolutePath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function assertRegularParent(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Output parent ${path} must be a regular directory.`);
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildReport(args);
  if (args.outPath) {
    writeJsonFile(args.outPath, report);
  }
  console.log(JSON.stringify(report, null, 2));

  if (args.strict && report.overallStatus !== "ready-for-stripe-submit") {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
