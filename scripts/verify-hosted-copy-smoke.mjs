#!/usr/bin/env node
/* global AbortSignal, console, fetch, process, URL */

import { lstatSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const publicRoutes = [
  { id: "customer-root", path: "/" },
  { id: "customer-demo", path: "/demo/customer" }
];

const adminRoutes = [{ id: "admin-console", path: "/admin" }];

const requiredPublicPhrases = [
  "Get my sample risk scan",
  "Book my one-day scan",
  "SOC2 readiness evidence",
  "Sample data only"
];

const forbiddenPublicPhrases = [
  { phrase: "XPRIZE", category: "internal-proof-language", fix: "Move hackathon and judge proof language to /admin only." },
  { phrase: "Devpost", category: "internal-proof-language", fix: "Move Devpost submission language to /admin only." },
  { phrase: "Judge Access", category: "internal-proof-language", fix: "Keep judge-access setup out of the customer route." },
  { phrase: "judge export", category: "internal-proof-language", fix: "Use customer-safe Trust Packet language on public routes." },
  { phrase: "Cloud Run", category: "internal-proof-language", fix: "Keep deployment proof wording inside /admin and private packets." },
  { phrase: "MRR", category: "fake-or-private-traction", fix: "Do not show traction metrics on customer pages unless verified and consent-safe." },
  { phrase: "$1,194", category: "fake-or-private-traction", fix: "Remove seeded revenue values from customer routes." },
  { phrase: "source-release", category: "internal-proof-language", fix: "Keep source release verifier language inside /admin." },
  { phrase: "/secure/local", category: "private-path", fix: "Never expose local private artifact paths in hosted customer pages." },
  { phrase: "SOC2 certified", category: "compliance-overclaim", fix: "Use SOC2 readiness evidence language instead of certification claims." },
  { phrase: "SOC2 compliant", category: "compliance-overclaim", fix: "Use readiness or evidence language instead of compliance claims." },
  { phrase: "fully compliant", category: "compliance-overclaim", fix: "Remove unqualified compliance claims." },
  { phrase: "guaranteed compliance", category: "compliance-overclaim", fix: "Remove guarantees and describe bounded readiness evidence." },
  { phrase: "guaranteed compliant", category: "compliance-overclaim", fix: "Remove guarantees and describe bounded readiness evidence." },
  { phrase: "100% confident", category: "outcome-overclaim", fix: "Do not claim absolute certainty or guaranteed outcomes." }
];

const adminContextualPhrases = [
  {
    phrase: "SOC2 certified",
    category: "compliance-overclaim",
    allowedContextPatterns: [/question:\s*are you soc2 certified/iu, /are you soc2 certified\?/iu, /claim guard/iu, /banned claim/iu],
    fix: "Keep this phrase only inside questionnaire examples or claim-guard education."
  },
  {
    phrase: "SOC2 compliant",
    category: "compliance-overclaim",
    allowedContextPatterns: [/claim guard/iu, /banned claim/iu],
    fix: "Keep this phrase only inside claim-guard education."
  },
  {
    phrase: "fully compliant",
    category: "compliance-overclaim",
    allowedContextPatterns: [/claim guard/iu, /banned claim/iu],
    fix: "Keep this phrase only inside claim-guard education."
  },
  {
    phrase: "guaranteed compliance",
    category: "compliance-overclaim",
    allowedContextPatterns: [/claim guard/iu, /banned claim/iu],
    fix: "Keep this phrase only inside claim-guard education."
  },
  {
    phrase: "100% confident",
    category: "outcome-overclaim",
    allowedContextPatterns: [/claim guard/iu, /banned claim/iu],
    fix: "Keep certainty examples only inside claim-guard education."
  }
];

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
    strict: false,
    skipAdmin: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (prohibitedCliPatterns.some((pattern) => pattern.test(arg))) {
      throw new Error("Raw secret CLI args are not supported. Use private files, not credential arguments.");
    }

    if (arg === "--strict") {
      args.strict = true;
      continue;
    }

    if (arg === "--skip-admin") {
      args.skipAdmin = true;
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

  args.baseUrl = args.baseUrl || normalizeBaseUrl(process.env.NEXT_PUBLIC_PRODUCT_URL || "", "NEXT_PUBLIC_PRODUCT_URL");

  return args;
}

async function buildReport(args) {
  const publicResults = await Promise.all(publicRoutes.map((route) => inspectPublicRoute(args.baseUrl, route)));
  const adminResults = args.skipAdmin ? [] : await Promise.all(adminRoutes.map((route) => inspectAdminRoute(args.baseUrl, route)));
  const routes = [...publicResults, ...adminResults];
  const blockers = routes.flatMap((route) =>
    route.checks.filter((check) => check.status === "blocked").map((check) => `${route.path}: ${check.label}: ${check.fix}`)
  );

  return {
    generatedAt: new Date().toISOString(),
    overallStatus: blockers.length ? "blocked" : "verified",
    baseUrl: args.baseUrl,
    routes,
    blockers,
    nextActions: blockers.length
      ? ["Fix the listed hosted copy issues, redeploy, then rerun this verifier before using the route in outreach."]
      : [
          "Preserve this hosted copy smoke packet with customer-demo proof.",
          "Continue keeping public customer routes separate from /admin proof, verifier, revenue, and judge surfaces."
        ],
    proofBoundary:
      "This verifies hosted copy safety for customer-visible pages and context-aware admin education only. It is not revenue proof, user proof, Workspace OAuth proof, Cloud Run deployment proof, hosted Gemini proof, judge access, organizer approval, legal advice, audit assurance, or SOC2 certification."
  };
}

async function inspectPublicRoute(baseUrl, route) {
  const fetched = await fetchRoute(baseUrl, route.path);
  const text = normalizeVisibleText(fetched.html);
  const checks = [
    check({
      id: `${route.id}-http-status`,
      label: "HTTP response",
      status: fetched.ok ? "ready" : "blocked",
      evidence: `HTTP ${fetched.status}`,
      fix: "Deploy a working page that returns 2xx."
    }),
    ...requiredPublicPhrases.map((phrase) =>
      check({
        id: `${route.id}-required-${slugify(phrase)}`,
        label: `Required customer phrase: ${phrase}`,
        status: includesPhrase(text, phrase) ? "ready" : "blocked",
        evidence: includesPhrase(text, phrase) ? "present" : "missing",
        fix: "Restore the customer offer, first-person CTA, sample boundary, and SOC2 readiness boundary."
      })
    ),
    ...forbiddenPublicPhrases.map((rule) => {
      const matches = findPhraseContexts(text, rule.phrase);

      return check({
        id: `${route.id}-forbidden-${slugify(rule.phrase)}`,
        label: `Forbidden public phrase: ${rule.phrase}`,
        status: matches.length ? "blocked" : "ready",
        evidence: matches.length ? summarizeContexts(matches) : "absent",
        fix: rule.fix,
        category: rule.category
      });
    })
  ];

  return summarizeRoute({ route, kind: "customer", fetched, checks });
}

async function inspectAdminRoute(baseUrl, route) {
  const fetched = await fetchRoute(baseUrl, route.path);
  const text = normalizeVisibleText(fetched.html);
  const contextualChecks = adminContextualPhrases.map((rule) => {
    const matches = findPhraseContexts(text, rule.phrase);
    const unapprovedContexts = matches.filter(
      (context) => !rule.allowedContextPatterns.some((pattern) => pattern.test(context.context))
    );

    return check({
      id: `${route.id}-context-${slugify(rule.phrase)}`,
      label: `Admin contextual phrase: ${rule.phrase}`,
      status: unapprovedContexts.length ? "blocked" : "ready",
      evidence: matches.length
        ? `${matches.length} occurrence(s); ${unapprovedContexts.length} outside allowed context.`
        : "absent",
      fix: rule.fix,
      category: rule.category,
      allowedContext: matches.length && !unapprovedContexts.length
    });
  });
  const checks = [
    check({
      id: `${route.id}-http-status`,
      label: "HTTP response",
      status: fetched.ok ? "ready" : "blocked",
      evidence: `HTTP ${fetched.status}`,
      fix: "Deploy a working admin page that returns 2xx."
    }),
    ...contextualChecks
  ];

  return summarizeRoute({ route, kind: "admin", fetched, checks });
}

function summarizeRoute({ route, kind, fetched, checks }) {
  return {
    id: route.id,
    kind,
    path: route.path,
    url: fetched.url,
    httpStatus: fetched.status,
    status: checks.some((item) => item.status === "blocked") ? "blocked" : "ready",
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
    fix: input.fix,
    ...(input.category ? { category: input.category } : {}),
    ...(input.allowedContext ? { allowedContext: input.allowedContext } : {})
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

function findPhraseContexts(text, phrase) {
  const normalizedText = String(text || "");
  const lowerText = normalizedText.toLocaleLowerCase();
  const lowerPhrase = phrase.toLocaleLowerCase();
  const contexts = [];
  let cursor = 0;

  while (cursor < lowerText.length) {
    const index = lowerText.indexOf(lowerPhrase, cursor);
    if (index === -1) {
      break;
    }

    const start = Math.max(0, index - 120);
    const end = Math.min(normalizedText.length, index + phrase.length + 160);
    contexts.push({
      phrase,
      context: normalizedText.slice(start, end).trim()
    });
    cursor = index + lowerPhrase.length;
  }

  return contexts;
}

function summarizeContexts(matches) {
  return matches
    .slice(0, 3)
    .map((match) => match.context)
    .join(" | ");
}

function slugify(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80);
}

function normalizeBaseUrl(value, label) {
  if (!value) {
    throw new Error(`${label} requires a hosted URL.`);
  }

  const text = String(value).trim();
  let parsed;
  try {
    parsed = new URL(text.startsWith("http://") || text.startsWith("https://") ? text : `https://${text}`);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }

  if (parsed.username || parsed.password || parsed.search) {
    throw new Error(`${label} must not include credentials or query parameters.`);
  }

  const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalhost)) {
    throw new Error(`${label} must use HTTPS, except localhost test URLs.`);
  }

  return parsed.origin;
}

