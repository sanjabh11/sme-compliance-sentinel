import { scanClaimText } from "@/lib/claim-guard";
import { demoVideoClearanceSummary, hasDemoVideoClearance, sentinelConfig } from "@/lib/config";
import { buildDevpostSubmissionPack } from "@/lib/devpost-submission";
import type {
  DashboardSnapshot,
  DemoScriptScene,
  DemoVideoCompliancePack,
  DemoVideoRuleCheck,
  DemoVideoScenePlan,
  SubmissionScreenshotItem
} from "@/lib/types";

type DemoVideoSnapshot = Pick<
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

const maximumAllowedSeconds = 180;
const allowedPlatforms = ["YouTube", "Vimeo", "Youku"];
const ruleSourceUrl = "https://www.geminixprize.com/rules";

export function buildDemoVideoCompliancePack(snapshot: DemoVideoSnapshot): DemoVideoCompliancePack {
  const devpostPack = buildDevpostSubmissionPack(snapshot);
  const scenes = buildScenePlan(devpostPack.demoVideoScript);
  const plannedDurationSeconds = Math.max(...scenes.map((scene) => scene.endSecond), 0);
  const checks = buildChecks(snapshot, scenes, devpostPack.screenshotChecklist);
  const blockers = checks.filter((check) => check.status === "blocked").map((check) => `${check.label}: ${check.fix}`);
  const warnings = checks.filter((check) => check.status === "warning");
  const overallStatus = hasDemoVideoClearance() && blockers.length === 0 ? "cleared" : blockers.length === 0 ? "ready-to-record" : "blocked";

  return {
    generatedAt: new Date().toISOString(),
    overallStatus,
    plannedDurationSeconds,
    maximumAllowedSeconds,
    bufferSeconds: maximumAllowedSeconds - plannedDurationSeconds,
    videoUrl: sentinelConfig.demoVideoUrl,
    allowedPlatforms,
    scenes,
    checks,
    screenshotChecklist: devpostPack.screenshotChecklist,
    blockers,
    nextActions: buildNextActions(blockers, warnings),
    recordingChecklist: [
      "Record from the hosted product URL after Cloud Run, Workspace sync, persistence, and live Gemini proof are configured.",
      "Keep the final cut under 180 seconds; the generated plan targets 175 seconds to preserve a five-second buffer.",
      "Use English narration or add English subtitles before setting XPRIZE_DEMO_VIDEO_ENGLISH_OR_SUBTITLED_CONFIRMED=true.",
      "Show the live provider/model proof clearly; do not blur the provider field if it distinguishes mock Gemini from Gemini API.",
      "Blur customer names, invoices, security findings, OAuth tokens, and Workspace resource IDs before upload.",
      "Use only owned UI footage, permitted screenshots, and music/sound assets with documented rights."
    ],
    privateHandling: [
      "Keep raw customer footage, unredacted invoices, credentials, and detailed security findings in the private Evidence Vault only.",
      "Store the public video URL and human clearance notes as demo-video-proof artifacts after review.",
      "If a customer appears in the video or testimonial, attach explicit consent before using it in the public submission."
    ],
    sourceUrls: [ruleSourceUrl],
    disclaimer:
      "This pack validates the demo-video plan and clearance gates. It does not prove the final public video exists until the URL, platform, duration, language/subtitle, asset, and redaction checks are human-confirmed."
  };
}

function buildScenePlan(scenes: DemoScriptScene[]): DemoVideoScenePlan[] {
  return scenes.map((scene, index) => {
    const { startSecond, endSecond } = parseTimestampRange(scene.timestamp);

    return {
      ...scene,
      startSecond,
      endSecond,
      durationSeconds: Math.max(endSecond - startSecond, 0),
      assetRiskLevel: resolveAssetRisk(scene, index),
      ruleCoverage: resolveRuleCoverage(scene),
      clearanceAction: resolveClearanceAction(scene, index)
    };
  });
}

