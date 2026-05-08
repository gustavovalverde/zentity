import "server-only";

import type {
  IdentityValidityEvent,
  ValidityEventKind,
  ValidityStatus,
  ValidityTransitionSource,
} from "@/lib/db/schema/identity";

import { db } from "@/lib/db/connection";
import {
  appendIdentityValidityEvent,
  getIdentityValiditySnapshot,
  upsertIdentityValiditySnapshot,
} from "@/lib/db/queries/identity-validity";
import { logError } from "@/lib/logging/error-logger";

import {
  deliverPendingValidityDeliveries,
  scheduleValidityDeliveries,
} from "./delivery";

type IdentityValidityExecutor = Pick<typeof db, "insert" | "select" | "update">;

interface ValiditySnapshotInput {
  effectiveVerificationId?: string | null;
  freshnessCheckedAt?: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokedReason: string | null;
  validityStatus: ValidityStatus;
  verificationExpiresAt?: string | null;
}

async function persistValidityTransition(args: {
  bundleSnapshot?: ValiditySnapshotInput;
  eventKind: ValidityEventKind;
  executor?: IdentityValidityExecutor;
  occurredAt?: string;
  reason?: string | null;
  source: ValidityTransitionSource;
  sourceBlockNumber?: number | null;
  sourceEventId?: string | null;
  sourceNetwork?: string | null;
  triggeredBy?: string | null;
  userId: string;
  verificationId?: string | null;
}): Promise<IdentityValidityEvent> {
  const executor = args.executor ?? db;
  const currentSnapshot = await getIdentityValiditySnapshot(
    args.userId,
    executor
  );
  const nextSnapshot = args.bundleSnapshot ?? currentSnapshot;

  if (!nextSnapshot) {
    throw new Error(
      `Cannot apply validity transition without a bundle snapshot for user ${args.userId}`
    );
  }

  if (args.bundleSnapshot) {
    await upsertIdentityValiditySnapshot(
      {
        effectiveVerificationId:
          args.bundleSnapshot.effectiveVerificationId ?? null,
        freshnessCheckedAt: args.bundleSnapshot.freshnessCheckedAt ?? null,
        verificationExpiresAt:
          args.bundleSnapshot.verificationExpiresAt ?? null,
        userId: args.userId,
        validityStatus: args.bundleSnapshot.validityStatus,
        revokedAt: args.bundleSnapshot.revokedAt,
        revokedBy: args.bundleSnapshot.revokedBy,
        revokedReason: args.bundleSnapshot.revokedReason,
      },
      executor
    );
  }

  return await appendIdentityValidityEvent(
    {
      eventKind: args.eventKind,
      reason: args.reason ?? null,
      source: args.source,
      sourceBlockNumber: args.sourceBlockNumber ?? null,
      sourceEventId: args.sourceEventId ?? null,
      sourceNetwork: args.sourceNetwork ?? null,
      triggeredBy: args.triggeredBy ?? null,
      userId: args.userId,
      validityStatus: nextSnapshot.validityStatus,
      verificationId: args.verificationId ?? null,
      ...(args.occurredAt ? { createdAt: args.occurredAt } : {}),
    },
    executor
  );
}

export async function recordValidityTransition(args: {
  bundleSnapshot?: ValiditySnapshotInput;
  eventKind: ValidityEventKind;
  executor?: IdentityValidityExecutor;
  occurredAt?: string;
  reason?: string | null;
  source: ValidityTransitionSource;
  sourceBlockNumber?: number | null;
  sourceEventId?: string | null;
  sourceNetwork?: string | null;
  triggeredBy?: string | null;
  userId: string;
  verificationId?: string | null;
}): Promise<{
  deliveries: Awaited<ReturnType<typeof scheduleValidityDeliveries>>;
  event: IdentityValidityEvent;
}> {
  const event = await persistValidityTransition(args);
  const deliveries = await scheduleValidityDeliveries(event.id, args.executor);

  // Drain the queued deliveries in the background. Anything that fails is
  // marked retrying with attempt-count semantics; the scheduler picks it up
  // on its next tick. We don't await here so the caller (a tRPC mutation,
  // a chain-ingest pass) returns without waiting for a Base Sepolia tx
  // receipt. The .catch() makes the promise non-floating per noFloatingPromises.
  deliverPendingValidityDeliveries({ eventId: event.id }).catch(
    (error: unknown) => {
      logError(error, {
        path: "validity.transition.drain",
        operation: event.eventKind,
      });
    }
  );

  return { event, deliveries };
}

/**
 * Records a "verified" transition for a confirmed on-chain attestation.
 * Idempotent via the (source, sourceNetwork, sourceEventId) unique index:
 * a duplicate event from a re-run (the dashboard's polling path catching
 * the same tx that chain-ingest later scans) returns false instead of
 * throwing. Returns true when a new transition was created.
 */
export async function recordChainAttestationConfirmed(args: {
  blockNumber?: number | null;
  networkId: string;
  sourceEventId: string;
  userId: string;
}): Promise<boolean> {
  const snapshot = await getIdentityValiditySnapshot(args.userId);
  if (!snapshot) {
    return false;
  }

  try {
    await recordValidityTransition({
      userId: args.userId,
      verificationId: snapshot.effectiveVerificationId ?? null,
      eventKind: "verified",
      source: "chain",
      sourceEventId: args.sourceEventId,
      sourceNetwork: args.networkId,
      sourceBlockNumber: args.blockNumber ?? null,
      reason: "blockchain_attestation_confirmed",
    });

    return true;
  } catch (error) {
    if (isDuplicateValidityEvent(error)) {
      return false;
    }
    throw error;
  }
}

export function isDuplicateValidityEvent(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message.includes("identity_validity_events_source_event_unique") ||
    error.message.includes("SQLITE_CONSTRAINT_UNIQUE")
  );
}
