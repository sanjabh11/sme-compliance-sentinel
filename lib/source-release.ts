import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scanClaimText } from "@/lib/claim-guard";
import type {
  ProjectProvenanceGitSignals,
  SourceReleaseClaimFinding,
  SourceReleaseCheck,
  SourceReleaseFileCategory,
  SourceReleaseFilePlan,
  SourceReleaseGuard,
  SourceReleaseSecretFinding
} from "@/lib/types";

const requiredRepoFiles = [
  "package.json",
  "package-lock.json",
  "README.md",
  "XPRIZE_CHECKLIST.md",
  "WINNING_STRATEGY.md",
  ".env.example",
  ".gitignore",
  "cloudrun.service.yaml",
  "app/page.tsx",
  "app/dashboard-client.tsx",
  "lib/store.ts",
  "lib/scanner.ts",
  "lib/gemini.ts",
  "lib/readiness.ts",
  "tests/scanner.test.ts",
  "tests/readiness.test.ts"
];

const requiredGitignorePatterns = [
  "node_modules/",
  ".next/",
  "coverage/",
  "*.tsbuildinfo",
  ".env",
  ".env.local",
  ".env.*.local",
  "!.env.example"
];

const textFilePattern = /\.(css|env|example|gitignore|json|js|jsx|mjs|md|ts|tsx|txt|yaml|yml)$/u;
const secretValuePattern = /^[A-Za-z0-9_./+=:@-]{16,}$/u;
const placeholderPattern = /^(YOUR|PROJECT|BILLING|REGION|https:\/\/YOUR|configured|missing|\(default\)|false|true|tenant_|sentinel_|gemini-|gcp-rest|mock|production|oidc|demo|memory|\$)/iu;

export function collectSourceReleaseGuard(rootDir = process.cwd()): SourceReleaseGuard {
  const git = collectGitSignals(rootDir);
  const gitignoreText = safeRead(rootDir, ".gitignore");
  const files = collectFilePlans(rootDir);
  const secretFindings = scanSecrets(rootDir, files);
  const claimFindings = scanReleaseClaims(rootDir, files);

  return buildSourceReleaseGuard({ git, files, gitignoreText, secretFindings, claimFindings });
}

export function buildSourceReleaseGuard(input: {
  git: ProjectProvenanceGitSignals;
  files: SourceReleaseFilePlan[];
  gitignoreText: string;
  secretFindings: SourceReleaseSecretFinding[];
  claimFindings?: SourceReleaseClaimFinding[];
}): SourceReleaseGuard {
  const checks = buildChecks(input);
  const blockers = checks.filter((check) => check.status === "blocked").map((check) => `${check.label}: ${check.fix}`);
  const trackedFileCount = input.files.filter((file) => file.gitStatus === "tracked" || file.gitStatus === "modified").length;
  const untrackedFileCount = input.files.filter((file) => file.gitStatus === "untracked").length;
  const modifiedFileCount = input.files.filter((file) => file.gitStatus === "modified" || file.gitStatus === "deleted").length;
  const releasableFileCount = input.files.filter((file) => file.releaseAction === "stage").length;
  const overallStatus: SourceReleaseGuard["overallStatus"] =
    blockers.length > 0
      ? "blocked"
      : input.git.commitCount > 0 && untrackedFileCount === 0 && modifiedFileCount === 0
        ? "published"
        : "ready-to-commit";

  return {
    generatedAt: new Date().toISOString(),
    overallStatus,
    trackedFileCount,
    untrackedFileCount,
    modifiedFileCount,
    releasableFileCount,
    files: input.files,
    checks,
    secretFindings: input.secretFindings,
    claimFindings: input.claimFindings ?? [],
    blockers,
    nextActions: buildNextActions(input, overallStatus, blockers),
    recommendedCommands: [
      "npm run lint",
      "npm run typecheck",
      "npm test",
      "npm run build",
      "npm run verify:source-release",
      "git add .",
      'git commit -m "Initial SME Workspace Sentinel submission build"',
      "npm run verify:provenance"
    ],
    privateHandling: [
      "Do not stage .env, .env.local, OAuth tokens, API keys, raw customer files, invoices, payment exports, judge credentials, or detailed security findings.",
      "Commit `.env.example` placeholders and deployment templates only; production secret values belong in Secret Manager or private Devpost testing instructions.",
      "Public-facing source copy must stay inside the Claim Guard boundary: SOC2 readiness evidence, risk detection, staged remediation, and explicit remaining proof gaps.",
      "Run this guard immediately before the first commit and again before every source push shared with judges."
    ],
    disclaimer:
      "This guard checks source-release hygiene and obvious secret patterns. It does not replace human repository review, legal/IP review, or the final Devpost source-sharing requirement."
  };
}

