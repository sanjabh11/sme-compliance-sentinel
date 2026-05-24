import packageJson from "@/package.json";
import { sentinelConfig } from "@/lib/config";
import { collectCloudRunDeploymentEvidence } from "@/lib/cloudrun-deployment";
import type {
  DeploymentEvidenceArtifact,
  DeploymentEvidenceCommand,
  DeploymentEvidencePacket,
  DeploymentEvidencePacketStatus,
  DeploymentRunbookStep,
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
  const artifactManifest = buildArtifactManifest({
    releaseId,
    privateEvidenceBucket,
    deploymentStatus: deployment.overallStatus
  });

  return {
    generatedAt,
    releaseId,
    status,
    productUrl,
    repositoryUrl,
    privateEvidenceBucket,
    deploymentStatus: deployment.overallStatus,
    artifactManifest,
    commandSequence,
    runbook: buildRunbook({ artifactManifest, commandSequence }),
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

function buildRunbook(input: {
  artifactManifest: DeploymentEvidenceArtifact[];
  commandSequence: DeploymentEvidenceCommand[];
}): DeploymentRunbookStep[] {
  const proofFiles = (...ids: string[]) =>
    ids.map((id) => input.artifactManifest.find((artifact) => artifact.id === id)?.privateStorePath ?? `missing:${id}`);
  const commandIds = (...ids: string[]) => input.commandSequence.filter((command) => ids.includes(command.id)).map((command) => command.id);

  return [
    runbookStep({
      id: "local-release-preflight",
      phase: "local-preflight",
      label: "Freeze source and local quality proof",
      ownerRole: "engineering",
      commandIds: commandIds("lint", "typecheck", "test", "build", "source-release", "provenance"),
      requiredArtifactIds: ["local-quality-gates-log", "source-release-json", "provenance-json"],
      proofFiles: proofFiles("local-quality-gates-log", "source-release-json", "provenance-json"),
      stopCondition: "Stop if source-release reports forbidden files, secret findings, untracked source, or provenance is not tied to the pushed repository.",
      redactionCheck: "Do not preserve shell history, environment dumps, local paths containing private customer names, or untracked evidence files.",
      nextStep: "Render the private Cloud Run manifest only after the source commit and release id are fixed.",
      externalProofRequired: false
    }),
    runbookStep({
      id: "render-and-verify-manifest",
      phase: "manifest-render",
      label: "Render and verify private Cloud Run manifest",
      ownerRole: "engineering",
      commandIds: commandIds(
        "cloudrun-render-values-audit",
        "cloudrun-render-manifest",
        "cloudrun-template-strict",
        "cloudrun-dry-run-preflight",
        "cloudrun-dry-run-packet-verify"
      ),
      requiredArtifactIds: [
        "cloudrun-render-values-audit-json",
        "cloudrun-render-evidence-packet-json",
        "cloudrun-render-summary-json",
        "cloudrun-manifest-verifier-json",
        "cloudrun-dry-run-preflight-json",
        "cloudrun-dry-run-packet-verifier-json"
      ],
      proofFiles: proofFiles(
        "cloudrun-render-values-audit-json",
        "cloudrun-render-evidence-packet-json",
        "cloudrun-render-summary-json",
        "cloudrun-manifest-verifier-json",
        "cloudrun-dry-run-preflight-json",
        "cloudrun-dry-run-packet-verifier-json"
      ),
      stopCondition:
        "Stop unless the render-values audit is ready-to-render, the rendered verifier status is ready-to-dry-run, and the dry-run packet verifier status is verified with zero digest drift.",
      redactionCheck:
        "Keep the filled values file, rendered manifest, and command files private; share only redacted audit/verifier status, Secret Manager lookup names, and release id.",
      nextStep: "Run the generated Cloud Run dry-run command from a private operator shell only after the preflight packet is ready-to-dry-run.",
      externalProofRequired: false
    }),
    runbookStep({
      id: "dry-run-and-deploy-cloudrun",
      phase: "cloud-deploy",
      label: "Dry-run, deploy, and capture Cloud Run revision",
      ownerRole: "engineering",
      commandIds: commandIds("cloudrun-dry-run", "cloudrun-deploy", "cloudrun-describe", "cloudrun-deployment-transcript-collect"),
      requiredArtifactIds: ["cloudrun-dry-run-log", "cloudrun-deploy-log", "cloudrun-describe-json", "cloudrun-deployment-transcript-packet-json"],
      proofFiles: proofFiles("cloudrun-dry-run-log", "cloudrun-deploy-log", "cloudrun-describe-json", "cloudrun-deployment-transcript-packet-json"),
      stopCondition: "Stop if dry-run fails, if the deployed revision uses a different image or service account, or if Secret Manager refs are missing.",
      redactionCheck: "Redact unrelated project metadata and any accidental env dumps; never include admin tokens, OAuth secrets, Gemini key values, or judge credentials.",
      nextStep: "Use the deployed URL for hosted read-only and write-through verification.",
      externalProofRequired: true
    }),
    runbookStep({
      id: "hosted-production-proof",
      phase: "hosted-proof",
      label: "Capture hosted product, AI, persistence, Workspace, and cost proof",
      ownerRole: "engineering",
      commandIds: commandIds("hosted-readonly", "hosted-write-through", "hosted-evidence", "hosted-proof-bundle"),
      requiredArtifactIds: [
        "verify-production-readonly-json",
        "verify-production-write-json",
        "hosted-evidence-json",
        "hosted-proof-bundle-manifest-json",
        "hosted-proof-release-evidence-json"
      ],
      proofFiles: proofFiles(
        "verify-production-readonly-json",
        "verify-production-write-json",
        "hosted-evidence-json",
        "hosted-proof-bundle-manifest-json",
        "hosted-proof-release-evidence-json"
      ),
      stopCondition:
        "Stop if hosted checks are local/mock-only, if Gemini proof is not provider=gemini-api, if GCP/Workspace write-through checks are blocked, or if hosted proof bundle release integrity is not passed.",
      redactionCheck: "Redact customer identifiers, Workspace resource ids, raw findings, tokens, and cloud response details before judge or Evidence Vault use.",
      nextStep: "Dry-run the hosted proof bundle import, then generate the deployment execution checklist before any confirmed Evidence Vault write.",
      externalProofRequired: true
    }),
    runbookStep({
      id: "redacted-evidence-vault-import",
      phase: "evidence-import",
      label: "Import redacted proof and prepare judge packet",
      ownerRole: "legal",
      commandIds: commandIds("hosted-proof-import-dry-run", "deployment-execution-checklist", "hosted-proof-import-confirm"),
      requiredArtifactIds: [
        "deployment-command-results-template-json",
        "deployment-execution-checklist-json",
        "evidence-vault-import-request-json",
        "evidence-vault-import-response-json"
      ],
      proofFiles: proofFiles(
        "deployment-command-results-template-json",
        "deployment-execution-checklist-json",
        "evidence-vault-import-request-json",
        "evidence-vault-import-response-json"
      ),
      stopCondition:
        "Stop if the deployment execution checklist is not passed, import input is not redacted, release integrity is not passed, checksums are missing, or customer consent and Devpost disclosure review are incomplete.",
      redactionCheck: "Share checksums, statuses, consent flags, and aggregate evidence; keep raw logs, invoices, security findings, and customer contact data private.",
      nextStep: "Attach release id, source commit, Cloud Run revision, checksums, demo video link, judge access instructions, and revenue/user evidence to Devpost.",
      externalProofRequired: true
    })
  ];
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
      id: "cloudrun-render-values-audit-json",
      label: "Cloud Run render-values audit packet",
      ownerRole: "engineering",
      status: localVerifierStatus,
      sourceCommand:
        "npm run audit:cloudrun-values -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --release-id $SENTINEL_RELEASE_ID --strict",
      privateStorePath: `${basePath}/cloudrun-render-values-audit.json`,
      evidenceVaultTarget: "cloud-run-proof",
      redactionRules: [
        "Keep the filled render-values file private; it can expose project ids, URLs, budget ids, and evidence-state decisions.",
        "Share only after reviewing valuesPath, project ids, URLs, billing ids, and manual evidence flags."
      ],
      nextAction: "Audit the private render-values file before rendering; stop if status is not ready-to-render and use the evidence packet to assign owner fixes."
    }),
    artifact({
      id: "cloudrun-render-evidence-packet-json",
      label: "Cloud Run render evidence owner packet",
      ownerRole: "engineering",
      status: localVerifierStatus,
      sourceCommand:
        "npm run audit:cloudrun-values -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --release-id $SENTINEL_RELEASE_ID --strict",
      privateStorePath: `${basePath}/cloudrun-render-evidence-packet.json`,
      evidenceVaultTarget: "cloud-run-proof",
      redactionRules: [
        "Keep owner queues, accepted-proof notes, and local paths private until redacted for judges.",
        "Do not share any filled values file, billing id, customer artifact, private testing instruction, or raw proof flag rationale publicly."
      ],
      nextAction:
        "Use the owner queues to clear requiredBeforeDryRun rows before rendering and to keep public XPRIZE proof flags false until private evidence exists."
    }),
    artifact({
      id: "cloudrun-render-summary-json",
      label: "Private rendered Cloud Run manifest bundle",
      ownerRole: "engineering",
      status: localVerifierStatus,
      sourceCommand:
        "npm run render:cloudrun-manifest -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --release-id $SENTINEL_RELEASE_ID --strict",
      privateStorePath: `${basePath}/cloudrun-render-summary.json`,
      evidenceVaultTarget: "cloud-run-proof",
      redactionRules: ["Use non-secret render values only; keep rendered manifest and command files private."],
      nextAction: "Render a private production candidate manifest and inspect verifier output before Cloud Run dry-run."
    }),
    artifact({
      id: "cloudrun-manifest-verifier-json",
      label: "Cloud Run manifest verifier JSON",
      ownerRole: "engineering",
      status: localVerifierStatus,
      sourceCommand: "npm run verify:cloudrun-deployment -- --manifest=artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun.service.rendered.yaml --strict",
      privateStorePath: `${basePath}/cloudrun-manifest-verifier.json`,
      evidenceVaultTarget: "cloud-run-proof",
      redactionRules: ["Keep Secret Manager names if useful, but never include secret values."],
      nextAction: "Render production placeholders and rerun until the manifest is ready for dry-run."
    }),
    artifact({
      id: "cloudrun-dry-run-preflight-json",
      label: "Cloud Run dry-run preflight packet",
      ownerRole: "engineering",
      status: localVerifierStatus,
      sourceCommand:
        "npm run prepare:cloudrun-dry-run -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --release-id $SENTINEL_RELEASE_ID --strict",
      privateStorePath: `${basePath}/cloudrun-dry-run-preflight-packet.json`,
      evidenceVaultTarget: "cloud-run-proof",
      redactionRules: ["Keep the filled values file private; share only the packet after human redaction review."],
      nextAction: "Generate immediately before Cloud Run dry-run and stop if status is not ready-to-dry-run."
    }),
    artifact({
      id: "cloudrun-dry-run-packet-verifier-json",
      label: "Cloud Run dry-run packet digest verifier JSON",
      ownerRole: "engineering",
      status: localVerifierStatus,
      sourceCommand:
        "npm run verify:cloudrun-dry-run-packet -- artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-dry-run-preflight-packet.json --strict",
      privateStorePath: `${basePath}/cloudrun-dry-run-packet-verifier.json`,
      evidenceVaultTarget: "cloud-run-proof",
      redactionRules: [
        "Keep local paths private if they reveal operator usernames or customer names.",
        "Share digest status, release id, matched counts, and stop conditions only after redaction review."
      ],
      nextAction: "Run immediately before Cloud Run dry-run and preserve the verifier JSON beside the preflight packet."
    }),
    artifact({
      id: "cloudrun-dry-run-log",
      label: "Cloud Run dry-run output",
      ownerRole: "engineering",
      status: "external-required",
      sourceCommand: "gcloud run services replace artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun.service.rendered.yaml --region REGION --project PROJECT_ID --dry-run",
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
      sourceCommand: "gcloud run services replace artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun.service.rendered.yaml --region REGION --project PROJECT_ID",
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
      id: "cloudrun-deployment-transcript-packet-json",
      label: "Redacted Cloud Run deployment transcript packet",
      ownerRole: "engineering",
      status: "external-required",
      sourceCommand:
        "npm run collect:cloudrun-deployment -- --release-id $SENTINEL_RELEASE_ID --dry-run-log /secure/local/cloudrun-dry-run.log --deploy-log /secure/local/cloudrun-deploy.log --describe-json /secure/local/cloudrun-describe.json --out-dir artifacts/deployment --strict",
      privateStorePath: `${basePath}/cloudrun-deployment-transcript-packet.json`,
      evidenceVaultTarget: "cloud-run-proof",
      redactionRules: [
        "Keep raw gcloud logs private; share only the redacted packet after reviewing project ids, service accounts, revision names, and env names.",
        "Do not import this as hosted proof until verify:production and hosted write-through checks have also run."
      ],
      nextAction: "Collect, redact, and checksum dry-run/deploy/describe outputs before hosted verification."
    }),
    artifact({
      id: "verify-production-readonly-json",
      label: "Hosted read-only production verification JSON",
      ownerRole: "engineering",
      status: "external-required",
      sourceCommand:
        "npm run verify:production -- --url https://YOUR-CLOUD-RUN-URL --release-id $SENTINEL_RELEASE_ID --strict --out /secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-readonly.json",
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
      sourceCommand:
        "npm run verify:production -- --url https://YOUR-CLOUD-RUN-URL --release-id $SENTINEL_RELEASE_ID --strict --include-write-checks --out /secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-write.json",
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
      id: "hosted-proof-bundle-manifest-json",
      label: "Hosted proof bundle manifest JSON",
      ownerRole: "engineering",
      status: "external-required",
      sourceCommand:
        "npm run collect:hosted-proof -- --url https://YOUR-CLOUD-RUN-URL --release-id $SENTINEL_RELEASE_ID --include-write-checks --strict",
      privateStorePath: `${basePath}/hosted-proof-bundle/manifest.json`,
      evidenceVaultTarget: "release-bound hosted proof bundle",
      redactionRules: [
        "Review every hosted bundle artifact before judge sharing; the collector redacts common secrets but cannot replace human review.",
        "Do not import the bundle if release integrity, proof-flag checks, or hosted write-through checks are blocked."
      ],
      nextAction: "Collect the release-bound hosted proof bundle after Cloud Run and hosted write-through verification."
    }),
    artifact({
      id: "hosted-proof-release-evidence-json",
      label: "Hosted proof release evidence manifest",
      ownerRole: "engineering",
      status: "external-required",
      sourceCommand:
        "npm run collect:hosted-proof -- --url https://YOUR-CLOUD-RUN-URL --release-id $SENTINEL_RELEASE_ID --include-write-checks --strict",
      privateStorePath: `${basePath}/hosted-proof-bundle/release-evidence-manifest.json`,
      evidenceVaultTarget: "release-integrity and proof-flag status",
      redactionRules: [
        "Share aggregate verified, needs-review, missing, mock-only, and transport-error statuses only after reviewing source artifact details.",
        "Keep customer evidence locations, raw Workspace ids, invoices, screenshots, and logs in the private store."
      ],
      nextAction: "Review release-integrity and proof-flag status before any Evidence Vault import."
    }),
    artifact({
      id: "evidence-vault-import-request-json",
      label: "Evidence Vault dry-run import request JSON",
      ownerRole: "legal",
      status: "external-required",
      sourceCommand:
        "npm run import:hosted-proof -- --bundle-dir artifacts/hosted-proof/$SENTINEL_RELEASE_ID --url https://YOUR-CLOUD-RUN-URL --dry-run",
      privateStorePath: `${basePath}/hosted-proof-bundle/evidence-vault-import-request.json`,
      evidenceVaultTarget: "redacted import request preview",
      redactionRules: ["Human-review the redacted request before making the hosted Evidence Vault write."],
      nextAction: "Run the dry-run import and confirm the request contains only redacted hosted verify:production JSON."
    }),
    artifact({
      id: "deployment-command-results-template-json",
      label: "Deployment command results template JSON",
      ownerRole: "engineering",
      status: "external-required",
      sourceCommand:
        "npm run prepare:deployment-execution-checklist -- --bundle-dir artifacts/hosted-proof/$SENTINEL_RELEASE_ID --write-results-template /secure/local/deployment-command-results.json",
      privateStorePath: `${basePath}/hosted-proof-bundle/deployment-command-results.json`,
      evidenceVaultTarget: "operator command-result template lineage",
      redactionRules: [
        "Keep the filled template outside source and free of credentials, raw customer data, security findings, invoices, and shell environment dumps.",
        "Preserve the generated template checksum and release id lineage so confirm-import cannot use a hand-written checklist."
      ],
      nextAction: "Generate the private command-results template after dry-run import and before filling command outcomes."
    }),
    artifact({
      id: "deployment-execution-checklist-json",
      label: "Deployment execution checklist JSON",
      ownerRole: "engineering",
      status: "external-required",
      sourceCommand:
        "npm run prepare:deployment-execution-checklist -- --bundle-dir artifacts/hosted-proof/$SENTINEL_RELEASE_ID --write-results-template /secure/local/deployment-command-results.json, then fill the private template and run npm run prepare:deployment-execution-checklist -- --bundle-dir artifacts/hosted-proof/$SENTINEL_RELEASE_ID --results /secure/local/deployment-command-results.json --strict",
      privateStorePath: `${basePath}/hosted-proof-bundle/deployment-execution-checklist.json`,
      evidenceVaultTarget: "operator command-result ledger",
      redactionRules: [
        "Keep operator result notes free of credentials, raw customer data, security findings, invoices, and shell environment dumps.",
        "Record every required command result with release id, timestamp, expected artifact path, and private evidence path before confirmed hosted proof import."
      ],
      nextAction: "Generate and pass the deployment execution checklist after dry-run import and before confirm-import."
    }),
    artifact({
      id: "evidence-vault-import-response-json",
      label: "Evidence Vault import response JSON",
      ownerRole: "legal",
      status: "external-required",
      sourceCommand:
        "npm run import:hosted-proof -- --bundle-dir artifacts/hosted-proof/$SENTINEL_RELEASE_ID --url https://YOUR-CLOUD-RUN-URL --confirm-import",
      privateStorePath: `${basePath}/hosted-proof-bundle/evidence-vault-import-response.json`,
      evidenceVaultTarget: "checksummed private artifact records",
      redactionRules: ["Share checksums and status only; keep raw imported JSON in the private store."],
      nextAction: "Import the hosted proof bundle only after dry-run review, redaction review, and release-integrity pass."
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
    ),
    command(
      "cloudrun-render-values-audit",
      "Audit private Cloud Run render values",
      "npm run audit:cloudrun-values -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --release-id $SENTINEL_RELEASE_ID --strict",
      false,
      false,
      "cloudrun-render-values-audit-json",
      "Writes the private render-values audit; do not render unless status is ready-to-render."
    ),
    command(
      "cloudrun-render-manifest",
      "Render private Cloud Run manifest",
      "npm run render:cloudrun-manifest -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --release-id $SENTINEL_RELEASE_ID --strict",
      false,
      false,
      "cloudrun-render-summary-json",
      "Uses non-secret render values only; generated manifest stays ignored and private."
    ),
    command(
      "cloudrun-template-strict",
      "Validate Cloud Run manifest",
      "npm run verify:cloudrun-deployment -- --manifest=artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun.service.rendered.yaml --strict",
      false,
      false,
      "cloudrun-manifest-verifier-json",
      "Store output privately; a template-needs-values result is not hosted proof."
    ),
    command(
      "cloudrun-dry-run-preflight",
      "Prepare Cloud Run dry-run preflight packet",
      "npm run prepare:cloudrun-dry-run -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --release-id $SENTINEL_RELEASE_ID --strict",
      false,
      false,
      "cloudrun-dry-run-preflight-json",
      "Writes the private preflight packet and redaction checklist; do not dry-run unless status is ready-to-dry-run."
    ),
    command(
      "cloudrun-dry-run-packet-verify",
      "Verify Cloud Run dry-run packet digests",
      "npm run verify:cloudrun-dry-run-packet -- artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun-dry-run-preflight-packet.json --strict",
      false,
      false,
      "cloudrun-dry-run-packet-verifier-json",
      "Rechecks rendered manifest bundle SHA-256 digests immediately before dry-run; regenerate the preflight packet if any file drifted."
    ),
    command(
      "cloudrun-dry-run",
      "Cloud Run dry-run",
      `gcloud run services replace artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun.service.rendered.yaml --region ${input.region} --project ${input.projectId} --dry-run`,
      false,
      false,
      "cloudrun-dry-run-log",
      "Run after manifest values are rendered; preserve output privately."
    ),
    command(
      "cloudrun-deploy",
      "Deploy Cloud Run service",
      `gcloud run services replace artifacts/deployment/$SENTINEL_RELEASE_ID/cloudrun.service.rendered.yaml --region ${input.region} --project ${input.projectId}`,
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
      "cloudrun-deployment-transcript-collect",
      "Collect redacted Cloud Run deployment transcript packet",
      "npm run collect:cloudrun-deployment -- --release-id $SENTINEL_RELEASE_ID --dry-run-log /secure/local/cloudrun-dry-run.log --deploy-log /secure/local/cloudrun-deploy.log --describe-json /secure/local/cloudrun-describe.json --out-dir artifacts/deployment --strict",
      false,
      false,
      "cloudrun-deployment-transcript-packet-json",
      "Writes a redacted, checksummed transcript packet from operator-saved gcloud dry-run/deploy/describe outputs."
    ),
    command(
      "hosted-readonly",
      "Hosted read-only verification",
      `npm run verify:production -- --url ${input.productUrl} --release-id $SENTINEL_RELEASE_ID --strict --out /secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-readonly.json`,
      false,
      false,
      "verify-production-readonly-json",
      "Read-only hosted smoke report; keep full JSON private."
    ),
    command(
      "hosted-write-through",
      "Hosted write-through verification",
      `npm run verify:production -- --url ${input.productUrl} --release-id $SENTINEL_RELEASE_ID --strict --include-write-checks --out /secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-write.json`,
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
      "hosted-proof-bundle",
      "Collect release-bound hosted proof bundle",
      `npm run collect:hosted-proof -- --url ${input.productUrl} --release-id $SENTINEL_RELEASE_ID --include-write-checks --strict`,
      true,
      true,
      "hosted-proof-bundle-manifest-json",
      "Collects hosted proof, release-integrity checks, proof-flag checks, and redacted bundle artifacts before Evidence Vault import."
    ),
    command(
      "hosted-proof-import-dry-run",
      "Dry-run hosted proof import",
      `npm run import:hosted-proof -- --bundle-dir artifacts/hosted-proof/$SENTINEL_RELEASE_ID --url ${input.productUrl} --dry-run`,
      false,
      false,
      "evidence-vault-import-request-json",
      "Writes the redacted Evidence Vault import request without contacting the hosted app."
    ),
    command(
      "deployment-execution-checklist",
      "Prepare deployment execution checklist",
      "npm run prepare:deployment-execution-checklist -- --bundle-dir artifacts/hosted-proof/$SENTINEL_RELEASE_ID --write-results-template /secure/local/deployment-command-results.json && npm run prepare:deployment-execution-checklist -- --bundle-dir artifacts/hosted-proof/$SENTINEL_RELEASE_ID --results /secure/local/deployment-command-results.json --strict",
      false,
      false,
      "deployment-execution-checklist-json",
      "Records each required deployment command result after dry-run import and before confirmed hosted proof import; keep the private results file outside source."
    ),
    command(
      "hosted-proof-import-confirm",
      "Import hosted proof bundle",
      `npm run import:hosted-proof -- --bundle-dir artifacts/hosted-proof/$SENTINEL_RELEASE_ID --url ${input.productUrl} --confirm-import`,
      true,
      true,
      "evidence-vault-import-response-json",
      "Imports metadata into the hosted Evidence Vault only after bundle release integrity and dry-run review pass."
    ),
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
    `Run ${input.commandSequence[0].command}, ${input.commandSequence[1].command}, ${input.commandSequence[2].command}, ${input.commandSequence[3].command}, and ${input.commandSequence[4].command} before deployment.`,
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

function runbookStep(input: DeploymentRunbookStep): DeploymentRunbookStep {
  return input;
}

function isPlaceholder(value: string) {
  return !value || value.includes("YOUR") || value.includes("PROJECT_ID") || value.includes("RELEASE_ID");
}
