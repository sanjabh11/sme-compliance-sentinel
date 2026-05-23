import { describe, expect, it } from "vitest";
import {
  accessTrustPacket,
  approveTrustAccessRequest,
  createDemoEvent,
  createTrustAccessRequest,
  createTrustPacket,
  getDashboardSnapshot,
  ingestResourceEvent,
  resetState
} from "@/lib/store";

describe("Trust Packet access workflow", () => {
  it("creates a redacted, time-limited prospect packet and logs access", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const { packet, snapshot } = createTrustPacket({
      prospectAlias: "Acme procurement team",
      prospectDomain: "acme.example",
      expiresInDays: 7
    });
    const serialized = JSON.stringify(packet);

    expect(packet.status).toBe("active");
    expect(packet.redacted).toBe(true);
    expect(packet.accessUrl).toContain("/api/trust-center/packets/");
    expect(packet.sections).toEqual(
      expect.arrayContaining(["trust-profile", "risk-metrics", "approved-documents", "ai-operations", "consented-testimonials"])
    );
    expect(packet.summaryMetrics.risksDetected).toBeGreaterThanOrEqual(1);
    expect(packet.summaryMetrics.approvedDocuments).toBe(1);
    expect(packet.approvedDocuments.map((document) => document.visibility)).toEqual(["public"]);
    expect(packet.questionnairePreview.every((question) => question.approvalRequired)).toBe(true);
    expect(serialized).not.toContain("AWS_SECRET_ACCESS_KEY");
    expect(serialized).not.toContain("founder@");
    expect(serialized).not.toContain("Vendor security packet");
    expect(snapshot.trustPackets[0].id).toBe(packet.id);

    const access = accessTrustPacket(packet.token);
    const accessedPacket = access.packet;

    expect(access.status).toBe("available");
    expect(accessedPacket?.accessCount).toBe(1);
    expect(getDashboardSnapshot().auditEvents.some((event) => event.type === "trust_packet_accessed")).toBe(true);
  });

  it("refuses expired packet access", () => {
    resetState();
    const { packet } = createTrustPacket({ prospectAlias: "Expired prospect", expiresInDays: -1 });

    const access = accessTrustPacket(packet.token);

    expect(access.status).toBe("expired");
    expect(access.packet?.status).toBe("expired");
  });

  it("gates requestable documents behind NDA-aware approval before adding them to packets", () => {
    resetState();
    const requestableIds = getDashboardSnapshot().trustDocuments
      .filter((document) => document.visibility === "requestable")
      .map((document) => document.id);

    const { request } = createTrustAccessRequest({
      prospectAlias: "Acme procurement team",
      prospectDomain: "acme.example",
      requesterEmail: "buyer@acme.example",
      requestedDocumentIds: requestableIds,
      ndaAccepted: true
    });

    expect(request.status).toBe("pending");
    expect(request.approverRole).toBe("legal");

    const approvedSnapshot = approveTrustAccessRequest(request.id);
    const approvedRequest = approvedSnapshot.trustAccessRequests[0];

    expect(approvedRequest.status).toBe("approved");
    expect(approvedRequest.approvedDocumentIds).toHaveLength(requestableIds.length);
    expect(approvedSnapshot.auditEvents.some((event) => event.type === "trust_access_approved")).toBe(true);

    const { packet } = createTrustPacket({
      prospectAlias: "Acme procurement team",
      prospectDomain: "acme.example",
      accessRequestId: request.id
    });
    const serialized = JSON.stringify(packet);

    expect(packet.accessRequestId).toBe(request.id);
    expect(packet.approvedDocuments).toHaveLength(requestableIds.length + 1);
    expect(packet.approvedDocuments.some((document) => document.requiresNda)).toBe(true);
    expect(serialized).not.toContain("Raw customer finding logs");
    expect(serialized).not.toContain("Internal-only customer security finding details");
    expect(getDashboardSnapshot().readiness.trustAccess.approvedRequests).toBe(1);
  });
});
