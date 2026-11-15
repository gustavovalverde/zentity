import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import {
  attachHumanityCredential,
  consumeHumanityChallenge,
  createHumanityChallenge,
} from "@/lib/db/queries/humanity";
import { humanityChallenges } from "@/lib/db/schema/identity";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

const FUTURE = "2999-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";

describe("humanity queries", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function createChallenge(userId: string, expiresAt = FUTURE) {
    return await createHumanityChallenge({
      id: crypto.randomUUID(),
      userId,
      provider: "world_id",
      nonce: "nonce-1",
      expiresAt,
    });
  }

  it("returns the stored challenge from createHumanityChallenge", async () => {
    const userId = await createTestUser();
    const challenge = await createChallenge(userId);

    expect(challenge).toMatchObject({
      userId,
      provider: "world_id",
      nonce: "nonce-1",
      expiresAt: FUTURE,
      consumedAt: null,
    });
    expect(Number.isNaN(Date.parse(challenge.createdAt))).toBe(false);
  });

  it("consumes a matching challenge exactly once", async () => {
    const userId = await createTestUser();
    const challenge = await createChallenge(userId);
    const args = {
      id: challenge.id,
      userId,
      provider: "world_id",
      nonce: "nonce-1",
    };

    const consumed = await consumeHumanityChallenge(args);
    expect(consumed?.id).toBe(challenge.id);
    expect(consumed?.consumedAt).not.toBeNull();

    await expect(consumeHumanityChallenge(args)).resolves.toBeNull();
  });

  it("leaves a challenge unconsumed when the nonce, user, or provider differs", async () => {
    const userId = await createTestUser();
    const challenge = await createChallenge(userId);
    const base = {
      id: challenge.id,
      userId,
      provider: "world_id",
      nonce: "nonce-1",
    };

    await expect(
      consumeHumanityChallenge({ ...base, nonce: "other" })
    ).resolves.toBeNull();
    await expect(
      consumeHumanityChallenge({ ...base, userId: "other-user" })
    ).resolves.toBeNull();
    await expect(
      consumeHumanityChallenge({ ...base, provider: "other" })
    ).resolves.toBeNull();

    const row = await db
      .select()
      .from(humanityChallenges)
      .where(eq(humanityChallenges.id, challenge.id))
      .get();
    expect(row?.consumedAt).toBeNull();
  });

  it("does not consume an expired challenge", async () => {
    const userId = await createTestUser();
    const challenge = await createChallenge(userId, PAST);

    await expect(
      consumeHumanityChallenge({
        id: challenge.id,
        userId,
        provider: "world_id",
        nonce: "nonce-1",
      })
    ).resolves.toBeNull();

    const row = await db
      .select()
      .from(humanityChallenges)
      .where(eq(humanityChallenges.id, challenge.id))
      .get();
    expect(row?.consumedAt).toBeNull();
  });

  it("returns the stored credential from attachHumanityCredential", async () => {
    const userId = await createTestUser();

    const credential = await attachHumanityCredential({
      userId,
      provider: "world_id",
      providerSubjectHash: "subject-hash",
      providerSubjectKind: "nullifier",
      providerMetadata: { level: "orb" },
    });

    expect(credential).toMatchObject({
      userId,
      provider: "world_id",
      providerSubjectHash: "subject-hash",
      providerSubjectKind: "nullifier",
      providerMetadata: { level: "orb" },
      expiresAt: null,
      revokedAt: null,
    });
  });
});
