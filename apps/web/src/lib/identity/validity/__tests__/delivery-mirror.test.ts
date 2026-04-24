import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteMirrorCompliance = vi.fn();
const mockWriteMirrorRevocation = vi.fn();

vi.mock("@/lib/blockchain/networks", () => ({
  getBaseSepoliaMirrorConfig: () => ({
    id: "base_sepolia",
    name: "Base Sepolia",
    chainId: 84_532,
    rpcUrl: "https://sepolia.base.org",
    registrarPrivateKey: "0xregistrar",
    type: "mirror",
    contracts: {
      identityRegistryMirror: "0x0000000000000000000000000000000000000001",
    },
    explorer: "https://sepolia.basescan.org",
    enabled: true,
  }),
}));

vi.mock("@/lib/blockchain/attestation/mirror-writer", () => ({
  writeMirrorCompliance: (...args: unknown[]) =>
    mockWriteMirrorCompliance(...args),
  writeMirrorRevocation: (...args: unknown[]) =>
    mockWriteMirrorRevocation(...args),
}));

import { db } from "@/lib/db/connection";
import { getCurrentMirrorComplianceLevel } from "@/lib/db/queries/attestation";
import {
  createVerification,
  reconcileIdentityBundle,
  revokeIdentity,
} from "@/lib/db/queries/identity";
import {
  blockchainAttestations,
  identityValidityDeliveries,
} from "@/lib/db/schema/identity";
import { verificationChecks } from "@/lib/db/schema/privacy";
import { deliverPendingValidityDeliveries } from "@/lib/identity/validity/delivery";
import { recordValidityTransition } from "@/lib/identity/validity/transition";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

describe("identity validity mirror deliveries", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDatabase();
    mockWriteMirrorCompliance.mockResolvedValue({ status: "submitted" });
    mockWriteMirrorRevocation.mockResolvedValue({ status: "submitted" });
  });

  async function seedConfirmedAttestation() {
    const userId = await createTestUser();
    const verificationId = crypto.randomUUID();
    const attestationId = crypto.randomUUID();

    await createVerification({
      id: verificationId,
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: `dedup-${userId}`,
      verifiedAt: "2026-04-22T12:00:00Z",
    });
    await reconcileIdentityBundle(userId);
    await db
      .insert(blockchainAttestations)
      .values({
        id: attestationId,
        userId,
        status: "confirmed",
        chainId: 11_155_111,
        walletAddress: "0x0000000000000000000000000000000000000003",
        networkId: "fhevm_sepolia",
      })
      .run();

    return { attestationId, userId, verificationId };
  }

  it("schedules and delivers a Base mirror compliance write for chain confirmations", async () => {
    const { attestationId, userId, verificationId } =
      await seedConfirmedAttestation();

    const { event } = await recordValidityTransition({
      userId,
      verificationId,
      eventKind: "verified",
      source: "chain",
      sourceNetwork: "fhevm_sepolia",
      sourceEventId: "0xtx:1",
    });

    const deliveries = await db
      .select()
      .from(identityValidityDeliveries)
      .where(eq(identityValidityDeliveries.eventId, event.id))
      .all();

    expect(deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "mirror_compliance_write",
          targetKey: attestationId,
          status: "pending",
        }),
      ])
    );

    await deliverPendingValidityDeliveries({
      eventId: event.id,
      targets: ["mirror_compliance_write"],
    });

    expect(mockWriteMirrorCompliance).toHaveBeenCalledWith(attestationId);
  });

  it("schedules Base mirror compliance writes for non-chain validity changes", async () => {
    const { attestationId, userId, verificationId } =
      await seedConfirmedAttestation();

    const { event } = await recordValidityTransition({
      userId,
      verificationId,
      eventKind: "verified",
      source: "system",
    });

    const deliveries = await db
      .select()
      .from(identityValidityDeliveries)
      .where(eq(identityValidityDeliveries.eventId, event.id))
      .all();

    expect(deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "mirror_compliance_write",
          targetKey: attestationId,
          status: "pending",
        }),
      ])
    );

    await deliverPendingValidityDeliveries({
      eventId: event.id,
      targets: ["mirror_compliance_write"],
    });

    expect(mockWriteMirrorCompliance).toHaveBeenCalledWith(attestationId);
  });

  it("derives the mirror compliance level from current verification checks", async () => {
    const { attestationId, userId, verificationId } =
      await seedConfirmedAttestation();

    expect(await getCurrentMirrorComplianceLevel(userId)).toBe(1);

    await db
      .insert(verificationChecks)
      .values(
        [
          "document",
          "age",
          "liveness",
          "face_match",
          "nationality",
          "identity_binding",
          "sybil_resistant",
        ].map((checkType, index) => ({
          id: crypto.randomUUID(),
          userId,
          verificationId,
          checkType,
          passed: index < 4,
          source: "test",
        }))
      )
      .run();

    expect(await getCurrentMirrorComplianceLevel(userId)).toBe(2);

    const { event: staleEvent } = await recordValidityTransition({
      userId,
      verificationId,
      eventKind: "stale",
      source: "system",
      occurredAt: "2026-04-22T13:00:00Z",
      reason: "verification_freshness_expired",
      bundleSnapshot: {
        effectiveVerificationId: verificationId,
        freshnessCheckedAt: "2026-04-22T13:00:00Z",
        verificationExpiresAt: "2026-04-22T12:30:00Z",
        validityStatus: "stale",
        revokedAt: null,
        revokedBy: null,
        revokedReason: null,
      },
    });

    expect(await getCurrentMirrorComplianceLevel(userId)).toBe(1);

    const staleDeliveries = await db
      .select()
      .from(identityValidityDeliveries)
      .where(eq(identityValidityDeliveries.eventId, staleEvent.id))
      .all();

    expect(staleDeliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "mirror_compliance_write",
          targetKey: attestationId,
          status: "pending",
        }),
      ])
    );
  });

  it("schedules and delivers a Base mirror revocation write for identity revocation", async () => {
    const { attestationId, userId } = await seedConfirmedAttestation();

    const result = await revokeIdentity(
      userId,
      "admin@zentity.app",
      "fraud",
      "admin"
    );

    await deliverPendingValidityDeliveries({
      eventId: result.eventId as string,
      targets: ["mirror_revocation_write"],
    });

    expect(mockWriteMirrorRevocation).toHaveBeenCalledWith(attestationId);
  });
});