function buildChecks(input: {
  git: ProjectProvenanceGitSignals;
  files: SourceReleaseFilePlan[];
  gitignoreText: string;
  secretFindings: SourceReleaseSecretFinding[];
  claimFindings?: SourceReleaseClaimFinding[];
}): SourceReleaseCheck[] {
  const paths = new Set(input.files.map((file) => file.path));
  const missingRequired = requiredRepoFiles.filter((path) => !paths.has(path));
  const missingGitignore = requiredGitignorePatterns.filter((pattern) => !input.gitignoreText.includes(pattern));
  const releasable = input.files.filter((file) => file.releaseAction === "stage");
  const hasCoreSource = ["app-source", "api-route", "library-source", "test"].every((category) =>
    releasable.some((file) => file.category === category)
  );

  return [
    check(
      "required-source-present",
      "Required source surfaces are present",
      missingRequired.length === 0 ? "passed" : "blocked",
      missingRequired.length ? `Missing ${missingRequired.join(", ")}.` : `${requiredRepoFiles.length} required source/control files are present.`,
      "Restore missing app, library, test, docs, config, and package files before creating the source-release commit.",
      true
    ),
    check(
      "core-categories-present",
      "App, API, library, and test source are represented",
      hasCoreSource ? "passed" : "blocked",
      summarizeCategories(releasable),
      "Include the actual app, API routes, library modules, and tests in the repository before sharing source with judges.",
      true
    ),
    check(
      "gitignore-protects-private-files",
      "Git ignore rules protect private files and build output",
      missingGitignore.length === 0 ? "passed" : "blocked",
      missingGitignore.length ? `Missing patterns: ${missingGitignore.join(", ")}.` : "Required secret, local-env, dependency, build, and coverage ignores are present.",
      "Update .gitignore before staging so secrets, local env files, build output, and dependency folders stay out of the repository.",
      true
    ),
    check(
      "secret-scan-clean",
      "Releasable source has no obvious committed secrets",
      input.secretFindings.length === 0 ? "passed" : "blocked",
      input.secretFindings.length ? `${input.secretFindings.length} possible secret finding(s).` : "No obvious API keys, OAuth secrets, private keys, or password assignments found in releasable files.",
      "Remove or rotate the detected value, replace it with an environment variable or placeholder, and rerun the source-release guard.",
      true
    ),
    check(
      "claim-guard-clean",
      "Public-facing source copy has no unsafe compliance or absolute-win claims",
      (input.claimFindings ?? []).length === 0 ? "passed" : "blocked",
      (input.claimFindings ?? []).length
        ? `${input.claimFindings?.length ?? 0} unsafe claim finding(s).`
        : "No unsafe certification, legal, audit, guarantee, or absolute-win claims found in public-facing source copy.",
      "Replace unsupported claims with SOC2 readiness evidence, risk detection, staged remediation, and explicit external-proof gaps.",
      true
    ),
    check(
      "source-ready-for-first-commit",
      "Repository is ready for first provenance commit",
      input.git.commitCount > 0
        ? "passed"
        : input.files.some((file) => file.releaseAction === "stage" && file.gitStatus === "untracked")
          ? "warning"
          : "blocked",
      `${input.git.commitCount} commit(s), ${input.git.trackedFileCount} tracked file(s), ${input.git.untrackedPaths.length} untracked path(s).`,
      "After quality checks pass, stage intended source files and create the first commit so provenance can evaluate the first-commit timestamp.",
      false
    ),
    check(
      "source-worktree-clean-for-publish",
      "Tracked source has no unpublished changes",
      input.git.commitCount > 0 && !input.files.some((file) => file.gitStatus === "modified" || file.gitStatus === "deleted" || file.gitStatus === "untracked")
        ? "passed"
        : "warning",
      `${input.files.filter((file) => file.gitStatus === "modified" || file.gitStatus === "deleted").length} modified/deleted tracked file(s), ${input.files.filter((file) => file.gitStatus === "untracked").length} untracked file(s).`,
      "Commit and push the intended source changes before treating source release as published.",
      false
    )
  ];
}

function scanReleaseClaims(rootDir: string, files: SourceReleaseFilePlan[]): SourceReleaseClaimFinding[] {
  return files
    .filter((file) => shouldScanClaims(file))
    .flatMap((file) => {
      const text = safeRead(rootDir, file.path);

      return scanClaimText({ artifact: file.path, text }).map((violation) => ({
        path: file.path,
        line: Number(violation.location.split(":").pop()) || 0,
        phrase: violation.phrase,
        severity: violation.severity,
        evidence: violation.context,
        fix: violation.fix
      }));
    });
}

function shouldScanClaims(file: SourceReleaseFilePlan) {
  if (file.releaseAction !== "stage" || !textFilePattern.test(file.path) || file.path === "package-lock.json") {
    return false;
  }

  return file.category !== "test" && file.category !== "script" && file.path !== "lib/claim-guard.ts";
}

