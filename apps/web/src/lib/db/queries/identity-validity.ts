import type {
  IdentityBundle,
  IdentityValidityDelivery,
  IdentityValidityEvent,
  IdentityValiditySourceCursor,
  NewIdentityValidityDelivery,
  NewIdentityValidityEvent,
  ValidityDeliveryStatus,
  ValidityDeliveryTarget,
  ValidityStatus,
  ValidityTransitionSource,
} from "../schema/identity";

import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";

import { type DbExecutor, db } from "../connection";
import {
  identityBundles,
  identityValidityDeliveries,
  identityValidityEvents,
  identityValiditySourceCursors,
} from "../schema/identity";

type IdentityValiditySnapshot = Pick<
  IdentityBundle,
  | "effectiveVerificationId"
  | "freshnessCheckedAt"
  | "revokedAt"
  | "revokedBy"
  | "revokedReason"
  | "userId"
  | "verificationExpiresAt"
> & { validityStatus: ValidityStatus };

export async function getIdentityValiditySnapshot(
  userId: string,
  executor: DbExecutor = db
): Promise<IdentityValiditySnapshot | null> {
  const row = await executor
    .select({
      effectiveVerificationId: identityBundles.effectiveVerificationId,
      freshnessCheckedAt: identityBundles.freshnessCheckedAt,
      verificationExpiresAt: identityBundles.verificationExpiresAt,
      userId: identityBundles.userId,
      validityStatus: identityBundles.validityStatus,
      revokedAt: identityBundles.revokedAt,
      revokedBy: identityBundles.revokedBy,
      revokedReason: identityBundles.revokedReason,
    })
    .from(identityBundles)
    .where(eq(identityBundles.userId, userId))
    .limit(1)
    .get();

  if (!row) {
    return null;
  }

  return { ...row, validityStatus: row.validityStatus ?? "pending" };
}

export async function upsertIdentityValiditySnapshot(
  snapshot: IdentityValiditySnapshot,
  executor: DbExecutor = db
): Promise<void> {
  const { userId: _userId, ...changes } = snapshot;

  await executor
    .insert(identityBundles)
    .values(snapshot)
    .onConflictDoUpdate({
      target: identityBundles.userId,
      set: changes,
    })
    .run();
}

/**
 * Appends a validity event. Returns null when the event's
 * (source, sourceNetwork, sourceEventId) was already recorded, so a replayed
 * source event is a no-op.
 */
export async function appendIdentityValidityEvent(
  args: Omit<NewIdentityValidityEvent, "id">,
  executor: DbExecutor = db
): Promise<IdentityValidityEvent | null> {
  const row = await executor
    .insert(identityValidityEvents)
    .values(args)
    .onConflictDoNothing({
      target: [
        identityValidityEvents.source,
        identityValidityEvents.sourceNetwork,
        identityValidityEvents.sourceEventId,
      ],
    })
    .returning()
    .get();

  return row ?? null;
}

export async function getIdentityValiditySourceCursor(
  source: ValidityTransitionSource,
  network: string,
  executor: DbExecutor = db
): Promise<IdentityValiditySourceCursor | null> {
  const row = await executor
    .select()
    .from(identityValiditySourceCursors)
    .where(
      and(
        eq(identityValiditySourceCursors.source, source),
        eq(identityValiditySourceCursors.network, network)
      )
    )
    .limit(1)
    .get();

  return row ?? null;
}

export async function upsertIdentityValiditySourceCursor(
  args: {
    cursor?: string | null;
    lastSeenBlockHash?: string | null;
    lastSeenBlockNumber?: number | null;
    network: string;
    source: ValidityTransitionSource;
  },
  executor: DbExecutor = db
): Promise<void> {
  const fields = {
    cursor: args.cursor ?? null,
    lastSeenBlockNumber: args.lastSeenBlockNumber ?? null,
    lastSeenBlockHash: args.lastSeenBlockHash ?? null,
  };

  await executor
    .insert(identityValiditySourceCursors)
    .values({
      ...fields,
      source: args.source,
      network: args.network,
    })
    .onConflictDoUpdate({
      target: [
        identityValiditySourceCursors.source,
        identityValiditySourceCursors.network,
      ],
      set: fields,
    })
    .run();
}

export async function listIdentityValiditySourceCursors(
  executor: DbExecutor = db
): Promise<IdentityValiditySourceCursor[]> {
  return await executor
    .select()
    .from(identityValiditySourceCursors)
    .orderBy(
      asc(identityValiditySourceCursors.source),
      asc(identityValiditySourceCursors.network)
    )
    .all();
}

export async function listExpiredIdentityBundles(
  args: { limit?: number; now?: string } = {}
): Promise<
  Array<{
    effectiveVerificationId: string | null;
    lastVerifiedAt: string | null;
    verificationExpiresAt: string;
    userId: string;
    validityStatus: ValidityStatus;
  }>
> {
  const now = args.now ?? new Date().toISOString();

  return (await db
    .select({
      userId: identityBundles.userId,
      effectiveVerificationId: identityBundles.effectiveVerificationId,
      lastVerifiedAt: identityBundles.lastVerifiedAt,
      verificationExpiresAt: identityBundles.verificationExpiresAt,
      validityStatus: identityBundles.validityStatus,
    })
    .from(identityBundles)
    .where(
      and(
        eq(identityBundles.validityStatus, "verified"),
        lte(identityBundles.verificationExpiresAt, now)
      )
    )
    .orderBy(asc(identityBundles.verificationExpiresAt))
    .limit(args.limit ?? 100)
    .all()) as Array<{
    effectiveVerificationId: string | null;
    lastVerifiedAt: string | null;
    verificationExpiresAt: string;
    userId: string;
    validityStatus: ValidityStatus;
  }>;
}

