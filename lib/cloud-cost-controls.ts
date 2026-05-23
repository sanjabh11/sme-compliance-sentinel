import { sentinelConfig } from "@/lib/config";
import { fetchCloudRunAccessToken } from "@/lib/persistence";
import type {
  AgentRun,
  ApiKeyRestrictionPlan,
  CloudBudgetPlan,
  CloudCostControlCenter,
  CloudCostControlChecklistItem,
  CloudCostControlVerificationResult,
  GeminiQuotaPlan
} from "@/lib/types";

const GEMINI_API_TARGET = "generativelanguage.googleapis.com";

export function buildCloudCostControlCenter(snapshot: { agentRuns: AgentRun[] }): CloudCostControlCenter {
  const estimatedGeminiSpendUsd = Number(
    snapshot.agentRuns.reduce((total, run) => total + run.estimatedCostUsd, 0).toFixed(6)
  );
  const budgetPlan = buildCloudBudgetPlan();
  const apiKeyRestrictionPlan = buildApiKeyRestrictionPlan();
  const quotaPlan = buildGeminiQuotaPlan();
  const evidenceChecklist = buildEvidenceChecklist(budgetPlan, apiKeyRestrictionPlan);
  const warnings = buildCostControlWarnings(budgetPlan, apiKeyRestrictionPlan);
  const hasProductionConfig =
    sentinelConfig.cloudCostControlsMode === "production" &&
    Boolean(sentinelConfig.googleCloudProject) &&
    Boolean(sentinelConfig.googleCloudBillingAccountId) &&
    Boolean(sentinelConfig.googleCloudBudgetId) &&
    Boolean(sentinelConfig.googleCloudProjectNumber) &&
    Boolean(sentinelConfig.geminiApiKeyId) &&
    sentinelConfig.geminiApiAllowedServerIps.length > 0;

  return {
    generatedAt: new Date().toISOString(),
    status: hasProductionConfig ? "ready" : warnings.length ? "blocked" : "warning",
    mode: sentinelConfig.cloudCostControlsMode,
    projectId: sentinelConfig.googleCloudProject || "not-configured",
    estimatedGeminiSpendUsd,
    monthlyBudgetUsd: sentinelConfig.geminiMonthlyBudgetUsd,
    budgetPlan,
    apiKeyRestrictionPlan,
    quotaPlan,
    evidenceChecklist,
    runbook: [
      "Create a project-level Cloud Billing budget before the first paid pilot.",
      "Route budget notifications to Pub/Sub and connect the alert handler to pause Tier 2 Gemini calls.",
      "Restrict the Gemini API key to the Generative Language API and a controlled server egress path.",
      "Keep the application-level Gemini monthly budget lower than the Cloud Billing budget because billing data can lag.",
      "Attach budget screenshots, alert test logs, API key restriction screenshots, and AI usage logs to the private judge binder."
    ],
    warnings
  };
}

