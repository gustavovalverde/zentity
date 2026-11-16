/**
 * Recovery factors are what a user can recover an account with: the email
 * address, the OPAQUE password, a wallet, a linked social sign-in account,
 * the vault root, and the recovery key. On an account that holds a passkey,
 * adding another passkey, or binding, replacing, or removing one of these,
 * would let a password, a mailbox, or a stolen session turn into lasting
 * control, so every such change asks `checkRecoveryFactorChange` first. So
 * does deleting the account, which removes every factor at once.
 *
 * Allowed states (NIST SP 800-63B-4 §4.1.2.1 and §4.2.2.2, OWASP ASVS 5
 * V7.5.1):
 * - `no_passkey`: the account holds no passkey, and keeps today's rules.
 * - `sign_up`: the account is still anonymous, so sign-up is binding its
 *   first factors.
 * - `passkey_reverified`: this session holds a passkey sign-in with observed
 *   user verification in the last 5 minutes (15 for the recovery key).
 * - `account_recovery`: in the last 10 minutes this session proved one
 *   recovery code (a magic-link sign-in or the recovery key) and one more
 *   factor: the password, a wallet, or the other recovery code. A password
 *   that a mailbox alone set (a reset by email, or an `email_only_recovery`)
 *   never counts, so a mailbox is still one factor, and a wallet linked in
 *   the last 7 days does not count.
 * - `email_only_recovery`: a magic-link sign-in in the last 10 minutes, on an
 *   account with no password, wallet, or recovery key to pair it with.
 *
 * The magic-link sign-in counts only when it reached an address that was
 * verified before the sign-in and has not changed since.
 */
import "server-only";

import type { GenericEndpointContext } from "@better-auth/core";
import type { BetterAuthPlugin } from "better-auth";
import type { PasswordChangeVia } from "@/lib/auth/opaque/types";

import { createHash, timingSafeEqual } from "node:crypto";

