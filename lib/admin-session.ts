export const adminTokenHeader = "x-sentinel-admin-token";
export const adminSessionCookieName = "sentinel_admin_session";
export const adminSessionCookieMaxAgeSeconds = 60 * 60 * 8;
export const adminSessionValuePrefix = "v1:";

export function isPublicSurfaceLockdownEnabled() {
  return process.env.SENTINEL_PUBLIC_SURFACE_LOCKDOWN === "true";
}

export function requiresAdminProtection() {
  return (
    isPublicSurfaceLockdownEnabled() ||
    process.env.SENTINEL_MOCK_MODE === "false" ||
    process.env.SENTINEL_EVIDENCE_MODE === "production"
  );
}

export function getExpectedAdminToken() {
  return process.env.SENTINEL_ADMIN_ACTION_TOKEN?.trim() ?? "";
}

export function buildAdminSessionHashInput(token: string) {
  return `sme-workspace-sentinel-admin-session:${token}`;
}

export function isPublicApiPath(pathname: string) {
  return (
    pathname === "/api/customer/leads" ||
    pathname === "/api/customer/consent-packet" ||
    pathname === "/api/compliance/claims" ||
    pathname === "/api/xprize/judge-access-pack" ||
    pathname === "/api/xprize/submission-gate" ||
    pathname === "/api/admin/session"
  );
}
