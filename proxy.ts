import { NextRequest, NextResponse } from "next/server";
import {
  adminSessionCookieName,
  adminSessionValuePrefix,
  adminTokenHeader,
  buildAdminSessionHashInput,
  getExpectedAdminToken,
  isPublicApiPath,
  isPublicSurfaceLockdownEnabled
} from "@/lib/admin-session";

export const config = {
  matcher: ["/api/:path*"]
};

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (!isPublicSurfaceLockdownEnabled() || isPublicApiPath(pathname)) {
    return NextResponse.next();
  }

  const expectedToken = getExpectedAdminToken();
  if (!expectedToken) {
    return adminBlockedResponse(503, "Admin-only API access requires SENTINEL_ADMIN_ACTION_TOKEN from Secret Manager.");
  }

  const providedToken = readProvidedToken(request);
  if (providedToken) {
    const tokenValid = await constantDigestEqual(providedToken, expectedToken);
    if (!tokenValid) {
      return adminBlockedResponse(403, "Invalid admin API token.");
    }

    return noStoreNext();
  }

  const sessionValue = request.cookies.get(adminSessionCookieName)?.value ?? "";
  const expectedSession = await buildEdgeAdminSessionValue(expectedToken);
  if (sessionValue && (await constantDigestEqual(sessionValue, expectedSession))) {
    return noStoreNext();
  }

  return adminBlockedResponse(401, `Missing ${adminTokenHeader}, Bearer token, or admin session for admin-only API access.`);
}

function readProvidedToken(request: NextRequest) {
  const headerToken = request.headers.get(adminTokenHeader)?.trim();
  if (headerToken) {
    return headerToken;
  }

  const bearerMatch = request.headers.get("authorization")?.trim().match(/^Bearer\s+(.+)$/iu);
  return bearerMatch?.[1]?.trim() ?? "";
}

async function buildEdgeAdminSessionValue(token: string) {
  return `${adminSessionValuePrefix}${await sha256Hex(buildAdminSessionHashInput(token))}`;
}

async function constantDigestEqual(left: string, right: string) {
  return (await sha256Hex(left)) === (await sha256Hex(right));
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function noStoreNext() {
  const response = NextResponse.next();
  response.headers.set("cache-control", "no-store");
  return response;
}

function adminBlockedResponse(status: 401 | 403 | 503, error: string) {
  return NextResponse.json(
    { ok: false, error },
    {
      status,
      headers: {
        "cache-control": "no-store"
      }
    }
  );
}
