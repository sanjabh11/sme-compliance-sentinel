import { demoVideoClearanceSummary, judgeProductAccessSummary, sentinelConfig } from "@/lib/config";
import { buildThirdPartyManifest } from "@/lib/license-manifest";
import { buildSubmissionComplianceCenter } from "@/lib/submission-compliance";
import { hasLiveWorkspaceSyncEvidence } from "@/lib/workspace-sync";
import { buildXPrizeSubmissionGate } from "@/lib/xprize-gate";
import type {
  DashboardSnapshot,
  DemoScriptScene,
  DevpostCopySection,
  DevpostEvidenceReadinessExport,
  DevpostEvidenceReadinessItem,
  DevpostSubmissionPack,
  DevpostSubmissionStatus,
  SubmissionEvidenceStatus,
  SubmissionPrivateEvidenceRequest,
  SubmissionScreenshotItem
} from "@/lib/types";

type DevpostSnapshot = Pick<
  DashboardSnapshot,
  | "tenant"
  | "connections"
  | "syncState"
  | "agentRuns"
  | "auditEvents"
  | "pilotRecords"
  | "pilotProspects"
  | "aggregateCounters"
  | "findings"
  | "remediations"
  | "trustPackets"
  | "questionnairePacks"
>;

export function buildDevpostSubmissionPack(snapshot: DevpostSnapshot): DevpostSubmissionPack {
  const generatedAt = new Date().toISOString();
  const gate = buildXPrizeSubmissionGate(snapshot);
  const compliance = buildSubmissionComplianceCenter(snapshot);
  const thirdPartyManifest = buildThirdPartyManifest();
  const privateEvidenceResponse = buildPrivateEvidenceResponse(snapshot);
  const blockers = [
    ...gate.blockingSummary,
    ...compliance.checks.filter((check) => check.status === "blocked").map((check) => `${check.label}: ${check.fix}`),
    ...thirdPartyManifest.blockers
  ];
  const overallStatus = resolveOverallStatus({
    blocked: blockers.length,
    warnings: compliance.summary.warning + (thirdPartyManifest.summary.status === "warning" ? 1 : 0)
  });

  return {
    generatedAt,
    overallStatus,
    title: "SME Workspace Sentinel",
    tagline: "A one-day Google Workspace risk desk for small businesses preparing enterprise security reviews.",
    category: snapshot.tenant.category,
    publicDescription: buildPublicDescription(snapshot, blockers),
    problem: buildProblemSection(snapshot),
    solution: buildSolutionSection(snapshot),
    googleStack: buildGoogleStackSection(snapshot),
    businessModel: buildBusinessModelSection(snapshot),
    tractionEvidence: buildTractionSection(snapshot),
    demoVideoScript: buildDemoVideoScript(snapshot),
    screenshotChecklist: buildScreenshotChecklist(snapshot),
    testingInstructionsDraft: buildTestingInstructionsDraft(),
    privateEvidenceResponse,
    evidenceReadinessExport: buildEvidenceReadinessExport(snapshot, {
      generatedAt,
      gate,
      compliance,
      thirdPartyManifest,
      privateEvidenceResponse
    }),
    claimBoundaries: [
      "Use SOC2 readiness evidence, risk detection, staged remediation, human-approved remediation, and redacted judge evidence language.",
      "Do not state or imply certification, auditor opinion, guaranteed outcomes, or certainty of winning.",
      "Show seeded local data as product demonstration only until production evidence mode, durable storage, live Gemini logs, live Workspace sync, and paid customer proof are present.",
      "Keep customer names, sensitive findings, invoices, credentials, and testimonials with no explicit consent out of public materials.",
      "Mention Antigravity only as optional development tooling if actually used; the product architecture relies on Google Cloud and Gemini API requirements."
    ],
    blockers,
    nextActions: buildNextActions(blockers, compliance.nextActions, thirdPartyManifest.nextActions),
    disclaimer:
      "This pack prepares Devpost-facing copy, demo flow, screenshots, and private evidence responses. It does not replace final human review, production deployment proof, customer consent checks, or Devpost field submission."
  };
}

