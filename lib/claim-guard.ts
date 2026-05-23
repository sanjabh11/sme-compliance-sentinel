import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ClaimGuardResult, ClaimGuardViolation } from "@/lib/types";

export const bannedComplianceClaims = [
  "SOC2 certified",
  "SOC 2 certified",
  "SOC2 compliant",
  "SOC 2 compliant",
  "guaranteed compliance",
  "legal advice",
  "audit assurance",
  "fully compliant",
  "violations prevented",
  "100% win",
  "100% confident this will win"
];

export const approvedCompliancePhrases = [
  "SOC2 readiness evidence",
  "SOC 2 readiness evidence",
  "risk detection",
  "risks detected",
  "staged remediation",
  "human-approved workflow",
  "redacted judge evidence",
  "mock sync reconciliation",
  "live proof still needs"
];

const defaultArtifactPaths = [
  "README.md",
  "WINNING_STRATEGY.md",
  "XPRIZE_CHECKLIST.md",
  ".env.example",
  "cloudrun.service.yaml",
  "app/dashboard-client.tsx",
  "app/api/approvals/ops/route.ts",
  "app/api/deal-impact/report/route.ts",
  "app/api/evidence/signed-packet/route.ts",
  "app/api/evidence/vault/route.ts",
  "app/api/evidence/vault/import/route.ts",
  "app/api/financial-evidence/ledger/route.ts",
  "app/api/market/positioning/route.ts",
  "app/api/pilots/conversion-kit/route.ts",
  "app/api/pilots/consent-packet/route.ts",
  "app/api/pilots/launch-plan/route.ts",
  "app/api/pilots/prospects/route.ts",
  "app/api/xprize/license-manifest/route.ts",
  "app/api/xprize/eligibility-disclosure/route.ts",
  "app/api/xprize/devpost-pack/route.ts",
  "app/api/xprize/demo-video-pack/route.ts",
  "app/api/xprize/judge-access-pack/route.ts",
  "app/api/xprize/source-release/route.ts",
  "app/api/xprize/submission-compliance/route.ts",
  "app/api/playbooks/route.ts",
  "app/api/production/cost-controls/route.ts",
  "app/api/production/deployment-evidence/route.ts",
  "app/api/production/deployment-packet/route.ts",
  "app/api/production/hosted-evidence/route.ts",
  "app/api/production/launch-readiness/route.ts",
  "app/api/workspace/sync/bootstrap/route.ts",
  "app/api/risk/score-history/route.ts",
  "app/api/trust-center/analytics/route.ts",
  "app/layout.tsx",
  "lib/readiness.ts",
  "lib/strategy.ts",
  "lib/hosted-evidence-capture.ts",
  "lib/workspace-sync.ts",
  "lib/admin-action-auth.ts",
  "lib/cloud-cost-controls.ts",
  "lib/cloudrun-deployment.ts",
  "lib/deployment-evidence-packet.ts",
  "lib/approval-ops.ts",
  "lib/deal-impact.ts",
  "lib/evidence-intake.ts",
  "lib/evidence-vault.ts",
  "lib/evidence-vault-import.ts",
  "lib/financial-evidence.ts",
  "lib/pilot-conversion.ts",
  "lib/pilot-consent.ts",
  "lib/pilot-launch.ts",
  "lib/prospect-pipeline.ts",
  "lib/production-launch.ts",
  "lib/playbooks.ts",
  "lib/risk-score.ts",
  "lib/source-release.ts",
  "lib/evidence.ts",
  "lib/trust-center.ts",
  "lib/questionnaire.ts",
  "lib/judge-access.ts",
  "lib/gemini.ts",
  "lib/demo-video.ts",
  "lib/devpost-submission.ts",
  "lib/eligibility-disclosure.ts",
  "lib/submission-binder.ts",
  "lib/submission-compliance.ts",
  "lib/license-manifest.ts",
  "lib/market-positioning.ts",
  "lib/framework-evidence.ts"
];

export function scanClaimText(input: { artifact: string; text: string }): ClaimGuardViolation[] {
  const lines = input.text.split(/\r?\n/u);
  const violations: ClaimGuardViolation[] = [];

  lines.forEach((line, index) => {
    const context = line.trim();
    if (!context) {
      return;
    }

    for (const phrase of bannedComplianceClaims) {
      if (!containsPhrase(context, phrase) || isAllowedContext(context)) {
        continue;
      }

      violations.push({
        location: `${input.artifact}:${index + 1}`,
        phrase,
        severity: severityForPhrase(phrase),
        context: truncateContext(context),
        fix: fixForPhrase(phrase)
      });
    }
  });

  return violations;
}

