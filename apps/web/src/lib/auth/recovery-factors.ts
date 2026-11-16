/**
 * Recovery factors are what a user can recover an account with: the email
 * address, the OPAQUE password, a wallet, the vault root, and the recovery
 * key. On an account that holds a passkey, binding, replacing, or removing
 * one would let a password or a stolen session turn into lasting control,
 * so every such change asks `checkRecoveryFactorChange` first. Removing a
 * passkey asks too: an account that drops its last passkey leaves the rule.
 * So does deleting the account, which removes every factor at once.
 *
 * Allowed states (NIST SP 800-63B-4 §4.1.2.1, OWASP ASVS 5 V7.5.1):
 * - `no_passkey`: the account holds no passkey, and keeps today's rules.
 * - `sign_up`: the account is still anonymous, so sign-up is binding its
 *   first factors.
 * - `passkey_reverified`: this session holds a passkey sign-in with observed
 *   user verification in the last 5 minutes.
 * - `magic_link_reverified`: this session signed in by magic link in the
 *   last 10 minutes, to an address that was verified before the sign-in and
 *   has not changed since.
 */
import "server-only";

import type { BetterAuthPlugin } from "better-auth";

import { defineRequestState } from "@better-auth/core/context";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
  isAPIError,
} from "better-auth/api";
import { and, asc, eq, gt, gte } from "drizzle-orm";
import { jwtVerify } from "jose";

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
import { sendAccountSecurityNotice } from "@/lib/email/auth";
import { logError, logWarn } from "@/lib/logging/error-logger";

export const PASSKEY_REVERIFICATION_WINDOW_MS = 5 * 60 * 1000;
export const MAGIC_LINK_REVERIFICATION_WINDOW_MS = 10 * 60 * 1000;

/** Refusal code on Better Auth endpoints and `data.reason` on tRPC. */
export const REVERIFICATION_REQUIRED = "REVERIFICATION_REQUIRED";
export const REVERIFICATION_REQUIRED_MESSAGE =
  "Confirm it's you with your passkey, or sign in again with an email link, then try again.";

export type RecoveryFactorChange =
  | "account_deletion"
  | "email"
  | "passkey"
  | "password"
  | "wallet"
  | "vault_reset"
  | "vault_root"
  | "recovery_key";

export type RecoveryFactorDecision =
  | {
      allowed: true;
      reason:
        | "no_passkey"
        | "sign_up"
        | "passkey_reverified"
        | "magic_link_reverified";
    }
  | { allowed: false; reason: "reverification_required" };

export interface RecoveryFactorState {
  email: string;
  emailVerified: boolean;
  hasPasskey: boolean;
  isAnonymous: boolean;
  /** The address a magic-link sign-in of this session reached, when it was verified before that sign-in. */
  magicLinkProof: { email: string; expiresAt: Date } | null;
  /** Passkey sign-ins of this session. */
  passkeySignIns: { authenticatedAt: Date; userVerified: boolean }[];
}

export function decideRecoveryFactorChange(
  state: RecoveryFactorState,
  now: number = Date.now()
): RecoveryFactorDecision {
  if (!state.hasPasskey) {
    return { allowed: true, reason: "no_passkey" };
  }
  if (state.isAnonymous) {
    return { allowed: true, reason: "sign_up" };
  }
  const reverifiedByPasskey = state.passkeySignIns.some(
    (signIn) =>
      signIn.userVerified &&
      now - signIn.authenticatedAt.getTime() <= PASSKEY_REVERIFICATION_WINDOW_MS
  );
  if (reverifiedByPasskey) {
    return { allowed: true, reason: "passkey_reverified" };
  }
  const proof = state.magicLinkProof;
  if (
    proof &&
    proof.expiresAt.getTime() > now &&
    state.emailVerified &&
    proof.email === state.email.toLowerCase()
  ) {
    return { allowed: true, reason: "magic_link_reverified" };
  }
  return { allowed: false, reason: "reverification_required" };
}

// ── State ─────────────────────────────────────────────────

const MAGIC_LINK_PROOF_PREFIX = "magic-link-proof:";