function buildEvidenceReadinessExport(
  snapshot: DevpostSnapshot,
  deps: {
    generatedAt: string;
    gate: ReturnType<typeof buildXPrizeSubmissionGate>;
    compliance: ReturnType<typeof buildSubmissionComplianceCenter>;
    thirdPartyManifest: ReturnType<typeof buildThirdPartyManifest>;
    privateEvidenceResponse: SubmissionPrivateEvidenceRequest[];
  }
): DevpostEvidenceReadinessExport {
  const gateById = new Map(deps.gate.checks.map((check) => [check.id, check]));
  const complianceById = new Map(deps.compliance.checks.map((check) => [check.id, check]));
  const privateEvidenceById = new Map(deps.privateEvidenceResponse.map((request) => [request.id, request]));
  const categoryStatus =
    statusFromGate(gateById.get("category-small-business")?.status) === "ready"
      ? snapshot.agentRuns.length
        ? "ready"
        : "needs-review"
      : "blocked";
  const googleStackStatus = worstStatus([
    statusFromGate(gateById.get("google-cloud-product")?.status),
    statusFromGate(gateById.get("gemini-api-production")?.status)
  ]);
  const realUserStatus = worstStatus([
    statusFromEvidenceStatus(privateEvidenceById.get("real-user-evidence")?.status),
    statusFromGate(gateById.get("related-party-separation")?.status)
  ]);
  const productionOperationStatus = worstStatus([
    statusFromEvidenceStatus(privateEvidenceById.get("ai-operation-proof")?.status),
    statusFromEvidenceStatus(privateEvidenceById.get("gcp-production-proof")?.status),
    statusFromEvidenceStatus(privateEvidenceById.get("workspace-sync-proof")?.status)
  ]);
  const ipStatus = worstStatus([
    statusFromCompliance(complianceById.get("third-party-license-manifest")?.status),
    statusFromCompliance(complianceById.get("submission-ip-ownership")?.status),
    statusFromManifest(deps.thirdPartyManifest.summary.status)
  ]);

  const checklist: DevpostEvidenceReadinessItem[] = [
    {
      id: "category-ai-workflow",
      label: "Category fit and AI workflow transformation",
      ruleArea: "Category Impact",
      status: categoryStatus,
      source: "/api/xprize/submission-gate",
      publicSafeEvidence:
        categoryStatus === "ready"
          ? "Small Business Services positioning and AI-assisted scan-to-recommendation workflow are visible in the product."
          : "Category positioning is present, but the final submission still needs a fresh visible workflow run before recording.",
      privateProofNeeded:
        categoryStatus === "ready"
          ? []
          : ["Capture a current scan, recommendation, approval, and audit trail before final submission."],
      redactionRule: "Use seeded or redacted Workspace examples; do not show customer file names, domains, or private findings.",
      ownerRole: "founder"
    },
    {
      id: "google-cloud-gemini",
      label: "Google Cloud product and deployed Gemini API call",
      ruleArea: "Project Requirements",
      status: googleStackStatus,
      source: "/api/xprize/submission-gate",
      publicSafeEvidence:
        googleStackStatus === "ready"
          ? "Production proof shows Google Cloud infrastructure and at least one deployed Gemini API semantic audit."
          : "Local proof describes the intended Cloud Run, Firestore, BigQuery, Secret Manager, Workspace, and Gemini path; deployed proof remains required.",
      privateProofNeeded: [
        "Cloud Run revision and URL proof.",
        "Gemini API model, timestamp, token, and cost metadata from a deployed run.",
        "Google Cloud logs with secrets and customer identifiers removed."
      ],
      redactionRule: "Never expose API keys, project numbers that identify private billing, service-account keys, or raw prompt content.",
      ownerRole: "engineering"
    },
    {
      id: "product-access",
      label: "Working product URL and free judge access",
      ruleArea: "Submission Requirements",
      status: statusFromCompliance(complianceById.get("product-access")?.status),
      source: "/api/xprize/judge-access-pack",
      publicSafeEvidence: judgeProductAccessSummary(),
      privateProofNeeded: ["Hosted product URL.", "Private judge testing instructions.", "Free access confirmation through the judging period."],
      redactionRule: "Put credentials only in Devpost testing instructions or another approved private channel, never in source or screenshots.",
      ownerRole: "engineering"
    },
    {
      id: "repository-access",
      label: "Repository access and source completeness",
      ruleArea: "Submission Requirements",
      status: statusFromCompliance(complianceById.get("repository-access")?.status),
      source: "/api/xprize/source-release",
      publicSafeEvidence: sentinelConfig.repositoryUrl
        ? "Repository URL is configured for judge review."
        : "Repository URL is not configured in this runtime.",
      privateProofNeeded: ["Public repository URL or private repository access for the required judging accounts.", "Source-release proof with no secrets."],
      redactionRule: "Keep secrets, customer documents, invoices, private evidence, and judge credentials out of the repository.",
      ownerRole: "engineering"
    },
    {
      id: "demo-video",
      label: "Public under-three-minute demo video",
      ruleArea: "Submission Requirements",
      status: statusFromCompliance(complianceById.get("demo-video-clearance")?.status),
      source: "/api/xprize/demo-video-pack",
      publicSafeEvidence: demoVideoClearanceSummary(),
      privateProofNeeded: [
        "Public YouTube, Vimeo, or Youku URL.",
        "Length, English or subtitle, visibility, asset-permission, and customer-data redaction confirmation."
      ],
      redactionRule: "Record with seeded or redacted data, no copyrighted music, and no unlicensed third-party marks.",
      ownerRole: "sales"
    },
    {
      id: "revenue-cost-cac",
      label: "Revenue by month, total costs, and customer acquisition spend",
      ruleArea: "Business Viability",
      status: statusFromEvidenceStatus(privateEvidenceById.get("revenue-cost-cac")?.status),
      source: "/api/financial-evidence/ledger",
      publicSafeEvidence:
        "The export tracks readiness for total revenue, monthly revenue, costs, and customer acquisition spend without exposing invoices or customer identities.",
      privateProofNeeded: [
        "Arms-length invoices or payment exports for May, June, July, and August 2026 as applicable.",
        "Cost ledger and one-sentence cost description.",
        "Marketing and customer acquisition spend, even when zero."
      ],
      redactionRule: "Public copy should use aggregate numbers only; invoice IDs, payment references, and customer identities stay private.",
      ownerRole: "founder"
    },
    {
      id: "real-users-feedback-related-party",
      label: "Real users, consented feedback, and related-party separation",
      ruleArea: "Business Viability",
      status: realUserStatus,
      source: "/api/evidence/vault",
      publicSafeEvidence:
        "The export checks user-count, high-level user breakdown, testimonial consent, and related-party separation without publishing raw contact details.",
      privateProofNeeded: [
        "Active-user counts and high-level user segments.",
        "Customer feedback with explicit sharing consent.",
        "Related-party revenue separated from arms-length revenue."
      ],
      redactionRule: "Do not publish customer names, emails, phone numbers, testimonial text, or related-party notes without explicit consent.",
      ownerRole: "sales"
    },
    {
      id: "production-operation-proof",
      label: "Production operation proof and AI-native logs",
      ruleArea: "AI-Native Operations",
      status: productionOperationStatus,
      source: "/api/production/hosted-evidence",
      publicSafeEvidence:
        "The checklist expects agent execution logs, API usage records, dashboard screenshots, and production playbook proof after deployment.",
      privateProofNeeded: [
        "Agent execution timeline.",
        "Gemini API usage metadata.",
        "Hosted dashboard screenshots and Cloud logs.",
        "Workspace sync and reconciliation trace."
      ],
      redactionRule: "Show statuses, timestamps, counts, and model metadata; remove prompts, document contents, OAuth tokens, and customer identifiers.",
      ownerRole: "engineering"
    },
    {
      id: "ip-third-party-safety",
      label: "Original work, third-party use, and public safety review",
      ruleArea: "IP and Safety",
      status: ipStatus,
      source: "/api/xprize/submission-compliance",
      publicSafeEvidence:
        "The submission compliance gate tracks new-project disclosure, third-party SDK/API authorization, license review, media clearance, and public redaction boundaries.",
      privateProofNeeded: [
        "Pre-existing template/framework disclosure.",
        "Open-source and third-party API review.",
        "Demo media and screenshot clearance notes."
      ],
      redactionRule: "Do not upload third-party copyrighted material, customer-private material, or unsupported ownership claims.",
      ownerRole: "legal"
    },
    {
      id: "two-business-day-response",
      label: "Two-business-day private evidence response",
      ruleArea: "Evidence Response",
      status: statusFromCompliance(complianceById.get("private-evidence-response")?.status),
      source: "/api/xprize/submission-binder",
      publicSafeEvidence:
        "The binder assigns owners and response handling for private financial, customer, AI-operation, Cloud, Workspace, and license evidence requests.",
      privateProofNeeded: deps.privateEvidenceResponse
        .filter((request) => request.status !== "private-on-request" && request.status !== "ready" && request.status !== "verified")
        .map((request) => request.label),
      redactionRule: "Respond to organizer evidence requests privately; keep customer contact details and financial documents out of public Devpost fields.",
      ownerRole: "founder"
    }
  ];
  const summary = summarizeEvidenceReadiness(checklist);
  const overallStatus = resolveOverallStatus({
    blocked: summary.blocked,
    warnings: summary.needsReview
  });

  return {
    generatedAt: deps.generatedAt,
    overallStatus,
    summary,
    checklist,
    publicSafeSummary: [
      `${summary.total} Devpost evidence bucket(s): ${summary.ready} ready, ${summary.needsReview} need review, ${summary.blocked} blocked.`,
      "The export maps product access, repository access, demo video, business evidence, real users, AI-operation proof, category impact, and IP safety without raw customer evidence.",
      "Use this as the paste-review checklist before Devpost upload; attach sensitive proof only through approved private judge channels."
    ],
    copyReadyDevpostBullets: [
      "Small Business Services entry: a one-day Google Workspace risk desk for small businesses preparing enterprise security reviews.",
      "AI transforms the workflow by triaging Workspace events, running deterministic checks first, routing justified cases to Gemini semantic review, and staging human-approved remediation.",
      "The evidence workflow separates public demo proof from private financial, customer, and production-operation evidence for judge review."
    ],
    privateJudgePacketRules: [
      "Include revenue by month, total costs, and customer acquisition spend with source documents privately.",
      "Include real-user counts, high-level user segments, feedback, and consent records privately.",
      "Include agent execution logs, API usage records, dashboard screenshots, and live-demo readiness privately.",
      "Keep customer contact details available for organizer requests, but never place them in public Devpost copy or committed files.",
      "Respond to organizer evidence requests within two business days."
    ],
    redactionWarnings: [
      "Do not publish customer names, email addresses, phone numbers, invoices, payment references, raw findings, document contents, OAuth tokens, API keys, or judge credentials.",
      "Do not show unconsented testimonials or private customer security details in screenshots or the demo video.",
      "Do not turn seed data, local mock runs, or pipeline estimates into public revenue, user, or production-proof claims."
    ],
    disclaimer:
      "This export is a submission-readiness map. It does not submit to Devpost, prove eligibility, replace legal review, or convert mock evidence into production proof."
  };
}