function buildChecks(
  snapshot: DemoVideoSnapshot,
  scenes: DemoVideoScenePlan[],
  screenshotChecklist: SubmissionScreenshotItem[]
): DemoVideoRuleCheck[] {
  const plannedDurationSeconds = Math.max(...scenes.map((scene) => scene.endSecond), 0);
  const publicUrlStatus = sentinelConfig.demoVideoUrl ? "passed" : "blocked";
  const platformStatus = sentinelConfig.demoVideoUrl ? (isAllowedPlatform(sentinelConfig.demoVideoUrl) ? "passed" : "blocked") : "blocked";
  const hasFunctionalLocalDemo = snapshot.agentRuns.length > 0 && snapshot.findings.length > 0;
  const hasLiveGeminiProof = snapshot.agentRuns.some((run) => run.provider === "gemini-api");
  const claimViolations = scanClaimText({
    artifact: "demo-video-script",
    text: scenes.map((scene) => [scene.scene, scene.voiceover, scene.proofShown, scene.riskToAvoid].join("\n")).join("\n\n")
  });
  const screenshotRiskCount = screenshotChecklist.filter((item) => item.redactionRequired).length;

  return [
    {
      id: "planned-under-three-minutes",
      label: "Generated plan stays under three minutes",
      status: plannedDurationSeconds < maximumAllowedSeconds ? "passed" : "blocked",
      evidence: `${plannedDurationSeconds}s planned against ${maximumAllowedSeconds}s maximum.`,
      fix: "Shorten scenes until the final planned timestamp remains below 180 seconds.",
      requiredBeforeSubmit: true
    },
    {
      id: "public-video-url",
      label: "Public demo-video URL configured",
      status: publicUrlStatus,
      evidence: sentinelConfig.demoVideoUrl || "XPRIZE_DEMO_VIDEO_URL is not configured.",
      fix: "Publish the final video and set XPRIZE_DEMO_VIDEO_URL only after upload.",
      requiredBeforeSubmit: true
    },
    {
      id: "accepted-video-platform",
      label: "Video host is an accepted public platform",
      status: platformStatus,
      evidence: sentinelConfig.demoVideoUrl ? `${sentinelConfig.demoVideoUrl}; allowed platforms: ${allowedPlatforms.join(", ")}.` : "No video URL to validate.",
      fix: "Use a public YouTube, Vimeo, or Youku URL for the submitted demo video.",
      requiredBeforeSubmit: true
    },
    {
      id: "public-visibility-confirmed",
      label: "Public visibility human-confirmed",
      status: sentinelConfig.demoVideoPubliclyAccessibleConfirmed ? "passed" : "blocked",
      evidence: demoVideoClearanceSummary(),
      fix: "Open the video in a signed-out browser and set XPRIZE_DEMO_VIDEO_PUBLICLY_ACCESSIBLE_CONFIRMED=true only after it loads.",
      requiredBeforeSubmit: true
    },
    {
      id: "duration-human-confirmed",
      label: "Final duration human-confirmed",
      status: sentinelConfig.demoVideoUnderThreeMinutesConfirmed ? "passed" : "blocked",
      evidence: demoVideoClearanceSummary(),
      fix: "Check the final public video runtime and set XPRIZE_DEMO_VIDEO_UNDER_3_MIN_CONFIRMED=true only if it is under 180 seconds.",
      requiredBeforeSubmit: true
    },
    {
      id: "english-or-subtitled-confirmed",
      label: "English or English subtitles human-confirmed",
      status: sentinelConfig.demoVideoEnglishOrSubtitledConfirmed ? "passed" : "blocked",
      evidence: demoVideoClearanceSummary(),
      fix: "Use English narration or add English subtitles, then set XPRIZE_DEMO_VIDEO_ENGLISH_OR_SUBTITLED_CONFIRMED=true after review.",
      requiredBeforeSubmit: true
    },
    {
      id: "asset-clearance-confirmed",
      label: "Third-party asset and music clearance confirmed",
      status: sentinelConfig.demoVideoAssetClearanceConfirmed ? "passed" : "blocked",
      evidence: `${screenshotRiskCount} screenshot target(s) require redaction or asset review. ${demoVideoClearanceSummary()}`,
      fix: "Review screenshots, logos, marks, music, audio, and external footage; set XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED=true only after clearance.",
      requiredBeforeSubmit: true
    },
    {
      id: "customer-data-redaction-confirmed",
      label: "Customer security data redaction confirmed",
      status: sentinelConfig.demoVideoCustomerDataRedactedConfirmed ? "passed" : "blocked",
      evidence: demoVideoClearanceSummary(),
      fix: "Blur or remove customer names, invoices, security findings, OAuth tokens, resource IDs, and sensitive logs before setting the redaction flag.",
      requiredBeforeSubmit: true
    },
    {
      id: "functioning-product-footage",
      label: "Functioning product footage is available for recording",
      status: hasFunctionalLocalDemo ? "passed" : "warning",
      evidence: `${snapshot.agentRuns.length} agent run(s), ${snapshot.findings.length} finding(s), ${snapshot.remediations.length} remediation record(s).`,
      fix: "Run a representative Workspace event before recording so the video shows the scanner, recommendation, approval, and audit workflow.",
      requiredBeforeSubmit: true
    },
    {
      id: "live-gemini-proof-scene",
      label: "Live Gemini API proof is available for the video",
      status: hasLiveGeminiProof ? "passed" : "blocked",
      evidence: hasLiveGeminiProof
        ? "At least one current agent run uses provider=gemini-api."
        : "Current agent runs do not yet prove provider=gemini-api.",
      fix: "Run the hosted production Gemini smoke check and record the provider/model proof in the video.",
      requiredBeforeSubmit: true
    },
    {
      id: "claim-safe-script",
      label: "Demo script avoids banned overclaims",
      status: claimViolations.length ? "blocked" : "passed",
      evidence: `${claimViolations.length} banned-claim violation(s).`,
      fix: claimViolations[0]?.fix ?? "Keep the script in readiness, risk-detection, staged-remediation, and proof-boundary language.",
      requiredBeforeSubmit: true
    }
  ];
}

