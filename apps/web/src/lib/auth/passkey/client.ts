"use client";

import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

import { startAuthentication } from "@simplewebauthn/browser";

import { authClient } from "@/lib/auth/auth-client";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";

import {
  type ApprovalAssertion,
  buildPrfExtension,
  evaluatePrf,
  extractPrfOutputFromClientResults,
  toApprovalAssertion,
} from "./prf";

/**
 * Runs the passkey assertion that confirms a CIBA decision, over the
 * server's options, without signing in.
 */
export async function assertPasskeyForApproval(
  optionsJSON: PublicKeyCredentialRequestOptionsJSON
): Promise<ApprovalAssertion> {
  return toApprovalAssertion(await startAuthentication({ optionsJSON }));
}

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
  return withPasskeyConfirmation(() =>
    authClient.passkey.deletePasskey({ id })
  );
}

// The code the server refuses a recovery factor change with until the user
// confirms with a passkey (`recovery-factors.ts`).
const REVERIFICATION_REQUIRED = "REVERIFICATION_REQUIRED";

/**
 * Whether the server refused a change to how the account is recovered until
 * the user confirms with a passkey. Reads a Better Auth error's `code` and a
 * tRPC error's `data.reason`.
 */
export function isReverificationRequired(error: unknown): boolean {
  if (!(error && typeof error === "object")) {
    return false;
  }
  const { code, data } = error as {
    code?: unknown;
    data?: { reason?: unknown } | null;
  };
  return (
    code === REVERIFICATION_REQUIRED || data?.reason === REVERIFICATION_REQUIRED
  );
}

export type PasskeyConfirmationChoice = "cancel" | "email_link" | "passkey";

/** A change the server refused, waiting for the user to choose how to confirm. */
export interface PasskeyConfirmationRequest {
  choose: (choice: PasskeyConfirmationChoice) => void;
  /** Where an email sign-in link that counts as confirmation can go. */
  emailLinkTo: string | null;
}

let pendingConfirmation: PasskeyConfirmationRequest | null = null;
const confirmationListeners = new Set<() => void>();

function notifyConfirmationListeners() {
  for (const listener of confirmationListeners) {
    listener();
  }
}

/** For `useSyncExternalStore` in the confirmation dialog. */
export function subscribePasskeyConfirmation(listener: () => void) {
  confirmationListeners.add(listener);
  return () => {
    confirmationListeners.delete(listener);
  };
}

export function getPasskeyConfirmation(): PasskeyConfirmationRequest | null {
  return pendingConfirmation;
}

function askForConfirmation(
  emailLinkTo: string | null
): Promise<PasskeyConfirmationChoice> {
  pendingConfirmation?.choose("cancel");
  return new Promise((resolve) => {
    const request: PasskeyConfirmationRequest = {
      emailLinkTo,
      choose: (choice) => {
        if (pendingConfirmation === request) {
          pendingConfirmation = null;
          notifyConfirmationListeners();
        }
        resolve(choice);
      },
    };
    pendingConfirmation = request;
    notifyConfirmationListeners();
  });
}

type Attempt<T> = { refused: true } | { refused: false; result: T };

async function attempt<T>(action: () => Promise<T>): Promise<Attempt<T>> {
  try {
    const result = await action();
    return isReverificationRequired((result as { error?: unknown })?.error)
      ? { refused: true }
      : { refused: false, result };
  } catch (error) {
    if (isReverificationRequired(error)) {
      return { refused: true };
    }
    throw error;
  }
}

/**
 * Runs an action that changes how the account is recovered. When the server
 * asks for a confirmation, by throwing or by returning `{ error }`, the
 * confirmation dialog asks the user to sign in again with a passkey and the
 * action runs once more. A user with a verified address can ask for an email
 * sign-in link instead, which counts once opened.
 */
export async function withPasskeyConfirmation<T>(
  action: () => Promise<T>
): Promise<T> {
  const first = await attempt(action);
  if (!first.refused) {
    return first.result;
  }

  const { data: current } = await authClient.getSession();
  const user = current?.user;
  const emailLinkTo =
    user?.emailVerified && !isSyntheticEmail(user.email) ? user.email : null;
  const orEmail = emailLinkTo ? ", or ask for an email sign-in link" : "";

  const choice = await askForConfirmation(emailLinkTo);
  if (choice === "cancel") {
    throw new Error("Nothing was changed.");
  }
  if (choice === "email_link" && emailLinkTo) {
    const sent = await authClient.signIn.magicLink({
      email: emailLinkTo,
      callbackURL: `${globalThis.location.pathname}${globalThis.location.search}`,
    });
    if (sent?.error) {
      throw new Error("We couldn't send a sign-in link. Try again.");
    }
    throw new Error(
      `We sent a sign-in link to ${emailLinkTo}. Open it within 5 minutes, then try again.`
    );
  }

  const confirmation = await signInWithPasskey();
  if (!confirmation.ok) {
    throw new Error(
      `We couldn't confirm it's you with your passkey. Try again${orEmail}.`
    );
  }
  const confirmedUserId = (
    confirmation.data as { user?: { id?: unknown } } | undefined
  )?.user?.id;
  if (user && confirmedUserId !== user.id) {
    throw new Error(
      "That passkey belongs to another Zentity account, and you're now signed in to it. Sign in to the account you meant to change, then try again."
    );
  }

  const retry = await attempt(action);
  if (retry.refused) {
    // The passkey plugin accepts assertions without user verification.
    throw new Error(
      `Your passkey didn't ask for your PIN, fingerprint, or face, so it can't confirm this change. Use a passkey that does${orEmail}.`
    );
  }
  return retry.result;
}
