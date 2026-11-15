"use client";

import { authClient } from "@/lib/auth/auth-client";

import {
  buildPrfExtension,
  evaluatePrf,
  extractPrfOutputFromClientResults,
} from "./prf";

type PasskeyErrorLike = {
  code?: string | undefined;
  message?: unknown;
  status?: number;
  statusText?: string;
} | null;

export function isPasskeyAlreadyRegistered(error: PasskeyErrorLike): boolean {
  if (!error) {
    return false;
  }
  if (error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return true;
  }
  const message =
    typeof error.message === "string" ? error.message.toLowerCase() : "";
  return message.includes("previously registered");
}

/**
 * Resolve PRF output from WebAuthn response or via fallback evaluation.
 *
 * @param allowFallback - If false, skip the fallback evaluatePrf() call that
 *   triggers a second WebAuthn prompt. Use false during registration to avoid
 *   double-prompting the user.
 */
async function resolvePrfOutput(params: {
  prfSalt: Uint8Array;
  credentialId: string | null;
  clientExtensionResults: unknown;
  allowFallback?: boolean;
}): Promise<Uint8Array | null> {
  const prfOutput = extractPrfOutputFromClientResults({
    clientExtensionResults: params.clientExtensionResults,
    credentialId: params.credentialId ?? undefined,
  });
  if (prfOutput) {
    return prfOutput;
  }
  if (!params.credentialId) {
    return null;
  }

  // Skip fallback to avoid double WebAuthn prompt during registration
  if (params.allowFallback === false) {
    return null;
  }

  const { prfOutputs } = await evaluatePrf({
    credentialIdToSalt: { [params.credentialId]: params.prfSalt },
  });
  return (
    prfOutputs.get(params.credentialId) ??
    prfOutputs.values().next().value ??
    null
  );
}

function resolveErrorMessage(
  error: PasskeyErrorLike,
  fallback: string
): string {
  return (
    (typeof error?.message === "string" ? error.message : null) || fallback
  );
}

type PasskeyPrfResult =
  | {
      ok: true;
      credentialId: string;
      prfOutput: Uint8Array;
      data?: unknown;
    }
  | {
      ok: false;
      error: PasskeyErrorLike;
      message: string;
    };

export async function registerPasskeyWithPrf(params: {
  name: string;
  prfSalt: Uint8Array;
  context?: string;
}): Promise<PasskeyPrfResult> {
  const registration = await authClient.passkey.addPasskey({
    name: params.name,
    returnWebAuthnResponse: true,
    extensions: buildPrfExtension(params.prfSalt),
    context: params.context,
  });

  if (!registration || registration.error || !registration.data) {
    const message = resolveErrorMessage(
      registration?.error ?? null,
      "Failed to register passkey."
    );
    return {
      ok: false,
      error: registration?.error ?? null,
      message,
    };
  }

  const webauthn = "webauthn" in registration ? registration.webauthn : null;
  const credentialId =
    registration.data.credentialID || webauthn?.response.id || null;

  if (!credentialId) {
    return {
      ok: false,
      error: null,
      message: "Missing passkey credential ID.",
    };
  }

  // Disable fallback to avoid double WebAuthn prompt during registration.
  // Modern authenticators (Windows Hello, Face ID, YubiKey 5+) return PRF
  // directly in the registration response.
  const prfOutput = await resolvePrfOutput({
    prfSalt: params.prfSalt,
    credentialId,
    clientExtensionResults: webauthn?.clientExtensionResults,
    allowFallback: false,
  });

  if (!prfOutput) {
    return {
      ok: false,
      error: null,
      message:
        "Your passkey doesn't support the PRF extension required for key encryption. " +
        "Please try Windows Hello, Face ID, Touch ID, or a YubiKey 5 Series.",
    };
  }

  return {
    ok: true,
    credentialId,
    prfOutput,
    data: registration.data,
  };
}

type PasskeySignInResult =
  | {
      ok: true;
      data?: unknown;
      credentialId?: string | null;
      prfOutput?: Uint8Array | null;
    }
  | {
      ok: false;
      error: PasskeyErrorLike;
      message: string;
    };

export async function signInWithPasskey(params?: {
  prfSalt?: Uint8Array;
  requirePrf?: boolean;
  /**
   * If false, skip the fallback evaluatePrf() call that triggers a second
   * WebAuthn prompt when PRF output isn't in the initial sign-in response.
   * Default: true (allow fallback for normal sign-in flows).
   */
  allowPrfFallback?: boolean;
}): Promise<PasskeySignInResult> {
  const prfSalt = params?.prfSalt;
  const requirePrf = params?.requirePrf ?? Boolean(prfSalt);
  const allowPrfFallback = params?.allowPrfFallback ?? true;
  const result = await authClient.signIn.passkey({
    returnWebAuthnResponse: Boolean(prfSalt),
    extensions: prfSalt ? buildPrfExtension(prfSalt) : undefined,
  });

  if (!result || result.error || !result.data) {
    const message = resolveErrorMessage(
      result?.error ?? null,
      "Authentication failed. Please try again."
    );
    return {
      ok: false,
      error: result?.error ?? null,
      message,
    };
  }

  if (!prfSalt) {
    return { ok: true, data: result.data };
  }

  const webauthn = "webauthn" in result ? result.webauthn : null;
  const credentialId = webauthn?.response.id || null;
  const prfOutput = await resolvePrfOutput({
    prfSalt,
    credentialId,
    clientExtensionResults: webauthn?.clientExtensionResults,
    allowFallback: allowPrfFallback,
  });

  if (requirePrf && !prfOutput) {
    return {
      ok: false,
      error: null,
      message:
        "This passkey doesn't support the encryption features needed. Please try a different passkey or use a password instead.",
    };
  }

  return {
    ok: true,
    data: result.data,
    credentialId,
    prfOutput,
  };
}

export function listUserPasskeys() {
  return authClient.passkey.listUserPasskeys();
}

export function renamePasskey(id: string, name: string) {
  return authClient.passkey.updatePasskey({ id, name });
}

export function deletePasskey(id: string) {
  return authClient.passkey.deletePasskey({ id });
}
