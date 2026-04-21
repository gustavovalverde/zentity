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
  getIdentityValiditySnapshot,
  getLatestIdentityValidityEvent,
} from "@/lib/db/queries/identity-validity";

import { getLatestValidityDeliveryState } from "./delivery";

interface IdentityValidityOverview {
  deliverySummary: Record<ValidityDeliveryStatus, number>;
  latestEvent: {
    createdAt: string;
    eventKind: ValidityEventKind;
    reason: string | null;
    source: ValidityTransitionSource;
    sourceNetwork: string | null;
    sourceEventId: string | null;
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
    verificationExpiresAt: string | null;
    revokedAt: string | null;
    revokedBy: string | null;
    revokedReason: string | null;
    validityStatus: ValidityStatus;
  } | null;
}

export const getIdentityValidityOverview = cache(
  async function getIdentityValidityOverview(
    userId: string
  ): Promise<IdentityValidityOverview> {
    const [snapshot, latestEvent, deliveryState] = await Promise.all([
      getIdentityValiditySnapshot(userId),
      getLatestIdentityValidityEvent(userId),
      getLatestValidityDeliveryState(userId),
    ]);

    return {
      snapshot: snapshot
        ? {
            verificationExpiresAt: snapshot.verificationExpiresAt,
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
            sourceNetwork: latestEvent.sourceNetwork,
            sourceEventId: latestEvent.sourceEventId,
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
  }
);
