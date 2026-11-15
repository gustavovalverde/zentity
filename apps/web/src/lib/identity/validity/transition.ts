import "server-only";

import type {
  IdentityValidityEvent,
  ValidityEventKind,
  ValidityStatus,
  ValidityTransitionSource,
} from "@/lib/db/schema/identity";

import { type DbExecutor, db } from "@/lib/db/connection";
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

interface ValiditySnapshotInput {
  effectiveVerificationId?: string | null;
  freshnessCheckedAt?: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokedReason: string | null;
  validityStatus: ValidityStatus;
  verificationExpiresAt?: string | null;
}

interface ValidityTransitionArgs {
  bundleSnapshot?: ValiditySnapshotInput;
  eventKind: ValidityEventKind;
  executor?: DbExecutor;
  occurredAt?: string;
  reason?: string | null;
  source: ValidityTransitionSource;
  sourceBlockNumber?: number | null;
  sourceEventId?: string | null;
  sourceNetwork?: string | null;
  triggeredBy?: string | null;
  userId: string;
  verificationId?: string | null;
}

interface ValidityTransitionResult {
  deliveries: Awaited<ReturnType<typeof scheduleValidityDeliveries>>;
  event: IdentityValidityEvent;
}

async function persistValidityTransition(
  args: ValidityTransitionArgs
): Promise<IdentityValidityEvent | null> {
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

  const event = await appendIdentityValidityEvent(
    {
      eventKind: args.eventKind,
      reason: args.reason,
      source: args.source,
      sourceBlockNumber: args.sourceBlockNumber,
      sourceEventId: args.sourceEventId,
      sourceNetwork: args.sourceNetwork,
      triggeredBy: args.triggeredBy,
      userId: args.userId,
      validityStatus: nextSnapshot.validityStatus,
      verificationId: args.verificationId,
      createdAt: args.occurredAt,
    },
    executor
  );

  // A replayed source event changes nothing, snapshot included.
  if (event && args.bundleSnapshot) {
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

  return event;
}

/**
 * Records a validity transition, schedules its deliveries, and drains them in
 * the background.
 *
 * A transition with a `sourceEventId` is idempotent through the
 * (source, sourceNetwork, sourceEventId) unique index: replaying one records
 * nothing and resolves to null. A transition without a `sourceEventId` always
 * records.
 */
export async function recordValidityTransition(
  args: ValidityTransitionArgs & { sourceEventId?: null | undefined }
): Promise<ValidityTransitionResult>;
export async function recordValidityTransition(
  args: ValidityTransitionArgs
): Promise<ValidityTransitionResult | null>;
export async function recordValidityTransition(
  args: ValidityTransitionArgs
): Promise<ValidityTransitionResult | null> {
  const event = await persistValidityTransition(args);
  if (!event) {
    return null;
  }
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

  const recorded = await recordValidityTransition({
    userId: args.userId,
    verificationId: snapshot.effectiveVerificationId ?? null,
    eventKind: "verified",
    source: "chain",
    sourceEventId: args.sourceEventId,
    sourceNetwork: args.networkId,
    sourceBlockNumber: args.blockNumber ?? null,
    reason: "blockchain_attestation_confirmed",
  });

  return recorded !== null;
}
