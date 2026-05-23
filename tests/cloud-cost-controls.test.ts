import { describe, expect, it, vi } from "vitest";
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

describe("cloud cost controls", () => {
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
    expect(JSON.stringify(restrictionPlan.requestBody)).toContain("api_targets");
    expect(restrictionPlan.clientRestrictionMode).toBe("pending-static-egress");
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
});
