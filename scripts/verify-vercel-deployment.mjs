#!/usr/bin/env node
/* global console, process, URL */

import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const prohibitedCliPatterns = [
  /(^|-)token($|=)/iu,
  /(^|-)password($|=)/iu,
  /(^|-)secret($|=)/iu,
  /api[_-]?key=/iu,
  /authorization=/iu
];

function parseArgs(argv) {
  const args = {
    deploymentsJsonPath: "",
    expectedCommit: "",
    productUrl: "",
    outPath: "",
    strict: false
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

    if (arg === "--deployments-json") {
      args.deploymentsJsonPath = argv[index + 1] ?? "";
      if (!args.deploymentsJsonPath) {
        throw new Error("--deployments-json requires a non-secret Vercel deployment export JSON path.");
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--deployments-json=")) {
      args.deploymentsJsonPath = arg.slice("--deployments-json=".length);
      continue;
    }

    if (arg === "--expected-commit") {
      args.expectedCommit = normalizeCommit(argv[index + 1] ?? "");
      if (!args.expectedCommit) {
        throw new Error("--expected-commit requires a Git commit SHA.");
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--expected-commit=")) {
      args.expectedCommit = normalizeCommit(arg.slice("--expected-commit=".length));
      continue;
    }

    if (arg === "--url" || arg === "--product-url") {
      args.productUrl = normalizeProductUrl(argv[index + 1] ?? "", arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--url=")) {
      args.productUrl = normalizeProductUrl(arg.slice("--url=".length), "--url");
      continue;
    }

    if (arg.startsWith("--product-url=")) {
      args.productUrl = normalizeProductUrl(arg.slice("--product-url=".length), "--product-url");
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

  return args;
}

function buildReport(args) {
  const expectedCommit = args.expectedCommit || normalizeCommit(process.env.SENTINEL_SOURCE_COMMIT || "") || gitHeadCommit();
  const project = readVercelProject();
  const productUrl =
    args.productUrl ||
    normalizeOptionalProductUrl(process.env.NEXT_PUBLIC_PRODUCT_URL || "") ||
    normalizeOptionalProductUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL || "") ||
    "missing";
  const deploymentInput = args.deploymentsJsonPath ? readDeployments(args.deploymentsJsonPath) : missingDeploymentInput();
  const latestProduction = deploymentInput.deployments
    .filter((deployment) => deployment.target === "production")
    .sort((left, right) => Number(right.created || 0) - Number(left.created || 0))[0];
  const latestReadyProduction = deploymentInput.deployments
    .filter((deployment) => deployment.target === "production" && deployment.state === "READY")
    .sort((left, right) => Number(right.created || 0) - Number(left.created || 0))[0];
  const selectedDeployment = latestReadyProduction || latestProduction;
  const checks = buildChecks({
    expectedCommit,
    productUrl,
    project,
    deploymentInput,
    selectedDeployment
  });
  const blockers = checks
    .filter((check) => check.status === "missing" || check.status === "blocked")
    .map((check) => `${check.label}: ${check.fix}`);
  const overallStatus = blockers.length ? "blocked" : "verified";

  return {
    generatedAt: new Date().toISOString(),
    overallStatus,
    expectedCommit,
    productUrl,
    project,
    deploymentInput: {
      path: args.deploymentsJsonPath ? resolve(args.deploymentsJsonPath) : "missing",
      status: deploymentInput.status,
      deploymentCount: deploymentInput.deployments.length
    },
    latestProductionDeployment: summarizeDeployment(selectedDeployment),
    checks,
    blockers,
    nextActions: buildNextActions({ blockers, selectedDeployment, expectedCommit, productUrl }),
    proofBoundary:
      "This verifies Vercel customer-demo deployment lineage only. It is not Cloud Run proof, live Gemini proof, Google Cloud proof, Workspace OAuth proof, revenue proof, judge access, organizer approval, or XPRIZE submission readiness.",
    stopConditions: [
      "Do not treat a Vercel 200 response as current-source proof unless the latest production deployment commit matches the pushed HEAD.",
      "Do not treat Vercel customer-demo deployment as a substitute for required Cloud Run and Google Cloud evidence.",
      "Keep Vercel tokens, dashboard exports, private aliases, and deployment screenshots out of Git unless explicitly redacted and reviewed."
    ]
  };
}

function buildChecks({ expectedCommit, productUrl, project, deploymentInput, selectedDeployment }) {
  const deploymentCommit = selectedDeployment?.githubCommitSha || "";

  return [
    check({
      id: "expected-source-commit",
      label: "Expected source commit",
      status: expectedCommit ? "ready" : "missing",
      evidence: expectedCommit || "missing",
      fix: "Commit and push the intended source, or pass --expected-commit with the Git SHA that should be deployed."
    }),
    check({
      id: "vercel-project-link",
      label: "Vercel project linkage",
      status: project.projectId && project.orgId ? "ready" : "missing",
      evidence: project.projectId && project.orgId ? `project=${project.projectId}; org=${project.orgId}.` : ".vercel/project.json missing or incomplete.",
      fix: "Link the repo to the intended Vercel project before using this as customer-demo deployment evidence."
    }),
    check({
      id: "customer-product-url",
      label: "Customer product URL",
      status: isHttpsUrl(productUrl) ? "ready" : "missing",
      evidence: productUrl,
      fix: "Set NEXT_PUBLIC_PRODUCT_URL or pass --url with the customer-visible Vercel URL."
    }),
    check({
      id: "deployment-export",
      label: "Vercel deployment export",
      status: deploymentInput.status === "loaded" ? "ready" : "missing",
      evidence:
        deploymentInput.status === "loaded"
          ? `${deploymentInput.deployments.length} deployment record(s) loaded.`
          : "No --deployments-json path was supplied.",
      fix: "Export current Vercel deployments from the connector, dashboard, or API into a private JSON file and rerun with --deployments-json."
    }),
    check({
      id: "latest-production-ready",
      label: "Latest production deployment is ready",
      status: selectedDeployment?.state === "READY" && selectedDeployment?.target === "production" ? "ready" : "blocked",
      evidence: selectedDeployment
        ? `id=${selectedDeployment.id}; target=${selectedDeployment.target}; state=${selectedDeployment.state}; url=${selectedDeployment.url}.`
        : "No production deployment record found.",
      fix: "Trigger or repair the Vercel production deployment, then rerun this verifier with a fresh deployment export."
    }),
    check({
      id: "production-source-lineage",
      label: "Production deployment source lineage",
      status: expectedCommit && deploymentCommit && sameCommit(expectedCommit, deploymentCommit) ? "ready" : "blocked",
      evidence: `expected=${expectedCommit || "missing"}; deployed=${deploymentCommit || "missing"}.`,
      fix:
        expectedCommit && deploymentCommit
          ? "Redeploy the customer-facing Vercel production app from the current pushed source commit, then rerun this verifier."
          : "Capture a deployment export with githubCommitSha metadata and verify it against the pushed source commit."
    })
  ];
}

function buildNextActions({ blockers, selectedDeployment, expectedCommit, productUrl }) {
  if (!blockers.length) {
    return [
      "Preserve this Vercel deployment-lineage packet with the customer-demo proof bundle.",
      "Continue using Cloud Run hosted proof for XPRIZE Google Cloud evidence; Vercel lineage only supports customer-demo visibility."
    ];
  }

  const actions = [
    "If Vercel CLI is authenticated, run npx vercel deploy --prod --yes from the repo root; otherwise trigger Redeploy in the Vercel dashboard.",
    "After deployment is READY, export the Vercel deployments JSON and rerun npm run verify:vercel-deployment -- --deployments-json /private/path/vercel-deployments.json --url https://sme-workspace-sentinel.vercel.app --strict.",
    "Keep this as customer-demo deployment proof only; Cloud Run and Gemini proof still require the separate hosted proof pipeline."
  ];

  if (selectedDeployment?.githubCommitSha && expectedCommit && !sameCommit(expectedCommit, selectedDeployment.githubCommitSha)) {
    actions.unshift(`Current Vercel production deployment is stale: deployed ${selectedDeployment.githubCommitSha}, expected ${expectedCommit}.`);
  }

  if (productUrl === "missing") {
    actions.unshift("Provide the customer-visible Vercel URL with --url or NEXT_PUBLIC_PRODUCT_URL.");
  }

  return actions;
}

function missingDeploymentInput() {
  return { status: "missing", deployments: [] };
}

function readDeployments(path) {
  const text = readRegularTextFile(path, "Vercel deployments JSON");
  const parsed = JSON.parse(text);
  const deployments = normalizeDeployments(parsed);

  return {
    status: "loaded",
    deployments
  };
}

function normalizeDeployments(parsed) {
  const rawDeployments = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.deployments)
      ? parsed.deployments
      : Array.isArray(parsed?.deployments?.deployments)
        ? parsed.deployments.deployments
        : [];

  return rawDeployments.map((deployment) => ({
    id: String(deployment?.id || ""),
    name: String(deployment?.name || ""),
    url: normalizeDeploymentUrl(deployment?.url || ""),
    created: Number(deployment?.created || deployment?.createdAt || 0),
    state: String(deployment?.state || ""),
    target: String(deployment?.target || ""),
    inspectorUrl: String(deployment?.inspectorUrl || ""),
    githubCommitSha: normalizeCommit(deployment?.meta?.githubCommitSha || deployment?.githubCommitSha || ""),
    githubCommitRef: String(deployment?.meta?.githubCommitRef || deployment?.githubCommitRef || ""),
    githubCommitMessage: String(deployment?.meta?.githubCommitMessage || deployment?.githubCommitMessage || "")
  }));
}

function summarizeDeployment(deployment) {
  if (!deployment) {
    return {
      status: "missing"
    };
  }

  return {
    status: "found",
    id: deployment.id,
    name: deployment.name,
    url: deployment.url,
    created: deployment.created,
    state: deployment.state,
    target: deployment.target,
    githubCommitSha: deployment.githubCommitSha || "missing",
    githubCommitRef: deployment.githubCommitRef || "missing",
    githubCommitMessage: deployment.githubCommitMessage || "missing",
    inspectorUrl: deployment.inspectorUrl || "missing"
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

function readVercelProject() {
  try {
    const parsed = JSON.parse(readFileSync(resolve(".vercel/project.json"), "utf8"));

    return {
      projectId: String(parsed.projectId || ""),
      orgId: String(parsed.orgId || ""),
      source: ".vercel/project.json"
    };
  } catch {
    if (process.env.VERCEL_PROJECT_ID || process.env.VERCEL_ORG_ID) {
      return {
        projectId: String(process.env.VERCEL_PROJECT_ID || ""),
        orgId: String(process.env.VERCEL_ORG_ID || ""),
        source: "environment"
      };
    }

    return {
      projectId: "",
      orgId: "",
      source: "missing"
    };
  }
}

function gitHeadCommit() {
  try {
    return normalizeCommit(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }));
  } catch {
    return "";
  }
}

function sameCommit(expected, actual) {
  const left = normalizeCommit(expected);
  const right = normalizeCommit(actual);

  return Boolean(left && right && (left === right || left.startsWith(right) || right.startsWith(left)));
}

function normalizeCommit(value) {
  const text = String(value || "").trim().toLowerCase();

  return /^[a-f0-9]{7,40}$/u.test(text) ? text : "";
}

function normalizeDeploymentUrl(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "";
  }

  return text.startsWith("http://") || text.startsWith("https://") ? text : `https://${text}`;
}

function normalizeOptionalProductUrl(value) {
  if (!value) {
    return "";
  }

  return normalizeProductUrl(value, "product URL");
}

function normalizeProductUrl(value, label) {
  const normalized = normalizeDeploymentUrl(value);

  if (!normalized) {
    throw new Error(`${label} requires a URL.`);
  }

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }

  if (parsed.username || parsed.password || parsed.search) {
    throw new Error(`${label} must not include credentials or query parameters.`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }

  return parsed.origin;
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function readRegularTextFile(path, label) {
  const absolutePath = resolve(path);
  assertRegularFile(absolutePath, label);

  return readFileSync(absolutePath, "utf8");
}

function writeJson(path, value) {
  const absolutePath = resolve(path);
  const parentDirectory = dirname(absolutePath);
  assertDirectoryPathSafe(parentDirectory, "Vercel deployment output parent directory");
  mkdirSync(parentDirectory, { recursive: true });
  assertDirectoryExistsSafe(parentDirectory, "Vercel deployment output parent directory");

  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (prohibitedCliPatterns.some((pattern) => pattern.test(text))) {
    throw new Error("Vercel deployment report contains secret-shaped text and will not be written.");
  }

  const temporaryPath = resolve(parentDirectory, `.${basename(absolutePath)}.${process.pid}.tmp`);
  writeFileSync(temporaryPath, text, { encoding: "utf8", flag: "wx" });
  renameSync(temporaryPath, absolutePath);
}

function assertRegularFile(path, label) {
  let fileStat;
  try {
    fileStat = lstatSync(path);
  } catch (error) {
    throw new Error(`${label} ${path} is not readable: ${error instanceof Error ? error.message : String(error)}.`);
  }

  if (fileStat.isSymbolicLink()) {
    throw new Error(`${label} ${path} is a symbolic link; use a regular private file.`);
  }

  if (!fileStat.isFile()) {
    throw new Error(`${label} ${path} is not a regular file.`);
  }
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
  const report = buildReport(args);

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
