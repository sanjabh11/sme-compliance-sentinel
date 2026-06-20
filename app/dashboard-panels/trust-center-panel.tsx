"use client";

import { CheckCircle2, FileSearch, ShieldCheck, Sparkles } from "lucide-react";
import type { TrustCenterProfile, TrustPacket, TrustAccessSummary, TrustCenterAnalytics } from "@/lib/types";
import { formatUtcDate } from "../dashboard-ui";

export interface TrustCenterPanelProps {
  busy: boolean;
  hasPendingTrustRequests: boolean;
  trustProfile: TrustCenterProfile | null;
  trustPacket: TrustPacket | null;
  trustAccess: TrustAccessSummary;
  trustAnalytics: TrustCenterAnalytics;
  onGenerateProfile: () => void;
  onCreatePacket: () => void;
  onRequestDocuments: () => void;
  onApproveDocuments: () => void;
}

export function TrustCenterPanel({
  busy,
  hasPendingTrustRequests,
  trustProfile,
  trustPacket,
  trustAccess,
  trustAnalytics,
  onGenerateProfile,
  onCreatePacket,
  onRequestDocuments,
  onApproveDocuments
}: TrustCenterPanelProps) {
  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <h2>Trust Center Lite</h2>
          <p>A redacted, prospect-safe trust profile turns evidence into a sales asset.</p>
        </div>
        <ShieldCheck size={24} aria-hidden="true" />
      </div>
      <button type="button" onClick={onGenerateProfile} disabled={busy}>
        <Sparkles size={16} aria-hidden="true" />
        Generate trust profile
      </button>
      <button type="button" className="secondary" onClick={onCreatePacket} disabled={busy}>
        <ShieldCheck size={16} aria-hidden="true" />
        Create Trust Packet
      </button>
      <button type="button" className="secondary" onClick={onRequestDocuments} disabled={busy}>
        <FileSearch size={16} aria-hidden="true" />
        Request docs
      </button>
      <button
        type="button"
        className="secondary"
        onClick={onApproveDocuments}
        disabled={busy || !hasPendingTrustRequests}
      >
        <CheckCircle2 size={16} aria-hidden="true" />
        Approve docs
      </button>
      <div className="verification-list">
        <span data-status={trustAccess.pendingRequests ? "warning" : "passed"}>document access</span>
        <article>
          <strong>Trust documents</strong>
          <p>
            {trustAccess.publicDocuments} public · {trustAccess.requestableDocuments} requestable ·{" "}
            {trustAccess.privateDocuments} private
          </p>
        </article>
        <article>
          <strong>Requests</strong>
          <p>
            {trustAccess.pendingRequests} pending · {trustAccess.approvedRequests} approved ·{" "}
            {trustAccess.ndaRequiredDocuments} NDA-gated document(s)
          </p>
        </article>
        <article>
          <strong>Engagement</strong>
          <p>
            {trustAnalytics.packetsCreated} packet(s) · {trustAnalytics.totalPacketAccesses} access(es) ·{" "}
            {trustAnalytics.followUpQueue.length} follow-up(s)
          </p>
        </article>
      </div>
      {trustAnalytics.packetsCreated ? (
        <div className="trust-analytics-panel" aria-label="Trust Center analytics">
          <div className="trust-analytics-metrics">
            <span>{trustAnalytics.activePackets} active</span>
            <span>{trustAnalytics.accessedPackets} accessed</span>
            <span>{trustAnalytics.averageAccessesPerPacket} avg views</span>
          </div>
          <div className="trust-followups">
            <strong>Prospect follow-up</strong>
            {(trustAnalytics.followUpQueue.length
              ? trustAnalytics.followUpQueue
              : trustAnalytics.topProspects
            )
              .slice(0, 3)
              .map((prospect) => (
                <article key={`${prospect.prospectAlias}-${prospect.prospectDomain ?? "domain"}`}>
                  <span data-stage={prospect.stage}>{prospect.stage}</span>
                  <b>{prospect.prospectAlias}</b>
                  <small>
                    {prospect.accessCount} access(es) · {prospect.approvedDocumentCount} approved doc(s)
                  </small>
                  <p>{prospect.nextAction}</p>
                </article>
              ))}
          </div>
          <small>{trustAnalytics.productionGaps[0]}</small>
        </div>
      ) : null}
      {trustProfile ? (
        <div className="trust-profile">
          <div>
            <span>Readiness posture</span>
            <strong>{trustProfile.readinessPostureScore}%</strong>
          </div>
          <h3>{trustProfile.headline}</h3>
          <ul>
            {trustProfile.approvedClaims.map((claim) => (
              <li key={claim}>{claim}</li>
            ))}
          </ul>
          <p>{trustProfile.disclaimer}</p>
        </div>
      ) : null}
      {trustPacket ? (
        <div className="verification-list">
          <span data-status={trustPacket.status}>{trustPacket.status}</span>
          <article>
            <strong>Prospect access</strong>
            <p>
              {trustPacket.accessUrl} · expires {formatUtcDate(trustPacket.expiresAt)}
            </p>
          </article>
          <article>
            <strong>Packet contents</strong>
            <p>
              {trustPacket.sections.join(" · ")} · {trustPacket.approvedDocuments.length} approved document(s)
            </p>
          </article>
          {trustPacket.approvedDocuments.length ? (
            <article>
              <strong>Approved documents</strong>
              <p>{trustPacket.approvedDocuments.map((document) => document.title).join(" · ")}</p>
            </article>
          ) : null}
          {trustPacket.accessRequestId ? (
            <article>
              <strong>Access approval</strong>
              <p>{trustPacket.accessRequestId}</p>
            </article>
          ) : null}
          <article>
            <strong>Redaction boundary</strong>
            <p>{trustPacket.disclaimer}</p>
          </article>
        </div>
      ) : null}
    </div>
  );
}