export function buildClaimGuardResult(input: Array<{ artifact: string; text: string }>, generatedAt = new Date().toISOString()): ClaimGuardResult {
  const violations = input.flatMap(scanClaimText);
  const warnings = buildWarnings(input);

  return {
    generatedAt,
    status: violations.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
    scannedArtifacts: input.length,
    bannedClaims: bannedComplianceClaims,
    approvedPhrases: approvedCompliancePhrases,
    violations,
    warnings,
    notes: [
      "This guard verifies product and submission copy only; it does not prove legal compliance or audit readiness.",
      "Banned phrases are allowed only in explicit negation, questionnaire prompts, or guardrail configuration contexts.",
      "Run before every judge export, demo script edit, and hosted release."
    ]
  };
}

export function buildRuntimeClaimGuardResult(): ClaimGuardResult {
  return buildClaimGuardResult([
    {
      artifact: "runtime-approved-copy",
      text: [
        "SME Workspace Sentinel provides SOC2 readiness evidence, risk detection, staged remediation, human-approved workflow, and redacted judge evidence.",
        "The product does not provide audit assurance, legal advice, certification, or a compliance guarantee.",
        "Live proof still needs real OAuth credentials, Google Cloud deployment evidence, and arms-length customer revenue."
      ].join("\n")
    }
  ]);
}

export async function scanRepositoryClaims(paths = defaultArtifactPaths, rootDir = process.cwd()): Promise<ClaimGuardResult> {
  const artifacts = await Promise.all(
    paths.map(async (path) => ({
      artifact: path,
      text: await readFile(join(rootDir, path), "utf8")
    }))
  );

  return buildClaimGuardResult(artifacts);
}

function containsPhrase(context: string, phrase: string) {
  return context.toLowerCase().includes(phrase.toLowerCase());
}

function isAllowedContext(context: string) {
  const normalized = context.toLowerCase();
  const explicitNegation =
    normalized.includes("not ") ||
    normalized.includes("do not") ||
    normalized.includes("does not") ||
    normalized.includes("without ") ||
    normalized.includes("no ");
  const guardrailConfig =
    normalized.includes("bannedclaims") ||
    normalized.includes("restrictedclaims") ||
    normalized.includes("banned phrases") ||
    normalized.includes("banned claim") ||
    normalized.includes("avoid") ||
    normalized.includes("instead of") ||
    normalized.includes("overclaims such as") ||
    normalized.includes("blocks phrases such as") ||
    normalized.includes("unsafe claims");
  const questionnairePrompt = normalized.includes("question:") || normalized.includes("are you soc2") || normalized.includes("are you soc 2");

  return explicitNegation || guardrailConfig || questionnairePrompt;
}

function buildWarnings(input: Array<{ artifact: string; text: string }>): ClaimGuardViolation[] {
  const requiredPhrases = ["SOC2 readiness evidence", "risk detection", "redacted judge evidence"];
  const joined = input.map((artifact) => artifact.text).join("\n").toLowerCase();

  return requiredPhrases
    .filter((phrase) => !joined.includes(phrase.toLowerCase()))
    .map((phrase) => ({
      location: "claim-guard",
      phrase,
      severity: "low",
      context: "Approved phrase missing from scanned artifacts.",
      fix: `Use "${phrase}" where the product explains scope, instead of stronger compliance claims.`
    }));
}

function severityForPhrase(phrase: string): ClaimGuardViolation["severity"] {
  if (phrase.includes("100%") || phrase.includes("guaranteed")) {
    return "critical";
  }

  if (phrase.includes("certified") || phrase.includes("compliant") || phrase.includes("legal advice") || phrase.includes("audit assurance")) {
    return "high";
  }

  return "medium";
}

function fixForPhrase(phrase: string) {
  if (phrase.includes("100%")) {
    return "Replace absolute win language with rule-readiness, current evidence, and remaining blockers.";
  }

  if (phrase.includes("violations prevented")) {
    return "Use risks detected, remediations approved, or public exposures closed.";
  }

  if (phrase.includes("certified") || phrase.includes("compliant")) {
    return "Use SOC2 readiness evidence and clearly state that certification requires an independent auditor.";
  }

  if (phrase.includes("legal advice") || phrase.includes("audit assurance")) {
    return "State that Sentinel provides operational evidence and not legal, audit, or certification advice.";
  }

  return "Replace with a narrower readiness or evidence phrase.";
}

function truncateContext(context: string) {
  return context.length > 220 ? `${context.slice(0, 217)}...` : context;
}
