"use client";

import "client-only";

/**
 * Binding Context Retrieval
 *
 * Determines the user's auth mode from their secret wrappers and retrieves
 * fresh credential material for identity binding proof generation.
 *
 * Passkey mode prompts via WebAuthn. OPAQUE/wallet modes return "cache_expired"
 * requiring the caller to prompt for re-authentication.
 */

import type { BindingContext } from "@/lib/identity/verification/finalize-and-prove";

import { evaluatePrf } from "@/lib/auth/webauthn-prf";
import {
  OPAQUE_CREDENTIAL_ID,
  WALLET_CREDENTIAL_PREFIX,
} from "@/lib/privacy/credentials";
import { getCachedBindingMaterial } from "@/lib/privacy/credentials/cache";
import { SECRET_TYPES } from "@/lib/privacy/secrets/types";
import { trpc } from "@/lib/trpc/client";
import { base64ToBytes } from "@/lib/utils/base64";

import { deriveBindingSecret } from "./binding-secret";
import { AuthMode } from "./proof-types";

/**
 * Auth mode detection result.
 */
interface AuthModeInfo {
  mode: "passkey" | "opaque" | "wallet";
  passkeyCreds?: { credentialId: string; prfSalt: Uint8Array }[];
}

/**
 * Result of binding context retrieval attempt.
 */
export type BindingContextResult =
  | { success: true; context: BindingContext }
  | {
      success: false;
      reason: "no_wrappers" | "cache_expired" | "error";
      authMode?: "passkey" | "opaque" | "wallet";
      message: string;
    };

/**
 * Detect auth mode from secret wrappers.
 * Returns null if no wrappers are registered.
 */
async function detectAuthMode(): Promise<AuthModeInfo | null> {
  const bundle = await trpc.secrets.getSecretBundle.query({
    secretType: SECRET_TYPES.FHE_KEYS,
  });

  if (!bundle?.wrappers?.length) {
    return null;
  }

  // Priority: passkey > OPAQUE > wallet (matches loadSecret order)
  const passkeyCreds = bundle.wrappers.flatMap((w) =>
    w.prfSalt
      ? [{ credentialId: w.credentialId, prfSalt: base64ToBytes(w.prfSalt) }]
      : []
  );
  if (passkeyCreds.length > 0) {
    return { mode: "passkey", passkeyCreds };
  }

  const opaqueWrapper = bundle.wrappers.find(
    (w) => w.credentialId === OPAQUE_CREDENTIAL_ID
  );
  if (opaqueWrapper) {
    return { mode: "opaque" };
  }

  const walletWrapper = bundle.wrappers.find((w) =>
    w.credentialId.startsWith(WALLET_CREDENTIAL_PREFIX)
  );
  if (walletWrapper) {
    return { mode: "wallet" };
  }

  return null;
}

/** Prompt WebAuthn PRF evaluation. Returns null if the user cancels. */
async function getPasskeyPrfOutput(
  creds: { credentialId: string; prfSalt: Uint8Array }[]
): Promise<Uint8Array | null> {
  const saltByCredential: Record<string, Uint8Array> = {};
  for (const cred of creds) {
    saltByCredential[cred.credentialId] = cred.prfSalt;
  }

  try {
    const { prfOutputs, selectedCredentialId } = await evaluatePrf({
      credentialIdToSalt: saltByCredential,
    });

    const credentialId =
      (selectedCredentialId && prfOutputs.has(selectedCredentialId)
        ? selectedCredentialId
        : null) ?? prfOutputs.keys().next().value;

    return credentialId ? (prfOutputs.get(credentialId) ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * Retrieve binding context for identity binding proof generation.
 * Passkey mode prompts via WebAuthn; OPAQUE/wallet return cache_expired.
 */
export async function getBindingContext(
  userId: string,
  documentId: string,
  options: { promptPasskey?: boolean } = {}
): Promise<BindingContextResult> {
  const { promptPasskey = true } = options;

  try {
    const authModeInfo = await detectAuthMode();
    if (!authModeInfo) {
      return {
        success: false,
        reason: "no_wrappers",
        message: "No authentication credentials registered",
      };
    }

    const claims = await trpc.crypto.getSignedClaims.query({ documentId });
    const documentHash = claims.ocr?.documentHashField;
    if (!documentHash) {
      return {
        success: false,
        reason: "error",
        message: "Missing document hash in signed claims",
      };
    }

    const cached = getCachedBindingMaterial();

    if (authModeInfo.mode === "opaque") {
      if (cached?.mode !== "opaque") {
        return {
          success: false,
          reason: "cache_expired",
          authMode: "opaque",
          message: "Session expired. Please sign in again with your password",
        };
      }
      const bindingResult = await deriveBindingSecret({
        authMode: AuthMode.OPAQUE,
        exportKey: cached.exportKey,
        userId,
        documentHash,
      });
      return { success: true, context: { bindingResult, userId } };
    }

    if (authModeInfo.mode === "wallet") {
      if (cached?.mode !== "wallet") {
        return {
          success: false,
          reason: "cache_expired",
          authMode: "wallet",
          message: "Please sign the key access request with your wallet",
        };
      }
      const bindingResult = await deriveBindingSecret({
        authMode: AuthMode.WALLET,
        signatureBytes: cached.signatureBytes,
        userId,
        documentHash,
      });
      return { success: true, context: { bindingResult, userId } };
    }

    // Passkey mode: use cached PRF output if available, otherwise prompt
    let prfOutput: Uint8Array | null =
      cached?.mode === "passkey" ? cached.prfOutput : null;

    if (!prfOutput && authModeInfo.passkeyCreds && promptPasskey) {
      prfOutput = await getPasskeyPrfOutput(authModeInfo.passkeyCreds);
    }

    if (!prfOutput) {
      return {
        success: false,
        reason: "cache_expired",
        authMode: "passkey",
        message: "Please authenticate with your passkey to continue",
      };
    }

    const bindingResult = await deriveBindingSecret({
      authMode: AuthMode.PASSKEY,
      prfOutput,
      userId,
      documentHash,
    });

    return {
      success: true,
      context: { bindingResult, userId },
    };
  } catch (error) {
    return {
      success: false,
      reason: "error",
      message:
        error instanceof Error
          ? error.message
          : "Failed to prepare binding context",
    };
  }
}