function buildPublicDescription(snapshot: DevpostSnapshot, blockers: string[]): DevpostCopySection {
  return {
    id: "public-description",
    label: "Devpost public description",
    status: blockers.length ? "needs-review" : "ready",
    copy: [
      "SME Workspace Sentinel helps small businesses using Google Workspace find risky sharing, exposed secrets, and sensitive-data handling gaps before an enterprise buyer asks for a security review.",
      "The product runs a cost-aware workflow: metadata and deterministic checks decide what can be skipped, Gemini performs semantic review only when justified, and every meaningful remediation is staged for human approval.",
      "The app turns each scan into practical evidence: findings, explanations, audit events, Trust Center packets, questionnaire-ready answers, and a private XPRIZE evidence room for revenue, user, cost, and AI-operation proof."
    ].join(" "),
    claimBoundary: "Describe workflow transformation and category impact without claiming certification or guaranteed outcomes.",
    missingProof: blockers.slice(0, 6)
  };
}

function buildProblemSection(snapshot: DevpostSnapshot): DevpostCopySection {
  return {
    id: "problem",
    label: "Problem",
    status: snapshot.tenant.category === "Small Business Services" ? "ready" : "blocked",
    copy:
      "Seed-stage teams often run on Google Workspace long before they have dedicated security staff. One public proposal, leaked key, or unmanaged external share can slow an enterprise deal, but existing compliance platforms are expensive and usually ask founders to build the evidence trail manually.",
    claimBoundary: "Frame the pain as security-review friction and readiness work, not a promise to satisfy every buyer or auditor.",
    missingProof: snapshot.tenant.category === "Small Business Services" ? [] : ["Select Small Business Services as the final category."]
  };
}