function writeJson(path, value) {
  const absolutePath = resolve(path);
  const parentDirectory = dirname(absolutePath);
  assertDirectoryPathSafe(parentDirectory, "Hosted copy smoke output parent directory");
  mkdirSync(parentDirectory, { recursive: true });
  assertDirectoryExistsSafe(parentDirectory, "Hosted copy smoke output parent directory");

  const text = `${JSON.stringify(value, null, 2)}\n`;
  const temporaryPath = resolve(parentDirectory, `.${basename(absolutePath)}.${process.pid}.tmp`);
  writeFileSync(temporaryPath, text, { encoding: "utf8", flag: "wx" });
  renameSync(temporaryPath, absolutePath);
}

function assertDirectoryPathSafe(path, label) {
  const segments = resolve(path).split(/[/\\]+/u);

  for (let index = 1; index <= segments.length; index += 1) {
    const candidate = segments.slice(0, index).join("/") || "/";
    try {
      const stat = lstatSync(candidate);
      if (stat.isSymbolicLink()) {
        throw new Error(`${label} ${candidate} is a symbolic link; use a regular private directory.`);
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return;
      }
      if (error instanceof Error && error.message.includes("symbolic link")) {
        throw error;
      }
    }
  }
}

function assertDirectoryExistsSafe(path, label) {
  const stat = lstatSync(path);

  if (stat.isSymbolicLink()) {
    throw new Error(`${label} ${path} is a symbolic link; use a regular private directory.`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`${label} ${path} is not a directory.`);
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
