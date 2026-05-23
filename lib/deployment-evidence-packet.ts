import packageJson from "@/package.json";
import { sentinelConfig } from "@/lib/config";
import { collectCloudRunDeploymentEvidence } from "@/lib/cloudrun-deployment";
import type {
  DeploymentEvidenceArtifact,
  DeploymentEvidenceCommand,
  DeploymentEvidencePacket,
  DeploymentEvidencePacketStatus,
  EvidenceVaultImportRequest
} from "@/lib/types";

const placeholderProductUrl = "https://YOUR-CLOUD-RUN-URL";
const placeholderReleaseId = "RELEASE_ID";
const placeholderPrivateBucket = "gs://PROJECT_ID-sentinel-private-evidence";

export function buildDeploymentEvidencePacket(): DeploymentEvidencePacket {
  const generatedAt = new Date().toISOString();
  const deployment = collectCloudRunDeploymentEvidence();
  const releaseId = sentinelConfig.releaseId || placeholderReleaseId;
  const productUrl = sentinelConfig.productUrl || placeholderProductUrl;
  const repositoryUrl = sentinelConfig.repositoryUrl || packageJson.repository?.url || "missing";
  const privateEvidenceBucket = sentinelConfig.privateEvidenceBucket || placeholderPrivateBucket;
  const configGaps = buildConfigGaps({ releaseId, productUrl, repositoryUrl, privateEvidenceBucket });
  const secretGaps = sentinelConfig.adminActionTokenConfigured
    ? []
    : ["SENTINEL_ADMIN_ACTION_TOKEN must be configured in Secret Manager before write-through proof capture or hosted Evidence Vault imports."];
  const blockers = deployment.blockers.map((blocker) => `Cloud Run manifest: ${blocker}`);
  const setupGaps = [...configGaps, ...secretGaps];
  const status = packetStatus({ deploymentStatus: deployment.overallStatus, blockers, configGaps: setupGaps });
  const commandSequence = buildCommandSequence({
    productUrl,
    projectId: sentinelConfig.googleCloudProject || "PROJECT_ID",
    region: sentinelConfig.cloudRunRegion,
    serviceName: sentinelConfig.cloudRunServiceName
  });

  return {
    generatedAt,
    releaseId,
    status,
    productUrl,
    repositoryUrl,
    privateEvidenceBucket,
    deploymentStatus: deployment.overallStatus,
    artifactManifest: buildArtifactManifest({ releaseId, privateEvidenceBucket, deploymentStatus: deployment.overallStatus }),
    commandSequence,
    evidenceVaultImportTemplate: buildEvidenceVaultImportTemplate({ generatedAt, releaseId, productUrl, repositoryUrl, privateEvidenceBucket }),
    redactionChecklist: [
      "Remove admin tokens, OAuth client secrets, refresh tokens, Drive channel tokens, Gemini API key values, and raw Authorization headers.",
      "Replace customer names, emails, file names, invoices, payment ids, security findings, and Workspace resource ids with aliases before judge sharing.",
      "Keep full Cloud Run logs, gcloud describe output, billing proof, and hosted write-through JSON in the private evidence store.",
      "Public Devpost copy should cite aggregate statuses and the hosted workflow, not raw tenant security details."
    ],
    blockers,
    nextActions: buildNextActions({ status, configGaps: setupGaps, commandSequence }),
    privateHandling: [
      "This packet is an operator checklist and import template; it is not a substitute for real Cloud Run, Gemini, GCP, Workspace, or paid-pilot proof.",
      "Run mutating commands only from a private operator shell after production secrets and tenant consent are configured.",
      "Register only redacted JSON in the Evidence Vault; keep original logs in the private evidence bucket or equivalent controlled storage.",
      "Use the release id to tie source commit, Cloud Run revision, hosted verification JSON, Evidence Vault import response, and Devpost evidence together."
    ],
    disclaimer:
      "Deployment evidence remains pending until the command sequence is executed against the hosted product and the resulting redacted artifacts are registered with checksums."
  };
}

function buildConfigGaps(input: {
  releaseId: string;
  productUrl: string;
  repositoryUrl: string;
  privateEvidenceBucket: string;
}) {
  return [
    ...(isPlaceholder(input.releaseId) ? ["SENTINEL_RELEASE_ID must be replaced with the release id used for Cloud Run and source proof."] : []),
    ...(isPlaceholder(input.productUrl) ? ["NEXT_PUBLIC_PRODUCT_URL must be set to the hosted Cloud Run URL before hosted proof capture."] : []),
    ...(input.repositoryUrl === "missing" ? ["XPRIZE_REPOSITORY_URL or package repository URL must identify the judge-accessible source repository."] : []),
    ...(isPlaceholder(input.privateEvidenceBucket)
      ? ["SENTINEL_PRIVATE_EVIDENCE_BUCKET must point to the private store for logs, screenshots, invoices, and judge artifacts."]
      : [])
  ];
}

