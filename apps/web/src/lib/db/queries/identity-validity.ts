import type {
  IdentityValidityDelivery,
  IdentityValidityEvent,
  IdentityValiditySourceCursor,
  NewIdentityValidityDelivery,
  ValidityDeliveryStatus,
  ValidityDeliveryTarget,
  ValidityEventKind,
  ValidityStatus,
  ValidityTransitionSource,
} from "../schema/identity";

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";

import { db } from "../connection";
import {
  identityBundles,
  identityValidityDeliveries,
  identityValidityEvents,
  identityValiditySourceCursors,
} from "../schema/identity";

type IdentityValidityExecutor = Pick<typeof db, "insert" | "select" | "update">;

interface IdentityValiditySnapshot {
  effectiveVerificationId?: string | null;
  freshnessCheckedAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokedReason: string | null;
  userId: string;
  validityStatus: ValidityStatus;
  verificationExpiresAt: string | null;
}

export async function getIdentityValiditySnapshot(
  userId: string,
  executor: IdentityValidityExecutor = db
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

  return {
    effectiveVerificationId: row.effectiveVerificationId,
    freshnessCheckedAt: row.freshnessCheckedAt,
    verificationExpiresAt: row.verificationExpiresAt,
    userId: row.userId,
    validityStatus: row.validityStatus ?? "pending",
    revokedAt: row.revokedAt,
    revokedBy: row.revokedBy,
    revokedReason: row.revokedReason,
  };
}

export async function upsertIdentityValiditySnapshot(
  snapshot: IdentityValiditySnapshot,
  executor: IdentityValidityExecutor = db
): Promise<void> {
  await executor
    .insert(identityBundles)
    .values({
      userId: snapshot.userId,
      validityStatus: snapshot.validityStatus,
      effectiveVerificationId: snapshot.effectiveVerificationId ?? null,
      freshnessCheckedAt: snapshot.freshnessCheckedAt,
      verificationExpiresAt: snapshot.verificationExpiresAt,
      revokedAt: snapshot.revokedAt,
      revokedBy: snapshot.revokedBy,
      revokedReason: snapshot.revokedReason,
    })
    .onConflictDoUpdate({
      target: identityBundles.userId,
      set: {
        validityStatus: snapshot.validityStatus,
        effectiveVerificationId: snapshot.effectiveVerificationId ?? null,
        freshnessCheckedAt: snapshot.freshnessCheckedAt,
        verificationExpiresAt: snapshot.verificationExpiresAt,
        revokedAt: snapshot.revokedAt,
        revokedBy: snapshot.revokedBy,
        revokedReason: snapshot.revokedReason,
        updatedAt: sql`datetime('now')`,
      },
    })
    .run();
}

export async function appendIdentityValidityEvent(
  args: {
    createdAt?: string;
    eventKind: ValidityEventKind;
    reason?: string | null;
    source: ValidityTransitionSource;
    sourceBlockNumber?: number | null;
    sourceEventId?: string | null;
    sourceNetwork?: string | null;
    triggeredBy?: string | null;
    userId: string;
    validityStatus: ValidityStatus;
    verificationId?: string | null;
  },
  executor: IdentityValidityExecutor = db
): Promise<IdentityValidityEvent> {
  const id = randomUUID();
  const createdAt = args.createdAt ?? new Date().toISOString();

  await executor
    .insert(identityValidityEvents)
    .values({
      id,
      userId: args.userId,
      verificationId: args.verificationId ?? null,
      eventKind: args.eventKind,
      validityStatus: args.validityStatus,
      source: args.source,
      sourceBlockNumber: args.sourceBlockNumber ?? null,
      sourceEventId: args.sourceEventId ?? null,
      sourceNetwork: args.sourceNetwork ?? null,
      triggeredBy: args.triggeredBy ?? null,
      reason: args.reason ?? null,
      createdAt,
    })
    .run();

  return {
    id,
    userId: args.userId,
    verificationId: args.verificationId ?? null,
    eventKind: args.eventKind,
    validityStatus: args.validityStatus,
    source: args.source,
    sourceBlockNumber: args.sourceBlockNumber ?? null,
    sourceEventId: args.sourceEventId ?? null,
    sourceNetwork: args.sourceNetwork ?? null,
    triggeredBy: args.triggeredBy ?? null,
    reason: args.reason ?? null,
    createdAt,
  };
}

export async function getIdentityValiditySourceCursor(
  source: ValidityTransitionSource,
  network: string,
  executor: IdentityValidityExecutor = db
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
  executor: IdentityValidityExecutor = db
): Promise<void> {
  const now = new Date().toISOString();

  await executor
    .insert(identityValiditySourceCursors)
    .values({
      id: randomUUID(),
      source: args.source,
      network: args.network,
      cursor: args.cursor ?? null,
      lastSeenBlockNumber: args.lastSeenBlockNumber ?? null,
      lastSeenBlockHash: args.lastSeenBlockHash ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        identityValiditySourceCursors.source,
        identityValiditySourceCursors.network,
      ],
      set: {
        cursor: args.cursor ?? null,
        lastSeenBlockNumber: args.lastSeenBlockNumber ?? null,
        lastSeenBlockHash: args.lastSeenBlockHash ?? null,
        updatedAt: now,
      },
    })
    .run();
}

export async function listIdentityValiditySourceCursors(
  executor: IdentityValidityExecutor = db
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
        sql`${identityBundles.verificationExpiresAt} is not null`,
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
  executor: IdentityValidityExecutor = db
): Promise<void> {
  await executor
    .update(identityBundles)
    .set({
      freshnessCheckedAt: args.freshnessCheckedAt,
      ...(args.verificationExpiresAt === undefined
        ? {}
        : { verificationExpiresAt: args.verificationExpiresAt }),
      ...(args.validityStatus === undefined
        ? {}
        : { validityStatus: args.validityStatus }),
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
  eventId: string
): Promise<IdentityValidityEvent | null> {
  const row = await db
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
  executor: IdentityValidityExecutor = db
): Promise<number> {
  if (deliveries.length === 0) {
    return 0;
  }

  await executor
    .insert(identityValidityDeliveries)
    .values(
      deliveries.map((delivery) => ({
        id: randomUUID(),
        eventId: delivery.eventId,
        userId: delivery.userId,
        target: delivery.target,
        targetKey: delivery.targetKey,
        status: delivery.status ?? "pending",
        availableAt: delivery.availableAt ?? new Date().toISOString(),
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

  const rows = await executor
    .select({ count: sql<number>`count(*)` })
    .from(identityValidityDeliveries)
    .where(eq(identityValidityDeliveries.eventId, deliveries[0]?.eventId ?? ""))
    .get();

  return rows?.count ?? 0;
}

export async function listIdentityValidityDeliveriesForEvent(
  eventId: string
): Promise<IdentityValidityDelivery[]> {
  return await db
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
