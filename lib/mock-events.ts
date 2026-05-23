import { createHash } from "node:crypto";
import { sentinelConfig } from "@/lib/config";
import type { ResourceEvent } from "@/lib/types";

function hashContent(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

export function makePublicSecretDriveEvent(): ResourceEvent {
  const content = [
    "Customer: Northstar Health",
    "Status: vendor security review",
    "AWS_SECRET_ACCESS_KEY = wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    "Patient contact: customer@example.com",
    "Next step: upload SOC2 readiness checklist"
  ].join("\n");

  return {
    id: "evt_drive_public_secret",
    tenantId: sentinelConfig.tenantId,
    source: "drive",
    resourceId: "drive_file_security_pack_001",
    resourceName: "Vendor security packet - public link.txt",
    mimeType: "text/plain",
    actorEmail: "founder@mainstreet-security.example",
    ownerEmail: "cto@mainstreet-security.example",
    eventType: "permission_changed",
    occurredAt: new Date().toISOString(),
    metadataOnly: false,
    sharing: {
      public: true,
      externalDomains: ["unknown.example"],
      anyoneWithLink: true
    },
    content,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    contentHash: hashContent(content),
    previousContentHash: "previous_hash",
    labels: ["security-review", "customer-data"]
  };
}

export function makeLowRiskThumbnailEvent(): ResourceEvent {
  return {
    id: "evt_drive_thumbnail_low_risk",
    tenantId: sentinelConfig.tenantId,
    source: "drive",
    resourceId: "drive_file_thumbnail_001",
    resourceName: "homepage-thumbnail.png",
    mimeType: "image/png",
    actorEmail: "designer@mainstreet-security.example",
    ownerEmail: "designer@mainstreet-security.example",
    eventType: "metadata_changed",
    occurredAt: new Date().toISOString(),
    metadataOnly: true,
    sharing: {
      public: false,
      externalDomains: [],
      anyoneWithLink: false
    },
    sizeBytes: 8142,
    contentHash: "same_hash",
    previousContentHash: "same_hash",
    labels: ["marketing"]
  };
}

export function makeGmailPiiEvent(): ResourceEvent {
  const content = [
    "Subject: New enterprise trial intake",
    "The attached sheet includes taxpayer IDs and billing contacts.",
    "SSN: 123-45-6789",
    "Credit card: 4111 1111 1111 1111"
  ].join("\n");

  return {
    id: "evt_gmail_pii_trial",
    tenantId: sentinelConfig.tenantId,
    source: "gmail",
    resourceId: "gmail_msg_trial_001",
    resourceName: "Enterprise trial intake email",
    mimeType: "message/rfc822",
    actorEmail: "sales@mainstreet-security.example",
    ownerEmail: "sales@mainstreet-security.example",
    eventType: "message_added",
    occurredAt: new Date().toISOString(),
    metadataOnly: false,
    sharing: {
      public: false,
      externalDomains: ["prospect.example"],
      anyoneWithLink: false
    },
    content,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    contentHash: hashContent(content),
    previousContentHash: "previous_email_hash",
    labels: ["sales", "inbox"]
  };
}

export function makeSyntheticGeminiSmokeEvent(): ResourceEvent {
  const content = [
    "Synthetic production Gemini smoke fixture.",
    "This file contains no real customer, employee, payment, patient, or security data.",
    "Purpose: verify that deployed SME Workspace Sentinel can route a high-risk Workspace-style event to Gemini API.",
    "api_key = SENTINEL_SYNTHETIC_TEST_TOKEN_1234567890",
    "Expected output: staged recommendation only; no Workspace permissions are changed."
  ].join("\n");

  return {
    id: `evt_gemini_smoke_${Date.now()}`,
    tenantId: sentinelConfig.tenantId,
    source: "manual-upload",
    resourceId: "synthetic_gemini_smoke_fixture",
    resourceName: "Synthetic Gemini smoke fixture.txt",
    mimeType: "text/plain",
    actorEmail: "operator@mainstreet-security.example",
    ownerEmail: "operator@mainstreet-security.example",
    eventType: "production_smoke_test",
    occurredAt: new Date().toISOString(),
    metadataOnly: false,
    sharing: {
      public: true,
      externalDomains: ["synthetic.example"],
      anyoneWithLink: true
    },
    content,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    contentHash: hashContent(content),
    previousContentHash: "synthetic_previous_hash",
    labels: ["security-review", "source-code"]
  };
}
