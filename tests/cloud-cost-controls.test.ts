import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildApiKeyRestrictionPlan,
  buildCloudBudgetPlan,
  buildCloudCostControlCenter,
  verifyCloudCostControls
} from "@/lib/cloud-cost-controls";
import type { AgentRun } from "@/lib/types";

const agentRun: AgentRun = {
  id: "agent_1",
  tenantId: "tenant_mainstreet_security",
  purpose: "semantic_risk_audit",
  model: "gemini-3.5-flash",
  provider: "gemini-api",
  inputTokensEstimated: 1000,
  outputTokensEstimated: 120,
  estimatedCostUsd: 0.0012,
  promptSummary: "Risk audit",
  outputSummary: "Finding staged",
  startedAt: "2026-05-22T00:00:00.000Z",
  completedAt: "2026-05-22T00:00:01.000Z"
};

const productionCostControlEnv = {
  SENTINEL_CLOUD_COST_CONTROLS_MODE: "production",
  GOOGLE_CLOUD_PROJECT: "sentinel-prod",
  GOOGLE_CLOUD_BILLING_ACCOUNT_ID: "000000-111111-222222",
  SENTINEL_GCP_BUDGET_ID: "billingAccounts/000000-111111-222222/budgets/budget-123",
  GOOGLE_CLOUD_PROJECT_NUMBER: "123456789012",
  SENTINEL_GEMINI_API_KEY_ID: "projects/123456789012/locations/global/keys/gemini-key-123",
  SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS: "34.10.10.10",
  SENTINEL_GEMINI_QUOTA_EVIDENCE_CONFIRMED: "true",
  GOOGLE_CLOUD_ACCESS_TOKEN: "test-access-token"
};

describe("cloud cost controls", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("builds a Cloud Billing budget plan with alert thresholds and Pub/Sub response hooks", () => {
    const budgetPlan = buildCloudBudgetPlan();

    expect(budgetPlan.endpoint).toContain("billingbudgets.googleapis.com");
    expect(budgetPlan.requestBody).toMatchObject({
      displayName: "SME Workspace Sentinel monthly GCP and Gemini budget"
    });
    expect(budgetPlan.alertThresholds.map((threshold) => threshold.percent)).toEqual([0.5, 0.75, 0.9, 1]);
    expect(JSON.stringify(budgetPlan.requestBody)).toContain("thresholdRules");
  });

  it("plans Gemini API key restrictions without storing the secret key value", () => {
    const restrictionPlan = buildApiKeyRestrictionPlan();

    expect(restrictionPlan.endpoint).toContain("apikeys.googleapis.com");
    expect(restrictionPlan.endpoint).not.toContain("GEMINI_API_KEY=");
    expect(restrictionPlan.requiredApiTargets).toEqual(["generativelanguage.googleapis.com"]);
    expect(JSON.stringify(restrictionPlan.requestBody)).toContain("apiTargets");
    expect(restrictionPlan.clientRestrictionMode).toBe("pending-static-egress");
  });

  it("normalizes full production resource names for budget and API key verification endpoints", async () => {
    const controls = await loadCostControlsWithEnv(productionCostControlEnv);
    const budgetPlan = controls.buildCloudBudgetPlan();
    const restrictionPlan = controls.buildApiKeyRestrictionPlan();

    expect(budgetPlan.endpoint).toBe(
      "https://billingbudgets.googleapis.com/v1/billingAccounts/000000-111111-222222/budgets/budget-123"
    );
    expect(restrictionPlan.endpoint).toBe(
      "https://apikeys.googleapis.com/v2/projects/123456789012/locations/global/keys/gemini-key-123?updateMask=restrictions"
    );
    expect(JSON.stringify(restrictionPlan.requestBody)).toContain("serverKeyRestrictions");
  });

  it("exposes missing production proof instead of treating local cost limits as GCP evidence", () => {
    const center = buildCloudCostControlCenter({ agentRuns: [agentRun] });

    expect(center.status).toBe("blocked");
    expect(center.estimatedGeminiSpendUsd).toBe(0.0012);
    expect(center.evidenceChecklist.some((item) => item.item.includes("Cloud Billing"))).toBe(true);
    expect(center.warnings.join(" ")).toContain("GOOGLE_CLOUD_PROJECT");
    expect(center.runbook.join(" ")).toContain("pause Tier 2 Gemini");
  });

  it("blocks live verification in local plan mode without calling Google APIs", async () => {
    const fetchImpl = vi.fn();
    const result = await verifyCloudCostControls(fetchImpl as unknown as typeof fetch);

    expect(result.status).toBe("blocked");
    expect(result.attemptedLiveApi).toBe(false);
    expect(result.checks[0].detail).toContain("SENTINEL_CLOUD_COST_CONTROLS_MODE=production");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("passes live verification only when Gemini API key restrictions and quota evidence match the production plan", async () => {
    const controls = await loadCostControlsWithEnv(productionCostControlEnv);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("billingbudgets.googleapis.com")) {
        return jsonResponse({
          name: "billingAccounts/000000-111111-222222/budgets/budget-123"
        });
      }

      if (url.includes("apikeys.googleapis.com")) {
        return jsonResponse({
          name: "projects/123456789012/locations/global/keys/gemini-key-123",
          restrictions: {
            apiTargets: [{ service: "generativelanguage.googleapis.com" }],
            serverKeyRestrictions: {
              allowedIps: ["34.10.10.10"]
            }
          }
        });
      }

      return new Response("not found", { status: 404 });
    });

    const result = await controls.verifyCloudCostControls(fetchImpl as unknown as typeof fetch);

    expect(result.status).toBe("passed");
    expect(result.attemptedLiveApi).toBe(true);
    expect(result.checks.find((check) => check.target === "api-key")?.detail).toContain(
      "restricted to generativelanguage.googleapis.com"
    );
    expect(result.checks.find((check) => check.target === "quota")?.detail).toContain("private quota/usage proof");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails live verification when the API key allows extra API targets or quota proof is not confirmed", async () => {
    const controls = await loadCostControlsWithEnv({
      ...productionCostControlEnv,
      SENTINEL_GEMINI_QUOTA_EVIDENCE_CONFIRMED: "false"
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("billingbudgets.googleapis.com")) {
        return jsonResponse({
          name: "billingAccounts/000000-111111-222222/budgets/budget-123"
        });
      }

      if (url.includes("apikeys.googleapis.com")) {
        return jsonResponse({
          restrictions: {
            apiTargets: [
              { service: "generativelanguage.googleapis.com" },
              { service: "translate.googleapis.com" }
            ],
            serverKeyRestrictions: {
              allowedIps: []
            }
          }
        });
      }

      return new Response("not found", { status: 404 });
    });

    const result = await controls.verifyCloudCostControls(fetchImpl as unknown as typeof fetch);

    expect(result.status).toBe("failed");
    expect(result.checks.find((check) => check.target === "api-key")?.status).toBe("failed");
    expect(result.checks.find((check) => check.target === "api-key")?.detail).toContain(
      "unexpected API target"
    );
    expect(result.checks.find((check) => check.target === "quota")?.status).toBe("blocked");
  });
});

async function loadCostControlsWithEnv(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }

  return import("@/lib/cloud-cost-controls");
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}
