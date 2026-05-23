import { NextResponse } from "next/server";
import { buildDealImpactReport } from "@/lib/deal-impact";
import { getDashboardSnapshot, writeAudit } from "@/lib/store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redacted = url.searchParams.get("redacted") !== "false";
  const targetAlias = url.searchParams.get("targetAlias") ?? undefined;
  const targetSegment = url.searchParams.get("targetSegment") ?? undefined;
  const report = buildDealImpactReport(getDashboardSnapshot(), { redacted, targetAlias, targetSegment });

  writeAudit("system", "evidence_exported", "Deal impact report generated.", "deal-impact-report", {
    redacted,
    targetSegment: report.targetSegment,
    productionGaps: report.productionGaps.length
  });

  return NextResponse.json(report, {
    headers: {
      "content-disposition": `attachment; filename="sentinel-deal-impact-report.json"`
    }
  });
}
