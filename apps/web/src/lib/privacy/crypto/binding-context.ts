"use client";

import "client-only";

/**
 * Binding Context Retrieval
 *
 * Determines the user's auth mode from their secret wrappers and retrieves
 * cached auth material for identity binding proof generation. This orchestrates
 * the binding secret derivation by:
 *
 * 1. Querying secret wrappers to determine auth mode (passkey/OPAQUE/wallet)
 * 2. Retrieving cached auth material from the appropriate vault
 * 3. Deriving the binding secret for the circuit
 *
 * If auth material cache has expired, returns null and the caller should
 * prompt for re-authentication.
 */

import type { BindingContext } from "@/lib/identity/verification/finalize-and-prove";

import { trpc } from "@/lib/trpc/client";
import { base64ToBytes } from "@/lib/utils/base64";

import { AuthMode } from "../zk/proof-types";
import {
  type BindingSecretResult,
  deriveBindingSecret,
} from "./binding-secret";
import { OPAQUE_CREDENTIAL_ID } from "./opaque-vault";
import { SECRET_TYPES } from "./secret-types";
import {
  getCachedOpaqueExportKey,
  getCachedPasskeyPrfOutput,
} from "./secret-vault";
import {
  getCachedWalletSignature,
  parseWalletCredentialId,
  WALLET_CREDENTIAL_PREFIX,
} from "./wallet-vault";
import { evaluatePrf } from "./webauthn-prf";

/**
 * Auth mode detection result.
 */
interface AuthModeInfo {
  mode: "passkey" | "opaque" | "wallet";
  /** For passkey: credential IDs with PRF salts */
  passkeyCreds?: { credentialId: string; prfSalt: Uint8Array }[];
  /** For wallet: parsed address and chain ID */
  walletInfo?: { address: string; chainId: number };
}

/**
 * Result of binding context retrieval attempt.
 */
export type BindingContextResult =
  | { success: true; context: BindingContext }
  | {
      success: false;
      reason: "no_wrappers" | "cache_expired" | "error";
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
    console.debug(
      "[binding-context] No FHE key wrappers found - FHE keys may not be enrolled yet"
    );
    return null;
  }

  console.debug(
    "[binding-context] Found",
    bundle.wrappers.length,
    "wrapper(s):",
    bundle.wrappers.map((w) => ({
      credentialId: `${w.credentialId.slice(0, 20)}...`,
      hasPrfSalt: !!w.prfSalt,
    }))
  );

  // Priority: passkey > OPAQUE > wallet (matches loadSecret order)
  const passkeyCreds = bundle.wrappers.flatMap((w) =>
    w.prfSalt
      ? [{ credentialId: w.credentialId, prfSalt: base64ToBytes(w.prfSalt) }]
      : []
  );
  if (passkeyCreds.length > 0) {
    console.debug(
      "[binding-context] Detected auth mode: passkey with",
      passkeyCreds.length,
      "credential(s)"
    );
    return {
      mode: "passkey",
      passkeyCreds,
    };
  }

  const opaqueWrapper = bundle.wrappers.find(
    (w) => w.credentialId === OPAQUE_CREDENTIAL_ID
  );
  if (opaqueWrapper) {
    console.debug("[binding-context] Detected auth mode: opaque");
    return { mode: "opaque" };
  }

  const walletWrapper = bundle.wrappers.find((w) =>
    w.credentialId.startsWith(WALLET_CREDENTIAL_PREFIX)
  );
  if (walletWrapper) {
    const parsed = parseWalletCredentialId(walletWrapper.credentialId);
    if (parsed) {
      console.debug("[binding-context] Detected auth mode: wallet");
      return {
        mode: "wallet",
        walletInfo: { address: parsed.address, chainId: parsed.chainId },
      };
    }
  }

  console.debug("[binding-context] No recognized auth mode found in wrappers");
  return null;
}

/**
 * Get cached passkey PRF output by prompting the user if needed.
 * Returns null if the user cancels the WebAuthn prompt.
 */
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
 *
 * This function:
 * 1. Determines the user's auth mode from their secret wrappers
 * 2. Retrieves cached auth material (PRF output, OPAQUE key, or wallet signature)
 * 3. Fetches the document hash from signed claims
 * 4. Derives the binding secret
 *
 * @param userId - The authenticated user's ID
 * @param documentId - The identity document ID
 * @param options - Optional configuration
 * @param options.promptPasskey - If true, prompt for passkey if cache expired (default: true)
 * @returns BindingContextResult indicating success or failure reason
 *
 * @example
 * const result = await getBindingContext(userId, documentId);
 * if (result.success) {
 *   await generateAllProofs({ documentId, bindingContext: result.context });
 * } else if (result.reason === "cache_expired") {
 *   // Prompt user to re-authenticate
 * }
 */