function check(
  id: string,
  label: string,
  status: SourceReleaseCheck["status"],
  evidence: string,
  fix: string,
  requiredBeforeCommit: boolean
): SourceReleaseCheck {
  return { id, label, status, evidence, fix, requiredBeforeCommit };
}

function collectGitSignals(rootDir: string): ProjectProvenanceGitSignals {
  try {
    runGit(rootDir, ["rev-parse", "--show-toplevel"]);
  } catch (error) {
    return {
      gitAvailable: false,
      commitCount: 0,
      trackedFileCount: 0,
      untrackedPaths: [],
      error: error instanceof Error ? error.message : "Git is unavailable."
    };
  }

  const untrackedPaths = parseStatus(runGit(rootDir, ["status", "--short", "--untracked-files=all"]))
    .filter((item) => item.status === "untracked")
    .map((item) => item.path);
  const trackedFileCount = runGit(rootDir, ["ls-files"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;

  let commitCount = 0;
  let firstCommit: string | undefined;
  let firstCommitAt: string | undefined;
  let headCommitAt: string | undefined;
  let error: string | undefined;

  try {
    commitCount = Number(runGit(rootDir, ["rev-list", "--count", "HEAD"])) || 0;
    const firstCommitSignals = collectFirstCommitSignals(rootDir);
    firstCommit = firstCommitSignals?.commit;
    firstCommitAt = firstCommitSignals?.committedAt;
    headCommitAt = runGit(rootDir, ["log", "-1", "--format=%cI"]) || undefined;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "No commits are available.";
  }

  return {
    gitAvailable: true,
    commitCount,
    firstCommit,
    firstCommitAt,
    headCommitAt,
    trackedFileCount,
    untrackedPaths,
    error
  };
}

function collectFirstCommitSignals(rootDir: string) {
  const rootCommits = runGit(rootDir, ["rev-list", "--max-parents=0", "HEAD"])
    .split("\n")
    .map((commit) => commit.trim())
    .filter(Boolean);

  const roots = rootCommits
    .map((commit) => ({
      commit,
      committedAt: runGit(rootDir, ["show", "-s", "--format=%cI", commit])
    }))
    .filter((root) => root.committedAt);

  return roots.sort((left, right) => Date.parse(left.committedAt) - Date.parse(right.committedAt))[0];
}

function collectFilePlans(rootDir: string): SourceReleaseFilePlan[] {
  const statusItems = parseStatus(runGit(rootDir, ["status", "--short", "--untracked-files=all"]));
  const trackedItems = runGit(rootDir, ["ls-files"])
    .split("\n")
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => ({ status: "tracked" as const, path }));
  const byPath = new Map<string, SourceReleaseFilePlan>();

  for (const item of [...trackedItems, ...statusItems]) {
    byPath.set(item.path, buildFilePlan(item.path, item.status));
  }

  for (const requiredPath of requiredRepoFiles) {
    if (!byPath.has(requiredPath) && existsSync(projectPath(rootDir, requiredPath))) {
      byPath.set(requiredPath, buildFilePlan(requiredPath, "untracked"));
    }
  }

  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function buildFilePlan(path: string, gitStatus: SourceReleaseFilePlan["gitStatus"]): SourceReleaseFilePlan {
  const category = categorizePath(path);
  const privateLocalFile = /^\.env(?:\.local|(\..*\.local)?)?$/u.test(path) && path !== ".env.example";
  const buildOutput = path.startsWith(".next/") || path.startsWith("node_modules/") || path.endsWith(".tsbuildinfo");
  const releaseAction: SourceReleaseFilePlan["releaseAction"] =
    privateLocalFile || buildOutput ? "ignore" : category === "unknown" ? "review" : "stage";

  return {
    path,
    category,
    gitStatus,
    releaseAction,
    requiredForSubmission: releaseAction === "stage" && category !== "unknown",
    reason:
      releaseAction === "ignore"
        ? "Private/local/generated file should stay out of source release."
        : releaseAction === "review"
          ? "Unrecognized file type needs human review before staging."
          : "Source, tests, docs, config, or public placeholder needed for judge source review."
  };
}

function categorizePath(path: string): SourceReleaseFileCategory {
  if (path === "package.json" || path === "package-lock.json") {
    return "package-manifest";
  }

  if (path.startsWith("app/api/")) {
    return "api-route";
  }

  if (path.startsWith("app/")) {
    return "app-source";
  }

  if (path.startsWith("lib/")) {
    return "library-source";
  }

  if (path.startsWith("tests/")) {
    return "test";
  }

  if (path.startsWith("scripts/")) {
    return "script";
  }

  if (path.startsWith("public/")) {
    return "public-asset";
  }

  if (path.endsWith(".md")) {
    return "docs";
  }

  if (
    path === ".env.example" ||
    path === ".gitignore" ||
    path === "cloudrun.service.yaml" ||
    path === "Dockerfile" ||
    path.endsWith(".config.mjs") ||
    path.endsWith(".config.ts") ||
    path === "tsconfig.json" ||
    path === "next-env.d.ts"
  ) {
    return "config";
  }

  return "unknown";
}

function scanSecrets(rootDir: string, files: SourceReleaseFilePlan[]): SourceReleaseSecretFinding[] {
  const findings: SourceReleaseSecretFinding[] = [];
  const scanTargets = files.filter((file) => file.releaseAction === "stage" && textFilePattern.test(file.path) && file.path !== "package-lock.json");

  for (const file of scanTargets) {
    const text = safeRead(rootDir, file.path);
    if (!text) {
      continue;
    }

    text.split(/\r?\n/u).forEach((line, index) => {
      findings.push(...scanLine(file.path, index + 1, line));
    });
  }

  return findings;
}

function scanLine(path: string, lineNumber: number, line: string): SourceReleaseSecretFinding[] {
  const findings: SourceReleaseSecretFinding[] = [];

  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(line)) {
    findings.push(secretFinding(path, lineNumber, "private-key", "critical", "Private key header detected."));
  }

  if (/AIza[0-9A-Za-z_-]{20,}/u.test(line)) {
    findings.push(secretFinding(path, lineNumber, "google-api-key", "critical", "Google API key-shaped value detected."));
  }

  if (/GOCSPX-[0-9A-Za-z_-]{20,}/u.test(line)) {
    findings.push(secretFinding(path, lineNumber, "google-oauth-client-secret", "critical", "Google OAuth client-secret-shaped value detected."));
  }

  if (/AKIA[0-9A-Z]{16}/u.test(line)) {
    findings.push(secretFinding(path, lineNumber, "aws-access-key", "high", "AWS access-key-shaped value detected."));
  }

  const assignment = line.match(/\b(?:api[_-]?key|token|secret|password)\b\s*[:=]\s*["']([^"']+)["']/iu);
  if (assignment?.[1] && secretValuePattern.test(assignment[1]) && !placeholderPattern.test(assignment[1])) {
    findings.push(secretFinding(path, lineNumber, "secret-assignment", "medium", "Secret-like assignment detected."));
  }

  return findings;
}

function secretFinding(
  path: string,
  line: number,
  detector: string,
  severity: SourceReleaseSecretFinding["severity"],
  evidence: string
): SourceReleaseSecretFinding {
  return {
    path,
    line,
    detector,
    severity,
    evidence,
    fix: "Remove the value from source, rotate it if it was real, and replace it with an environment variable or placeholder."
  };
}

function parseStatus(output: string): Array<{ status: SourceReleaseFilePlan["gitStatus"]; path: string }> {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const code = line.slice(0, 2);
      const path = line.slice(3).trim();
      const status: SourceReleaseFilePlan["gitStatus"] =
        code === "??" ? "untracked" : code.includes("D") ? "deleted" : code.trim() ? "modified" : "tracked";

      return { status, path };
    });
}