function packetStatus(input: {
  deploymentStatus: DeploymentEvidencePacket["deploymentStatus"];
  blockers: string[];
  configGaps: string[];
}): DeploymentEvidencePacketStatus {
  if (input.blockers.length || input.deploymentStatus === "blocked") {
    return "blocked";
  }

  if (input.configGaps.length || input.deploymentStatus === "template-needs-values") {
    return "template-needs-values";
  }

  return "ready-to-capture";
}

function buildArtifactManifest(input: {
  releaseId: string;
  privateEvidenceBucket: string;
  deploymentStatus: DeploymentEvidencePacket["deploymentStatus"];
}): DeploymentEvidenceArtifact[] {
  const basePath = `${input.privateEvidenceBucket.replace(/\/$/u, "")}/releases/${input.releaseId}`;
  const localVerifierStatus = input.deploymentStatus === "blocked" ? "missing" : "ready";

  return [
    artifact({
      id: "local-quality-gates-log",
      label: "Local quality gate transcript",
      ownerRole: "engineering",
      status: "ready",
      sourceCommand: "npm run lint && npm run typecheck && npm test && npm run build",
      privateStorePath: `${basePath}/local-quality-gates.log`,
      evidenceVaultTarget: "release-readiness transcript",
      redactionRules: ["Do not include local env values or shell history."],
      nextAction: "Run all local checks and store the terminal transcript before deployment."
    }),
    artifact({
      id: "cloudrun-manifest-verifier-json",
      label: "Cloud Run manifest verifier JSON",
      ownerRole: "engineering",
      status: localVerifierStatus,
      sourceCommand: "npm run verify:cloudrun-deployment -- --strict",
      privateStorePath: `${basePath}/cloudrun-manifest-verifier.json`,
      evidenceVaultTarget: "cloud-run-proof",
      redactionRules: ["Keep Secret Manager names if useful, but never include secret values."],
      nextAction: "Render production placeholders and rerun until the manifest is ready for dry-run."
    }),
    artifact({
      id: "cloudrun-dry-run-log",
      label: "Cloud Run dry-run output",
      ownerRole: "engineering",
      status: "external-required",
      sourceCommand: "gcloud run services replace cloudrun.service.yaml --region REGION --project PROJECT_ID --dry-run",
      privateStorePath: `${basePath}/cloudrun-dry-run.log`,
      evidenceVaultTarget: "cloud-run-proof",
      redactionRules: ["Redact unrelated project ids and internal notes if present."],
      nextAction: "Run the dry-run after placeholders are rendered and preserve output privately."
    }),
    artifact({
      id: "cloudrun-deploy-log",
      label: "Cloud Run deploy output",
      ownerRole: "engineering",
      status: "external-required",
      sourceCommand: "gcloud run services replace cloudrun.service.yaml --region REGION --project PROJECT_ID",
      privateStorePath: `${basePath}/cloudrun-deploy.log`,
      evidenceVaultTarget: "cloud-run-proof",
      redactionRules: ["Do not include judge credentials, shell env dumps, or secret payloads."],
      nextAction: "Deploy the service and preserve the revision URL and revision id."
    }),
    artifact({
      id: "cloudrun-describe-json",
      label: "Cloud Run service describe JSON",
      ownerRole: "engineering",
      status: "external-required",
      sourceCommand: "gcloud run services describe sme-workspace-sentinel --region REGION --project PROJECT_ID --format=json",
      privateStorePath: `${basePath}/cloudrun-describe.json`,
      evidenceVaultTarget: "cloud-run-proof",
      redactionRules: ["Review service-account and env metadata before sharing outside the private packet."],
      nextAction: "Capture the deployed service identity, URL, revision, image, and Secret Manager references."
    }),
    artifact({
      id: "verify-production-readonly-json",
      label: "Hosted read-only production verification JSON",
      ownerRole: "engineering",
      status: "external-required",
      sourceCommand: "npm run verify:production -- --url https://YOUR-CLOUD-RUN-URL --strict",
      privateStorePath: `${basePath}/verify-production-readonly.json`,
      evidenceVaultTarget: "production-readiness-report",
      redactionRules: ["Keep route names and statuses; redact internal ids if present."],
      nextAction: "Run against the hosted Cloud Run URL after deployment."
    }),
    artifact({
      id: "verify-production-write-json",
      label: "Hosted write-through production verification JSON",
      ownerRole: "engineering",
      status: "external-required",
      sourceCommand: "npm run verify:production -- --url https://YOUR-CLOUD-RUN-URL --strict --include-write-checks",
      privateStorePath: `${basePath}/verify-production-write.json`,
      evidenceVaultTarget: "production-readiness-report",
      redactionRules: ["Redact tokens, raw Workspace content, customer ids, and raw cloud responses before importing."],
      nextAction: "Run only after admin token, GCP persistence, Gemini, Workspace, and cost-control settings are configured."
    }),
    artifact({
      id: "hosted-evidence-json",
      label: "Hosted evidence capture JSON",
      ownerRole: "engineering",
      status: "external-required",
      sourceCommand: "curl -s https://YOUR-CLOUD-RUN-URL/api/production/hosted-evidence",
      privateStorePath: `${basePath}/hosted-evidence.json`,
      evidenceVaultTarget: "hosted-evidence import candidates",
      redactionRules: ["Confirm customer names and private proof locations are redacted before judge sharing."],
      nextAction: "Capture after hosted checks and proof imports have run."
    }),
    artifact({
      id: "evidence-vault-import-response-json",
      label: "Evidence Vault import response JSON",
      ownerRole: "legal",
      status: "external-required",
      sourceCommand: "curl -s -X POST https://YOUR-CLOUD-RUN-URL/api/evidence/vault/import -H 'content-type: application/json' -H 'x-sentinel-admin-token: $SENTINEL_ADMIN_ACTION_TOKEN' --data @/secure/local/redacted-verify-production.json",
      privateStorePath: `${basePath}/evidence-vault-import-response.json`,
      evidenceVaultTarget: "checksummed private artifact records",
      redactionRules: ["Share checksums and status only; keep raw imported JSON in the private store."],
      nextAction: "Import redacted verification JSON and confirm checksummed artifact records are created."
    }),
    artifact({
      id: "source-release-json",
      label: "Source release guard JSON",
      ownerRole: "engineering",
      status: "ready",
      sourceCommand: "npm run verify:source-release",
      privateStorePath: `${basePath}/source-release.json`,
      evidenceVaultTarget: "source-code proof",
      redactionRules: ["Do not attach private env files or untracked customer evidence."],
      nextAction: "Run before every source push and before final Devpost source review."
    }),
    artifact({
      id: "provenance-json",
      label: "Project provenance JSON",
      ownerRole: "founder",
      status: "ready",
      sourceCommand: "npm run verify:provenance",
      privateStorePath: `${basePath}/project-provenance.json`,
      evidenceVaultTarget: "repository proof",
      redactionRules: ["Review repository URL and disclosure text before public submission."],
      nextAction: "Run after pushing the final source commit."
    })
  ];
}

