/**
 * Assurance Data Access Layer
 *
 * Separates account proofing, authentication provenance, and account
 * capabilities. Security-sensitive callers should use SecurityPosture.
 */
import "server-only";

import type { Session } from "@/lib/auth/auth";
import type { UnifiedVerificationModel } from "@/lib/identity/verification/unified-model";
import type {
  AccountAssurance,
  AccountCapabilities,
  SecurityPosture,
} from "./types";

import { and, eq } from "drizzle-orm";
import { cache } from "react";

import { resolveAuthenticationContext } from "@/lib/auth/authentication-context";
import { db } from "@/lib/db/connection";
import { accounts, passkeys } from "@/lib/db/schema/auth";
import { hasRequiredOcrProofTypes } from "@/lib/identity/verification/ocr-proof-sessions";
import { getUnifiedVerificationModel } from "@/lib/identity/verification/unified-model";

import { computeAccountAssurance } from "./compute";

function toAccountAssuranceInput(
  model: UnifiedVerificationModel,
  isAuthenticated: boolean
) {
  const documentVerified = model.verifiedAt !== null;
  const chipVerified = model.method === "nfc_chip";
  const zkProofsComplete = hasRequiredOcrProofTypes(
    model.proofs.map((proof) => proof.proofType)
  );

  return {
    isAuthenticated,
    hasSecuredKeys: model.bundle.fheKeyId !== null,
    chipVerified,
    documentVerified,
    livenessVerified: model.compliance.checks.livenessVerified,
    faceMatchVerified: model.compliance.checks.faceMatchVerified,
    zkProofsComplete,
    fheComplete: model.fhe.complete,
    onChainAttested: model.onChainAttested,
    missingProfileSecret:
      !model.vault.hasProfileSecret && (documentVerified || chipVerified),
    needsDocumentReprocessing: model.needsDocumentReprocessing,
  };
}

export const getAccountAssurance = cache(async function getAccountAssurance(
  userId: string,
  options?: { isAuthenticated?: boolean }
): Promise<AccountAssurance> {
  const model = await getUnifiedVerificationModel(userId);
  return computeAccountAssurance(
    toAccountAssuranceInput(model, options?.isAuthenticated ?? true)
  );
});

const getAccountCapabilities = cache(async function getAccountCapabilities(
  userId: string
): Promise<AccountCapabilities> {
  const [passkeyRow, opaqueAccount, walletAccount] = await Promise.all([
    db
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.userId, userId))
      .limit(1)
      .get(),
    db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(eq(accounts.userId, userId), eq(accounts.providerId, "opaque"))
      )
      .limit(1)
      .get(),
    db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(eq(accounts.userId, userId), eq(accounts.providerId, "eip712"))
      )
      .limit(1)
      .get(),
  ]);

  return {
    hasPasskeys: Boolean(passkeyRow),
    hasOpaqueAccount: Boolean(opaqueAccount),
    hasWalletAuth: Boolean(walletAccount),
  };
});

export async function getSecurityPosture(input: {
  userId: string;
  presentedAuth?: {
    authContextId?: string | null | undefined;
    cibaAuthReqId?: string | null | undefined;
    sessionId?: string | null | undefined;
  } | null;
}): Promise<SecurityPosture> {
  const auth = await resolveAuthenticationContext({
    authContextId: input.presentedAuth?.authContextId,
    cibaAuthReqId: input.presentedAuth?.cibaAuthReqId,
    sessionId: input.presentedAuth?.sessionId,
  });

  const [assurance, capabilities] = await Promise.all([
    getAccountAssurance(input.userId, { isAuthenticated: auth !== null }),
    getAccountCapabilities(input.userId),
  ]);

  return {
    assurance,
    auth,
    capabilities,
  };
}

export function getSecurityPostureForSession(
  userId: string,
  session: Session | null
): Promise<SecurityPosture> {
  const authContextId =
    (session?.session as { authContextId?: string | null } | undefined)
      ?.authContextId ?? null;

  return getSecurityPosture({
    userId,
    presentedAuth: session?.session?.id
      ? {
          authContextId,
          sessionId: session.session.id,
        }
      : null,
  });
}

export function getUnauthenticatedSecurityPosture(): SecurityPosture {
  return {
    assurance: computeAccountAssurance({
      isAuthenticated: false,
      hasSecuredKeys: false,
      chipVerified: false,
      documentVerified: false,
      livenessVerified: false,
      faceMatchVerified: false,
      zkProofsComplete: false,
      fheComplete: false,
      onChainAttested: false,
      missingProfileSecret: false,
      needsDocumentReprocessing: false,
    }),
    auth: null,
    capabilities: {
      hasPasskeys: false,
      hasOpaqueAccount: false,
      hasWalletAuth: false,
    },
  };
}
