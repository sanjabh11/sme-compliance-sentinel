import { NextResponse } from "next/server";
import { createTrustAccessRequest, getDashboardSnapshot } from "@/lib/store";

export async function GET() {
  const snapshot = getDashboardSnapshot();
  return NextResponse.json({
    documents: snapshot.trustDocuments,
    accessRequests: snapshot.trustAccessRequests,
    summary: snapshot.readiness.trustAccess
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      prospectAlias?: string;
      prospectDomain?: string;
      requesterEmail?: string;
      requestedDocumentIds?: string[];
      ndaAccepted?: boolean;
    };

    return NextResponse.json(createTrustAccessRequest(body), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Trust access request failed."
      },
      { status: 400 }
    );
  }
}
