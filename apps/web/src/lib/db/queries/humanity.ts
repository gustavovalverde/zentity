import "server-only";

import crypto from "node:crypto";

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
  const createdAt = new Date().toISOString();
  await db
    .insert(humanityChallenges)
    .values({
      id: args.id,
      userId: args.userId,
      provider: args.provider,
      nonce: args.nonce,
      expiresAt: args.expiresAt,
      createdAt,
    })
    .run();

  return {
    id: args.id,
    userId: args.userId,
    provider: args.provider,
    nonce: args.nonce,
    expiresAt: args.expiresAt,
    consumedAt: null,
    createdAt,
  };
}

export async function consumeHumanityChallenge(args: {
  id: string;
  nonce: string;
  provider: string;
  userId: string;
}): Promise<HumanityChallenge | null> {
  return await db.transaction(async (tx) => {
    const challenge = await tx
      .select()
      .from(humanityChallenges)
      .where(
        and(
          eq(humanityChallenges.id, args.id),
          eq(humanityChallenges.userId, args.userId),
          eq(humanityChallenges.provider, args.provider),
          eq(humanityChallenges.nonce, args.nonce),
          isNull(humanityChallenges.consumedAt)
        )
      )
      .limit(1)
      .get();

    if (!challenge || challenge.expiresAt <= new Date().toISOString()) {
      return null;
    }

    const consumedAt = new Date().toISOString();
    await tx
      .update(humanityChallenges)
      .set({ consumedAt })
      .where(eq(humanityChallenges.id, challenge.id))
      .run();

    return { ...challenge, consumedAt };
  });
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

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const providerMetadata = args.providerMetadata
      ? JSON.stringify(args.providerMetadata)
      : null;
    await tx
      .insert(humanityCredentials)
      .values({
        id,
        userId: args.userId,
        provider: args.provider,
        providerSubjectHash: args.providerSubjectHash,
        providerSubjectKind: args.providerSubjectKind,
        providerMetadata,
        expiresAt: args.expiresAt ?? null,
        attachedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return {
      id,
      userId: args.userId,
      provider: args.provider,
      providerSubjectKind: args.providerSubjectKind,
      providerSubjectHash: args.providerSubjectHash,
      providerMetadata,
      attachedAt: now,
      expiresAt: args.expiresAt ?? null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };
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
