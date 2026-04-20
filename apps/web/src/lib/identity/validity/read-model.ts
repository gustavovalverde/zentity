import "server-only";

import type {
  ValidityDeliveryStatus,
  ValidityDeliveryTarget,
  ValidityEventKind,
  ValidityStatus,
  ValidityTransitionSource,
} from "@/lib/db/schema/identity";

import { cache } from "react";

import {
  getIdentityBundleValiditySnapshot,
  getLatestIdentityValidityEvent,
} from "@/lib/db/queries/identity-validity";

import { getValidityDeliveryReadModel } from "./delivery";

interface ValidityReadModel {
  deliverySummary: Record<ValidityDeliveryStatus, number>;
  latestEvent: {
    createdAt: string;
    eventKind: ValidityEventKind;
    reason: string | null;
    source: ValidityTransitionSource;
    triggeredBy: string | null;
    validityStatus: ValidityStatus;
    verificationId: string | null;
  } | null;
  latestEventDeliveries: Array<{
    attemptCount: number;
    deliveredAt: string | null;
    lastAttemptedAt: string | null;
    lastError: string | null;
    status: ValidityDeliveryStatus;
    target: ValidityDeliveryTarget;
    targetKey: string;
  }>;
  snapshot: {
    revokedAt: string | null;
    revokedBy: string | null;
    revokedReason: string | null;
    validityStatus: ValidityStatus;
  } | null;
}

export const getValidityReadModel = cache(async function getValidityReadModel(
  userId: string
): Promise<ValidityReadModel> {
  const [snapshot, latestEvent, deliveryState] = await Promise.all([
    getIdentityBundleValiditySnapshot(userId),
    getLatestIdentityValidityEvent(userId),
    getValidityDeliveryReadModel(userId),
  ]);

  return {
    snapshot: snapshot
      ? {
          validityStatus: snapshot.validityStatus,
          revokedAt: snapshot.revokedAt,
          revokedBy: snapshot.revokedBy,
          revokedReason: snapshot.revokedReason,
        }
      : null,
    latestEvent: latestEvent
      ? {
          verificationId: latestEvent.verificationId,
          eventKind: latestEvent.eventKind,
          validityStatus: latestEvent.validityStatus,
          source: latestEvent.source,
          triggeredBy: latestEvent.triggeredBy,
          reason: latestEvent.reason,
          createdAt: latestEvent.createdAt,
        }
      : null,
    latestEventDeliveries: deliveryState.latestEvent.map((delivery) => ({
      target: delivery.target,
      targetKey: delivery.targetKey,
      status: delivery.status,
      attemptCount: delivery.attemptCount,
      lastAttemptedAt: delivery.lastAttemptedAt,
      deliveredAt: delivery.deliveredAt,
      lastError: delivery.lastError,
    })),
    deliverySummary: deliveryState.statusSummary,
  };
});
