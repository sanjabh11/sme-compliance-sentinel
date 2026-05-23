import { createHash, timingSafeEqual } from "node:crypto";

export type AdminActionAuthResult =
  | { ok: true; mode: "local-bypass" | "token" }
  | { ok: false; status: 401 | 403 | 503; error: string };

const adminTokenHeader = "x-sentinel-admin-token";

export function authorizeAdminAction(request: Request): AdminActionAuthResult {
  if (!requiresAdminToken()) {
    return { ok: true, mode: "local-bypass" };
  }

  const expectedToken = process.env.SENTINEL_ADMIN_ACTION_TOKEN?.trim() ?? "";
  if (!expectedToken) {
    return {
      ok: false,
      status: 503,
      error: "Production proof imports require SENTINEL_ADMIN_ACTION_TOKEN from Secret Manager."
    };
  }

  const providedToken = readProvidedToken(request);
  if (!providedToken) {
    return {
      ok: false,
      status: 401,
      error: `Missing ${adminTokenHeader} or Bearer token for production proof import.`
    };
  }

  if (!safeEqual(providedToken, expectedToken)) {
    return { ok: false, status: 403, error: "Invalid production proof import token." };
  }

  return { ok: true, mode: "token" };
}

function requiresAdminToken() {
  return process.env.SENTINEL_MOCK_MODE === "false" || process.env.SENTINEL_EVIDENCE_MODE === "production";
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

function safeEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
