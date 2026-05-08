/**
 * Generic humanity verification orchestrator.
 *
 * Dispatches to the registered provider, computes the stored subject hash,
 * and returns a typed envelope ready for `attachHumanityCredential`. All
 * provider-specific logic lives behind the registry.
 */

import "server-only";

import { env } from "@/env";

import {
  computeHumanityCredentialSubjectHash,
  requireHumanityHmacSecret,
} from "./nullifier";
import {
  type HumanityVerifyRequest,
  type HumanityVerifyResult,
  requireEnabledProvider,
} from "./registry";

interface VerifiedHumanityCredentialEnvelope {
  expiresAt: string | null;
  provider: string;
  providerMetadata: Record<string, unknown> | null;
  providerSubjectHash: string;
  providerSubjectKind: string;
}

export async function verifyProof(args: {
  providerId: string;
  request: HumanityVerifyRequest;
}): Promise<{
  envelope: VerifiedHumanityCredentialEnvelope;
  raw: HumanityVerifyResult;
}> {
  const provider = requireEnabledProvider(args.providerId);
  const result = await provider.verifyProof(args.request);

  const providerSubjectHash = computeHumanityCredentialSubjectHash({
    secret: requireHumanityHmacSecret(env.HUMANITY_HMAC_SECRET),
    provider: provider.id,
    providerSubjectKind: result.providerSubjectKind,
    providerSubject: result.providerSubject,
  });

  return {
    raw: result,
    envelope: {
      provider: provider.id,
      providerSubjectHash,
      providerSubjectKind: result.providerSubjectKind,
      providerMetadata: result.providerMetadata ?? null,
      expiresAt: result.expiresAt ?? null,
    },
  };
}
