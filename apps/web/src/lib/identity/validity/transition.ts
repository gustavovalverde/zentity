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
  getIdentityBundleValiditySnapshot,
  upsertIdentityBundleValiditySnapshot,
} from "@/lib/db/queries/identity-validity";

type IdentityValidityExecutor = Pick<typeof db, "insert" | "select" | "update">;

interface BundleValiditySnapshotOverride {
  revokedAt: string | null;
  revokedBy: string | null;
  revokedReason: string | null;
  validityStatus: ValidityStatus;
}

export async function applyValidityTransition(args: {
  bundleSnapshot?: BundleValiditySnapshotOverride;
  eventKind: ValidityEventKind;
  executor?: IdentityValidityExecutor;
  occurredAt?: string;
  reason?: string | null;
  source: ValidityTransitionSource;
  triggeredBy?: string | null;
  userId: string;
  verificationId?: string | null;
}): Promise<IdentityValidityEvent> {
  const executor = args.executor ?? db;
  const currentSnapshot =
    args.bundleSnapshot ??
    (await getIdentityBundleValiditySnapshot(args.userId, executor));

  if (!currentSnapshot) {
    throw new Error(
      `Cannot apply validity transition without a bundle snapshot for user ${args.userId}`
    );
  }

  if (args.bundleSnapshot) {
    await upsertIdentityBundleValiditySnapshot(
      {
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
      triggeredBy: args.triggeredBy ?? null,
      userId: args.userId,
      validityStatus: currentSnapshot.validityStatus,
      verificationId: args.verificationId ?? null,
      ...(args.occurredAt ? { createdAt: args.occurredAt } : {}),
    },
    executor
  );
}
