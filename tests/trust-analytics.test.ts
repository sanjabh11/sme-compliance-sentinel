import { describe, expect, it } from "vitest";
import { buildTrustCenterAnalytics } from "@/lib/trust-center";
import {
  accessTrustPacket,
  approveTrustAccessRequest,
  createTrustAccessRequest,
  createTrustPacket,
  getDashboardSnapshot,
  resetState
} from "@/lib/store";

describe("Trust Center analytics", () => {
  it("summarizes packet access into prospect engagement and follow-up actions", () => {
    resetState();
    const { request } = createTrustAccessRequest({
      prospectAlias: "Redacted enterprise buyer",
      prospectDomain: "enterprise.example",
      requesterEmail: "security@enterprise.example",
      ndaAccepted: true
    });
    approveTrustAccessRequest(request.id);
    const { packet } = createTrustPacket({
      prospectAlias: "Redacted enterprise buyer",
      prospectDomain: "enterprise.example",
      accessRequestId: request.id
    });

    accessTrustPacket(packet.token);
    accessTrustPacket(packet.token);
    accessTrustPacket(packet.token);

    const analytics = buildTrustCenterAnalytics(getDashboardSnapshot());

    expect(analytics.packetsCreated).toBe(1);
    expect(analytics.totalPacketAccesses).toBe(3);
    expect(analytics.accessedPackets).toBe(1);
    expect(analytics.averageAccessesPerPacket).toBe(3);
    expect(analytics.topProspects[0]).toMatchObject({
      prospectDomain: "enterprise.example",
      stage: "hot",
      accessCount: 3
    });
    expect(analytics.followUpQueue[0].nextAction).toContain("book a security-review follow-up");
    expect(analytics.productionGaps.join(" ")).toContain("Firestore/BigQuery");
  });

  it("keeps unaccessed packets out of traction follow-up evidence", () => {
    resetState();
    createTrustPacket({ prospectAlias: "Redacted quiet prospect", prospectDomain: "quiet.example" });

    const analytics = buildTrustCenterAnalytics(getDashboardSnapshot());

    expect(analytics.packetsCreated).toBe(1);
    expect(analytics.totalPacketAccesses).toBe(0);
    expect(analytics.topProspects[0].stage).toBe("new");
    expect(analytics.followUpQueue).toHaveLength(0);
    expect(analytics.productionGaps.join(" ")).toContain("real prospect packet access");
  });
});
