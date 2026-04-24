import "server-only";

import type {
  IdentityValidityDelivery,
  ValidityDeliveryStatus,
  ValidityDeliveryTarget,
} from "@/lib/db/schema/identity";

import { and, eq, inArray, sql } from "drizzle-orm";

import {
  listBackchannelLogoutClients,
  sendBackchannelLogoutToClient,
} from "@/lib/auth/oidc/backchannel-logout";
import {
  writeMirrorCompliance,
  writeMirrorRevocation,
} from "@/lib/blockchain/attestation/mirror-writer";
import {
  canCreateProvider,
  createProvider,
} from "@/lib/blockchain/attestation/providers";
import { getBaseSepoliaMirrorConfig } from "@/lib/blockchain/networks";
import { db } from "@/lib/db/connection";
import {
  listPendingCibaRequestIdsByUserId,
  rejectPendingCibaRequest,
} from "@/lib/db/queries/ciba";
import {
  createIdentityValidityDeliveries,
  getIdentityValidityEventById,
  listIdentityValidityDeliveriesForEvent,
  listProcessableIdentityValidityDeliveries,
  markIdentityValidityDeliveryDelivered,
  markIdentityValidityDeliveryRetrying,
} from "@/lib/db/queries/identity-validity";
import {
  blockchainAttestations,
  identityValidityDeliveries,
  identityValidityEvents,
} from "@/lib/db/schema/identity";
import { oidc4vciIssuedCredentials } from "@/lib/db/schema/oidc-credentials";
import {
  listRpValidityNoticeClients,
  postRpValidityNotice,
} from "@/lib/identity/validity/rp-notice";

type DeliveryExecutor = Pick<typeof db, "insert" | "select" | "update">;

const MAX_ATTEMPTS_BY_TARGET: Record<ValidityDeliveryTarget, number> = {
  oidc4vci_credential_status: 1,
  ciba_request_cancellation: 1,
  backchannel_logout: 3,
  blockchain_attestation_revocation: 3,
  mirror_compliance_write: 3,
  mirror_revocation_write: 3,
  rp_validity_notice: 3,
};

const RETRY_DELAY_MS_BY_TARGET: Record<ValidityDeliveryTarget, number[]> = {
  oidc4vci_credential_status: [],
  ciba_request_cancellation: [],
  backchannel_logout: [1000, 3000],
  blockchain_attestation_revocation: [1000, 3000],
  mirror_compliance_write: [1000, 3000],
  mirror_revocation_write: [1000, 3000],
  rp_validity_notice: [1000, 3000],
};

interface DeliveryTargetDescriptor {
  target: ValidityDeliveryTarget;
  targetKey: string;
}

function getNextAvailableAt(
  target: ValidityDeliveryTarget,
  attemptCount: number,
  now: Date
): string {
  const retryDelays = RETRY_DELAY_MS_BY_TARGET[target];
  const delayMs = retryDelays[Math.max(0, attemptCount - 1)] ?? 0;
  return new Date(now.getTime() + delayMs).toISOString();
}

