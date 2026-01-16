"use client";

import { authClient } from "@/lib/auth/auth-client";
import {
  buildPrfExtension,
  evaluatePrf,
  extractPrfOutputFromClientResults,
} from "@/lib/crypto/webauthn-prf";

export type PasskeyErrorLike = { code?: string; message?: string } | null;

interface WebauthnResponse {
  response?: {
    id?: string;
    rawId?: string;
    transports?: AuthenticatorTransport[];
  };
  clientExtensionResults?: unknown;
}

export function isPasskeyAlreadyRegistered(error: PasskeyErrorLike): boolean {
  if (!error) {
    return false;
  }
  if (error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return true;
  }
  const message = error.message?.toLowerCase();
  return Boolean(message?.includes("previously registered"));
}

function getWebauthnPayload(result: unknown): WebauthnResponse | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  if (!("webauthn" in result)) {
    return null;
  }
  const webauthn = (result as { webauthn?: unknown }).webauthn;
  if (!webauthn || typeof webauthn !== "object") {
    return null;
  }
  return webauthn as WebauthnResponse;
}

function getCredentialId(params: {
  data?: { credentialID?: string };
  webauthn: WebauthnResponse | null;
}): string | null {
  const dataId = params.data?.credentialID;
  if (dataId) {
    return dataId;
  }
  const response = params.webauthn?.response;
  return response?.id ?? response?.rawId ?? null;
}

function getTransports(
  webauthn: WebauthnResponse | null
): AuthenticatorTransport[] | undefined {
  const response = webauthn?.response;
  if (!(response && "transports" in response)) {
    return;
  }
  return response.transports as AuthenticatorTransport[];
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
  webauthn: WebauthnResponse | null;
  allowFallback?: boolean;
}): Promise<Uint8Array | null> {
  const prfOutput = extractPrfOutputFromClientResults({
    clientExtensionResults: params.webauthn?.clientExtensionResults,
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

  const transports = getTransports(params.webauthn);
  const { prfOutputs } = await evaluatePrf({
    credentialIdToSalt: { [params.credentialId]: params.prfSalt },
    credentialTransports: transports
      ? { [params.credentialId]: transports }
      : undefined,
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
  return error?.message || fallback;
}

export type PasskeyPrfResult =
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
  } as unknown as Parameters<typeof authClient.passkey.addPasskey>[0]);

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

  const webauthn = getWebauthnPayload(registration);
  const credentialId = getCredentialId({
    data: registration.data as { credentialID?: string } | undefined,
    webauthn,
  });

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
    webauthn,
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

export type PasskeySignInResult =
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
}): Promise<PasskeySignInResult> {
  const prfSalt = params?.prfSalt;
  const requirePrf = params?.requirePrf ?? Boolean(prfSalt);
  const result = await authClient.signIn.passkey({
    returnWebAuthnResponse: Boolean(prfSalt),
    extensions: prfSalt ? buildPrfExtension(prfSalt) : undefined,
  } as unknown as Parameters<typeof authClient.signIn.passkey>[0]);

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

  const webauthn = getWebauthnPayload(result);
  const credentialId = getCredentialId({
    data: undefined,
    webauthn,
  });
  const prfOutput = await resolvePrfOutput({
    prfSalt,
    credentialId,
    webauthn,
  });

  if (requirePrf && !prfOutput) {
    return {
      ok: false,
      error: null,
      message:
        "This passkey did not return PRF output. Please try a different authenticator.",
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
