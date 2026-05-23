import { sentinelConfig, nowIso } from "@/lib/config";
import type {
  ApprovalNotification,
  ApprovalOpsSummary,
  ApprovalRbacDecision,
  ApproverIdentity,
  ApproverRole,
  DashboardSnapshot,
  Finding
} from "@/lib/types";

const approverDirectory: ApproverIdentity[] = [
  {
    id: "approver_security_owner",
    role: "security",
    displayName: "Security Owner",
    email: "security-owner@mainstreet-security.example",
    backupEmail: "founder@mainstreet-security.example",
    deliveryChannels: ["in_app", "email", "google_chat"],
    status: "active",
    productionIdentityVerified: false
  },
  {
    id: "approver_legal_review",
    role: "legal",
    displayName: "Legal Reviewer",
    email: "legal-review@mainstreet-security.example",
    backupEmail: "security-owner@mainstreet-security.example",
    deliveryChannels: ["in_app", "email"],
    status: "active",
    productionIdentityVerified: false
  },
  {
    id: "approver_founder",
    role: "founder",
    displayName: "Founder Approver",
    email: "founder@mainstreet-security.example",
    backupEmail: "security-owner@mainstreet-security.example",
    deliveryChannels: ["in_app", "email", "google_chat"],
    status: "active",
    productionIdentityVerified: false
  },
  {
    id: "approver_engineering_owner",
    role: "engineering",
    displayName: "Engineering Owner",
    email: "engineering-owner@mainstreet-security.example",
    backupEmail: "security-owner@mainstreet-security.example",
    deliveryChannels: ["in_app", "email", "webhook"],
    status: "active",
    productionIdentityVerified: false
  }
];

export function getApproverForRole(role: ApproverRole) {
  return approverDirectory.find((identity) => identity.role === role && identity.status === "active") ?? approverDirectory[0];
}

export function getEscalationTargetForRole(role: ApproverRole) {
  return getApproverForRole(role).backupEmail;
}

export function buildApprovalOps(snapshot: Pick<DashboardSnapshot, "findings">): ApprovalOpsSummary {
  const openFindings = snapshot.findings.filter(isOpenApproval);
  const rbacDecisions = openFindings.map(buildRbacDecision);
  const notifications = openFindings.map(buildNotification);
  const roleMismatches = rbacDecisions.filter((decision) => !decision.authorized).length;
  const assignedApprovals = rbacDecisions.filter((decision) => decision.assignedTo !== "unassigned" && decision.authorized).length;

  return {
    directory: approverDirectory.map((identity) => ({
      ...identity,
      productionIdentityVerified: isProductionIdentityVerified()
    })),
    rbacDecisions,
    notifications,
    openApprovals: openFindings.length,
    assignedApprovals,
    roleMismatches,
    queuedNotifications: notifications.filter((notification) => notification.status === "queued").length,
    blockedNotifications: notifications.filter((notification) => notification.status === "blocked").length,
    acknowledgedNotifications: notifications.filter((notification) => notification.status === "acknowledged").length,
    productionGaps: buildProductionGaps(roleMismatches, openFindings.length),
    routingPolicy: [
      "Critical and high-risk Workspace exposure routes to the security approver.",
      "Gmail/legal-context findings route to legal unless the action requires security approval.",
      "Owner-review actions route to founder approval with security backup escalation.",
      "All notification delivery is local/in-app until production identity and delivery channels are verified."
    ]
  };
}

function buildRbacDecision(finding: Finding): ApprovalRbacDecision {
  const approver = getApproverForRole(finding.approval.requiredRole);
  const authorized = finding.approval.assignedTo === approver.email && approver.status === "active";

  return {
    findingId: finding.id,
    resourceName: finding.resourceName,
    requiredRole: finding.approval.requiredRole,
    assignedTo: finding.approval.assignedTo || "unassigned",
    authorized,
    reason: authorized
      ? `${approver.displayName} is active and matches the required ${finding.approval.requiredRole} role.`
      : `Expected ${approver.email} for ${finding.approval.requiredRole}, but finding is assigned to ${
          finding.approval.assignedTo || "nobody"
        }.`
  };
}

function buildNotification(finding: Finding): ApprovalNotification {
  const approver = getApproverForRole(finding.approval.requiredRole);
  const authorized = finding.approval.assignedTo === approver.email && approver.status === "active";
  const status: ApprovalNotification["status"] = authorized ? "queued" : "blocked";

  return {
    id: `approval_notice_${finding.id}`,
    findingId: finding.id,
    resourceName: finding.resourceName,
    recipientRole: finding.approval.requiredRole,
    recipientEmail: finding.approval.assignedTo || approver.email,
    channel: "in_app",
    status,
    priority: finding.severity,
    queuedAt: nowIso(),
    dueAt: finding.approval.dueAt,
    escalationTarget: finding.approval.escalationTarget,
    message: `${finding.severity.toUpperCase()} approval needed for ${finding.resourceName}: ${finding.recommendation.action.replaceAll(
      "_",
      " "
    )}.`,
    productionDeliveryRequired: true
  };
}

function buildProductionGaps(roleMismatches: number, openApprovals: number) {
  return [
    ...(roleMismatches > 0 ? [`Fix ${roleMismatches} RBAC assignment mismatch(es) before enabling production remediation.`] : []),
    ...(openApprovals > 0 ? ["Verify approver identities against Google Workspace or the production identity provider."] : []),
    "Connect queued notices to production email, Google Chat, or ticketing delivery before live customer rollout.",
    "Persist notification attempts and acknowledgements in Firestore/BigQuery for judge/audit evidence."
  ];
}

function isOpenApproval(finding: Finding) {
  return (
    finding.recommendation.humanApprovalRequired &&
    finding.approval.status !== "approved" &&
    finding.approval.status !== "not_required" &&
    finding.status !== "remediated" &&
    finding.status !== "dismissed" &&
    finding.status !== "false_positive"
  );
}

function isProductionIdentityVerified() {
  return sentinelConfig.evidenceMode === "production" && sentinelConfig.storageMode === "gcp-rest";
}