import { defineRequestState } from "@better-auth/core/context";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
  isAPIError,
  sensitiveSessionMiddleware,
} from "better-auth/api";
import { and, asc, eq, gt, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { jwtVerify } from "jose";
import { z } from "zod";

import { sendWebPush } from "@/lib/agents/push-sender";
import { getAppOrigin } from "@/lib/auth/origin";
import { isServiceAccountEmail } from "@/lib/auth/service-account";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { db } from "@/lib/db/connection";
import {
  accounts,
  authenticationContexts,
  passkeys,
  users,
  verifications,
} from "@/lib/db/schema/auth";
import { secretWrappers } from "@/lib/db/schema/privacy";
import { sendAccountSecurityNotice } from "@/lib/email/auth";
import { logError, logWarn } from "@/lib/logging/error-logger";
import { RECOVERY_KEY_CREDENTIAL_ID } from "@/lib/privacy/secrets/catalog";

export const PASSKEY_REVERIFICATION_WINDOW_MS = 5 * 60 * 1000;
/** Also covers encryption key setup between its passkey sign-in and the save. */
export const RECOVERY_KEY_REVERIFICATION_WINDOW_MS = 15 * 60 * 1000;
export const ACCOUNT_RECOVERY_WINDOW_MS = 10 * 60 * 1000;
/**
 * How long a newly linked wallet, or a password set before
 * `passwordSetMethod` was recorded, waits to count toward recovery.
 */
export const SETTLED_FACTOR_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Refusal code on Better Auth endpoints and `data.reason` on tRPC. */
export const REVERIFICATION_REQUIRED = "REVERIFICATION_REQUIRED";
export const REVERIFICATION_REQUIRED_MESSAGE =
  "Confirm it's you with your passkey. If you can't use it, confirm with two ways to recover your account, such as an email link and your recovery key.";

export type RecoveryFactorChange =
  | "account_deletion"
  | "email"
  | "passkey"
  | "passkey_enrollment"
  | "password"
  | "wallet"
  | "social_account"
  | "vault_reset"
  | "vault_root"
  | "recovery_key";

/** A proof toward account recovery that this session holds. */
export type RecoveryProof =
  | "magic_link"
  | "password"
  | "recovery_key"
  | "wallet";

type AllowedReason =
  | "no_passkey"
  | "sign_up"
  | "passkey_reverified"
  | "account_recovery"
  | "email_only_recovery";

export type RecoveryFactorDecision =
  | { allowed: true; reason: AllowedReason }
  | { allowed: false; reason: "reverification_required" };

type SessionSignInMethod = "eip712" | "opaque" | "passkey";

export interface RecoveryFactorState {
  email: string;
  emailVerified: boolean;
  /** What else recovers the account; the dates say when each was bound. */
  factors: {
    passwordSetAt: Date | null;
    /** How the password was last set; null when that predates the record. */
    passwordSetMethod: PasswordSetMethod | null;
    /** A recovery key the server can check, which a spent key is not. */
    recoveryKey: boolean;
    walletLinkedAt: Date | null;
  };
  hasPasskey: boolean;
  isAnonymous: boolean;
  /** The address a magic-link sign-in of this session reached, when it was verified before that sign-in. */
  magicLinkProof: { email: string; expiresAt: Date } | null;
  /** Whether an account recovery of this session already added a passkey. */
  recoveryAddedPasskey: boolean;
  recoveryKeyProof: { expiresAt: Date } | null;
  /** Sign-ins and in-session verifications of this session. */
  signIns: {
    authenticatedAt: Date;
    method: SessionSignInMethod;
    userVerified: boolean;
  }[];
}

const NO_FACTORS: RecoveryFactorState["factors"] = {
  passwordSetAt: null,
  passwordSetMethod: null,
  recoveryKey: false,
  walletLinkedAt: null,
};

/** How a password was set: the rule's reason, or a reset by email. */
export type PasswordSetMethod = AllowedReason | "password_reset";

// A mailbox alone completes these, so a password they set is no second factor.
const MAILBOX_PASSWORD_METHODS: readonly PasswordSetMethod[] = [
  "password_reset",
  "email_only_recovery",
];

/** Whether the account's password can count toward an account recovery. */
function passwordCountsTowardRecovery(
  factors: RecoveryFactorState["factors"],
  now: number
): boolean {
  if (!factors.passwordSetAt) {
    return false;
  }
  if (factors.passwordSetMethod === null) {
    return now - factors.passwordSetAt.getTime() > SETTLED_FACTOR_AGE_MS;
  }
  return !MAILBOX_PASSWORD_METHODS.includes(factors.passwordSetMethod);
}

/** The recovery proofs a session holds, in the order the UI offers them. */
export function heldRecoveryProofs(
  state: RecoveryFactorState,
  now: number = Date.now()
): RecoveryProof[] {
  const recent = (at: Date) => now - at.getTime() <= ACCOUNT_RECOVERY_WINDOW_MS;
  const settled = (boundAt: Date | null) =>
    boundAt !== null && now - boundAt.getTime() > SETTLED_FACTOR_AGE_MS;
  const signedInWith = (method: SessionSignInMethod) =>
    state.signIns.some(
      (signIn) => signIn.method === method && recent(signIn.authenticatedAt)
    );

  const proofs: RecoveryProof[] = [];
  const magicLink = state.magicLinkProof;
  if (
    magicLink &&
    magicLink.expiresAt.getTime() > now &&
    state.emailVerified &&
    magicLink.email === state.email.toLowerCase()
  ) {
    proofs.push("magic_link");
  }
  if (
    state.recoveryKeyProof &&
    state.recoveryKeyProof.expiresAt.getTime() > now
  ) {
    proofs.push("recovery_key");
  }
  if (
    passwordCountsTowardRecovery(state.factors, now) &&
    signedInWith("opaque")
  ) {
    proofs.push("password");
  }
  if (settled(state.factors.walletLinkedAt) && signedInWith("eip712")) {
    proofs.push("wallet");
  }
  return proofs;
}

export function decideRecoveryFactorChange(
  state: RecoveryFactorState,
  change: RecoveryFactorChange,
  now: number = Date.now()
): RecoveryFactorDecision {
  if (!state.hasPasskey) {
    return { allowed: true, reason: "no_passkey" };
  }
  if (state.isAnonymous) {
    return { allowed: true, reason: "sign_up" };
  }
  const passkeyWindow =
    change === "recovery_key"
      ? RECOVERY_KEY_REVERIFICATION_WINDOW_MS
      : PASSKEY_REVERIFICATION_WINDOW_MS;
  const reverifiedByPasskey = state.signIns.some(
    (signIn) =>
      signIn.method === "passkey" &&
      signIn.userVerified &&
      now - signIn.authenticatedAt.getTime() <= passkeyWindow
  );
  if (reverifiedByPasskey) {
    return { allowed: true, reason: "passkey_reverified" };
  }
  // One recovery adds one passkey.
  if (change === "passkey_enrollment" && state.recoveryAddedPasskey) {
    return { allowed: false, reason: "reverification_required" };
  }

  const proofs = heldRecoveryProofs(state, now);
  const recoveryCode =
    proofs.includes("magic_link") || proofs.includes("recovery_key");
  if (recoveryCode && proofs.length >= 2) {
    return { allowed: true, reason: "account_recovery" };
  }
  const { factors } = state;
  const emailIsAllItHas = !(
    factors.passwordSetAt ||
    factors.walletLinkedAt ||
    factors.recoveryKey
  );
  if (proofs.includes("magic_link") && emailIsAllItHas) {
    return { allowed: true, reason: "email_only_recovery" };
  }
  return { allowed: false, reason: "reverification_required" };
}

// ── State ─────────────────────────────────────────────────

const MAGIC_LINK_PROOF_PREFIX = "magic-link-proof:";
const RECOVERY_KEY_PROOF_PREFIX = "account-recovery:";
const PASSKEY_ENROLLMENT_PREFIX = "passkey-enrollment:";

function magicLinkProofIdentifier(sessionId: string): string {
  return `${MAGIC_LINK_PROOF_PREFIX}${sessionId}`;
}

function recoveryKeyProofIdentifier(sessionId: string): string {
  return `${RECOVERY_KEY_PROOF_PREFIX}${sessionId}`;
}

function passkeyEnrollmentIdentifier(sessionId: string): string {
  return `${PASSKEY_ENROLLMENT_PREFIX}${sessionId}`;
}

async function userHasPasskey(userId: string): Promise<boolean> {
  const row = await db
    .select({ id: passkeys.id })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .limit(1)
    .get();
  return Boolean(row);
}

interface SessionRecord {
  expiresAt: Date;
  id: string;
  value: Record<string, unknown>;
}

/** Unexpired verification rows of this user under one identifier. */
async function readSessionRecords(
  identifier: string,
  userId: string,
  now: Date
): Promise<SessionRecord[]> {
  const rows = await db
    .select({
      id: verifications.id,
      value: verifications.value,
      expiresAt: verifications.expiresAt,
    })
    .from(verifications)
    .where(
      and(
        eq(verifications.identifier, identifier),
        gt(verifications.expiresAt, now)
      )
    )
    .all();
  const records: SessionRecord[] = [];
  for (const row of rows) {
    try {
      const value = JSON.parse(row.value) as Record<string, unknown>;
      if (value.userId === userId) {
        records.push({ expiresAt: row.expiresAt, id: row.id, value });
      }
    } catch {
      // Not a record this module wrote.
    }
  }
  return records;
}

async function readMagicLinkProof(
  userId: string,
  sessionId: string,
  now: Date
): Promise<RecoveryFactorState["magicLinkProof"]> {
  const [record] = await readSessionRecords(
    magicLinkProofIdentifier(sessionId),
    userId,
    now
  );
  return typeof record?.value.email === "string"
    ? { email: record.value.email, expiresAt: record.expiresAt }
    : null;
}

/** The recovery key wrapper's verifier, which a spent key no longer has. */
async function readRecoveryKeyVerifierHash(
  userId: string
): Promise<string | null> {
  const row = await db
    .select({ verifierHash: secretWrappers.verifierHash })
    .from(secretWrappers)
    .where(
      and(
        eq(secretWrappers.userId, userId),
        eq(secretWrappers.credentialId, RECOVERY_KEY_CREDENTIAL_ID),
        isNotNull(secretWrappers.verifierHash)
      )
    )
    .limit(1)
    .get();
  return row?.verifierHash ?? null;
}

/**
 * This session's recovery key proof. It counts while the key it proved is
 * the account's unspent recovery key, or once this session's recovery
 * spent it.
 */
async function readRecoveryKeyProof(
  userId: string,
  sessionId: string,
  now: Date
): Promise<RecoveryFactorState["recoveryKeyProof"]> {
  const [records, verifierHash] = await Promise.all([
    readSessionRecords(recoveryKeyProofIdentifier(sessionId), userId, now),
    readRecoveryKeyVerifierHash(userId),
  ]);
  const record = records.find(
    (proof) =>
      proof.value.spent === true ||
      (verifierHash !== null && proof.value.verifierHash === verifierHash)
  );
  return record ? { expiresAt: record.expiresAt } : null;
}

async function readRecoveryFactors(
  userId: string
): Promise<RecoveryFactorState["factors"]> {
  const [signInAccounts, verifierHash] = await Promise.all([
    db
      .select({
        providerId: accounts.providerId,
        createdAt: accounts.createdAt,
        passwordSetMethod: accounts.passwordSetMethod,
        updatedAt: accounts.updatedAt,
      })
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, userId),
          inArray(accounts.providerId, ["eip712", "opaque"])
        )
      )
      .all(),
    readRecoveryKeyVerifierHash(userId),
  ]);
  const password = signInAccounts.find((row) => row.providerId === "opaque");
  const wallet = signInAccounts.find((row) => row.providerId === "eip712");
  return {
    // Setting or resetting the password rewrites the account row.
    passwordSetAt: password?.updatedAt ?? null,
    passwordSetMethod:
      (password?.passwordSetMethod as PasswordSetMethod | null | undefined) ??
      null,
    recoveryKey: verifierHash !== null,
    walletLinkedAt: wallet?.createdAt ?? null,
  };
}

