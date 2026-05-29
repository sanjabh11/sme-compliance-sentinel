import { createHash, timingSafeEqual } from "node:crypto";
import {
  adminSessionCookieName,
  adminSessionValuePrefix,
  adminTokenHeader,
  buildAdminSessionHashInput,
  getExpectedAdminToken,
  requiresAdminProtection
} from "@/lib/admin-session";

export type AdminActionAuthResult =
  | { ok: true; mode: "local-bypass" | "token" | "session" }
  | { ok: false; status: 401 | 403 | 503; error: string };

export function authorizeAdminAction(request: Request, actionLabel = "production operator action"): AdminActionAuthResult {
  if (!requiresAdminProtection()) {
    return { ok: true, mode: "local-bypass" };
  }

  const expectedToken = getExpectedAdminToken();
  if (!expectedToken) {
    return {
      ok: false,
      status: 503,
      error: `Admin-only ${actionLabel} requires SENTINEL_ADMIN_ACTION_TOKEN from Secret Manager.`
    };
  }

  const providedToken = readProvidedToken(request);
  const providedSession = readAdminSessionCookie(request.headers.get("cookie") ?? "");
  if (!providedToken && !providedSession) {
    return {
      ok: false,
      status: 401,
      error: `Missing ${adminTokenHeader}, Bearer token, or admin session for ${actionLabel}.`
    };
  }

  if (providedToken && safeEqual(providedToken, expectedToken)) {
    return { ok: true, mode: "token" };
  }

  if (providedSession && isValidAdminSessionValue(providedSession, expectedToken)) {
    return { ok: true, mode: "session" };
  }

  return { ok: false, status: 403, error: `Invalid ${actionLabel} token or admin session.` };
}

export function buildAdminSessionValue(token = getExpectedAdminToken()) {
  if (!token) {
    return "";
  }

  return `${adminSessionValuePrefix}${createHash("sha256").update(buildAdminSessionHashInput(token)).digest("hex")}`;
}

export function isValidAdminSessionValue(value: string | undefined, expectedToken = getExpectedAdminToken()) {
  if (!value || !expectedToken || !value.startsWith(adminSessionValuePrefix)) {
    return false;
  }

  return safeEqual(value, buildAdminSessionValue(expectedToken));
}

function readProvidedToken(request: Request) {
  const explicitHeader = request.headers.get(adminTokenHeader)?.trim();
  if (explicitHeader) {
    return explicitHeader;
  }

  const authorization = request.headers.get("authorization")?.trim();
  const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/iu);
  return bearerMatch?.[1]?.trim() ?? "";
}

function readAdminSessionCookie(cookieHeader: string) {
  const cookies = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  const match = cookies.find((item) => item.startsWith(`${adminSessionCookieName}=`));
  return match?.slice(adminSessionCookieName.length + 1).trim() ?? "";
}

function safeEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
