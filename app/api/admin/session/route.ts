import { NextResponse } from "next/server";
import {
  buildAdminSessionValue,
  isValidAdminSessionValue
} from "@/lib/admin-action-auth";
import {
  adminSessionCookieMaxAgeSeconds,
  adminSessionCookieName,
  adminTokenHeader,
  getExpectedAdminToken,
  isPublicSurfaceLockdownEnabled
} from "@/lib/admin-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isPublicSurfaceLockdownEnabled()) {
    return NextResponse.json(
      { ok: true, status: "lockdown-disabled" },
      {
        headers: { "cache-control": "no-store" }
      }
    );
  }

  const expectedToken = getExpectedAdminToken();
  if (!expectedToken) {
    return NextResponse.json(
      { ok: false, error: "Admin unlock requires SENTINEL_ADMIN_ACTION_TOKEN from Secret Manager." },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  const providedToken = await readSessionRequestToken(request);
  if (!providedToken) {
    return NextResponse.json(
      { ok: false, error: `Provide ${adminTokenHeader}, Bearer token, or token field to unlock the admin console.` },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }

  if (!isValidAdminSessionValue(buildAdminSessionValue(providedToken), expectedToken)) {
    return NextResponse.json(
      { ok: false, error: "Invalid admin unlock token." },
      { status: 403, headers: { "cache-control": "no-store" } }
    );
  }

  const response = NextResponse.json(
    { ok: true, status: "admin-session-created" },
    {
      headers: { "cache-control": "no-store" }
    }
  );
  response.cookies.set(adminSessionCookieName, buildAdminSessionValue(expectedToken), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: adminSessionCookieMaxAgeSeconds
  });

  return response;
}

export async function DELETE() {
  const response = NextResponse.json(
    { ok: true, status: "admin-session-cleared" },
    {
      headers: { "cache-control": "no-store" }
    }
  );
  response.cookies.set(adminSessionCookieName, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
  return response;
}

async function readSessionRequestToken(request: Request) {
  const headerToken = request.headers.get(adminTokenHeader)?.trim();
  if (headerToken) {
    return headerToken;
  }

  const bearerMatch = request.headers.get("authorization")?.trim().match(/^Bearer\s+(.+)$/iu);
  if (bearerMatch?.[1]) {
    return bearerMatch[1].trim();
  }

  const body = (await request.json().catch(() => ({}))) as { token?: string };
  return body.token?.trim() ?? "";
}