function buildSolutionSection(snapshot: DevpostSnapshot): DevpostCopySection {
  const hasRun = snapshot.agentRuns.length > 0;

  return {
    id: "solution",
    label: "Solution",
    status: hasRun ? "ready" : "needs-review",
    copy:
      "Sentinel listens for Workspace activity, skips low-risk events, uses deterministic detection for standard sensitive-data patterns, routes only justified cases to Gemini for semantic risk explanation, and creates a staged recommendation with severity, rationale, confidence, blast-radius notes, and an immutable audit trail.",
    claimBoundary: "Show AI-native operations while preserving human approval for non-trivial security actions.",
    missingProof: hasRun ? [] : ["Run the mock Workspace event demo or a production scan before recording the final video."]
  };
}

function buildGoogleStackSection(snapshot: DevpostSnapshot): DevpostCopySection {
  const hasGemini = snapshot.agentRuns.some((run) => run.provider === "gemini-api");
  const hasMockGemini = snapshot.agentRuns.some((run) => run.provider === "mock-gemini");
  const storageReady = sentinelConfig.storageMode === "gcp-rest" && Boolean(sentinelConfig.googleCloudProject);
  const missingProof = [
    ...(storageReady ? [] : ["Deploy on Cloud Run and configure Google Cloud persistence targets."]),
    ...(hasGemini ? [] : ["Run a deployed Gemini API semantic audit and retain usage/log proof."]),
    ...(hasMockGemini ? [] : ["Trigger a high-risk event so the demo visibly exercises the semantic-audit path."])
  ];

  return {
    id: "google-stack",
    label: "Google stack",
    status: storageReady && hasGemini ? "ready" : "blocked",
    copy:
      "The intended production path uses Cloud Run for the app and webhook handlers, Firestore for tenant state, BigQuery for audit evidence, Secret Manager for Workspace OAuth tokens, Pub/Sub-backed event flows for Workspace signals, Sensitive Data Protection for deterministic inspection where enabled, and Gemini API for semantic risk explanation.",
    claimBoundary: "Separate implemented local mock flow from production Google Cloud and Gemini API proof.",
    missingProof
  };
}

