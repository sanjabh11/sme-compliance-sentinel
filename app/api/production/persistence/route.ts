import { NextResponse } from "next/server";
import {
  buildBigQueryAgentRunInsertRequest,
  buildBigQueryAgentRunTableSchemaPlan,
  buildBigQueryAuditInsertRequest,
  buildBigQueryAuditTableSchemaPlan,
  buildPersistenceReadiness,
  buildSecretManagerAccessVersionRequest,
  buildWorkspaceTokenSecretName,
  verifyPersistenceWriteThrough
} from "@/lib/persistence";
import { getDashboardSnapshot } from "@/lib/store";

export async function GET() {
  const snapshot = getDashboardSnapshot();
  const latestAuditEvent = snapshot.auditEvents[0];
  const latestAgentRun = snapshot.agentRuns[0];

  return NextResponse.json({
    readiness: buildPersistenceReadiness(),
    sampleSecretName: buildWorkspaceTokenSecretName(),
    sampleSecretAccess: buildSecretManagerAccessVersionRequest(),
    sampleBigQueryTableSchema: buildBigQueryAuditTableSchemaPlan(),
    sampleBigQueryInsert: latestAuditEvent ? buildBigQueryAuditInsertRequest([latestAuditEvent]) : null,
    sampleBigQueryAgentRunTableSchema: buildBigQueryAgentRunTableSchemaPlan(),
    sampleBigQueryAgentRunInsert: latestAgentRun ? buildBigQueryAgentRunInsertRequest([latestAgentRun]) : null
  });
}

export async function POST() {
  const snapshot = getDashboardSnapshot();
  const result = await verifyPersistenceWriteThrough({
    auditEvents: snapshot.auditEvents,
    agentRuns: snapshot.agentRuns,
    pilotRecords: snapshot.pilotRecords
  });

  return NextResponse.json(result, {
    status: result.status === "passed" ? 200 : result.status === "blocked" ? 409 : 502
  });
}