function buildCommandSequence(input: {
  productUrl: string;
  projectId: string;
  region: string;
  serviceName: string;
}): DeploymentEvidenceCommand[] {
  return [
    command("lint", "Lint", "npm run lint", false, false, "local-quality-gates-log", "Safe local quality gate."),
    command("typecheck", "Typecheck", "npm run typecheck", false, false, "local-quality-gates-log", "Safe local quality gate."),
    command("test", "Unit tests", "npm test", false, false, "local-quality-gates-log", "Safe local quality gate."),
    command("build", "Production build", "npm run build", false, false, "local-quality-gates-log", "Safe local quality gate."),
    command(
      "cloudrun-template-strict",
      "Validate Cloud Run manifest",
      "npm run verify:cloudrun-deployment -- --strict",
      false,
      false,
      "cloudrun-manifest-verifier-json",
      "Store output privately; a template-needs-values result is not hosted proof."
    ),
    command(
      "cloudrun-dry-run",
      "Cloud Run dry-run",
      `gcloud run services replace cloudrun.service.yaml --region ${input.region} --project ${input.projectId} --dry-run`,
      false,
      false,
      "cloudrun-dry-run-log",
      "Run after manifest values are rendered; preserve output privately."
    ),
    command(
      "cloudrun-deploy",
      "Deploy Cloud Run service",
      `gcloud run services replace cloudrun.service.yaml --region ${input.region} --project ${input.projectId}`,
      true,
      false,
      "cloudrun-deploy-log",
      "Mutates the production service; run only from the approved operator shell."
    ),
    command(
      "cloudrun-describe",
      "Capture Cloud Run service state",
      `gcloud run services describe ${input.serviceName} --region ${input.region} --project ${input.projectId} --format=json`,
      false,
      false,
      "cloudrun-describe-json",
      "Review env metadata before sharing outside the private judge packet."
    ),
    command(
      "hosted-readonly",
      "Hosted read-only verification",
      `npm run verify:production -- --url ${input.productUrl} --strict`,
      false,
      false,
      "verify-production-readonly-json",
      "Read-only hosted smoke report; keep full JSON private."
    ),
    command(
      "hosted-write-through",
      "Hosted write-through verification",
      `npm run verify:production -- --url ${input.productUrl} --strict --include-write-checks`,
      true,
      true,
      "verify-production-write-json",
      "Requires the private admin token in the operator shell; do not paste it into source or screenshots."
    ),
    command(
      "hosted-evidence",
      "Hosted evidence packet",
      `curl -s ${input.productUrl}/api/production/hosted-evidence`,
      false,
      false,
      "hosted-evidence-json",
      "Capture after the hosted proof artifacts have been generated or imported."
    ),
    command(
      "vault-import",
      "Import redacted verification JSON",
      `curl -s -X POST ${input.productUrl}/api/evidence/vault/import -H 'content-type: application/json' -H 'x-sentinel-admin-token: $SENTINEL_ADMIN_ACTION_TOKEN' --data @/secure/local/redacted-verify-production.json`,
      true,
      true,
      "evidence-vault-import-response-json",
      "Imports metadata into the hosted Evidence Vault; keep raw JSON and token private."
    ),
    command(
      "source-release",
      "Source release guard",
      "npm run verify:source-release",
      false,
      false,
      "source-release-json",
      "Run before final source push and judge review."
    ),
    command(
      "provenance",
      "Project provenance report",
      "npm run verify:provenance",
      false,
      false,
      "provenance-json",
      "Run after the final source commit is pushed."
    )
  ];
}

