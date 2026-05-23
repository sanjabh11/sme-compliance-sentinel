/* global console, process */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const requiredFiles = [
  "package.json",
  "package-lock.json",
  "README.md",
  "XPRIZE_CHECKLIST.md",
  ".env.example",
  ".gitignore",
  "cloudrun.service.yaml",
  "app/page.tsx",
  "app/dashboard-client.tsx",
  "lib/store.ts",
  "lib/source-release.ts",
  "tests/source-release.test.ts"
];

const requiredIgnores = ["node_modules/", ".next/", "coverage/", "*.tsbuildinfo", ".env", ".env.local", ".env.*.local", "!.env.example"];
const forbiddenTrackedPatterns = [/^\.env$/u, /^\.env\.local$/u, /^\.env\..*\.local$/u, /^node_modules\//u, /^\.next\//u, /(^|\/)\.DS_Store$/u];
const secretPatterns = [
  { detector: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { detector: "google-api-key", pattern: /AIza[0-9A-Za-z_-]{20,}/u },
  { detector: "google-oauth-client-secret", pattern: /GOCSPX-[0-9A-Za-z_-]{20,}/u },
  { detector: "aws-access-key", pattern: /AKIA[0-9A-Z]{16}/u }
];

function runGit(args) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function parseStatus() {
  return runGit(["status", "--short", "--untracked-files=all"])
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      code: line.slice(0, 2),
      path: line.slice(3).trim()
    }));
}

function listTracked() {
  return runGit(["ls-files"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function scanFile(path) {
  const findings = [];

  if (!/\.(css|env|example|gitignore|json|js|jsx|mjs|md|ts|tsx|txt|yaml|yml)$/u.test(path) || path === "package-lock.json") {
    return findings;
  }

  const text = readFileSync(path, "utf8");
  text.split(/\r?\n/u).forEach((line, index) => {
    for (const detector of secretPatterns) {
      if (detector.pattern.test(line)) {
        findings.push({
          path,
          line: index + 1,
          detector: detector.detector
        });
      }
    }
  });

  return findings;
}

function buildReport() {
  const status = parseStatus();
  const tracked = listTracked();
  const commitCount = countCommits();
  const untracked = status.filter((item) => item.code === "??").map((item) => item.path);
  const candidateFiles = [...new Set([...tracked, ...untracked])].filter(
    (path) => !forbiddenTrackedPatterns.some((pattern) => pattern.test(path))
  );
  const missingFiles = requiredFiles.filter((path) => !existsSync(join(process.cwd(), path)));
  const gitignoreText = existsSync(".gitignore") ? readFileSync(".gitignore", "utf8") : "";
  const missingIgnores = requiredIgnores.filter((pattern) => !gitignoreText.includes(pattern));
  const forbiddenTracked = tracked.filter((path) => forbiddenTrackedPatterns.some((pattern) => pattern.test(path)));
  const secretFindings = candidateFiles.flatMap((path) => (existsSync(path) ? scanFile(path) : []));

  const checks = [
    check("required-files", missingFiles.length === 0, missingFiles.length ? `Missing: ${missingFiles.join(", ")}` : "Required files present."),
    check(
      "gitignore-private-files",
      missingIgnores.length === 0,
      missingIgnores.length ? `Missing ignore patterns: ${missingIgnores.join(", ")}` : "Private/build ignore patterns present."
    ),
    check(
      "forbidden-tracked-files",
      forbiddenTracked.length === 0,
      forbiddenTracked.length ? `Forbidden tracked files: ${forbiddenTracked.join(", ")}` : "No forbidden local/generated files tracked."
    ),
    check(
      "secret-scan",
      secretFindings.length === 0,
      secretFindings.length ? `${secretFindings.length} possible secret finding(s).` : "No obvious secret patterns found."
    )
  ];
  const blocked = checks.filter((item) => item.status === "blocked");
  const overallStatus = blocked.length ? "blocked" : commitCount > 0 && untracked.length === 0 ? "published" : "ready-to-commit";

  return {
    generatedAt: new Date().toISOString(),
    overallStatus,
    commitCount,
    trackedFileCount: tracked.length,
    untrackedFileCount: untracked.length,
    candidateFileCount: candidateFiles.length,
    checks,
    secretFindings,
    nextActions: blocked.length
      ? blocked.map((item) => item.fix)
      : overallStatus === "published"
        ? ["Rerun npm run verify:provenance and keep the repository URL in the deployment environment."]
        : ["Run full verification, stage intended source files, create the first commit, and rerun npm run verify:provenance."]
  };
}

function countCommits() {
  try {
    return Number(runGit(["rev-list", "--count", "HEAD"])) || 0;
  } catch {
    return 0;
  }
}

function check(id, passed, evidence) {
  return {
    id,
    status: passed ? "passed" : "blocked",
    evidence,
    fix: `Resolve ${id} before staging or pushing source.`
  };
}

const report = buildReport();
console.log(JSON.stringify(report, null, 2));

if (report.overallStatus === "blocked" || process.argv.includes("--strict") && report.untrackedFileCount > 0) {
  process.exitCode = 1;
}