function magicLinkProofIdentifier(sessionId: string): string {
  return `${MAGIC_LINK_PROOF_PREFIX}${sessionId}`;
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

async function readMagicLinkProof(
  userId: string,
  sessionId: string,
  now: Date
): Promise<RecoveryFactorState["magicLinkProof"]> {
  const row = await db
    .select({ value: verifications.value, expiresAt: verifications.expiresAt })
    .from(verifications)
    .where(
      and(
        eq(verifications.identifier, magicLinkProofIdentifier(sessionId)),
        gt(verifications.expiresAt, now)
      )
    )
    .limit(1)
    .get();
  if (!row) {
    return null;
  }
  try {
    const proof = JSON.parse(row.value) as {
      email?: unknown;
      userId?: unknown;
    };
    return proof.userId === userId && typeof proof.email === "string"
      ? { email: proof.email, expiresAt: row.expiresAt }
      : null;
  } catch {
    return null;
  }
}

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
    return { ...user, hasPasskey, magicLinkProof: null, passkeySignIns: [] };
  }

  const signIns = await db
    .select({
      amr: authenticationContexts.amr,
      authenticatedAt: authenticationContexts.authenticatedAt,
    })
    .from(authenticationContexts)
    .where(
      and(
        eq(authenticationContexts.userId, input.userId),
        eq(authenticationContexts.sourceSessionId, input.sessionId),
        eq(authenticationContexts.sourceKind, "better_auth"),
        eq(authenticationContexts.referenceType, "session"),
        eq(authenticationContexts.loginMethod, "passkey"),
        gte(
          authenticationContexts.authenticatedAt,
          new Date(now.getTime() - PASSKEY_REVERIFICATION_WINDOW_MS)
        )
      )
    )
    .all();

  return {
    ...user,
    hasPasskey,
    magicLinkProof: await readMagicLinkProof(
      input.userId,
      input.sessionId,
      now
    ),
    passkeySignIns: signIns.map((signIn) => ({
      authenticatedAt: signIn.authenticatedAt,
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
    ? decideRecoveryFactorChange(state)
    : { allowed: false, reason: "reverification_required" };
  if (!decision.allowed) {
    logWarn("recovery factor change refused", {
      change: input.change,
      reason: decision.reason,
    });
  }
  return decision;
}

// ── Notices ───────────────────────────────────────────────

export type RecoveryFactorNotice =
  | "email_changed"
  | "passkey_removed"
  | "password_added"
  | "password_changed"
  | "password_removed"
  | "password_reset"
  | "recovery_key_added"
  | "recovery_key_replaced"
  | "recovery_key_removed"
  | "vault_reset"
  | "vault_root_replaced"
  | "wallet_removed";

const NOTICE_SUMMARIES: Record<
  Exclude<RecoveryFactorNotice, "email_changed">,
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
  vault_reset: "The encryption keys of your Zentity account were reset.",
  vault_root_replaced:
    "New encryption keys were set up for your Zentity account.",
  wallet_removed: "A wallet was removed from your Zentity account.",
};

// A notice is useful for a day; a device offline longer than that gets none.
const NOTICE_PUSH_TTL_MS = 24 * 60 * 60 * 1000;

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}•••@${domain}`;
}

function hasMailbox(email: string): boolean {
  return !(isSyntheticEmail(email) || isServiceAccountEmail(email));
}

/**
 * Tells the user by email, and by push where they subscribed, that a
 * recovery factor changed. An `email_changed` notice goes to the previous
 * address. Anonymous accounts are still in sign-up and get none. Never
 * throws: a failed notice must not undo the change.
 */
export async function notifyRecoveryFactorChange(input: {
  notice: RecoveryFactorNotice;
  /** For `email_changed`: the address before and after the change. */
  emailChange?: { from: string; to: string };
  userId: string;
}): Promise<void> {
  try {
    const user = await db
      .select({ email: users.email, isAnonymous: users.isAnonymous })
      .from(users)
      .where(eq(users.id, input.userId))
      .get();
    if (!user || user.isAnonymous) {
      return;
    }
    const summary =
      input.notice === "email_changed"
        ? `The email of your Zentity account was changed to ${maskEmail(input.emailChange?.to ?? user.email)}.`
        : NOTICE_SUMMARIES[input.notice];
    const recipient = input.emailChange?.from ?? user.email;
    const settingsUrl = `${getAppOrigin()}/dashboard/settings`;

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
          data: {
            kind: "account_notice",
            url: "/dashboard/settings",
            approvalUrl: "/dashboard/settings",
          },
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
const pendingNotice = defineRequestState<{
  notice: RecoveryFactorNotice;
  userId: string;
} | null>(() => null);

async function requireReverifiedRemoval(
  ctx: HookCtx,
  change: RecoveryFactorChange,
  notice: RecoveryFactorNotice
): Promise<void> {
  const userId = await requireReverifiedSession(ctx, change);
  if (userId) {
    await pendingNotice.set({ notice, userId });
  }
}

// Unlinking these providers removes a recovery factor; other providers only
// sign in.
const UNLINKED_FACTORS: Record<
  string,
  { change: RecoveryFactorChange; notice: RecoveryFactorNotice }
> = {
  eip712: { change: "wallet", notice: "wallet_removed" },
  opaque: { change: "password", notice: "password_removed" },
};

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
  const factor = account ? UNLINKED_FACTORS[account.providerId] : undefined;
  if (factor) {
    await requireReverifiedRemoval(ctx, factor.change, factor.notice);
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
    expiresAt: new Date(Date.now() + MAGIC_LINK_REVERIFICATION_WINDOW_MS),
  });
}

/**
 * Applies the recovery factor rule to the Better Auth endpoints that change
 * a factor, and records the magic-link sign-ins that count toward it.
 */
export function recoveryFactorsPlugin() {
  return {
    id: "zentity-recovery-factors",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/passkey/delete-passkey",
          handler: createAuthMiddleware((ctx) =>
            requireReverifiedRemoval(ctx, "passkey", "passkey_removed")
          ),
        },
        {
          matcher: (ctx) => ctx.path === "/unlink-account",
          handler: createAuthMiddleware(beforeUnlinkAccount),
        },
        {
          matcher: (ctx) => ctx.path === "/delete-user",
          handler: createAuthMiddleware(async (ctx) => {
            await requireReverifiedSession(ctx, "account_deletion");
          }),
        },
        {
          matcher: (ctx) => ctx.path === "/change-email",
          handler: createAuthMiddleware(async (ctx) => {
            await requireReverifiedSession(ctx, "email");
          }),
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
          matcher: (ctx) =>
            ctx.path === "/passkey/delete-passkey" ||
            ctx.path === "/unlink-account",
          handler: createAuthMiddleware(afterRemoval),
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
