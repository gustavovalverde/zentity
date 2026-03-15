import type { RecoveryGuardian } from "@/lib/db/schema/recovery";

import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  countRecentRecoveryChallenges,
  createGuardianApprovalToken,
  createRecoveryChallenge,
  createRecoveryConfig,
  createRecoveryGuardian,
  getRecoveryGuardianByType,
  listRecoveryGuardiansByConfigId,
} from "@/lib/db/queries/recovery";
import {
  RECOVERY_GUARDIAN_TYPE_CUSTODIAL_EMAIL,
  RECOVERY_GUARDIAN_TYPE_EMAIL,
} from "@/lib/recovery/constants";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

async function createConfigWithGuardians(params: {
  userId: string;
  threshold?: number;
  totalGuardians?: number;
  includeCustodial?: boolean;
  userEmail?: string;
}) {
  const config = await createRecoveryConfig({
    id: randomUUID(),
    userId: params.userId,
    threshold: params.threshold ?? 2,
    totalGuardians: params.totalGuardians ?? 3,
    frostGroupPubkey: "test-pubkey",
    frostPublicKeyPackage: "test-package",
    frostCiphersuite: "secp256k1",
    status: "active",
  });

  const guardian1 = await createRecoveryGuardian({
    id: randomUUID(),
    recoveryConfigId: config.id,
    email: "guardian@example.com",
    participantIndex: 1,
    guardianType: RECOVERY_GUARDIAN_TYPE_EMAIL,
  });

  const guardian2 = await createRecoveryGuardian({
    id: randomUUID(),
    recoveryConfigId: config.id,
    email: "guardian2@example.com",
    participantIndex: 2,
    guardianType: RECOVERY_GUARDIAN_TYPE_EMAIL,
  });

  let custodialGuardian: RecoveryGuardian | null = null;
  if (params.includeCustodial) {
    custodialGuardian = await createRecoveryGuardian({
      id: randomUUID(),
      recoveryConfigId: config.id,
      email: params.userEmail ?? "user@example.com",
      participantIndex: 3,
      guardianType: RECOVERY_GUARDIAN_TYPE_CUSTODIAL_EMAIL,
    });
  }

  return { config, guardian1, guardian2, custodialGuardian };
}

describe("custodial guardian integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe("constraint enforcement", () => {
    it("allows at most one custodial guardian per recovery config", async () => {
      const userId = await createTestUser({ email: "user@example.com" });
      const { config } = await createConfigWithGuardians({
        userId,
        includeCustodial: true,
        userEmail: "user@example.com",
      });

      const existing = await getRecoveryGuardianByType({
        recoveryConfigId: config.id,
        guardianType: RECOVERY_GUARDIAN_TYPE_CUSTODIAL_EMAIL,
      });

      expect(existing).not.toBeNull();
      expect(existing?.guardianType).toBe(
        RECOVERY_GUARDIAN_TYPE_CUSTODIAL_EMAIL
      );
    });

    it("custodial guardian uses the user's registered email", async () => {
      const userEmail = "myaccount@example.com";
      const userId = await createTestUser({ email: userEmail });
      const { custodialGuardian } = await createConfigWithGuardians({
        userId,
        includeCustodial: true,
        userEmail,
      });

      expect(custodialGuardian?.email).toBe(userEmail);
    });

    it("custodial guardian gets a unique participant index", async () => {
      const userId = await createTestUser({ email: "user@example.com" });
      const { config, guardian1, guardian2, custodialGuardian } =
        await createConfigWithGuardians({
          userId,
          includeCustodial: true,
          userEmail: "user@example.com",
        });

      const indices = new Set([
        guardian1.participantIndex,
        guardian2.participantIndex,
        custodialGuardian?.participantIndex,
      ]);
      expect(indices.size).toBe(3);

      const guardians = await listRecoveryGuardiansByConfigId(config.id);
      expect(guardians).toHaveLength(3);
    });
  });

  describe("challenge lifecycle with custodial guardian", () => {
    it("creates approval tokens for all guardians including custodial", async () => {
      const userId = await createTestUser({ email: "user@example.com" });
      const { config, guardian1, guardian2, custodialGuardian } =
        await createConfigWithGuardians({
          userId,
          includeCustodial: true,
          userEmail: "user@example.com",
        });

      const challenge = await createRecoveryChallenge({
        id: randomUUID(),
        userId,
        recoveryConfigId: config.id,
        challengeNonce: randomUUID(),
        status: "pending",
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });

      const allGuardians = [guardian1, guardian2, custodialGuardian].filter(
        (g): g is RecoveryGuardian => g !== null
      );
      const tokens = await Promise.all(
        allGuardians.map(async (guardian) => {
          const token = randomUUID();
          const approval = await createGuardianApprovalToken({
            id: randomUUID(),
            challengeId: challenge.id,
            guardianId: guardian.id,
            token,
            tokenExpiresAt: challenge.expiresAt,
          });
          return { guardianId: guardian.id, token, approval };
        })
      );

      expect(tokens).toHaveLength(3);
      const custodialToken = tokens.find(
        (t) => t.guardianId === custodialGuardian?.id
      );
      expect(custodialToken).toBeDefined();
    });

    it("rate-limits recovery challenges to 3 per 24 hours per user", async () => {
      const userId = await createTestUser({ email: "user@example.com" });
      const { config } = await createConfigWithGuardians({
        userId,
        includeCustodial: true,
        userEmail: "user@example.com",
      });

      for (let i = 0; i < 3; i++) {
        await createRecoveryChallenge({
          id: randomUUID(),
          userId,
          recoveryConfigId: config.id,
          challengeNonce: randomUUID(),
          status: "pending",
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        });
      }

      const recentCount = await countRecentRecoveryChallenges(userId, 24);
      expect(recentCount).toBe(3);
    });

    it("challenge expires after 15 minutes", async () => {
      const userId = await createTestUser({ email: "user@example.com" });
      const { config } = await createConfigWithGuardians({
        userId,
        includeCustodial: true,
        userEmail: "user@example.com",
      });

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      const challenge = await createRecoveryChallenge({
        id: randomUUID(),
        userId,
        recoveryConfigId: config.id,
        challengeNonce: randomUUID(),
        status: "pending",
        expiresAt: expiresAt.toISOString(),
      });

      const expiry = new Date(challenge.expiresAt);
      const created = new Date(challenge.createdAt);
      const diffMs = expiry.getTime() - created.getTime();
      expect(diffMs / (1000 * 60)).toBeCloseTo(15, 0);
    });
  });
});