export function buildCloudBudgetPlan(): CloudBudgetPlan {
  const billingAccountId = sentinelConfig.googleCloudBillingAccountId || "BILLING_ACCOUNT_ID";
  const budgetId = sentinelConfig.googleCloudBudgetId || undefined;
  const projectId = sentinelConfig.googleCloudProject || "PROJECT_ID";
  const pubSubTopic =
    sentinelConfig.budgetPubSubTopic ||
    (sentinelConfig.googleCloudProject ? `projects/${sentinelConfig.googleCloudProject}/topics/sentinel-budget-alerts` : undefined);
  const endpoint = budgetId
    ? `https://billingbudgets.googleapis.com/v1/billingAccounts/${billingAccountId}/budgets/${budgetId}`
    : `https://billingbudgets.googleapis.com/v1/billingAccounts/${billingAccountId}/budgets`;
  const alertThresholds: CloudBudgetPlan["alertThresholds"] = [
    { percent: 0.5, basis: "CURRENT_SPEND" },
    { percent: 0.75, basis: "CURRENT_SPEND" },
    { percent: 0.9, basis: "FORECASTED_SPEND" },
    { percent: 1, basis: "CURRENT_SPEND" }
  ];

  return {
    billingAccountId,
    budgetId,
    displayName: "SME Workspace Sentinel monthly GCP and Gemini budget",
    endpoint,
    monthlyBudgetUsd: sentinelConfig.geminiMonthlyBudgetUsd,
    alertThresholds,
    pubSubTopic,
    requestBody: {
      displayName: "SME Workspace Sentinel monthly GCP and Gemini budget",
      budgetFilter: {
        projects: [`projects/${projectId}`],
        calendarPeriod: "MONTH"
      },
      amount: {
        specifiedAmount: {
          currencyCode: "USD",
          units: String(Math.floor(sentinelConfig.geminiMonthlyBudgetUsd))
        }
      },
      thresholdRules: alertThresholds.map((threshold) => ({
        thresholdPercent: threshold.percent,
        spendBasis: threshold.basis
      })),
      allUpdatesRule: pubSubTopic
        ? {
            pubsubTopic: pubSubTopic,
            schemaVersion: "1.0"
          }
        : undefined
    }
  };
}

export function buildApiKeyRestrictionPlan(): ApiKeyRestrictionPlan {
  const projectNumber = sentinelConfig.googleCloudProjectNumber || "PROJECT_NUMBER";
  const keyId = sentinelConfig.geminiApiKeyId || "GEMINI_API_KEY_ID";
  const allowedServerIps = sentinelConfig.geminiApiAllowedServerIps;
  const clientRestrictionMode = allowedServerIps.length ? "server-ip" : "pending-static-egress";

  return {
    projectNumber,
    keyId,
    endpoint: `https://apikeys.googleapis.com/v2/projects/${projectNumber}/locations/global/keys/${keyId}?updateMask=restrictions`,
    requiredApiTargets: [GEMINI_API_TARGET],
    allowedServerIps,
    clientRestrictionMode,
    requestBody: {
      restrictions: {
        api_targets: [{ service: GEMINI_API_TARGET }],
        ...(allowedServerIps.length
          ? {
              serverKeyRestrictions: {
                allowedIps: allowedServerIps
              }
            }
          : {})
      }
    },
    warnings: allowedServerIps.length
      ? []
      : [
          "No server IP restriction is configured. Use static Cloud Run egress or move Gemini access to a service-account-backed path before public launch."
        ]
  };
}

export function buildGeminiQuotaPlan(): GeminiQuotaPlan {
  return {
    dailyRequestLimit: sentinelConfig.geminiDailyRequestQuota,
    dailyTokenLimit: sentinelConfig.geminiDailyTokenQuota,
    enforcement: "gcp-quota-required",
    runbook: [
      "Keep SENTINEL_GEMINI_MONTHLY_BUDGET_USD below the Cloud Billing budget.",
      "Set service quota limits or quota alerts for Gemini/Generative Language usage before public traffic.",
      "When budget Pub/Sub crosses the critical threshold, disable Tier 2 Gemini and leave deterministic scans active.",
      "Rotate and re-restrict any Gemini API key after suspected exposure."
    ]
  };
}