const RECOVERY_REASONS: readonly string[] = [
  "account_recovery",
  "email_only_recovery",
];

/**
 * Reads what the decision needs. `sessionId` is the browser session making
 * the change; without one, only the account's own state can allow it.
 */
export async function readRecoveryFactorState(input: {
  sessionId: string | null;
  userId: string;
}): Promise<RecoveryFactorState | null> {
  const now = new Date();
  const user = await db
    .select({
      email: users.email,
      emailVerified: users.emailVerified,
      isAnonymous: users.isAnonymous,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .get();
  if (!user) {
    return null;
  }

  const hasPasskey = await userHasPasskey(input.userId);
  if (!(hasPasskey && input.sessionId)) {
    return {
      ...user,
      factors: hasPasskey
        ? await readRecoveryFactors(input.userId)
        : NO_FACTORS,
      hasPasskey,
      magicLinkProof: null,
      recoveryAddedPasskey: false,
      recoveryKeyProof: null,
      signIns: [],
    };
  }
  const sessionId = input.sessionId;

  const [factors, signIns, magicLinkProof, recoveryKeyProof, enrollments] =
    await Promise.all([
      readRecoveryFactors(input.userId),
      db
        .select({
          amr: authenticationContexts.amr,
          authenticatedAt: authenticationContexts.authenticatedAt,
          loginMethod: authenticationContexts.loginMethod,
        })
        .from(authenticationContexts)
        .where(
          and(
            eq(authenticationContexts.userId, input.userId),
            eq(authenticationContexts.sourceSessionId, sessionId),
            eq(authenticationContexts.sourceKind, "better_auth"),
            eq(authenticationContexts.referenceType, "session"),
            inArray(authenticationContexts.loginMethod, [
              "eip712",
              "opaque",
              "passkey",
            ]),
            gte(
              authenticationContexts.authenticatedAt,
              new Date(now.getTime() - RECOVERY_KEY_REVERIFICATION_WINDOW_MS)
            )
          )
        )
        .all(),
      readMagicLinkProof(input.userId, sessionId, now),
      readRecoveryKeyProof(input.userId, sessionId, now),
      readSessionRecords(
        passkeyEnrollmentIdentifier(sessionId),
        input.userId,
        now
      ),
    ]);

  return {
    ...user,
    factors,
    hasPasskey,
    magicLinkProof,
    recoveryAddedPasskey: enrollments.some((record) =>
      RECOVERY_REASONS.includes(String(record.value.method))
    ),
    recoveryKeyProof,
    signIns: signIns.map((signIn) => ({
      authenticatedAt: signIn.authenticatedAt,
      method: signIn.loginMethod as SessionSignInMethod,
      userVerified: signIn.amr.includes("mfa"),
    })),
  };
}

export async function checkRecoveryFactorChange(input: {
  change: RecoveryFactorChange;
  sessionId: string | null;
  userId: string;
}): Promise<RecoveryFactorDecision> {
  const state = await readRecoveryFactorState(input);
  const decision: RecoveryFactorDecision = state
    ? decideRecoveryFactorChange(state, input.change)
    : { allowed: false, reason: "reverification_required" };
  if (!decision.allowed) {
    logWarn("recovery factor change refused", {
      change: input.change,
      reason: decision.reason,
    });
  }
  return decision;
}

/** What the page can offer a session the rule refuses. */
export interface RecoveryOptions {
  /** Ways the account can still be recovered with, besides a passkey. */
  available: {
    /** A real, verified address that can receive a sign-in link. */
    email: boolean;
    /** A password that counts toward recovery. */
    password: boolean;
    recoveryKey: boolean;
    wallet: boolean;
  };
  /** Whether this session may add a passkey now. */
  enrollment: "allowed" | "reverification_required";
  hasPasskey: boolean;
  /** Whether the account has a password, however it was set. */
  hasPassword: boolean;
  /**
   * Whether a recent user-verified passkey sign-in, not an account recovery,
   * lets this session add a passkey. The user still has a working passkey.
   */
  passkeyReverified: boolean;
  /** Recovery proofs this session already holds. */
  proofs: RecoveryProof[];
  /**
   * Whether this session signed in with one of the account's passkeys in the
   * last 15 minutes, with or without user verification.
   */
  signedInWithPasskey: boolean;
}

export async function getRecoveryOptions(input: {
  sessionId: string | null;
  userId: string;
}): Promise<RecoveryOptions | null> {
  const state = await readRecoveryFactorState(input);
  if (!state) {
    return null;
  }
  const now = Date.now();
  const settled = (boundAt: Date | null) =>
    boundAt !== null && now - boundAt.getTime() > SETTLED_FACTOR_AGE_MS;
  const factors = state.hasPasskey
    ? state.factors
    : await readRecoveryFactors(input.userId);
  const enrollment = decideRecoveryFactorChange(
    state,
    "passkey_enrollment",
    now
  );
  return {
    available: {
      email: state.emailVerified && hasMailbox(state.email),
      password: passwordCountsTowardRecovery(factors, now),
      recoveryKey: factors.recoveryKey,
      wallet: settled(factors.walletLinkedAt),
    },
    enrollment: enrollment.allowed ? "allowed" : "reverification_required",
    hasPasskey: state.hasPasskey,
    hasPassword: factors.passwordSetAt !== null,
    passkeyReverified: enrollment.reason === "passkey_reverified",
    proofs: heldRecoveryProofs(state, now),
    signedInWithPasskey: state.signIns.some(
      (signIn) => signIn.method === "passkey"
    ),
  };
}

// ── Notices ───────────────────────────────────────────────

type RecoveryFactorNotice =
  | "email_change_requested"
  | "email_changed"
  | "passkey_added"
  | "passkey_removed"
  | "password_added"
  | "password_changed"
  | "password_removed"
  | "password_reset"
  | "recovery_key_added"
  | "recovery_key_replaced"
  | "recovery_key_removed"
  | "recovery_key_used"
  | "social_account_linked"
  | "social_account_removed"
  | "vault_reset"
  | "vault_root_replaced"
  | "wallet_removed";

const NOTICE_SUMMARIES: Record<
  Exclude<
    RecoveryFactorNotice,
    | "email_change_requested"
    | "email_changed"
    | "passkey_added"
    | "social_account_linked"
    | "social_account_removed"
  >,
  string
> = {
  passkey_removed: "A passkey was removed from your Zentity account.",
  password_added: "A password was added to your Zentity account.",
  password_changed: "The password of your Zentity account was changed.",
  password_removed: "The password was removed from your Zentity account.",
  password_reset: "The password of your Zentity account was reset.",
  recovery_key_added: "A recovery key was added to your Zentity account.",
  recovery_key_replaced:
    "The recovery key of your Zentity account was replaced. The old one no longer works.",
  recovery_key_removed:
    "The recovery key was removed from your Zentity account.",
  recovery_key_used:
    "Your recovery key was used to confirm a recovery of your Zentity account.",
  vault_reset: "The encryption keys of your Zentity account were reset.",
  vault_root_replaced:
    "New encryption keys were set up for your Zentity account.",
  wallet_removed: "A wallet was removed from your Zentity account.",
};

// A notice is useful for a day; a device offline longer than that gets none.
const NOTICE_PUSH_TTL_MS = 24 * 60 * 60 * 1000;

const SOCIAL_PROVIDER_NAMES: Record<string, string> = {
  github: "GitHub",
  google: "Google",
};

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}•••@${domain}`;
}

function socialAccountName(providerId: string | undefined): string {
  const name = providerId ? SOCIAL_PROVIDER_NAMES[providerId] : undefined;
  return name ? `${name} account` : "social sign-in account";
}

/** How a passkey was allowed onto the account, stored on its row. */
export type PasskeyEnrollmentMethod =
  | "first_passkey"
  | "sign_up"
  | "passkey_reverified"
  | "account_recovery"
  | "email_only_recovery";

const PASSKEY_ADDED_SUMMARIES: Record<PasskeyEnrollmentMethod, string> = {
  first_passkey: "A passkey was added to your Zentity account.",
  sign_up: "A passkey was added to your Zentity account.",
  passkey_reverified:
    "A passkey was added to your Zentity account, confirmed with one of your passkeys.",
  account_recovery:
    "A passkey was added to your Zentity account through account recovery.",
  email_only_recovery:
    "A passkey was added to your Zentity account with an email sign-in link.",
};

interface RecoveryFactorNoticeInput {
  /** For the email notices: the address before and after the change. */
  emailChange?: { from: string; to: string };
  /** For `passkey_added`: how the passkey was allowed. */
  enrollmentMethod?: PasskeyEnrollmentMethod;
  notice: RecoveryFactorNotice;
  /** For the social account notices: the account's provider. */
  providerId?: string;
  userId: string;
}

function noticeSummary(input: RecoveryFactorNoticeInput, email: string) {
  switch (input.notice) {
    case "email_change_requested":
      return `Someone asked to change the email of your Zentity account to ${maskEmail(input.emailChange?.to ?? email)}. The change happens only once the new address is confirmed.`;
    case "passkey_added":
      return PASSKEY_ADDED_SUMMARIES[input.enrollmentMethod ?? "first_passkey"];
    case "email_changed":
      return `The email of your Zentity account was changed to ${maskEmail(input.emailChange?.to ?? email)}.`;
    case "social_account_linked":
      return `A ${socialAccountName(input.providerId)} was linked to your Zentity account and can now sign in to it.`;
    case "social_account_removed":
      return `A ${socialAccountName(input.providerId)} was unlinked from your Zentity account.`;
    default:
      return NOTICE_SUMMARIES[input.notice];
  }
}

function hasMailbox(email: string): boolean {
  return !(isSyntheticEmail(email) || isServiceAccountEmail(email));
}

// Where a notice sends the user who did not make the change. An unknown
// passkey is removed from the recovery page, which works without one.
function reviewPath(notice: RecoveryFactorNotice): string {
  return notice === "passkey_added"
    ? "/recovery/passkey?intent=remove"
    : "/dashboard/settings";
}

/**
 * Tells the user by email, and by push where they subscribed, that a
 * recovery factor changed. An `email_changed` notice goes to the previous
 * address. Anonymous accounts are still in sign-up and get none. Never
 * throws: a failed notice must not undo the change.
 */
export async function notifyRecoveryFactorChange(
  input: RecoveryFactorNoticeInput
): Promise<void> {
  try {
    const user = await db
      .select({ email: users.email, isAnonymous: users.isAnonymous })
      .from(users)
      .where(eq(users.id, input.userId))
      .get();
    if (!user || user.isAnonymous) {
      return;
    }
    const summary = noticeSummary(input, user.email);
    const recipient = input.emailChange?.from ?? user.email;
    const path = reviewPath(input.notice);
    const settingsUrl = `${getAppOrigin()}${path}`;

    const results = await Promise.allSettled([
      hasMailbox(recipient)
        ? sendAccountSecurityNotice({ email: recipient, settingsUrl, summary })
        : Promise.resolve(),
      sendWebPush(
        input.userId,
        {
          title: "Security change on your account",
          body: summary,
          // Workers installed before account notices open `approvalUrl`.
          data: { kind: "account_notice", url: path, approvalUrl: path },
        },
        { expiresAt: new Date(Date.now() + NOTICE_PUSH_TTL_MS) }
      ),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        logError(result.reason, {
          userId: input.userId,
          operation: "recovery-factor-notice",
        });
      }
    }
  } catch (error) {
    logError(error, {
      userId: input.userId,
      operation: "recovery-factor-notice",
    });
  }
}

// ── Better Auth endpoints ─────────────────────────────────

type HookCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

function reverificationRequired(): APIError {
  return new APIError("FORBIDDEN", {
    code: REVERIFICATION_REQUIRED,
    message: REVERIFICATION_REQUIRED_MESSAGE,
  });
}

/** Returns the user whose change was allowed, or null without a session. */
async function requireReverifiedSession(
  ctx: HookCtx,
  change: RecoveryFactorChange
): Promise<string | null> {
  const session = await getSessionFromCtx(ctx);
  if (!session) {
    // The endpoint's own session middleware answers.
    return null;
  }
  const decision = await checkRecoveryFactorChange({
    change,
    sessionId: session.session.id,
    userId: session.user.id,
  });
  if (!decision.allowed) {
    throw reverificationRequired();
  }
  return session.user.id;
}

/** The notice an allowed endpoint call sends once it succeeds. */
const pendingNotice = defineRequestState<RecoveryFactorNoticeInput | null>(
  () => null
);

async function requireReverifiedRemoval(
  ctx: HookCtx,
  change: RecoveryFactorChange,
  notice: Omit<RecoveryFactorNoticeInput, "userId">
): Promise<void> {
  const userId = await requireReverifiedSession(ctx, change);
  if (userId) {
    await pendingNotice.set({ ...notice, userId });
  }
}

// ── Passkeys ──────────────────────────────────────────────

const ENROLLMENT_METHODS: Record<AllowedReason, PasskeyEnrollmentMethod> = {
  no_passkey: "first_passkey",
  sign_up: "sign_up",
  passkey_reverified: "passkey_reverified",
  account_recovery: "account_recovery",
  email_only_recovery: "email_only_recovery",
};

/** The registration this request verified, recorded once the passkey exists. */
const pendingEnrollment = defineRequestState<{
  credentialId: string;
  method: PasskeyEnrollmentMethod;
  sessionId: string;
  /** Whether the recovery that allowed it used the recovery key. */
  spendsRecoveryKey: boolean;
  userId: string;
} | null>(() => null);

/**
 * The passkey plugin's `registration.afterVerification`, which runs before
 * the plugin stores the passkey. `/passkey/generate-register-options`
 * already refused a session the rule does not allow; this check also covers
 * options issued before the session's window ended.
 */
export async function authorizePasskeyEnrollment(
  ctx: GenericEndpointContext,
  credentialId: string
): Promise<void> {
  const session = ctx.context.session;
  if (!session) {
    throw reverificationRequired();
  }
  const state = await readRecoveryFactorState({
    sessionId: session.session.id,
    userId: session.user.id,
  });
  const decision: RecoveryFactorDecision = state
    ? decideRecoveryFactorChange(state, "passkey_enrollment")
    : { allowed: false, reason: "reverification_required" };
  if (!(state && decision.allowed)) {
    logWarn("recovery factor change refused", {
      change: "passkey_enrollment",
      reason: decision.reason,
    });
    throw reverificationRequired();
  }
  await pendingEnrollment.set({
    credentialId,
    method: ENROLLMENT_METHODS[decision.reason],
    sessionId: session.session.id,
    spendsRecoveryKey:
      decision.reason === "account_recovery" && state.recoveryKeyProof !== null,
    userId: session.user.id,
  });
}

/**
 * Records how the passkey was allowed, marks the session's recovery as used
 * (`passkey-enrollment:<sessionId>`), spends the recovery key that allowed
 * it, and tells the user. The marker also lets the session take the passkey
 * back, as the client does when the passkey cannot open the vault.
 */
async function afterPasskeyRegistration(ctx: HookCtx) {
  const enrollment = await pendingEnrollment.get();
  const returned = (ctx.context as { returned?: unknown }).returned;
  if (!enrollment || isAPIError(returned)) {
    return;
  }
  const passkey = await db
    .select({ id: passkeys.id })
    .from(passkeys)
    .where(
      and(
        eq(passkeys.credentialID, enrollment.credentialId),
        eq(passkeys.userId, enrollment.userId)
      )
    )
    .get();
  if (!passkey) {
    return;
  }
  await db
    .update(passkeys)
    .set({ enrollmentMethod: enrollment.method })
    .where(eq(passkeys.id, passkey.id))
    .run();
  await ctx.context.internalAdapter.createVerificationValue({
    identifier: passkeyEnrollmentIdentifier(enrollment.sessionId),
    value: JSON.stringify({
      method: enrollment.method,
      passkeyId: passkey.id,
      userId: enrollment.userId,
    }),
    expiresAt: new Date(Date.now() + ACCOUNT_RECOVERY_WINDOW_MS),
  });
  if (enrollment.spendsRecoveryKey) {
    // A spent key still opens the vault in the browser, but proves nothing.
    await db
      .update(secretWrappers)
      .set({ verifierHash: null, updatedAt: sql`${secretWrappers.updatedAt}` })
      .where(
        and(
          eq(secretWrappers.userId, enrollment.userId),
          eq(secretWrappers.credentialId, RECOVERY_KEY_CREDENTIAL_ID)
        )
      )
      .run();
    // This session's recovery goes on, as it retires the lost passkey and
    // saves a new key; every other session's proof of the key is void.
    await db
      .update(verifications)
      .set({
        value: JSON.stringify({
          proof: "recovery_key",
          spent: true,
          userId: enrollment.userId,
        }),
      })
      .where(
        eq(
          verifications.identifier,
          recoveryKeyProofIdentifier(enrollment.sessionId)
        )
      )
      .run();
  }
  await notifyRecoveryFactorChange({
    notice: "passkey_added",
    enrollmentMethod: enrollment.method,
    userId: enrollment.userId,
  });
}

export const LAST_PASSKEY_MESSAGE =
  "Add another passkey before you remove this one.";

type PasskeyRemovalDecision =
  | { allowed: true; undo: SessionRecord | null }
  | { allowed: false; reason: "last_passkey" | "reverification_required" };

/**
 * Removing a passkey passes the rule. The last passkey goes only from an
 * account recovery, which is how a user removes a passkey they don't
 * recognize; otherwise the account would leave the rule and any session
 * could enroll its own. A session may always take back a passkey it added
 * in the last 10 minutes; `undo` is that enrollment.
 *
 * Detaching a passkey's vault wrapper asks the same question first, so a
 * refused deletion never leaves a passkey that no longer opens the vault.
 * Returns null when the user holds no such passkey.
 */
export async function checkPasskeyRemoval(input: {
  passkey: { id: string } | { credentialId: string };
  sessionId: string | null;
  userId: string;
}): Promise<PasskeyRemovalDecision | null> {
  const { sessionId, userId } = input;
  const owned = await db
    .select({ id: passkeys.id, credentialId: passkeys.credentialID })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .all();
  const target = owned.find((row) =>
    "id" in input.passkey
      ? row.id === input.passkey.id
      : row.credentialId === input.passkey.credentialId
  );
  if (!target) {
    return null;
  }

  const [ownEnrollment] = sessionId
    ? (
        await readSessionRecords(
          passkeyEnrollmentIdentifier(sessionId),
          userId,
          new Date()
        )
      ).filter((record) => record.value.passkeyId === target.id)
    : [];
  if (ownEnrollment) {
    return { allowed: true, undo: ownEnrollment };
  }
  const decision = await checkRecoveryFactorChange({
    change: "passkey",
    sessionId,
    userId,
  });
  const mayRemoveLast =
    decision.allowed &&
    (decision.reason === "account_recovery" || decision.reason === "sign_up");
  if (owned.length <= 1 && !mayRemoveLast) {
    return { allowed: false, reason: "last_passkey" };
  }
  if (!decision.allowed) {
    return { allowed: false, reason: "reverification_required" };
  }
  return { allowed: true, undo: null };
}

/** A passkey enrollment a successful deletion takes back. */
const pendingUndo = defineRequestState<SessionRecord | null>(() => null);

async function beforeDeletePasskey(ctx: HookCtx) {
  const session = await getSessionFromCtx(ctx);
  const passkeyId = typeof ctx.body?.id === "string" ? ctx.body.id : null;
  if (!(session && passkeyId)) {
    return;
  }
  const userId = session.user.id;
  const decision = await checkPasskeyRemoval({
    passkey: { id: passkeyId },
    sessionId: session.session.id,
    userId,
  });
  if (!decision) {
    // The endpoint answers for a passkey the user does not hold.
    return;
  }
  if (!decision.allowed) {
    throw decision.reason === "last_passkey"
      ? new APIError("BAD_REQUEST", {
          code: "LAST_PASSKEY",
          message: LAST_PASSKEY_MESSAGE,
        })
      : reverificationRequired();
  }
  await pendingUndo.set(decision.undo);
  await pendingNotice.set({ notice: "passkey_removed", userId });
}

async function afterDeletePasskey(ctx: HookCtx) {
  const undo = await pendingUndo.get();
  const returned = (ctx.context as { returned?: unknown }).returned;
  if (undo && !isAPIError(returned)) {
    // The recovery that allowed it may add a passkey again.
    await db.delete(verifications).where(eq(verifications.id, undo.id)).run();
  }
  await afterRemoval(ctx);
}

// ── Recovery key ──────────────────────────────────────────

const RECOVERY_KEY_VERIFIER_BYTES = 32;

/**
 * Proves the recovery key without revealing it: the browser derives a
 * verifier from the key (`deriveRecoveryKeyVerifier`), and the server keeps
 * only its SHA-256 on the key's vault wrapper. A match records a
 * `recovery_key` proof for this session for 10 minutes, bound to that
 * SHA-256, so spending or replacing the key voids every session's proof.
 */
const verifyRecoveryKey = createAuthEndpoint(
  "/recovery-key/verify",
  {
    method: "POST",
    body: z.object({ verifier: z.base64url() }),
    use: [sensitiveSessionMiddleware],
  },
  async (ctx) => {
    const { session, user } = ctx.context.session;
    const stored = await readRecoveryKeyVerifierHash(user.id);
    if (!stored) {
      throw new APIError("BAD_REQUEST", {
        code: "RECOVERY_KEY_NOT_SET",
        message:
          "Your account has no recovery key that can confirm a recovery. A recovery key confirms one recovery; create a new one in Settings.",
      });
    }
    const verifier = Buffer.from(ctx.body.verifier, "base64url");
    const matches =
      verifier.byteLength === RECOVERY_KEY_VERIFIER_BYTES &&
      timingSafeEqual(
        createHash("sha256").update(verifier).digest(),
        Buffer.from(stored, "hex")
      );
    if (!matches) {
      throw new APIError("UNAUTHORIZED", {
        code: "INVALID_RECOVERY_KEY",
        message:
          "This recovery key doesn't match your account. Check the words and try again.",
      });
    }
    const expiresAt = new Date(Date.now() + ACCOUNT_RECOVERY_WINDOW_MS);
    await ctx.context.internalAdapter.createVerificationValue({
      identifier: recoveryKeyProofIdentifier(session.id),
      value: JSON.stringify({
        proof: "recovery_key",
        userId: user.id,
        verifierHash: stored,
      }),
      expiresAt,
    });
    await notifyRecoveryFactorChange({
      notice: "recovery_key_used",
      userId: user.id,
    });
    return ctx.json({
      proof: "recovery_key" as const,
      expiresAt: expiresAt.toISOString(),
    });
  }
);

// ── Accounts ──────────────────────────────────────────────

interface AccountFactor {
  change: RecoveryFactorChange;
  removed: RecoveryFactorNotice;
}

// What an account of each provider recovers the account with. Every other
// account comes from a social provider's OAuth callback or `/link-social`.
const ACCOUNT_FACTORS: Record<string, AccountFactor> = {
  credential: { change: "password", removed: "password_removed" },
  eip712: { change: "wallet", removed: "wallet_removed" },
  opaque: { change: "password", removed: "password_removed" },
};
const SOCIAL_ACCOUNT_FACTOR: AccountFactor = {
  change: "social_account",
  removed: "social_account_removed",
};

function accountFactor(providerId: string): AccountFactor {
  return ACCOUNT_FACTORS[providerId] ?? SOCIAL_ACCOUNT_FACTOR;
}

async function beforeUnlinkAccount(ctx: HookCtx) {
  const session = await getSessionFromCtx(ctx);
  const accountId =
    typeof ctx.body?.accountId === "string" ? ctx.body.accountId : null;
  if (!(session && accountId)) {
    return;
  }
  const account = await db
    .select({ providerId: accounts.providerId })
    .from(accounts)
    .where(
      and(eq(accounts.id, accountId), eq(accounts.userId, session.user.id))
    )
    .get();
  if (!account) {
    // The endpoint answers for an account the user does not hold.
    return;
  }
  const factor = accountFactor(account.providerId);
  await requireReverifiedRemoval(ctx, factor.change, {
    notice: factor.removed,
    providerId: account.providerId,
  });
}

/**
 * Tells the user when a social sign-in account is linked, through
 * `/link-social` or by a social sign-in that matched the account's verified
 * address.
 */
async function afterAccountCreated(account: {
  providerId: string;
  userId: string;
}) {
  if (accountFactor(account.providerId) === SOCIAL_ACCOUNT_FACTOR) {
    await notifyRecoveryFactorChange({
      notice: "social_account_linked",
      providerId: account.providerId,
      userId: account.userId,
    });
  }
}

async function afterRemoval(ctx: HookCtx) {
  const pending = await pendingNotice.get();
  const returned = (ctx.context as { returned?: unknown }).returned;
  if (!pending || isAPIError(returned)) {
    return;
  }
  await notifyRecoveryFactorChange(pending);
}

// The endpoint keeps a session-less request at least this long so its
// timing does not say whether the address belongs to an unverified account.
const SESSIONLESS_VERIFICATION_FLOOR_MS = 500;

/**
 * Verifying the address makes it a recovery factor. A session-less request
 * for an account that holds a passkey sends nothing, and answers as the
 * endpoint answers for an unknown address.
 */
async function beforeSendVerificationEmail(ctx: HookCtx) {
  const startedAt = Date.now();
  if (await getSessionFromCtx(ctx)) {
    await requireReverifiedSession(ctx, "email");
    return;
  }
  const email =
    typeof ctx.body?.email === "string" ? ctx.body.email.toLowerCase() : null;
  if (!email) {
    return;
  }
  const user = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .get();
  if (!(user && (await userHasPasskey(user.id)))) {
    return;
  }
  const remaining =
    SESSIONLESS_VERIFICATION_FLOOR_MS - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  return ctx.json({ status: true });
}

/** An email change the user's current, unverified address hears nothing of. */
const pendingEmailChangeRequest = defineRequestState<{
  from: string;
  to: string;
  userId: string;
} | null>(() => null);

async function beforeChangeEmail(ctx: HookCtx) {
  const userId = await requireReverifiedSession(ctx, "email");
  const newEmail =
    typeof ctx.body?.newEmail === "string" ? ctx.body.newEmail : null;
  if (!(userId && newEmail)) {
    return;
  }
  const user = await db
    .select({ email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  // A verified address gets Better Auth's own confirmation request.
  if (user && !user.emailVerified && (await userHasPasskey(userId))) {
    await pendingEmailChangeRequest.set({
      from: user.email,
      to: newEmail,
      userId,
    });
  }
}

async function afterChangeEmail(ctx: HookCtx) {
  const request = await pendingEmailChangeRequest.get();
  const returned = (ctx.context as { returned?: unknown }).returned;
  if (!request || isAPIError(returned)) {
    return;
  }
  await notifyRecoveryFactorChange({
    notice: "email_change_requested",
    emailChange: { from: request.from, to: request.to },
    userId: request.userId,
  });
}

async function earliestPasskeyCreatedAt(userId: string): Promise<Date | null> {
  const row = await db
    .select({ createdAt: passkeys.createdAt })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .orderBy(asc(passkeys.createdAt))
    .limit(1)
    .get();
  return row?.createdAt ?? null;
}

interface EmailChangeToken {
  /** Whether opening the link writes the new address. */
  changesAddress: boolean;
  from: string;
  issuedAt: number;
  to: string;
  userId: string;
}

async function readEmailChangeToken(
  token: string,
  secret: string
): Promise<EmailChangeToken | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
      { algorithms: ["HS256"] }
    );
    return typeof payload.updateTo === "string" &&
      typeof payload.email === "string" &&
      typeof payload.userId === "string" &&
      typeof payload.iat === "number"
      ? {
          from: payload.email,
          issuedAt: payload.iat,
          changesAddress: payload.requestType !== "change-email-confirmation",
          to: payload.updateTo,
          userId: payload.userId,
        }
      : null;
  } catch {
    // The endpoint answers for a bad or expired token.
    return null;
  }
}

/**
 * An email-change link carries its authority: `/change-email` checked the
 * session that asked for it. A link issued before the account's passkey
 * existed was never checked, so it no longer changes the address. The link
 * can be opened on any device, which a check of the opening session would
 * not allow.
 */
async function beforeVerifyEmailChange(ctx: HookCtx) {
  const token = typeof ctx.query?.token === "string" ? ctx.query.token : null;
  if (!token) {
    return;
  }
  const change = await readEmailChangeToken(token, ctx.context.secret);
  if (!change) {
    return;
  }
  const firstPasskey = await earliestPasskeyCreatedAt(change.userId);
  // JWT `iat` has whole seconds; a link from the passkey's own second counts.
  if (
    !firstPasskey ||
    change.issuedAt >= Math.floor(firstPasskey.getTime() / 1000)
  ) {
    if (change.changesAddress) {
      await pendingEmailChange.set(change);
    }
    return;
  }
  logWarn("recovery factor change refused", {
    change: "email",
    reason: "link_issued_before_passkey",
  });
  if (typeof ctx.query?.callbackURL === "string") {
    throw ctx.redirect(
      `${getAppOrigin()}/dashboard/settings?tab=profile&error=${REVERIFICATION_REQUIRED}`
    );
  }
  throw reverificationRequired();
}

const pendingEmailChange = defineRequestState<EmailChangeToken | null>(
  () => null
);

async function afterVerifyEmailChange() {
  const change = await pendingEmailChange.get();
  if (!change) {
    return;
  }
  const user = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, change.userId))
    .get();
  if (user?.email.toLowerCase() === change.to.toLowerCase()) {
    await notifyRecoveryFactorChange({
      notice: "email_changed",
      emailChange: { from: change.from, to: change.to },
      userId: change.userId,
    });
  }
}

function passwordNotSet(): APIError {
  return new APIError("BAD_REQUEST", {
    code: "PASSWORD_NOT_SET",
    message:
      'Your account signs in with a passkey and has no password to reset. Sign in with your passkey, or choose "Lost your passkey?" on the sign-in page.',
  });
}

/**
 * The OPAQUE plugin's `authorizePasswordChange`, which runs before every
 * password write and returns how the password was set. A signed-in change
 * passes the rule. A reset by email passes no rule, so on an account that
 * holds a passkey it may replace the password but never add one, and the
 * password it sets confirms no account recovery.
 */
export async function authorizePasswordChange(change: {
  hasPassword: boolean;
  sessionId: string | null;
  userId: string;
  via: PasswordChangeVia;
}): Promise<PasswordSetMethod> {
  if (change.via === "sign_up") {
    return "sign_up";
  }
  if (change.via === "reset") {
    if (!(await userHasPasskey(change.userId))) {
      return "no_passkey";
    }
    if (!change.hasPassword) {
      logWarn("recovery factor change refused", {
        change: "password",
        reason: "reset_adds_password",
      });
      throw passwordNotSet();
    }
    return "password_reset";
  }
  const decision = await checkRecoveryFactorChange({
    change: "password",
    sessionId: change.sessionId,
    userId: change.userId,
  });
  if (!decision.allowed) {
    throw reverificationRequired();
  }
  return decision.reason;
}

/** Whether the account had a password before this registration. */
const passwordRegistration = defineRequestState<{
  hadPassword: boolean;
  userId: string;
} | null>(() => null);

async function beforePasswordRegistrationComplete(ctx: HookCtx) {
  const session = await getSessionFromCtx(ctx);
  if (!session) {
    return;
  }
  const existing = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, session.user.id),
        eq(accounts.providerId, "opaque")
      )
    )
    .limit(1)
    .get();
  await passwordRegistration.set({
    hadPassword: Boolean(existing),
    userId: session.user.id,
  });
}

async function afterPasswordRegistrationComplete(ctx: HookCtx) {
  const registration = await passwordRegistration.get();
  const returned = (ctx.context as { returned?: unknown }).returned;
  if (!registration || isAPIError(returned)) {
    return;
  }
  await notifyRecoveryFactorChange({
    notice: registration.hadPassword ? "password_changed" : "password_added",
    userId: registration.userId,
  });
}

// The magic-link plugin stores a token under this identifier (with its
// default plain token storage).
function magicLinkIdentifier(token: string): string {
  return `magic-link:${token}`;
}

/** The address a pending magic link signs in to. */
export async function readMagicLinkEmail(
  token: string
): Promise<string | null> {
  const verification = await db
    .select({ value: verifications.value })
    .from(verifications)
    .where(eq(verifications.identifier, magicLinkIdentifier(token)))
    .limit(1)
    .get();
  if (!verification) {
    return null;
  }
  try {
    const { email } = JSON.parse(verification.value) as { email?: unknown };
    return typeof email === "string" ? email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The account a magic link reaches, when its address was already verified. */
const magicLinkVerifiedAddress = defineRequestState<{
  email: string;
  userId: string;
} | null>(() => null);

async function beforeMagicLinkVerify(ctx: HookCtx) {
  const token = typeof ctx.query?.token === "string" ? ctx.query.token : null;
  const email = token ? await readMagicLinkEmail(token) : null;
  if (!email) {
    return;
  }
  const user = await db
    .select({ id: users.id, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.email, email))
    .get();
  if (user?.emailVerified) {
    await magicLinkVerifiedAddress.set({ email, userId: user.id });
  }
}

async function afterMagicLinkVerify(ctx: HookCtx) {
  const address = await magicLinkVerifiedAddress.get();
  const newSession = (
    ctx.context as {
      newSession?: { session?: { id?: string }; user?: { id?: string } };
    }
  ).newSession;
  const sessionId = newSession?.session?.id;
  if (!(address && sessionId && newSession?.user?.id === address.userId)) {
    return;
  }
  await ctx.context.internalAdapter.createVerificationValue({
    identifier: magicLinkProofIdentifier(sessionId),
    value: JSON.stringify(address),
    expiresAt: new Date(Date.now() + ACCOUNT_RECOVERY_WINDOW_MS),
  });
}

/**
 * Applies the recovery factor rule to the Better Auth endpoints that add a
 * passkey or change a factor, records the magic-link sign-ins and the
 * recovery key proofs that count toward it, and serves the recovery key
 * proof (`/recovery-key/verify`).
 */
export function recoveryFactorsPlugin() {
  return {
    id: "zentity-recovery-factors",
    endpoints: { verifyRecoveryKey },
    init: () => ({
      options: {
        databaseHooks: {
          account: { create: { after: afterAccountCreated } },
        },
      },
    }),
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/passkey/generate-register-options",
          handler: createAuthMiddleware(async (ctx) => {
            await requireReverifiedSession(ctx, "passkey_enrollment");
          }),
        },
        {
          matcher: (ctx) => ctx.path === "/passkey/delete-passkey",
          handler: createAuthMiddleware(beforeDeletePasskey),
        },
        {
          matcher: (ctx) => ctx.path === "/unlink-account",
          handler: createAuthMiddleware(beforeUnlinkAccount),
        },
        {
          matcher: (ctx) => ctx.path === "/link-social",
          handler: createAuthMiddleware(async (ctx) => {
            await requireReverifiedSession(ctx, "social_account");
          }),
        },
        {
          matcher: (ctx) => ctx.path === "/delete-user",
          handler: createAuthMiddleware(async (ctx) => {
            await requireReverifiedSession(ctx, "account_deletion");
          }),
        },
        {
          matcher: (ctx) => ctx.path === "/change-email",
          handler: createAuthMiddleware(beforeChangeEmail),
        },
        {
          matcher: (ctx) =>
            ctx.path?.startsWith("/password/opaque/registration/") ?? false,
          handler: createAuthMiddleware(async (ctx) => {
            await requireReverifiedSession(ctx, "password");
          }),
        },
        {
          matcher: (ctx) =>
            ctx.path === "/password/opaque/registration/complete",
          handler: createAuthMiddleware(beforePasswordRegistrationComplete),
        },
        {
          matcher: (ctx) => ctx.path === "/send-verification-email",
          handler: createAuthMiddleware(beforeSendVerificationEmail),
        },
        {
          matcher: (ctx) => ctx.path === "/verify-email",
          handler: createAuthMiddleware(beforeVerifyEmailChange),
        },
        {
          matcher: (ctx) => ctx.path === "/magic-link/verify",
          handler: createAuthMiddleware(beforeMagicLinkVerify),
        },
      ],
      after: [
        {
          matcher: (ctx) => ctx.path === "/passkey/verify-registration",
          handler: createAuthMiddleware(afterPasskeyRegistration),
        },
        {
          matcher: (ctx) => ctx.path === "/passkey/delete-passkey",
          handler: createAuthMiddleware(afterDeletePasskey),
        },
        {
          matcher: (ctx) => ctx.path === "/unlink-account",
          handler: createAuthMiddleware(afterRemoval),
        },
        {
          matcher: (ctx) => ctx.path === "/change-email",
          handler: createAuthMiddleware(afterChangeEmail),
        },
        {
          matcher: (ctx) => ctx.path === "/magic-link/verify",
          handler: createAuthMiddleware(afterMagicLinkVerify),
        },
        {
          matcher: (ctx) =>
            ctx.path === "/password/opaque/registration/complete",
          handler: createAuthMiddleware(afterPasswordRegistrationComplete),
        },
        {
          matcher: (ctx) => ctx.path === "/verify-email",
          handler: createAuthMiddleware(afterVerifyEmailChange),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