function buildNextActions(blockers: string[], warnings: DemoVideoRuleCheck[]) {
  if (blockers.length) {
    return blockers.slice(0, 5);
  }

  if (warnings.length) {
    return warnings.map((warning) => `${warning.label}: ${warning.fix}`).slice(0, 5);
  }

  return [
    "Record the final public video from the hosted production app.",
    "Run the Demo Video Compliance Pack again from the deployed URL before pasting the Devpost video link."
  ];
}

function parseTimestampRange(timestamp: string) {
  const [startRaw, endRaw] = timestamp.split("-");

  return {
    startSecond: parseTimestamp(startRaw),
    endSecond: parseTimestamp(endRaw)
  };
}

function parseTimestamp(value = "0:00") {
  const [minutesRaw, secondsRaw] = value.trim().split(":");
  const minutes = Number(minutesRaw);
  const seconds = Number(secondsRaw);

  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return 0;
  }

  return minutes * 60 + seconds;
}

function isAllowedPlatform(rawUrl: string) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return ["youtube.com", "youtu.be", "vimeo.com", "youku.com"].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function resolveAssetRisk(scene: DemoScriptScene, index: number): DemoVideoScenePlan["assetRiskLevel"] {
  if (scene.riskToAvoid.toLowerCase().includes("customer") || scene.proofShown.toLowerCase().includes("invoice")) {
    return "high";
  }

  if (index >= 4) {
    return "medium";
  }

  return "low";
}

function resolveRuleCoverage(scene: DemoScriptScene) {
  const coverage = ["functioning-project"];

  if (scene.timestamp === "0:00-0:20") {
    coverage.push("category-impact");
  }

  if (scene.scene.toLowerCase().includes("gemini")) {
    coverage.push("gemini-api-proof");
  }

  if (scene.riskToAvoid.toLowerCase().includes("customer") || scene.riskToAvoid.toLowerCase().includes("public video")) {
    coverage.push("customer-data-redaction");
  }

  return coverage;
}

function resolveClearanceAction(scene: DemoScriptScene, index: number) {
  if (scene.riskToAvoid.toLowerCase().includes("customer")) {
    return "Review frame-by-frame for customer names, invoices, findings, OAuth tokens, resource IDs, and unconsented feedback.";
  }

  if (index === 2) {
    return "Confirm the scene shows the real provider/model and does not imply mock Gemini is live Gemini API proof.";
  }

  if (index === 5) {
    return "Confirm submission gates are shown as blockers when external proof is missing.";
  }

  return "Confirm all visible UI, screenshots, icons, and audio are owned or permitted.";
}
