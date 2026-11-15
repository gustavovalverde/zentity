import "server-only";

import { and, eq, gt, isNull, or, type SQL } from "drizzle-orm";
import { cache } from "react";

import { db } from "../connection";
import {
  type HumanityChallenge,
  type HumanityCredential,
  humanityChallenges,
  humanityCredentials,
} from "../schema/identity";

// ─── Errors ──────────────────────────────────────────────────────────

export class HumanityCredentialAlreadyAttachedError extends Error {
  readonly code = "humanity_credential_already_attached";

  constructor(message = "Humanity credential is already attached") {
    super(message);
    this.name = "HumanityCredentialAlreadyAttachedError";
  }
}

// ─── Read paths ──────────────────────────────────────────────────────

type Executor = Pick<typeof db, "select">;

function activeHumanityCredentialsFilter(userId: string, now: string): SQL {
  return and(
    eq(humanityCredentials.userId, userId),
    isNull(humanityCredentials.revokedAt),
    or(
      isNull(humanityCredentials.expiresAt),
      gt(humanityCredentials.expiresAt, now)
    )
  ) as SQL;
}

async function selectActiveHumanityCredentials(
  userId: string,
  executor: Executor
): Promise<HumanityCredential[]> {
  return await executor
    .select()
    .from(humanityCredentials)
    .where(activeHumanityCredentialsFilter(userId, new Date().toISOString()))
    .all();
}

/**
 * Cached read used by server components and auth callbacks. Always uses
 * the module-level `db`. Inside transactions, call
 * `listActiveHumanityCredentials(userId, executor)` directly.
 */
export const getActiveHumanityCredentials = cache(
  async function getActiveHumanityCredentials(
    userId: string
  ): Promise<HumanityCredential[]> {
    return await selectActiveHumanityCredentials(userId, db);
  }
);

export async function listActiveHumanityCredentials(
  userId: string,
  executor: Executor
): Promise<HumanityCredential[]> {
  return await selectActiveHumanityCredentials(userId, executor);
}

// ─── Challenge lifecycle ─────────────────────────────────────────────

export async function createHumanityChallenge(args: {
  expiresAt: string;
  id: string;
  nonce: string;
  provider: string;
  userId: string;
}): Promise<HumanityChallenge> {
  const row = await db
    .insert(humanityChallenges)
    .values(args)
    .returning()
    .get();
  if (!row) {
    throw new Error("Failed to create humanity challenge");
  }
  return row;
}

/**
 * Marks a matching, unexpired, unconsumed challenge consumed in one statement.
 * Returns null when no such challenge exists, so a challenge is consumed once.
 */
export async function consumeHumanityChallenge(args: {
  id: string;
  nonce: string;
  provider: string;
  userId: string;
}): Promise<HumanityChallenge | null> {
  const now = new Date().toISOString();
  const row = await db
    .update(humanityChallenges)
    .set({ consumedAt: now })
    .where(
      and(
        eq(humanityChallenges.id, args.id),
        eq(humanityChallenges.userId, args.userId),
        eq(humanityChallenges.provider, args.provider),
        eq(humanityChallenges.nonce, args.nonce),
        isNull(humanityChallenges.consumedAt),
        gt(humanityChallenges.expiresAt, now)
      )
    )
    .returning()
    .get();

  return row ?? null;
}

// ─── Attach / detach ─────────────────────────────────────────────────

export async function attachHumanityCredential(args: {
  expiresAt?: string | null;
  provider: string;
  providerMetadata?: Record<string, unknown> | null;
  providerSubjectHash: string;
  providerSubjectKind: string;
  userId: string;
}): Promise<HumanityCredential> {
  return await db.transaction(async (tx) => {
    const existingSubject = await tx
      .select()
      .from(humanityCredentials)
      .where(
        and(
          eq(humanityCredentials.provider, args.provider),
          eq(humanityCredentials.providerSubjectHash, args.providerSubjectHash),
          isNull(humanityCredentials.revokedAt)
        )
      )
      .limit(1)
      .get();

    if (existingSubject) {
      if (existingSubject.userId !== args.userId) {
        throw new HumanityCredentialAlreadyAttachedError();
      }
      return existingSubject;
    }

    const existingProvider = await tx
      .select()
      .from(humanityCredentials)
      .where(
        and(
          eq(humanityCredentials.userId, args.userId),
          eq(humanityCredentials.provider, args.provider),
          isNull(humanityCredentials.revokedAt)
        )
      )
      .limit(1)
      .get();

    if (existingProvider) {
      throw new HumanityCredentialAlreadyAttachedError(
        "Humanity provider is already attached"
      );
    }

    const row = await tx
      .insert(humanityCredentials)
      .values({
        userId: args.userId,
        provider: args.provider,
        providerSubjectHash: args.providerSubjectHash,
        providerSubjectKind: args.providerSubjectKind,
        providerMetadata: args.providerMetadata ?? null,
        expiresAt: args.expiresAt ?? null,
      })
      .returning()
      .get();
    if (!row) {
      throw new Error("Failed to attach humanity credential");
    }
    return row;
  });
}

export async function detachHumanityCredential(args: {
  provider: string;
  userId: string;
}): Promise<number> {
  const now = new Date().toISOString();
  const result = await db
    .update(humanityCredentials)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(humanityCredentials.userId, args.userId),
        eq(humanityCredentials.provider, args.provider),
        isNull(humanityCredentials.revokedAt)
      )
    )
    .run();

  return result.rowsAffected;
}