function buildEvidenceVaultImportTemplate(input: {
  generatedAt: string;
  releaseId: string;
  productUrl: string;
  repositoryUrl: string;
  privateEvidenceBucket: string;
}): EvidenceVaultImportRequest {
  return {
    source: "verify-production",
    redacted: true,
    sourceUrl: input.productUrl,
    ownerNote: `Template for release ${input.releaseId}; source ${input.repositoryUrl}; private store ${input.privateEvidenceBucket}. Replace payload with redacted hosted verify:production JSON before import.`,
    payload: {
      generatedAt: input.generatedAt,
      baseUrl: input.productUrl,
      mode: "read-and-write-through",
      strict: true,
      releaseId: input.releaseId,
      summary: {
        total: 0,
        passedTransport: 0,
        failedTransport: 0,
        blockedOrNeedsReview: 0
      },
      results: []
    }
  };
}

function buildNextActions(input: {
  status: DeploymentEvidencePacketStatus;
  configGaps: string[];
  commandSequence: DeploymentEvidenceCommand[];
}) {
  if (input.status === "blocked") {
    return ["Clear Cloud Run manifest blockers and configure the production admin action token before write-through proof capture."];
  }

  if (input.configGaps.length) {
    return input.configGaps;
  }

  return [
    `Run ${input.commandSequence[0].command}, ${input.commandSequence[1].command}, ${input.commandSequence[2].command}, and ${input.commandSequence[3].command} before deployment.`,
    "Execute the Cloud Run dry-run and deploy commands from a private operator shell.",
    "Run hosted read-only and write-through verification, redact the JSON, then import it into the Evidence Vault.",
    "Attach the release id, source commit, Cloud Run revision, checksums, and final Devpost testing instructions to the private judge packet."
  ];
}

function artifact(input: DeploymentEvidenceArtifact): DeploymentEvidenceArtifact {
  return input;
}

function command(
  id: string,
  label: string,
  commandText: string,
  mutatesProduction: boolean,
  requiresAdminToken: boolean,
  expectedArtifactId: string,
  privateHandling: string
): DeploymentEvidenceCommand {
  return {
    id,
    label,
    command: commandText,
    mutatesProduction,
    requiresAdminToken,
    expectedArtifactId,
    privateHandling
  };
}

function isPlaceholder(value: string) {
  return !value || value.includes("YOUR") || value.includes("PROJECT_ID") || value.includes("RELEASE_ID");
}
