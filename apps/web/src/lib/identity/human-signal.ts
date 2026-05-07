import "server-only";

import type {
  HumanSignalProvider,
  HumanSignalSubjectKind,
} from "@/lib/db/schema/identity";

import { env } from "@/env";
import { getActiveHumanSignal } from "@/lib/db/queries/identity";
import { hmacSha256Hex } from "@/lib/privacy/primitives/symmetric";

const HUMAN_SIGNAL_SUBJECT_AAD = "zentity:human-signal-subject:v1";
const HUMAN_UNIQUENESS_NULLIFIER_AAD = "zentity:human-uniqueness-nullifier:v1";

export function requireHumanSignalHmacSecret(
  secret: string | undefined
): string {
  if (!secret) {
    throw new Error("HUMAN_SIGNAL_HMAC_SECRET is required for human signals");
  }

  return secret;
}

export function computeHumanSignalSubjectHash(args: {
  provider: HumanSignalProvider;
  providerSubject: string;
  providerSubjectKind: HumanSignalSubjectKind;
  secret: string;
}): string {
  return hmacSha256Hex(args.secret, [
    HUMAN_SIGNAL_SUBJECT_AAD,
    args.provider,
    args.providerSubjectKind,
    args.providerSubject,
  ]);
}

export function computeHumanUniquenessNullifier(args: {
  clientId: string;
  provider: HumanSignalProvider;
  providerSubjectHash: string;
  secret: string;
}): string {
  return hmacSha256Hex(args.secret, [
    HUMAN_UNIQUENESS_NULLIFIER_AAD,
    args.provider,
    args.providerSubjectHash,
    args.clientId,
  ]);
}

/**
 * Resolve the per-RP human uniqueness nullifier for an access token.
 * The stored provider subject hash never leaves the identity boundary.
 */
export async function resolveHumanUniquenessNullifier(
  userId: string,
  clientId: string
): Promise<{
  nullifier: string;
  source: "world_id";
} | null> {
  const signal = await getActiveHumanSignal(userId, "world_id");
  if (!signal) {
    return null;
  }

  return {
    source: signal.provider,
    nullifier: computeHumanUniquenessNullifier({
      secret: requireHumanSignalHmacSecret(env.HUMAN_SIGNAL_HMAC_SECRET),
      provider: signal.provider,
      providerSubjectHash: signal.providerSubjectHash,
      clientId,
    }),
  };
}