function buildBusinessModelSection(snapshot: DevpostSnapshot): DevpostCopySection {
  const activePipelineValue = snapshot.pilotProspects.reduce((total, prospect) => total + prospect.estimatedMrrUsd, 0);

  return {
    id: "business-model",
    label: "Business model",
    status: snapshot.pilotProspects.length ? "needs-review" : "blocked",
    copy: `The entry is packaged as a paid one-day Workspace risk scan for small businesses preparing enterprise security reviews, followed by a monthly evidence-room subscription. The current local pipeline tracks ${snapshot.pilotProspects.length} prospect record(s) and $${activePipelineValue}/mo in estimated pipeline, but final submission revenue must come from arms-length customers during the hackathon period.`,
    claimBoundary: "Pipeline and seed records are not revenue proof until invoices, payments, and consented user evidence exist.",
    missingProof: [
      "Replace seeded CRM records with real paid customer records.",
      "Attach revenue by month, costs, CAC spend, active-user counts, and related-party separation privately."
    ]
  };
}

function buildTractionSection(snapshot: DevpostSnapshot): DevpostCopySection {
  const productionEvidence = sentinelConfig.evidenceMode === "production";
  const verifiedPilots = productionEvidence
    ? snapshot.pilotRecords.filter((pilot) => pilot.armsLength && !pilot.relatedParty && pilot.proofStatus === "financial-doc-ready")
    : [];
  const consentedTestimonials = productionEvidence
    ? snapshot.pilotRecords.filter((pilot) => pilot.consentStatus === "consented" && pilot.testimonialQuote)
    : [];

  return {
    id: "traction-evidence",
    label: "Revenue and user evidence",
    status: verifiedPilots.length && consentedTestimonials.length ? "ready" : "blocked",
    copy:
      verifiedPilots.length && consentedTestimonials.length
        ? `Private judge evidence can show ${verifiedPilots.length} arms-length paid pilot(s), consented feedback, active-user counts, monthly revenue, costs, CAC spend, and related-party separation.`
        : "The product currently demonstrates the evidence workflow locally. Final Devpost traction copy must be updated only after real arms-length revenue, real-user counts, customer consent, cost records, CAC spend, and related-party separation are available.",
    claimBoundary: "Do not count mock pilots, related-party revenue, or unconsented testimonials as public traction.",
    missingProof:
      verifiedPilots.length && consentedTestimonials.length
        ? []
        : [
            "Arms-length paid customer revenue during the hackathon period.",
            "Revenue by month, total costs, and customer acquisition spend.",
            "Real active-user evidence and consented customer feedback."
          ]
  };
}

