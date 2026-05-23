import { NextResponse } from "next/server";
import { buildFrameworkEvidencePack, parseFrameworkAudience, parseFrameworkName } from "@/lib/framework-evidence";
import { getDashboardSnapshot, writeAudit } from "@/lib/store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const framework = parseFrameworkName(url.searchParams.get("framework"));
  const audience = parseFrameworkAudience(url.searchParams.get("audience"));
  const redacted = url.searchParams.get("redacted") !== "false";
  const pack = buildFrameworkEvidencePack(getDashboardSnapshot(), { framework, redacted, audience });

  writeAudit("system", "framework_pack_exported", `${framework} ${audience} readiness evidence pack exported.`, framework, {
    audience,
    redacted,
    controls: pack.controls.length,
    blocked: pack.summary.blocked
  });

  return NextResponse.json(pack, {
    headers: {
      "content-disposition": `attachment; filename="sentinel-${framework
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}-${audience}-readiness-pack.json"`
    }
  });
}