export async function recordIdentityFreshnessCheck(
  args: {
    freshnessCheckedAt: string;
    verificationExpiresAt?: string | null;
    userId: string;
    validityStatus?: ValidityStatus;
  },
  executor: DbExecutor = db
): Promise<void> {
  await executor
    .update(identityBundles)
    .set({
      freshnessCheckedAt: args.freshnessCheckedAt,
      verificationExpiresAt: args.verificationExpiresAt,
      validityStatus: args.validityStatus,
      updatedAt: args.freshnessCheckedAt,
    })
    .where(eq(identityBundles.userId, args.userId))
    .run();
}

export async function getLatestIdentityValidityEvent(userId: string) {
  const row = await db
    .select()
    .from(identityValidityEvents)
    .where(eq(identityValidityEvents.userId, userId))
    .orderBy(desc(identityValidityEvents.createdAt))
    .limit(1)
    .get();

  return row ?? null;
}

export async function getIdentityValidityEventById(
  eventId: string,
  executor: DbExecutor = db
): Promise<IdentityValidityEvent | null> {
  const row = await executor
    .select()
    .from(identityValidityEvents)
    .where(eq(identityValidityEvents.id, eventId))
    .limit(1)
    .get();

  return row ?? null;
}

export async function createIdentityValidityDeliveries(
  deliveries: Array<
    Omit<
      NewIdentityValidityDelivery,
      | "attemptCount"
      | "availableAt"
      | "createdAt"
      | "id"
      | "status"
      | "updatedAt"
    > & {
      availableAt?: string;
      status?: ValidityDeliveryStatus;
    }
  >,
  executor: DbExecutor = db
): Promise<void> {
  if (deliveries.length === 0) {
    return;
  }

  await executor
    .insert(identityValidityDeliveries)
    .values(
      deliveries.map((delivery) => ({
        eventId: delivery.eventId,
        userId: delivery.userId,
        target: delivery.target,
        targetKey: delivery.targetKey,
        status: delivery.status ?? "pending",
        availableAt: delivery.availableAt,
      }))
    )
    .onConflictDoNothing({
      target: [
        identityValidityDeliveries.eventId,
        identityValidityDeliveries.target,
        identityValidityDeliveries.targetKey,
      ],
    })
    .run();
}

export async function listIdentityValidityDeliveriesForEvent(
  eventId: string,
  executor: DbExecutor = db
): Promise<IdentityValidityDelivery[]> {
  return await executor
    .select()
    .from(identityValidityDeliveries)
    .where(eq(identityValidityDeliveries.eventId, eventId))
    .orderBy(
      asc(identityValidityDeliveries.target),
      asc(identityValidityDeliveries.targetKey)
    )
    .all();
}

export async function listProcessableIdentityValidityDeliveries(
  args: {
    eventId?: string;
    limit?: number;
    now?: string;
    statuses?: ValidityDeliveryStatus[];
    targets?: ValidityDeliveryTarget[];
  } = {}
): Promise<IdentityValidityDelivery[]> {
  const now = args.now ?? new Date().toISOString();
  const statuses = args.statuses ?? ["pending", "retrying"];
  const conditions = [
    inArray(identityValidityDeliveries.status, statuses),
    lte(identityValidityDeliveries.availableAt, now),
  ];

  if (args.eventId) {
    conditions.push(eq(identityValidityDeliveries.eventId, args.eventId));
  }

  if (args.targets && args.targets.length > 0) {
    conditions.push(inArray(identityValidityDeliveries.target, args.targets));
  }

  return await db
    .select()
    .from(identityValidityDeliveries)
    .where(and(...conditions))
    .orderBy(
      asc(identityValidityDeliveries.availableAt),
      asc(identityValidityDeliveries.createdAt)
    )
    .limit(args.limit ?? 100)
    .all();
}

export async function markIdentityValidityDeliveryDelivered(
  deliveryId: string,
  attemptCount: number,
  deliveredAt: string
): Promise<void> {
  await db
    .update(identityValidityDeliveries)
    .set({
      status: "delivered",
      attemptCount,
      deliveredAt,
      lastAttemptedAt: deliveredAt,
      lastError: null,
      updatedAt: deliveredAt,
    })
    .where(eq(identityValidityDeliveries.id, deliveryId))
    .run();
}

export async function markIdentityValidityDeliveryRetrying(args: {
  attemptCount: number;
  availableAt: string;
  deliveryId: string;
  error: string;
  lastAttemptedAt: string;
  status: Exclude<ValidityDeliveryStatus, "delivered" | "pending">;
}): Promise<void> {
  await db
    .update(identityValidityDeliveries)
    .set({
      status: args.status,
      attemptCount: args.attemptCount,
      availableAt: args.availableAt,
      lastAttemptedAt: args.lastAttemptedAt,
      lastError: args.error,
      updatedAt: args.lastAttemptedAt,
    })
    .where(eq(identityValidityDeliveries.id, args.deliveryId))
    .run();
}
