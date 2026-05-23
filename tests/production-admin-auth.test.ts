import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as postCostControls } from "@/app/api/production/cost-controls/route";
import { POST as postGeminiSmoke } from "@/app/api/production/gemini-smoke/route";
import { POST as postPersistence } from "@/app/api/production/persistence/route";
import { POST as postWorkspaceBootstrap } from "@/app/api/workspace/sync/bootstrap/route";
import { POST as postWorkspaceReconcile } from "@/app/api/workspace/sync/reconcile/route";
import { resetState } from "@/lib/store";

const protectedRoutes = [
  ["Gemini smoke", postGeminiSmoke],
  ["Persistence write-through", postPersistence],
  ["Cost controls", postCostControls],
  ["Workspace bootstrap", postWorkspaceBootstrap],
  ["Workspace reconciliation", postWorkspaceReconcile]
] as const;

describe("production admin action authentication", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetState();
  });

  it.each(protectedRoutes)("blocks unauthenticated production %s calls before side effects", async (_label, post) => {
    vi.stubEnv("SENTINEL_MOCK_MODE", "false");
    vi.stubEnv("SENTINEL_ADMIN_ACTION_TOKEN", "private-admin-token");

    const response = await post(request());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toContain("x-sentinel-admin-token");
    expect(JSON.stringify(body)).not.toContain("private-admin-token");
  });

  it("rejects invalid production admin action tokens", async () => {
    vi.stubEnv("SENTINEL_MOCK_MODE", "false");
    vi.stubEnv("SENTINEL_ADMIN_ACTION_TOKEN", "private-admin-token");

    const response = await postGeminiSmoke(request("wrong-token"));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it("allows local mock-mode proof actions without an operator token", async () => {
    vi.stubEnv("SENTINEL_MOCK_MODE", "true");

    const response = await postWorkspaceReconcile(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("result");
  });
});

function request(token?: string) {
  return new Request("https://sentinel.example.com/operator-proof", {
    method: "POST",
    headers: token ? { "x-sentinel-admin-token": token } : {}
  });
}