function summarizeCategories(files: SourceReleaseFilePlan[]) {
  const counts = files.reduce<Record<string, number>>((summary, file) => {
    summary[file.category] = (summary[file.category] ?? 0) + 1;
    return summary;
  }, {});

  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, count]) => `${category}: ${count}`)
    .join("; ");
}

function buildNextActions(
  input: {
    git: ProjectProvenanceGitSignals;
    files: SourceReleaseFilePlan[];
    secretFindings: SourceReleaseSecretFinding[];
  },
  overallStatus: SourceReleaseGuard["overallStatus"],
  blockers: string[]
) {
  if (blockers.length) {
    return blockers.slice(0, 6);
  }

  if (overallStatus === "ready-to-commit") {
    return [
      "Run the full local verification sequence.",
      "Review the file plan and stage only `releaseAction=stage` files.",
      input.git.commitCount > 0
        ? "Commit and push the intended source changes, then rerun source-release and provenance."
        : "Create the first source-release commit, then rerun provenance to verify first-commit timing and tracked source state."
    ];
  }

  return [
    "Push or share the repository URL for judges.",
    "Set XPRIZE_REPOSITORY_URL only after repository access is verified.",
    "Set XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED=true only after human review of the first-commit timestamp and disclosure text."
  ];
}

function runGit(rootDir: string, args: string[]) {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trimEnd();
}

function safeRead(rootDir: string, path: string) {
  try {
    return readFileSync(projectPath(rootDir, path), "utf8");
  } catch {
    return "";
  }
}

function projectPath(rootDir: string, path: string) {
  return rootDir === process.cwd() ? join(/*turbopackIgnore: true*/ process.cwd(), path) : join(rootDir, path);
}