function buildDemoVideoScript(snapshot: DevpostSnapshot): DemoScriptScene[] {
  const latestRun = snapshot.agentRuns[0];
  const latestFinding = snapshot.findings[0];

  return [
    {
      timestamp: "0:00-0:20",
      scene: "Problem and category",
      voiceover:
        "SME Workspace Sentinel is built for Small Business Services: founders using Google Workspace need buyer-ready security evidence before one risky file share slows an enterprise deal.",
      screenAction: "Open the dashboard header, readiness score, and category positioning.",
      proofShown: `Category: ${snapshot.tenant.category}; tenant positioning: ${snapshot.tenant.positioning}.`,
      riskToAvoid: "Do not state that the product certifies a business or guarantees buyer acceptance."
    },
    {
      timestamp: "0:20-0:45",
      scene: "Hybrid scanner",
      voiceover:
        "The scanner protects margin and data minimization by skipping low-risk events, using deterministic detection first, and routing only justified cases to semantic review.",
      screenAction: "Inject a low-risk event, then a high-risk mock Workspace event; show byte counters and skip behavior.",
      proofShown: `${snapshot.aggregateCounters.filesInspected} file(s) inspected; ${snapshot.aggregateCounters.bytesScannedByDlp} byte(s) scanned by deterministic detection; ${snapshot.aggregateCounters.bytesRoutedToGemini} byte(s) routed to Gemini or mock Gemini.`,
      riskToAvoid: "Do not imply every document is sent to Gemini."
    },
    {
      timestamp: "0:45-1:20",
      scene: "Gemini semantic audit",
      voiceover:
        "When risk justifies it, Gemini explains the finding, severity, confidence, and blast radius so a founder can understand what changed and why it matters.",
      screenAction: "Open the newest agent run and finding rationale.",
      proofShown: latestRun
        ? `${latestRun.provider} on ${latestRun.model}; estimated cost $${latestRun.estimatedCostUsd.toFixed(4)}.`
        : "No semantic run recorded in the current state.",
      riskToAvoid: "Do not hide whether the run is mock or live Gemini API."
    },
    {
      timestamp: "1:20-1:55",
      scene: "Human-approved remediation",
      voiceover:
        "Sentinel does not mutate non-trivial Workspace security settings by default. It stages a recommendation, waits for an admin decision, and logs the outcome.",
      screenAction: "Approve or dismiss a recommendation, then show the audit and remediation log.",
      proofShown: latestFinding
        ? `${latestFinding.severity} finding; approval status ${latestFinding.approval.status}; ${snapshot.remediations.length} remediation record(s).`
        : "No finding recorded yet.",
      riskToAvoid: "Do not present autonomous remediation as the default trust model."
    },
    {
      timestamp: "1:55-2:35",
      scene: "Business and trust evidence",
      voiceover:
        "The same workflow becomes business proof: Trust Packets, questionnaire answers, Evidence Vault artifacts, financial evidence, and pilot pipeline records are organized for customers and judges.",
      screenAction: "Open Trust Center, Evidence Vault, Pilot CRM, and submission controls.",
      proofShown: `${snapshot.trustPackets.length} Trust Packet(s); ${snapshot.questionnairePacks.length} questionnaire pack(s); ${snapshot.pilotRecords.length} pilot record(s).`,
      riskToAvoid: "Do not expose customer security details, invoices, or unconsented feedback in the public video."
    },
    {
      timestamp: "2:35-2:55",
      scene: "Submission gates",
      voiceover:
        "Before upload, Sentinel shows what is ready, what is private-on-request, and what remains blocked so the team does not turn a polished local demo into an unsupported claim.",
      screenAction: "Run Claim Guard, Submission Gate, Submission Compliance, License Manifest, Binder, and Devpost Pack.",
      proofShown: `Evidence mode: ${sentinelConfig.evidenceMode}; ${judgeProductAccessSummary()} Repository URL ${sentinelConfig.repositoryUrl ? "configured" : "missing"}; demo video clearance: ${demoVideoClearanceSummary()}`,
      riskToAvoid: "Do not claim final Devpost readiness until every production blocker is cleared."
    }
  ];
}

