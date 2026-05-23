import { createHash } from "node:crypto";
import type { AuditEvent, AuditIntegritySummary } from "@/lib/types";

type AuditEventInput = Omit<AuditEvent, "sequence" | "previousHash" | "eventHash">;

export function buildChainedAuditEvent(input: AuditEventInput, previousHead?: AuditEvent): AuditEvent {
  const sequence = (previousHead?.sequence ?? 0) + 1;
  const event: AuditEvent = {
    ...input,
    sequence,
    previousHash: previousHead?.eventHash ?? null
  };

  return {
    ...event,
    eventHash: hashAuditEvent(event)
  };
}

export function buildAuditIntegritySummary(auditEvents: AuditEvent[]): AuditIntegritySummary {
  const orderedEvents = sortAuditEventsForChain(auditEvents);
  let missingSeals = 0;
  let invalidHashes = 0;
  let brokenLinks = 0;
  let firstInvalidEventId: string | undefined;
  const legacySealedEvents = orderedEvents.filter((event) => Boolean(event.metadata?.integrityBackfilledAt)).length;

  orderedEvents.forEach((event, index) => {
    const expectedHash = hashAuditEvent(event);
    const olderEvent = orderedEvents[index + 1];
    const expectedPreviousHash = olderEvent?.eventHash ?? null;

    if (!event.eventHash || !event.sequence) {
      missingSeals += 1;
      firstInvalidEventId = firstInvalidEventId ?? event.id;
      return;
    }

    if (event.eventHash !== expectedHash) {
      invalidHashes += 1;
      firstInvalidEventId = firstInvalidEventId ?? event.id;
    }

    if (event.previousHash !== expectedPreviousHash) {
      brokenLinks += 1;
      firstInvalidEventId = firstInvalidEventId ?? event.id;
    }

    if (olderEvent?.sequence && event.sequence !== olderEvent.sequence + 1) {
      brokenLinks += 1;
      firstInvalidEventId = firstInvalidEventId ?? event.id;
    }
  });

  const valid = orderedEvents.length > 0 && missingSeals === 0 && invalidHashes === 0 && brokenLinks === 0;

  return {
    valid,
    totalEvents: orderedEvents.length,
    sealedEvents: orderedEvents.length - missingSeals,
    legacySealedEvents,
    missingSeals,
    invalidHashes,
    brokenLinks,
    headHash: orderedEvents[0]?.eventHash,
    firstInvalidEventId,
    notes: [
      valid
        ? "Audit events form a newest-first SHA-256 hash chain."
        : "Audit event hash-chain verification is incomplete or failed.",
      ...(legacySealedEvents
        ? [`${legacySealedEvents} legacy event(s) were hash-sealed after audit-chain migration and are labeled in metadata.`]
        : []),
      "This is tamper-evidence for product evidence review, not audit assurance or certification."
    ]
  };
}

export function sortAuditEventsForChain(auditEvents: AuditEvent[]) {
  return [...auditEvents].sort(
    (left, right) => (right.sequence ?? 0) - (left.sequence ?? 0) || right.createdAt.localeCompare(left.createdAt)
  );
}

export function rebuildAuditIntegrityChain(auditEvents: AuditEvent[], backfilledAt: string): AuditEvent[] {
  let previousHead: AuditEvent | undefined;
  const rebuiltOldestFirst = [...auditEvents].reverse().map((event) => {
    const input = auditEventInputFromEvent(event);
    const wasUnsealed = !event.eventHash || !event.sequence;
    const metadata = wasUnsealed
      ? {
          ...(input.metadata ?? {}),
          integrityBackfilledAt: backfilledAt,
          integrityBackfillReason: "legacy-unsealed-event"
        }
      : input.metadata;
    const rebuilt = buildChainedAuditEvent({ ...input, metadata }, previousHead);
    previousHead = rebuilt;
    return rebuilt;
  });

  return rebuiltOldestFirst.reverse();
}

function auditEventInputFromEvent(event: AuditEvent): AuditEventInput {
  return {
    id: event.id,
    tenantId: event.tenantId,
    actor: event.actor,
    type: event.type,
    targetId: event.targetId,
    message: event.message,
    createdAt: event.createdAt,
    metadata: event.metadata
  };
}

function hashAuditEvent(event: AuditEvent) {
  return createHash("sha256").update(stableStringify(canonicalAuditEvent(event))).digest("hex");
}

function canonicalAuditEvent(event: AuditEvent) {
  return {
    id: event.id,
    tenantId: event.tenantId,
    actor: event.actor,
    type: event.type,
    targetId: event.targetId ?? null,
    message: event.message,
    createdAt: event.createdAt,
    metadata: event.metadata ?? null,
    sequence: event.sequence ?? null,
    previousHash: event.previousHash ?? null
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
