/**
 * Generic humanity-challenge orchestrator.
 *
 * Wraps `buildChallenge()` from a registered provider with the DB-backed
 * challenge row that binds the nonce to the user. The provider chooses
 * the nonce; the orchestrator ensures it's persisted before exposing it
 * to the client.
 */

import "server-only";

import crypto from "node:crypto";

import { createHumanityChallenge } from "@/lib/db/queries/humanity";

import { requireEnabledProvider } from "./registry";

interface IssuedHumanityChallenge {
  challengeId: string;
  expiresAt: string;
  nonce: string;
  payload: Record<string, unknown>;
}

export async function issueHumanityChallenge(args: {
  providerId: string;
  userId: string;
}): Promise<IssuedHumanityChallenge> {
  const provider = requireEnabledProvider(args.providerId);
  const built = await provider.buildChallenge();
  const challengeId = crypto.randomUUID();

  await createHumanityChallenge({
    id: challengeId,
    userId: args.userId,
    provider: provider.id,
    nonce: built.nonce,
    expiresAt: built.expiresAt,
  });

  return {
    challengeId,
    nonce: built.nonce,
    expiresAt: built.expiresAt,
    payload: built.payload,
  };
}
