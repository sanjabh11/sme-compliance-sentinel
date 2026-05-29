import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as createAdminSession, DELETE as deleteAdminSession } from "@/app/api/admin/session/route";
import { buildAdminSessionValue } from "@/lib/admin-action-auth";
import { adminSessionCookieName } from "@/lib/admin-session";
import { proxy } from "../proxy";

describe("public surface admin lockdown", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("blocks internal APIs without a token when public lockdown is enabled", async () => {
    vi.stubEnv("SENTINEL_PUBLIC_SURFACE_LOCKDOWN", "true");
    vi.stubEnv("SENTINEL_ADMIN_ACTION_TOKEN", "private-admin-token");

    const response = await proxy(request("/api/readiness"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toContain("admin session");
    expect(JSON.stringify(body)).not.toContain("private-admin-token");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps public customer and judge-smoke APIs reachable during lockdown", async () => {
    vi.stubEnv("SENTINEL_PUBLIC_SURFACE_LOCKDOWN", "true");
    vi.stubEnv("SENTINEL_ADMIN_ACTION_TOKEN", "private-admin-token");

    const publicPaths = [
      "/api/customer/leads",
      "/api/customer/consent-packet",
      "/api/compliance/claims",
      "/api/xprize/judge-access-pack",
      "/api/xprize/submission-gate"
    ];

    for (const path of publicPaths) {
      const response = await proxy(request(path));
      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("allows internal APIs with the admin header, Bearer token, or hashed admin session cookie", async () => {
    vi.stubEnv("SENTINEL_PUBLIC_SURFACE_LOCKDOWN", "true");
    vi.stubEnv("SENTINEL_ADMIN_ACTION_TOKEN", "private-admin-token");
    const sessionValue = buildAdminSessionValue("private-admin-token");

    const headerResponse = await proxy(request("/api/readiness", { "x-sentinel-admin-token": "private-admin-token" }));
    const bearerResponse = await proxy(request("/api/strategy", { authorization: "Bearer private-admin-token" }));
    const cookieResponse = await proxy(request("/api/evidence/export", { cookie: `${adminSessionCookieName}=${sessionValue}` }));

    expect(headerResponse.headers.get("x-middleware-next")).toBe("1");
    expect(bearerResponse.headers.get("x-middleware-next")).toBe("1");
    expect(cookieResponse.headers.get("x-middleware-next")).toBe("1");
  });

  it("creates and clears an httpOnly admin session without returning the raw token", async () => {
    vi.stubEnv("SENTINEL_PUBLIC_SURFACE_LOCKDOWN", "true");
    vi.stubEnv("SENTINEL_ADMIN_ACTION_TOKEN", "private-admin-token");

    const createResponse = await createAdminSession(
      new Request("https://sentinel.example.com/api/admin/session", {
        method: "POST",
        headers: { "x-sentinel-admin-token": "private-admin-token" }
      })
    );
    const createBody = await createResponse.json();
    const setCookie = createResponse.headers.get("set-cookie") ?? "";

    expect(createResponse.status).toBe(200);
    expect(createBody).toMatchObject({ ok: true, status: "admin-session-created" });
    expect(setCookie).toContain(adminSessionCookieName);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).not.toContain("private-admin-token");

    const deleteResponse = await deleteAdminSession();
    expect(deleteResponse.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("fails closed when lockdown is enabled but no admin token is configured", async () => {
    vi.stubEnv("SENTINEL_PUBLIC_SURFACE_LOCKDOWN", "true");
    vi.stubEnv("SENTINEL_ADMIN_ACTION_TOKEN", "");

    const response = await proxy(request("/api/readiness"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toContain("SENTINEL_ADMIN_ACTION_TOKEN");
  });
});

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://sentinel.example.com${path}`, { headers });
}
