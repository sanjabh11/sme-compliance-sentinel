import type { ApproverRole, RecommendationAction, RemediationPlaybook, Tenant } from "@/lib/types";

const validActions: RecommendationAction[] = [
  "disable_public_sharing",
  "notify_owner",
  "request_owner_review",
  "label_restricted",
  "no_action"
];

export function buildDefaultPlaybooks(tenantId: string): RemediationPlaybook[] {
  return [
    {
      id: "playbook_public_secret",
      tenantId,
      name: "Public credential exposure",
      trigger: "Public Drive sharing plus credential-like detector finding.",
      stagedActions: ["disable_public_sharing", "notify_owner", "label_restricted"],
      autoAllowed: false,
      approvalSlaHours: 4,
      ownerRole: "security",
      escalationTarget: "founder@mainstreet-security.example",
      status: "active",
      createdAt: "2026-05-20T00:00:00.000Z",
      updatedAt: "2026-05-20T00:00:00.000Z"
    },
    {
      id: "playbook_public_pii",
      tenantId,
      name: "Public PII exposure",
      trigger: "Public sharing plus PII detector finding.",
      stagedActions: ["disable_public_sharing", "request_owner_review", "notify_owner"],
      autoAllowed: false,
      approvalSlaHours: 8,
      ownerRole: "legal",
      escalationTarget: "security-owner@mainstreet-security.example",
      status: "active",
      createdAt: "2026-05-20T00:00:00.000Z",
      updatedAt: "2026-05-20T00:00:00.000Z"
    },
    {
      id: "playbook_metadata_skip",
      tenantId,
      name: "Low-risk metadata change",
      trigger: "Unchanged hash or metadata-only event without external sharing.",
      stagedActions: ["no_action"],
      autoAllowed: true,
      approvalSlaHours: 0,
      ownerRole: "security",
      escalationTarget: "none",
      status: "active",
      createdAt: "2026-05-20T00:00:00.000Z",
      updatedAt: "2026-05-20T00:00:00.000Z"
    }
  ];
}

export function validatePlaybookDraft(
  input: {
    name?: string;
    trigger?: string;
    stagedActions?: RecommendationAction[];
    autoAllowed?: boolean;
    approvalSlaHours?: number;
    ownerRole?: ApproverRole;
    escalationTarget?: string;
    status?: RemediationPlaybook["status"];
  },
  tenant: Tenant
) {
  const name = cleanText(input.name ?? "");
  const trigger = cleanText(input.trigger ?? "");
  const stagedActions = normalizeActions(input.stagedActions ?? []);
  const approvalSlaHours = Math.max(0, Math.min(168, Math.round(Number(input.approvalSlaHours ?? 24))));
  const ownerRole = input.ownerRole ?? "security";
  const status = input.status ?? "active";
  const autoAllowed = Boolean(input.autoAllowed);
  const escalationTarget = cleanText(input.escalationTarget ?? (ownerRole === "founder" ? "security-owner@mainstreet-security.example" : "founder@mainstreet-security.example"));

  if (!name) {
    throw new Error("Playbook name is required.");
  }

  if (!trigger) {
    throw new Error("Playbook trigger is required.");
  }

  if (!stagedActions.length) {
    throw new Error("At least one staged action is required.");
  }

  if (!["security", "founder", "legal", "engineering"].includes(ownerRole)) {
    throw new Error("Owner role is not supported.");
  }

  if (!["active", "paused"].includes(status)) {
    throw new Error("Playbook status is not supported.");
  }

  if (autoAllowed && !isSafeAutoActionSet(stagedActions, tenant.settings.safeAutoActions)) {
    throw new Error("Auto-allowed playbooks can only use no_action or tenant-enabled safe auto actions.");
  }

  return {
    name,
    trigger,
    stagedActions,
    autoAllowed,
    approvalSlaHours: autoAllowed && stagedActions.every((action) => action === "no_action") ? 0 : approvalSlaHours,
    ownerRole,
    escalationTarget: escalationTarget || "none",
    status
  };
}

function normalizeActions(actions: RecommendationAction[]) {
  return actions
    .map((action) => {
      if (!validActions.includes(action)) {
        throw new Error(`Unsupported playbook action: ${action}`);
      }

      return action;
    })
    .filter((action, index, normalized) => normalized.indexOf(action) === index);
}

function isSafeAutoActionSet(actions: RecommendationAction[], safeAutoActions: RecommendationAction[]) {
  return actions.every((action) => action === "no_action" || safeAutoActions.includes(action));
}

function cleanText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}
