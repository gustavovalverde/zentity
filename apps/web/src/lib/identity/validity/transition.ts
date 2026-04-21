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

import { scheduleValidityDeliveries } from "./delivery";

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

  return { event, deliveries };
}