function buildScreenshotChecklist(snapshot: DevpostSnapshot): SubmissionScreenshotItem[] {
  const gate = buildXPrizeSubmissionGate(snapshot);
  const manifest = buildThirdPartyManifest();

  return [
    {
      id: "dashboard-command-center",
      label: "Readiness command center",
      routeOrAction: "/",
      proof: "Category, USP, score, current blockers, and claim-safe readiness posture.",
      redactionRequired: false,
      status: "ready"
    },
    {
      id: "scanner-flow",
      label: "Hybrid scanner flow",
      routeOrAction: "Run low-risk and high-risk mock Workspace events",
      proof: "Skipped low-risk event, deterministic scan counters, semantic audit only when justified.",
      redactionRequired: true,
      status: snapshot.agentRuns.length ? "ready" : "needs-review"
    },
    {
      id: "hitl-recommendation",
      label: "Human-in-the-loop recommendation",
      routeOrAction: "Open latest finding and approval controls",
      proof: "Finding rationale, confidence, approval status, and immutable audit event.",
      redactionRequired: true,
      status: snapshot.findings.length ? "ready" : "needs-review"
    },
    {
      id: "evidence-room",
      label: "Private Evidence Room and vault",
      routeOrAction: "Check Evidence Vault and financial ledger",
      proof: "Revenue, cost, CAC, consent, AI logs, hosted URL, repository URL, and demo video artifacts by status.",
      redactionRequired: true,
      status: "needs-review"
    },
    {
      id: "prospect-pipeline",
      label: "Paid pilot prospect pipeline",
      routeOrAction: "Open Pilot CRM + ROI panel",
      proof: "Target segments, next actions, estimated MRR, and conversion risks.",
      redactionRequired: true,
      status: snapshot.pilotProspects.length ? "ready" : "needs-review"
    },
    {
      id: "submission-gate",
      label: "XPRIZE submission gate",
      routeOrAction: "/api/xprize/submission-gate or dashboard button",
      proof: `${gate.overallStatus}; ${gate.blockingSummary.length} blocker(s).`,
      redactionRequired: false,
      status: gate.overallStatus === "passed" ? "ready" : "blocked"
    },
    {
      id: "license-manifest",
      label: "Dependency and API license manifest",
      routeOrAction: "/api/xprize/license-manifest or dashboard button",
      proof: "Third-party packages, Google API integrations, disclosure text, and human review status.",
      redactionRequired: false,
      status: sentinelConfig.thirdPartyReviewApproved && manifest.summary.status === "passed" ? "ready" : "blocked"
    },
    {
      id: "devpost-pack",
      label: "Devpost submission pack",
      routeOrAction: "/api/xprize/devpost-pack or dashboard button",
      proof: "Claim-safe copy, demo scenes, screenshot checklist, testing instructions, and private response plan.",
      redactionRequired: false,
      status: "ready"
    }
  ];
}

function buildTestingInstructionsDraft(): string[] {
  return [
    `Product URL: ${sentinelConfig.productUrl || "Add hosted URL after Cloud Run deployment."}`,
    `Repository URL: ${sentinelConfig.repositoryUrl || "Add public repository URL or share private repository with the required judging accounts."}`,
    `Product access clearance: ${judgeProductAccessSummary()}`,
    `Demo video clearance: ${demoVideoClearanceSummary()}`,
    "Judge login: provide credentials only through Devpost testing instructions or an approved private channel; do not commit credentials.",
    "Demo path: reset demo, run a low-risk mock event, run a high-risk mock event, review the staged recommendation, approve or dismiss it, open Evidence Vault, run Claim Guard, then open the Devpost pack.",
    "Production proof: if requested, provide Cloud Run revision, Google Cloud logs, Gemini API usage metadata, Workspace OAuth/sync logs, invoices/payment records, active-user evidence, costs, CAC spend, related-party notes, and consented testimonials privately."
  ];
}