async function buildRevocationDeliveryTargets(
  userId: string,
  executor: DeliveryExecutor = db
): Promise<DeliveryTargetDescriptor[]> {
  const mirrorEnabled = Boolean(getBaseSepoliaMirrorConfig());
  const [
    issuedCredentials,
    pendingCibaRequests,
    backchannelClients,
    rpValidityClients,
    attestations,
  ] = await Promise.all([
    executor
      .select({ id: oidc4vciIssuedCredentials.id })
      .from(oidc4vciIssuedCredentials)
      .where(
        and(
          eq(oidc4vciIssuedCredentials.userId, userId),
          eq(oidc4vciIssuedCredentials.status, 0)
        )
      )
      .all(),
    listPendingCibaRequestIdsByUserId(userId),
    listBackchannelLogoutClients(),
    listRpValidityNoticeClients(),
    executor
      .select({ id: blockchainAttestations.id })
      .from(blockchainAttestations)
      .where(
        and(
          eq(blockchainAttestations.userId, userId),
          inArray(blockchainAttestations.status, ["pending", "confirmed"])
        )
      )
      .all(),
  ]);

  return [
    ...issuedCredentials.map((credential) => ({
      target: "oidc4vci_credential_status" as const,
      targetKey: credential.id,
    })),
    ...pendingCibaRequests.map((authReqId) => ({
      target: "ciba_request_cancellation" as const,
      targetKey: authReqId,
    })),
    ...backchannelClients.map((client) => ({
      target: "backchannel_logout" as const,
      targetKey: client.clientId,
    })),
    ...rpValidityClients.map((client) => ({
      target: "rp_validity_notice" as const,
      targetKey: client.clientId,
    })),
    ...attestations.map((attestation) => ({
      target: "blockchain_attestation_revocation" as const,
      targetKey: attestation.id,
    })),
    ...(mirrorEnabled
      ? attestations.map((attestation) => ({
          target: "mirror_revocation_write" as const,
          targetKey: attestation.id,
        }))
      : []),
  ];
}

async function buildMirrorComplianceWriteTargets(
  userId: string,
  sourceNetwork: string | null,
  executor: DeliveryExecutor = db
): Promise<DeliveryTargetDescriptor[]> {
  if (!getBaseSepoliaMirrorConfig()) {
    return [];
  }

  const conditions = [
    eq(blockchainAttestations.userId, userId),
    eq(blockchainAttestations.status, "confirmed"),
  ];
  if (sourceNetwork) {
    conditions.push(eq(blockchainAttestations.networkId, sourceNetwork));
  }

  return (
    await executor
      .select({ id: blockchainAttestations.id })
      .from(blockchainAttestations)
      .where(and(...conditions))
      .all()
  ).map((attestation) => ({
    target: "mirror_compliance_write" as const,
    targetKey: attestation.id,
  }));
}

async function buildRpValidityNoticeTargets(): Promise<
  DeliveryTargetDescriptor[]
> {
  const clients = await listRpValidityNoticeClients();

  return clients.map((client) => ({
    target: "rp_validity_notice" as const,
    targetKey: client.clientId,
  }));
}

async function buildValidityChangeDeliveryTargets(
  userId: string,
  sourceNetwork: string | null,
  executor: DeliveryExecutor = db
): Promise<DeliveryTargetDescriptor[]> {
  const [rpValidityTargets, mirrorComplianceTargets] = await Promise.all([
    buildRpValidityNoticeTargets(),
    buildMirrorComplianceWriteTargets(userId, sourceNetwork, executor),
  ]);

  return [...rpValidityTargets, ...mirrorComplianceTargets];
}

export async function scheduleValidityDeliveries(
  eventId: string,
  executor: DeliveryExecutor = db
): Promise<IdentityValidityDelivery[]> {
  const event =
    executor === db
      ? await getIdentityValidityEventById(eventId)
      : await executor
          .select()
          .from(identityValidityEvents)
          .where(eq(identityValidityEvents.id, eventId))
          .limit(1)
          .get();
  if (!event) {
    throw new Error(
      `Cannot schedule validity deliveries for missing event ${eventId}`
    );
  }

  let targets: DeliveryTargetDescriptor[] = [];

  switch (event.eventKind) {
    case "revoked":
      targets = await buildRevocationDeliveryTargets(event.userId, executor);
      break;
    case "verified":
    case "stale":
    case "superseded":
      targets = await buildValidityChangeDeliveryTargets(
        event.userId,
        event.source === "chain" ? event.sourceNetwork : null,
        executor
      );
      break;
    case "failed":
      targets = [];
      break;
    default: {
      const unreachableEventKind: never = event.eventKind;
      throw new Error(
        `Unsupported identity validity event kind: ${unreachableEventKind}`
      );
    }
  }

  await createIdentityValidityDeliveries(
    targets.map((target) => ({
      eventId: event.id,
      userId: event.userId,
      target: target.target,
      targetKey: target.targetKey,
    })),
    executor
  );

  if (executor !== db) {
    return await executor
      .select()
      .from(identityValidityDeliveries)
      .where(eq(identityValidityDeliveries.eventId, eventId))
      .orderBy(
        sql`${identityValidityDeliveries.target} asc`,
        sql`${identityValidityDeliveries.targetKey} asc`
      )
      .all();
  }

  return await listIdentityValidityDeliveriesForEvent(eventId);
}