export async function getBindingContext(
  userId: string,
  documentId: string,
  options: { promptPasskey?: boolean } = {}
): Promise<BindingContextResult> {
  const { promptPasskey = true } = options;

  console.debug(
    "[binding-context] Getting binding context for document:",
    documentId
  );

  try {
    // 1. Detect auth mode from wrappers
    const authModeInfo = await detectAuthMode();
    if (!authModeInfo) {
      console.debug("[binding-context] Failed: no auth mode detected");
      return {
        success: false,
        reason: "no_wrappers",
        message: "No authentication credentials registered",
      };
    }

    console.debug("[binding-context] Auth mode detected:", authModeInfo.mode);

    // 2. Get document hash from signed claims
    const claims = await trpc.crypto.getSignedClaims.query({ documentId });
    const documentHash = claims.ocr?.documentHashField;
    if (!documentHash) {
      console.debug(
        "[binding-context] Failed: missing document hash in claims"
      );
      return {
        success: false,
        reason: "error",
        message: "Missing document hash in signed claims",
      };
    }

    console.debug(
      "[binding-context] Document hash found:",
      `${documentHash.slice(0, 20)}...`
    );

    // 3. Get auth material based on mode
    let bindingResult: BindingSecretResult;

    if (authModeInfo.mode === "passkey") {
      // For passkey, first try to use cached PRF output (from sign-in/sign-up)
      let prfOutput: Uint8Array | null = null;

      if (authModeInfo.passkeyCreds) {
        const credentialIds = authModeInfo.passkeyCreds.map(
          (c) => c.credentialId
        );
        prfOutput = getCachedPasskeyPrfOutput(credentialIds);

        if (prfOutput) {
          console.debug("[binding-context] Using cached passkey PRF output");
        } else if (promptPasskey) {
          // Fallback: prompt user for fresh PRF if allowed
          console.debug("[binding-context] No cached PRF, prompting user...");
          prfOutput = await getPasskeyPrfOutput(authModeInfo.passkeyCreds);
        } else {
          console.debug(
            "[binding-context] No cached PRF and prompting disabled"
          );
        }
      }

      if (!prfOutput) {
        console.debug("[binding-context] Failed: no PRF output obtained");
        return {
          success: false,
          reason: "cache_expired",
          message: "Please authenticate with your passkey to continue",
        };
      }

      console.debug(
        "[binding-context] PRF output obtained, deriving binding secret..."
      );

      bindingResult = await deriveBindingSecret({
        authMode: AuthMode.PASSKEY,
        prfOutput,
        userId,
        documentHash,
      });
    } else if (authModeInfo.mode === "opaque") {
      console.debug(
        "[binding-context] OPAQUE mode - checking cached export key..."
      );
      const exportKey = getCachedOpaqueExportKey(userId);
      if (!exportKey) {
        console.debug("[binding-context] Failed: no cached OPAQUE export key");
        return {
          success: false,
          reason: "cache_expired",
          message: "Session expired. Please sign in again with your password",
        };
      }

      console.debug(
        "[binding-context] OPAQUE export key found, deriving binding secret..."
      );
      bindingResult = await deriveBindingSecret({
        authMode: AuthMode.OPAQUE,
        exportKey,
        userId,
        documentHash,
      });
    } else {
      // Wallet
      console.debug("[binding-context] Wallet mode...");
      if (!authModeInfo.walletInfo) {
        console.debug("[binding-context] Failed: wallet info missing");
        return {
          success: false,
          reason: "error",
          message: "Wallet info missing for wallet auth mode",
        };
      }
      const { address, chainId } = authModeInfo.walletInfo;
      console.debug(
        "[binding-context] Checking cached wallet signature for:",
        `${address.slice(0, 10)}...`
      );
      const signatureBytes = getCachedWalletSignature(userId, address, chainId);
      if (!signatureBytes) {
        console.debug("[binding-context] Failed: no cached wallet signature");
        return {
          success: false,
          reason: "cache_expired",
          message: "Please sign the key access request with your wallet",
        };
      }

      console.debug(
        "[binding-context] Wallet signature found, deriving binding secret..."
      );
      bindingResult = await deriveBindingSecret({
        authMode: AuthMode.WALLET,
        signatureBytes,
        walletAddress: address,
        chainId,
        userId,
        documentHash,
      });
    }

    console.debug("[binding-context] Success! Binding context ready");
    return {
      success: true,
      context: {
        bindingResult,
        userId,
      },
    };
  } catch (error) {
    console.debug("[binding-context] Error:", error);
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