export async function verifyCloudCostControls(fetchImpl: typeof fetch = fetch): Promise<CloudCostControlVerificationResult> {
  const center = buildCloudCostControlCenter({ agentRuns: [] });
  const checks: CloudCostControlVerificationResult["checks"] = [];
  const missingConfig = [
    ["GOOGLE_CLOUD_PROJECT", sentinelConfig.googleCloudProject],
    ["GOOGLE_CLOUD_BILLING_ACCOUNT_ID", sentinelConfig.googleCloudBillingAccountId],
    ["SENTINEL_GCP_BUDGET_ID", sentinelConfig.googleCloudBudgetId],
    ["GOOGLE_CLOUD_PROJECT_NUMBER", sentinelConfig.googleCloudProjectNumber],
    ["SENTINEL_GEMINI_API_KEY_ID", sentinelConfig.geminiApiKeyId]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (sentinelConfig.cloudCostControlsMode !== "production" || missingConfig.length) {
    return {
      generatedAt: new Date().toISOString(),
      status: "blocked",
      attemptedLiveApi: false,
      checks: [
        {
          target: "configuration",
          status: "blocked",
          detail: `Live cost-control verification requires SENTINEL_CLOUD_COST_CONTROLS_MODE=production and configured GCP identifiers. Missing: ${missingConfig.join(", ") || "none"}.`
        },
        {
          target: "quota",
          status: "blocked",
          detail: "Local plan mode cannot prove Google Cloud quota or budget enforcement."
        }
      ]
    };
  }

  try {
    const accessToken = await fetchCloudRunAccessToken(fetchImpl);
    checks.push({
      target: "access-token",
      status: "passed",
      detail: "Resolved Google Cloud access token from env or Cloud Run metadata server."
    });

    const budgetResult = await fetchGoogleJson(center.budgetPlan.endpoint, accessToken, fetchImpl);
    checks.push({
      target: "budget",
      status: budgetResult.ok ? "passed" : "failed",
      detail: budgetResult.ok
        ? "Cloud Billing budget is readable through the configured billing account and budget id."
        : "Unable to read the configured Cloud Billing budget.",
      url: center.budgetPlan.endpoint,
      httpStatus: budgetResult.status
    });

    const apiKeyReadUrl = center.apiKeyRestrictionPlan.endpoint.replace("?updateMask=restrictions", "");
    const keyResult = await fetchGoogleJson(apiKeyReadUrl, accessToken, fetchImpl);
    checks.push({
      target: "api-key",
      status: keyResult.ok ? "passed" : "failed",
      detail: keyResult.ok
        ? "Gemini API key resource is readable; confirm restrictions match the generated plan before launch."
        : "Unable to read the configured Gemini API key resource.",
      url: apiKeyReadUrl,
      httpStatus: keyResult.status
    });

    checks.push({
      target: "quota",
      status: sentinelConfig.geminiApiAllowedServerIps.length ? "passed" : "blocked",
      detail: sentinelConfig.geminiApiAllowedServerIps.length
        ? `Application guardrails are configured for ${center.quotaPlan.dailyRequestLimit} requests/day and ${center.quotaPlan.dailyTokenLimit} tokens/day; retain GCP quota screenshots as private evidence.`
        : "Static server egress is not configured, so API-key client restriction proof is incomplete."
    });

    return {
      generatedAt: new Date().toISOString(),
      status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
      attemptedLiveApi: true,
      checks
    };
  } catch (error) {
    checks.push({
      target: "configuration",
      status: "failed",
      detail: error instanceof Error ? error.message : "Cloud cost-control verification failed."
    });

    return {
      generatedAt: new Date().toISOString(),
      status: "failed",
      attemptedLiveApi: true,
      checks
    };
  }
}

function buildEvidenceChecklist(
  budgetPlan: CloudBudgetPlan,
  apiKeyRestrictionPlan: ApiKeyRestrictionPlan
): CloudCostControlChecklistItem[] {
  const projectConfigured = Boolean(sentinelConfig.googleCloudProject);
  const billingConfigured = Boolean(sentinelConfig.googleCloudBillingAccountId);
  const budgetConfigured = Boolean(sentinelConfig.googleCloudBudgetId);
  const topicConfigured = Boolean(budgetPlan.pubSubTopic);
  const apiKeyConfigured = Boolean(sentinelConfig.googleCloudProjectNumber && sentinelConfig.geminiApiKeyId);
  const clientRestricted = apiKeyRestrictionPlan.allowedServerIps.length > 0;

  return [
    {
      item: "Google Cloud project selected for production",
      status: projectConfigured ? "configured" : "missing",
      proof: projectConfigured ? sentinelConfig.googleCloudProject : "GOOGLE_CLOUD_PROJECT is empty.",
      fix: "Set GOOGLE_CLOUD_PROJECT to the deployed Cloud Run project."
    },
    {
      item: "Cloud Billing account attached",
      status: billingConfigured ? "configured" : "missing",
      proof: billingConfigured ? maskIdentifier(sentinelConfig.googleCloudBillingAccountId) : "No billing account id configured.",
      fix: "Set GOOGLE_CLOUD_BILLING_ACCOUNT_ID and keep billing evidence private."
    },
    {
      item: "Monthly budget and alert thresholds created",
      status: budgetConfigured ? "configured" : "planned",
      proof: budgetConfigured ? budgetPlan.endpoint : "Budget request body is generated but not verified.",
      fix: "Create the Cloud Billing budget and set SENTINEL_GCP_BUDGET_ID."
    },
    {
      item: "Budget Pub/Sub notifications connected",
      status: topicConfigured ? "configured" : "planned",
      proof: budgetPlan.pubSubTopic ?? "No Pub/Sub topic configured.",
      fix: "Set SENTINEL_BUDGET_PUBSUB_TOPIC and connect the alert handler to pause Tier 2 calls."
    },
    {
      item: "Gemini API key resource tracked",
      status: apiKeyConfigured ? "configured" : "missing",
      proof: apiKeyConfigured ? apiKeyRestrictionPlan.endpoint : "Project number or key id missing.",
      fix: "Set GOOGLE_CLOUD_PROJECT_NUMBER and SENTINEL_GEMINI_API_KEY_ID without storing the secret key value."
    },
    {
      item: "Gemini key API target restriction",
      status: apiKeyConfigured ? "planned" : "missing",
      proof: `${GEMINI_API_TARGET} is the only planned API target.`,
      fix: "Apply the generated API Keys API restriction patch and retain a console/API screenshot."
    },
    {
      item: "Gemini key client restriction",
      status: clientRestricted ? "configured" : "planned",
      proof: clientRestricted
        ? `${apiKeyRestrictionPlan.allowedServerIps.length} server IP restriction(s) configured.`
        : "No static server egress IP configured.",
      fix: "Use static Cloud Run egress or an equivalent server-only restriction before public launch."
    }
  ];
}

function buildCostControlWarnings(budgetPlan: CloudBudgetPlan, apiKeyRestrictionPlan: ApiKeyRestrictionPlan) {
  return [
    ...(!sentinelConfig.googleCloudProject ? ["GOOGLE_CLOUD_PROJECT is required for production cost evidence."] : []),
    ...(!sentinelConfig.googleCloudBillingAccountId
      ? ["GOOGLE_CLOUD_BILLING_ACCOUNT_ID is required to create or verify Cloud Billing budgets."]
      : []),
    ...(!sentinelConfig.googleCloudBudgetId
      ? ["SENTINEL_GCP_BUDGET_ID is missing, so the app can generate a budget plan but cannot prove the budget exists."]
      : []),
    ...(!budgetPlan.pubSubTopic ? ["No budget Pub/Sub topic is configured for automated spend response."] : []),
    ...(!sentinelConfig.googleCloudProjectNumber || !sentinelConfig.geminiApiKeyId
      ? ["GOOGLE_CLOUD_PROJECT_NUMBER and SENTINEL_GEMINI_API_KEY_ID are required to verify API key restrictions."]
      : []),
    ...apiKeyRestrictionPlan.warnings
  ];
}

async function fetchGoogleJson(url: string, accessToken: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl(url, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  return {
    ok: response.ok,
    status: response.status
  };
}

function maskIdentifier(value: string) {
  if (value.length <= 6) {
    return "***";
  }

  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}