async function deliverOidc4vciCredentialStatus(
  delivery: IdentityValidityDelivery
): Promise<void> {
  await db
    .update(oidc4vciIssuedCredentials)
    .set({
      status: 1,
      revokedAt: new Date(),
    })
    .where(
      and(
        eq(oidc4vciIssuedCredentials.id, delivery.targetKey),
        eq(oidc4vciIssuedCredentials.status, 0)
      )
    )
    .run();
}

async function deliverCibaRequestCancellation(
  delivery: IdentityValidityDelivery
): Promise<void> {
  await rejectPendingCibaRequest(delivery.targetKey);
}

async function deliverBackchannelLogout(
  delivery: IdentityValidityDelivery
): Promise<void> {
  await sendBackchannelLogoutToClient({
    clientId: delivery.targetKey,
    userId: delivery.userId,
  });
}

async function deliverBlockchainAttestationRevocation(
  delivery: IdentityValidityDelivery
): Promise<void> {
  const attestation = await db
    .select({
      id: blockchainAttestations.id,
      networkId: blockchainAttestations.networkId,
      status: blockchainAttestations.status,
      walletAddress: blockchainAttestations.walletAddress,
    })
    .from(blockchainAttestations)
    .where(eq(blockchainAttestations.id, delivery.targetKey))
    .limit(1)
    .get();

  if (!attestation || attestation.status === "revoked") {
    return;
  }

  if (!canCreateProvider(attestation.networkId)) {
    await db
      .update(blockchainAttestations)
      .set({
        status: "revocation_pending",
        revokedAt: sql`datetime('now')`,
        updatedAt: sql`datetime('now')`,
      })
      .where(eq(blockchainAttestations.id, attestation.id))
      .run();
    throw new Error(
      `No blockchain attestation provider is configured for network ${attestation.networkId}`
    );
  }

  await createProvider(attestation.networkId).revokeAttestation(
    attestation.walletAddress
  );

  await db
    .update(blockchainAttestations)
    .set({
      status: "revoked",
      revokedAt: sql`datetime('now')`,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(blockchainAttestations.id, attestation.id))
    .run();
}

async function deliverRpValidityNotice(
  delivery: IdentityValidityDelivery
): Promise<void> {
  const event = await getIdentityValidityEventById(delivery.eventId);
  if (!event) {
    throw new Error(
      `Cannot deliver RP validity notice for missing event ${delivery.eventId}`
    );
  }

  await postRpValidityNotice({
    clientId: delivery.targetKey,
    deliveryId: delivery.id,
    event,
    userId: delivery.userId,
  });
}

async function deliverMirrorComplianceWrite(
  delivery: IdentityValidityDelivery
): Promise<void> {
  await writeMirrorCompliance(delivery.targetKey);
}

async function deliverMirrorRevocationWrite(
  delivery: IdentityValidityDelivery
): Promise<void> {
  await writeMirrorRevocation(delivery.targetKey);
}

async function deliverValidityTarget(
  delivery: IdentityValidityDelivery
): Promise<void> {
  switch (delivery.target) {
    case "oidc4vci_credential_status":
      await deliverOidc4vciCredentialStatus(delivery);
      return;
    case "ciba_request_cancellation":
      await deliverCibaRequestCancellation(delivery);
      return;
    case "backchannel_logout":
      await deliverBackchannelLogout(delivery);
      return;
    case "blockchain_attestation_revocation":
      await deliverBlockchainAttestationRevocation(delivery);
      return;
    case "mirror_compliance_write":
      await deliverMirrorComplianceWrite(delivery);
      return;
    case "mirror_revocation_write":
      await deliverMirrorRevocationWrite(delivery);
      return;
    case "rp_validity_notice":
      await deliverRpValidityNotice(delivery);
      return;
    default: {
      const unreachableTarget: never = delivery.target;
      throw new Error(
        `Unsupported identity validity delivery target: ${unreachableTarget}`
      );
    }
  }
}

function summarizeStatuses(
  deliveries: IdentityValidityDelivery[]
): Record<ValidityDeliveryStatus, number> {
  return deliveries.reduce<Record<ValidityDeliveryStatus, number>>(
    (summary, delivery) => {
      summary[delivery.status] += 1;
      return summary;
    },
    {
      pending: 0,
      delivered: 0,
      retrying: 0,
      dead_letter: 0,
    }
  );
}

export async function deliverPendingValidityDeliveries(
  args: {
    eventId?: string;
    limit?: number;
    targets?: ValidityDeliveryTarget[];
  } = {}
): Promise<{
  attempted: number;
  delivered: number;
  retrying: number;
  deadLettered: number;
}> {
  const deliveries = await listProcessableIdentityValidityDeliveries({
    ...(args.eventId ? { eventId: args.eventId } : {}),
    ...(args.limit ? { limit: args.limit } : {}),
    ...(args.targets ? { targets: args.targets } : {}),
  });

  let delivered = 0;
  let retrying = 0;
  let deadLettered = 0;

  for (const delivery of deliveries) {
    const now = new Date();
    const attemptedAt = now.toISOString();
    const nextAttemptCount = delivery.attemptCount + 1;

    try {
      await deliverValidityTarget(delivery);
      await markIdentityValidityDeliveryDelivered(
        delivery.id,
        nextAttemptCount,
        attemptedAt
      );
      delivered += 1;
    } catch (error) {
      const maxAttempts = MAX_ATTEMPTS_BY_TARGET[delivery.target];
      const nextStatus: Exclude<
        ValidityDeliveryStatus,
        "delivered" | "pending"
      > = nextAttemptCount >= maxAttempts ? "dead_letter" : "retrying";

      if (nextStatus === "dead_letter") {
        deadLettered += 1;
      } else {
        retrying += 1;
      }

      await markIdentityValidityDeliveryRetrying({
        deliveryId: delivery.id,
        attemptCount: nextAttemptCount,
        availableAt: getNextAvailableAt(delivery.target, nextAttemptCount, now),
        error: error instanceof Error ? error.message : String(error),
        lastAttemptedAt: attemptedAt,
        status: nextStatus,
      });
    }
  }

  return {
    attempted: deliveries.length,
    delivered,
    retrying,
    deadLettered,
  };
}

export async function getLatestValidityDeliveryState(userId: string): Promise<{
  latestEvent: IdentityValidityDelivery[];
  statusSummary: Record<ValidityDeliveryStatus, number>;
}> {
  const latestEvent = await db
    .select({ id: identityValidityEvents.id })
    .from(identityValidityEvents)
    .where(eq(identityValidityEvents.userId, userId))
    .orderBy(sql`${identityValidityEvents.createdAt} desc`)
    .limit(1)
    .get();

  if (!latestEvent) {
    return {
      latestEvent: [],
      statusSummary: {
        pending: 0,
        delivered: 0,
        retrying: 0,
        dead_letter: 0,
      },
    };
  }

  const deliveries = await listIdentityValidityDeliveriesForEvent(
    latestEvent.id
  );
  return {
    latestEvent: deliveries,
    statusSummary: summarizeStatuses(deliveries),
  };
}
