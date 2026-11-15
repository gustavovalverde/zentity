import "server-only";

import type { AuthContext } from "@better-auth/core";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";

import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { eq } from "drizzle-orm";

import { getApprovalPageOrigins, PASSKEY_RP_ID } from "@/lib/auth/origin";
import { db } from "@/lib/db/connection";
import { passkeys } from "@/lib/db/schema/auth";

/**
 * A passkey confirmation bound to one CIBA request and one session, verified
 * without creating a session (the passkey plugin's own verification always
 * signs the user in). The challenge is a single-use verification row that
 * lives 120 seconds; a new options call replaces it.
 */

const STEP_UP_TTL_MS = 120_000;

type VerificationStore = Pick<
  AuthContext["internalAdapter"],
  | "consumeVerificationValue"
  | "createVerificationValue"
  | "deleteVerificationByIdentifier"
>;

interface StepUpBinding {
  requestId: string;
  sessionId: string;
  userId: string;
}

interface StoredStepUp {
  challenge: string;
  requestId: string;
  userId: string;
}

export type PasskeyStepUpFailure = "challenge_missing" | "verification_failed";

export class PasskeyStepUpError extends Error {
  readonly reason: PasskeyStepUpFailure;

  constructor(reason: PasskeyStepUpFailure) {
    super(reason);
    this.name = "PasskeyStepUpError";
    this.reason = reason;
  }
}

function stepUpIdentifier(binding: StepUpBinding): string {
  return `ciba-step-up:${binding.requestId}:${binding.sessionId}`;
}

function parseTransports(
  transports: string | null
): AuthenticatorTransportFuture[] | undefined {
  return transports
    ? (transports.split(",") as AuthenticatorTransportFuture[])
    : undefined;
}

function parseStoredStepUp(value: string): StoredStepUp | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredStepUp>;
    return typeof parsed.challenge === "string" &&
      typeof parsed.requestId === "string" &&
      typeof parsed.userId === "string"
      ? (parsed as StoredStepUp)
      : null;
  } catch {
    return null;
  }
}

/** Whether the user has a passkey to confirm an approval with. */
export async function hasPasskey(userId: string): Promise<boolean> {
  const row = await db
    .select({ id: passkeys.id })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .limit(1)
    .get();
  return Boolean(row);
}

/**
 * Options for one user-verified assertion over the user's own passkeys, or
 * null when the user has none.
 */
export async function issuePasskeyStepUp(
  store: VerificationStore,
  binding: StepUpBinding
): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const userPasskeys = await db
    .select({
      credentialID: passkeys.credentialID,
      transports: passkeys.transports,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, binding.userId))
    .all();
  if (userPasskeys.length === 0) {
    return null;
  }

  const options = await generateAuthenticationOptions({
    rpID: PASSKEY_RP_ID,
    userVerification: "required",
    timeout: STEP_UP_TTL_MS,
    allowCredentials: userPasskeys.map((passkey) => ({
      id: passkey.credentialID,
      transports: parseTransports(passkey.transports),
    })),
  });

  const identifier = stepUpIdentifier(binding);
  await store.deleteVerificationByIdentifier(identifier);
  await store.createVerificationValue({
    identifier,
    value: JSON.stringify({
      challenge: options.challenge,
      requestId: binding.requestId,
      userId: binding.userId,
    } satisfies StoredStepUp),
    expiresAt: new Date(Date.now() + STEP_UP_TTL_MS),
  });
  return options;
}

/**
 * Consumes the challenge and verifies a user-verified assertion from one of
 * the user's own passkeys, advancing its signature counter.
 */
export async function verifyPasskeyStepUp(
  store: VerificationStore,
  binding: StepUpBinding & { response: AuthenticationResponseJSON }
): Promise<{ passkeyId: string; verifiedAt: Date }> {
  const record = await store.consumeVerificationValue(
    stepUpIdentifier(binding)
  );
  const stored = record ? parseStoredStepUp(record.value) : null;
  if (!stored) {
    throw new PasskeyStepUpError("challenge_missing");
  }
  if (
    stored.userId !== binding.userId ||
    stored.requestId !== binding.requestId
  ) {
    throw new PasskeyStepUpError("verification_failed");
  }

  const passkey = await db
    .select()
    .from(passkeys)
    .where(eq(passkeys.credentialID, binding.response.id))
    .limit(1)
    .get();
  if (!passkey || passkey.userId !== binding.userId) {
    throw new PasskeyStepUpError("verification_failed");
  }

  let newCounter: number;
  try {
    const verification = await verifyAuthenticationResponse({
      response: { ...binding.response, clientExtensionResults: {} },
      expectedChallenge: stored.challenge,
      expectedOrigin: getApprovalPageOrigins(),
      expectedRPID: PASSKEY_RP_ID,
      credential: {
        id: passkey.credentialID,
        publicKey: new Uint8Array(Buffer.from(passkey.publicKey, "base64")),
        counter: passkey.counter,
        transports: parseTransports(passkey.transports),
      },
      requireUserVerification: true,
    });
    if (
      !(verification.verified && verification.authenticationInfo.userVerified)
    ) {
      throw new PasskeyStepUpError("verification_failed");
    }
    newCounter = verification.authenticationInfo.newCounter;
  } catch {
    throw new PasskeyStepUpError("verification_failed");
  }

  await db
    .update(passkeys)
    .set({ counter: newCounter })
    .where(eq(passkeys.id, passkey.id))
    .run();
  return { passkeyId: passkey.id, verifiedAt: new Date() };
}