function buildPrivateEvidenceResponse(snapshot: DevpostSnapshot): SubmissionPrivateEvidenceRequest[] {
  const productionEvidence = sentinelConfig.evidenceMode === "production";
  const hasFinancialProof =
    productionEvidence &&
    snapshot.pilotRecords.some((pilot) => pilot.armsLength && !pilot.relatedParty && pilot.proofStatus === "financial-doc-ready");
  const hasUserProof = productionEvidence && snapshot.tenant.evidence.activeUsers > 0;
  const hasConsent = productionEvidence && snapshot.pilotRecords.some((pilot) => pilot.consentStatus === "consented");
  const hasGeminiApiRun = snapshot.agentRuns.some((run) => run.provider === "gemini-api");
  const hasCloudProof = sentinelConfig.storageMode === "gcp-rest" && Boolean(sentinelConfig.googleCloudProject);
  const hasWorkspaceProof = snapshot.connections.some((connection) => connection.mode !== "mock") && hasLiveWorkspaceSyncEvidence(snapshot.syncState);
  const manifest = buildThirdPartyManifest();

  return [
    {
      id: "revenue-cost-cac",
      label: "Revenue, costs, and customer acquisition spend",
      ownerRole: "founder",
      responseSlaHours: 48,
      status: hasFinancialProof ? "private-on-request" : "missing",
      handling: "Prepare invoices, payment exports, revenue by month, total costs, CAC receipts, and related-party separation with customer details redacted for public materials."
    },
    {
      id: "real-user-evidence",
      label: "Real users and consented feedback",
      ownerRole: "sales",
      responseSlaHours: 48,
      status: hasUserProof && hasConsent ? "private-on-request" : "missing",
      handling: "Prepare active-user counts, customer segment breakdown, and testimonial consent records before sharing any feedback."
    },
    {
      id: "ai-operation-proof",
      label: "Gemini and agent operation proof",
      ownerRole: "engineering",
      responseSlaHours: 48,
      status: hasGeminiApiRun ? "private-on-request" : "mock-only",
      handling: "Export redacted model id, timestamp, cost, token estimate, decision path, and audit-event metadata from production logs."
    },
    {
      id: "gcp-production-proof",
      label: "Google Cloud production proof",
      ownerRole: "engineering",
      responseSlaHours: 48,
      status: hasCloudProof ? "private-on-request" : "missing",
      handling: "Prepare Cloud Run, Firestore, BigQuery, Secret Manager, IAM, billing budget, quota, and API-key restriction evidence."
    },
    {
      id: "workspace-sync-proof",
      label: "Workspace OAuth and sync proof",
      ownerRole: "security",
      responseSlaHours: 48,
      status: hasWorkspaceProof ? "private-on-request" : "missing",
      handling: "Prepare OAuth consent, Drive change cursor, Gmail history cursor, push notification, and reconciliation evidence without customer content."
    },
    {
      id: "license-and-ip-proof",
      label: "Third-party, open-source, and media clearance",
      ownerRole: "legal",
      responseSlaHours: 48,
      status: sentinelConfig.thirdPartyReviewApproved && manifest.summary.status === "passed" ? "private-on-request" : "missing",
      handling: "Provide dependency license review, Google API terms review, starter-boilerplate disclosure, and demo media clearance notes."
    }
  ];
}

function buildNextActions(blockers: string[], complianceActions: string[], manifestActions: string[]) {
  if (!blockers.length) {
    return [
      "Run Claim Guard one final time on the pasted Devpost copy and video script.",
      "Verify the product URL, repository URL, demo URL, and judge access from a signed-out browser.",
      "Generate the final redacted judge evidence packet from production immediately before submission."
    ];
  }

  return [
    "Deploy the Cloud Run production path with durable Firestore, BigQuery, Secret Manager, and cost controls.",
    "Run a live Gemini API semantic audit and preserve model, cost, and agent execution proof.",
    "Onboard at least one arms-length paid pilot and attach revenue, cost, CAC, user, and consent evidence privately.",
    "Record the under-three-minute public demo using only owned, permitted, or redacted assets.",
    ...complianceActions.slice(0, 2),
    ...manifestActions.slice(0, 2)
  ];
}

function summarizeEvidenceReadiness(checklist: DevpostEvidenceReadinessItem[]) {
  const ready = checklist.filter((item) => item.status === "ready").length;
  const needsReview = checklist.filter((item) => item.status === "needs-review").length;
  const blocked = checklist.filter((item) => item.status === "blocked").length;

  return {
    ready,
    needsReview,
    blocked,
    total: checklist.length
  };
}

function statusFromGate(status?: "passed" | "warning" | "blocked"): DevpostSubmissionStatus {
  if (status === "passed") {
    return "ready";
  }

  if (status === "warning") {
    return "needs-review";
  }

  return "blocked";
}

function statusFromCompliance(status?: "passed" | "warning" | "blocked"): DevpostSubmissionStatus {
  return statusFromGate(status);
}

function statusFromEvidenceStatus(status?: SubmissionEvidenceStatus): DevpostSubmissionStatus {
  if (status === "ready" || status === "verified" || status === "private-on-request") {
    return "ready";
  }

  if (status === "mock-only") {
    return "needs-review";
  }

  return "blocked";
}

function statusFromManifest(status: "passed" | "warning" | "blocked"): DevpostSubmissionStatus {
  return statusFromGate(status);
}

function worstStatus(statuses: DevpostSubmissionStatus[]): DevpostSubmissionStatus {
  if (statuses.includes("blocked")) {
    return "blocked";
  }

  if (statuses.includes("needs-review")) {
    return "needs-review";
  }

  return "ready";
}

function resolveOverallStatus(input: { blocked: number; warnings: number }): DevpostSubmissionStatus {
  if (input.blocked > 0) {
    return "blocked";
  }

  if (input.warnings > 0) {
    return "needs-review";
  }

  return "ready";
}
