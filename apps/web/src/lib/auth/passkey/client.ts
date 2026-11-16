"use client";

import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import type { RecoveryProof } from "@/lib/auth/recovery-factors";

import { startAuthentication } from "@simplewebauthn/browser";

import { authClient } from "@/lib/auth/auth-client";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { deriveRecoveryKeyVerifier } from "@/lib/privacy/credentials/derivation";
import { parseRecoveryKey } from "@/lib/privacy/credentials/recovery-key";
import {
  bytesToBase64Url,
  toArrayBuffer,
} from "@/lib/privacy/primitives/symmetric";
import { trpc } from "@/lib/trpc/client";

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
    // A passkey reported as failed must not keep signing in or approving.
    // The server lets the session take back a passkey it just added.
    const passkeyId = (registration.data as { id?: unknown }).id;
    if (typeof passkeyId === "string") {
      const removed = await authClient.passkey.deletePasskey({ id: passkeyId });
      if (!removed.error) {
        forgetPasskeyOnDevice(credentialId);
      }
    }
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

/**
 * Tells the browser's passkey manager that Zentity no longer accepts a
 * passkey, so it stops offering it (WebAuthn Level 3 Signals API), where the
 * browser supports it.
 */
export function forgetPasskeyOnDevice(credentialId: string): void {
  const signal = (
    globalThis.PublicKeyCredential as
      | {
          signalUnknownCredential?: (options: {
            credentialId: string;
            rpId: string;
          }) => Promise<void>;
        }
      | undefined
  )?.signalUnknownCredential;
  if (!signal) {
    return;
  }
  signal
    .call(globalThis.PublicKeyCredential, {
      credentialId,
      rpId: globalThis.location.hostname,
    })
    .catch(() => {
      // Best effort: the server already refuses the passkey.
    });
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

/**
 * The PRF input for a sign-in that should also open the vault: one salt per
 * passkey that wraps it. A signed-in user's sign-in lists only their own
 * passkeys, which `evalByCredential` needs.
 */
function prfExtensionByCredential(
  credentialIdToSalt: Record<string, Uint8Array>
): AuthenticationExtensionsClientInputs {
  const evalByCredential: Record<string, { first: ArrayBuffer }> = {};
  for (const [credentialId, salt] of Object.entries(credentialIdToSalt)) {
    evalByCredential[credentialId] = { first: toArrayBuffer(salt) };
  }
  return { prf: { evalByCredential } };
}

export async function signInWithPasskey(params?: {
  /** Per-passkey PRF salts; the result carries the chosen passkey's output. */
  credentialIdToSalt?: Record<string, Uint8Array>;
  prfSalt?: Uint8Array;
  requirePrf?: boolean;
  /**
   * If false, skip the fallback evaluatePrf() call that triggers a second
   * WebAuthn prompt when PRF output isn't in the initial sign-in response.
   * Default: true (allow fallback for normal sign-in flows).
   */
  allowPrfFallback?: boolean;
}): Promise<PasskeySignInResult> {
  const byCredential = params?.credentialIdToSalt;
  if (byCredential && Object.keys(byCredential).length > 0) {
    const result = await authClient.signIn.passkey({
      returnWebAuthnResponse: true,
      extensions: prfExtensionByCredential(byCredential),
    });
    if (!result || result.error || !result.data) {
      return {
        ok: false,
        error: result?.error ?? null,
        message: resolveErrorMessage(
          result?.error ?? null,
          "Authentication failed. Please try again."
        ),
      };
    }
    const webauthn = "webauthn" in result ? result.webauthn : null;
    return {
      ok: true,
      data: result.data,
      credentialId: webauthn?.response.id ?? null,
      prfOutput: extractPrfOutputFromClientResults({
        clientExtensionResults: webauthn?.clientExtensionResults,
      }),
    };
  }

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

export type PasskeyConfirmationChoice =
  | "cancel"
  | "email_link"
  | "passkey"
  /** The dialog already confirmed the wallet in this session. */
  | "wallet_confirmed"
  | { password: string }
  | { recoveryKey: string };

/** A change the server refused, waiting for the user to choose how to confirm. */
export interface PasskeyConfirmationRequest {
  choose: (choice: PasskeyConfirmationChoice) => void;
  /** Where an email sign-in link that counts toward recovery can go. */
  emailLinkTo: string | null;
  /** Why the last way the user tried did not confirm. */
  error: string | null;
  /** Recovery proofs this session already holds. */
  held: RecoveryProof[];
  /** Tells one prompt from the next. */
  id: number;
  /** Whether the password can confirm a recovery now. */
  password: boolean;
  /** Whether the recovery key can confirm a recovery now. */
  recoveryKey: boolean;
  /** Whether a wallet confirmation can count toward a recovery now. */
  wallet: boolean;
}

let pendingConfirmation: PasskeyConfirmationRequest | null = null;
let confirmationCount = 0;
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
  options: Omit<PasskeyConfirmationRequest, "choose" | "id">
): Promise<PasskeyConfirmationChoice> {
  pendingConfirmation?.choose("cancel");
  confirmationCount += 1;
  return new Promise((resolve) => {
    const request: PasskeyConfirmationRequest = {
      ...options,
      id: confirmationCount,
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
 * Proves the recovery key to the server for this session, without sending
 * the key: the server checks a verifier derived from it.
 */
export async function proveRecoveryKey(
  recoveryKey: Uint8Array,
  userId: string
): Promise<void> {
  const verifier = await deriveRecoveryKeyVerifier(recoveryKey, userId);
  const result = await authClient.$fetch("/recovery-key/verify", {
    method: "POST",
    body: { verifier: bytesToBase64Url(verifier) },
  });
  if (result.error) {
    throw new Error(
      result.error.message || "We couldn't check your recovery key. Try again."
    );
  }
}

/** Proves the password or the recovery key the user entered. */
async function proveRecovery(
  choice: { password: string } | { recoveryKey: string },
  userId: string | undefined
): Promise<void> {
  if ("password" in choice) {
    const result = await authClient.opaque.verifyPassword({
      password: choice.password,
    });
    if (!result.data || result.error) {
      throw new Error("That password is incorrect.");
    }
    return;
  }
  const recoveryKey = parseRecoveryKey(choice.recoveryKey);
  if (!recoveryKey) {
    throw new Error(
      "Enter all 24 words of your recovery key, separated by spaces."
    );
  }
  if (!userId) {
    throw new Error("Sign in again, then try again.");
  }
  try {
    await proveRecoveryKey(recoveryKey, userId);
  } finally {
    recoveryKey.fill(0);
  }
}

async function readRecoveryOptions() {
  try {
    return await trpc.account.recoveryOptions.query();
  } catch {
    return null;
  }
}

// Wrong entries, one email link, and two proofs fit in this many prompts.
const MAX_CONFIRMATION_PROMPTS = 5;

/**
 * Runs an action that changes how the account is recovered. When the server
 * asks for a confirmation, by throwing or by returning `{ error }`, the
 * confirmation dialog asks the user to sign in again with a passkey and the
 * action runs once more. Without the passkey, the user confirms an account
 * recovery instead: an email sign-in link, which counts once opened, and the
 * password, the recovery key, or a wallet, as many as the server needs.
 */
export async function withPasskeyConfirmation<T>(
  action: () => Promise<T>,
  options: {
    /** PRF salts for the passkey sign-in, so it can also open the vault. */
    credentialIdToSalt?: Record<string, Uint8Array>;
    /** Receives the confirming passkey's PRF output before the retry. */
    onPasskeyConfirmed?: (confirmation: {
      credentialId: string | null;
      prfOutput: Uint8Array | null;
    }) => void;
  } = {}
): Promise<T> {
  const first = await attempt(action);
  if (!first.refused) {
    return first.result;
  }

  const { data: current } = await authClient.getSession();
  const user = current?.user;
  const verifiedAddress =
    user?.emailVerified && !isSyntheticEmail(user.email) ? user.email : null;
  let error: string | null = null;

  for (let prompt = 0; prompt < MAX_CONFIRMATION_PROMPTS; prompt++) {
    const recovery = await readRecoveryOptions();
    const held = recovery?.proofs ?? [];
    const emailLinkTo = held.includes("magic_link") ? null : verifiedAddress;
    const orEmail = emailLinkTo ? ", or ask for an email sign-in link" : "";

    const choice = await askForConfirmation({
      emailLinkTo,
      error,
      held,
      password:
        Boolean(recovery?.available.password) && !held.includes("password"),
      recoveryKey:
        Boolean(recovery?.available.recoveryKey) &&
        !held.includes("recovery_key"),
      wallet: Boolean(recovery?.available.wallet) && !held.includes("wallet"),
    });
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

    if (choice === "passkey" || choice === "email_link") {
      const confirmation = await signInWithPasskey(
        options.credentialIdToSalt
          ? { credentialIdToSalt: options.credentialIdToSalt }
          : undefined
      );
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
      options.onPasskeyConfirmed?.({
        credentialId: confirmation.credentialId ?? null,
        prfOutput: confirmation.prfOutput ?? null,
      });
      const retry = await attempt(action);
      if (retry.refused) {
        // The passkey plugin accepts assertions without user verification.
        throw new Error(
          `Your passkey didn't ask for your PIN, fingerprint, or face, so it can't confirm this change. Use a passkey that does${orEmail}.`
        );
      }
      return retry.result;
    }

    if (choice !== "wallet_confirmed") {
      try {
        await proveRecovery(choice, user?.id);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        continue;
      }
    }
    error = null;
    const retry = await attempt(action);
    if (!retry.refused) {
      return retry.result;
    }
    // The proof counted; the next prompt asks for the one still missing.
  }
  throw new Error("We couldn't confirm it's you. Nothing was changed.");
}
