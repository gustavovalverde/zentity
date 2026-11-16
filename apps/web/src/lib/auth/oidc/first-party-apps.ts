import type { GenericEndpointContext } from "@better-auth/core";
import type {
  FirstPartyAuthorizationDecision,
  FirstPartyAuthorizationPolicyInput,
  FirstPartyClient,
  FirstPartyMethod,
  FirstPartyMethodRespondResult,
  FirstPartyMethodStartResult,
  FirstPartySessionFieldsInput,
} from "@better-auth/first-party-apps";

import { firstPartyApps } from "@better-auth/first-party-apps";
import { ready, server } from "@serenity-kit/opaque";
import { APIError } from "better-auth/api";
import { and, desc, eq, lte } from "drizzle-orm";
import { getAddress } from "viem";

import { env } from "@/env";
import { loginMethodToAmr } from "@/lib/assurance/oidc-claims";
import { getAccountAssurance } from "@/lib/assurance/posture";
import { createAuthenticationContext } from "@/lib/auth/auth-context";
import { findSatisfiedAcr } from "@/lib/auth/oidc/step-up";
import {
  createDummyRegistrationRecord,
  decryptServerLoginState,
  encryptServerLoginState,
  LOGIN_REQUEST_LENGTH,
  validateBase64Length,
} from "@/lib/auth/opaque/validation";
import {
  issueSiweChallenge,
  redeemSiweChallenge,
} from "@/lib/auth/siwe/server";
import { db } from "@/lib/db/connection";
import { accounts, users, walletAddresses } from "@/lib/db/schema/auth";
import {
  firstPartyAuthSessions,
  firstPartyFailureBudgets,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";
import { getOpaqueStateKey } from "@/lib/privacy/primitives/derived-keys";

/**
 * Lifetime of a session the endpoint creates. It bounds the tokens issued
 * from it, which the provider treats as inactive once their `sid` session
 * ends, and the DPoP-bound `auth_session` that re-enters on it. A day covers
 * a working session of a CLI or native app and stays shorter than the
 * browser's seven-day session.
 */
const FIRST_PARTY_SESSION_EXPIRES_IN_S = 24 * 60 * 60;
const DEFAULT_CHAIN_ID = 1;
const ETH_ADDRESS_RE = /^0x[0-9a-f]{40}$/i;

const failed: FirstPartyMethodRespondResult = { type: "failed" };

function isWalletAddress(hint: string): boolean {
  return ETH_ADDRESS_RE.test(hint);
}

async function findRegistrationRecord(userId: string): Promise<string | null> {
  const account = await db
    .select({ registrationRecord: accounts.registrationRecord })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "opaque")))
    .get();
  return account?.registrationRecord ?? null;
}

// ── OPAQUE (three rounds) ───────────────────────────────

interface OpaqueState {
  /** The encrypted server login state, set once the client sent its login request. */
  serverLoginState?: string;
}

async function opaqueChallenge(
  userId: string | null
): Promise<FirstPartyMethodStartResult> {
  await ready;
  return {
    type: "challenge",
    userId,
    challenge: {
      server_public_key: server.getPublicKey(env.OPAQUE_SERVER_SETUP),
    },
    state: {} satisfies OpaqueState,
  };
}

/**
 * Round 2: answers the client's login request. An account without a
 * registration record runs against a dummy record, so it takes as long as a
 * real one and fails at the next round.
 */
async function startOpaqueLogin(
  userId: string | null,
  startLoginRequest: string
): Promise<FirstPartyMethodRespondResult> {
  await ready;
  try {
    validateBase64Length(
      startLoginRequest,
      LOGIN_REQUEST_LENGTH,
      "login request"
    );
    const registrationRecord = userId
      ? await findRegistrationRecord(userId)
      : null;
    const record =
      registrationRecord && userId
        ? { registrationRecord, userIdentifier: userId }
        : await createDummyRegistrationRecord();
    const { serverLoginState, loginResponse } = server.startLogin({
      serverSetup: env.OPAQUE_SERVER_SETUP,
      userIdentifier: record.userIdentifier,
      registrationRecord: record.registrationRecord,
      startLoginRequest,
    });
    const state: OpaqueState = {
      serverLoginState: await encryptServerLoginState({
        serverLoginState,
        userId: registrationRecord ? userId : null,
        secret: getOpaqueStateKey(),
      }),
    };
    return {
      type: "challenge",
      challenge: { opaque_login_response: loginResponse },
      state,
    };
  } catch {
    return failed;
  }
}

/** Round 3: verifies the client's finish request. */
async function finishOpaqueLogin(
  encryptedState: string,
  finishLoginRequest: string
): Promise<FirstPartyMethodRespondResult> {
  await ready;
  try {
    const decrypted = await decryptServerLoginState({
      encryptedState,
      secret: getOpaqueStateKey(),
    });
    const { sessionKey } = server.finishLogin({
      finishLoginRequest,
      serverLoginState: decrypted.serverLoginState,
    });
    return sessionKey && decrypted.userId
      ? { type: "authenticated", userId: decrypted.userId }
      : failed;
  } catch {
    return failed;
  }
}

/**
 * OPAQUE password sign-in. It handles email hints only: a wallet address
 * always goes to Sign-In with Ethereum, and an email whose account has no
 * OPAQUE password answers `redirect_to_web` rather than a wallet challenge
 * that would reveal the account's address. An unknown email gets the same
 * challenge as a known one.
 */
function opaqueMethod(): FirstPartyMethod {
  return {
    id: "opaque",
    amr: loginMethodToAmr("opaque"),
    responseParameters: ["opaque_login_request", "opaque_finish_request"],
    async start({ loginHint, user }) {
      if (user) {
        return (await findRegistrationRecord(user.id))
          ? opaqueChallenge(user.id)
          : null;
      }
      const hint = loginHint?.trim();
      if (!hint || isWalletAddress(hint)) {
        return null;
      }
      const found = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, hint.toLowerCase()))
        .get();
      if (!found) {
        return opaqueChallenge(null);
      }
      return (await findRegistrationRecord(found.id))
        ? opaqueChallenge(found.id)
        : { type: "redirect_to_web" };
    },
    respond({ userId, params, state }) {
      const { opaque_finish_request, opaque_login_request } = params;
      if (typeof opaque_login_request === "string") {
        return startOpaqueLogin(userId, opaque_login_request);
      }
      const { serverLoginState } = (state ?? {}) as OpaqueState;
      if (typeof opaque_finish_request === "string" && serverLoginState) {
        return finishOpaqueLogin(serverLoginState, opaque_finish_request);
      }
      return failed;
    },
  };
}

// ── Sign-In with Ethereum (two rounds) ──────────────────

interface SiweChallengeState {
  message: string;
  requestId: string;
}

function readChainId(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const chainId = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new APIError("BAD_REQUEST", {
      error: "invalid_request",
      error_description: "chain_id must be a positive integer",
    });
  }
  return chainId;
}

/**
 * Issues the EIP-4361 message for one challenge. Its Request ID is a random
 * value kept with the message in the method state, which the plugin
 * encrypts, so a signature redeems only for this challenge. The
 * `auth_session` handle is a bearer secret and never goes into the message.
 */
async function siweChallenge(
  ctx: GenericEndpointContext,
  userId: string | null,
  address: string,
  chainId: number
): Promise<FirstPartyMethodStartResult> {
  const requestId = crypto.randomUUID();
  const message = await issueSiweChallenge(ctx.context.internalAdapter, {
    address,
    chainId,
    purpose: "first-party-app",
    requestId,
  });
  return {
    type: "challenge",
    userId,
    challenge: { message },
    state: { message, requestId } satisfies SiweChallengeState,
  };
}

/**
 * Sign-In with Ethereum. It handles wallet address hints only, so an email
 * never learns the address behind it. An address hint gets the same
 * challenge whether or not it is registered, on the requested `chain_id` or
 * chain 1, and an unknown address's signature then fails. The stored
 * credential ids stay `eip712`, the wallet account's provider id.
 */
function siweMethod(): FirstPartyMethod {
  return {
    id: "siwe",
    amr: loginMethodToAmr("eip712"),
    responseParameters: ["siwe_signature"],
    async start({ ctx, loginHint, user, params }) {
      const requestedChainId = readChainId(params.chain_id);
      if (user) {
        const wallet = await db
          .select({
            address: walletAddresses.address,
            chainId: walletAddresses.chainId,
          })
          .from(walletAddresses)
          .where(eq(walletAddresses.userId, user.id))
          .orderBy(desc(walletAddresses.isPrimary))
          .get();
        return wallet
          ? siweChallenge(
              ctx,
              user.id,
              wallet.address,
              requestedChainId ?? wallet.chainId
            )
          : null;
      }
      const hint = loginHint?.trim();
      if (!(hint && isWalletAddress(hint))) {
        return null;
      }
      const address = getAddress(hint);
      const wallet = await db
        .select({ userId: walletAddresses.userId })
        .from(walletAddresses)
        .where(eq(walletAddresses.address, address))
        .get();
      // The chain must not depend on the account, or the challenge would
      // reveal whether the address is registered.
      return siweChallenge(
        ctx,
        wallet?.userId ?? null,
        address,
        requestedChainId ?? DEFAULT_CHAIN_ID
      );
    },
    async respond({ ctx, userId, params, state }) {
      const signature = params.siwe_signature;
      const challenge = state as SiweChallengeState | undefined;
      if (!(typeof signature === "string" && signature && challenge)) {
        return failed;
      }
      const redemption = await redeemSiweChallenge(
        ctx.context.internalAdapter,
        {
          message: challenge.message,
          purpose: "first-party-app",
          requestId: challenge.requestId,
          signature,
        }
      );
      return redemption.ok && userId
        ? { type: "authenticated", userId }
        : failed;
    },
  };
}

// ── Client opt-in, policy, and session ──────────────────

/**
 * A client may use the endpoint when an administrator marked it first-party
 * (`oauth_client.first_party`, which registration cannot set) and gave it
 * `skip_consent`, since the endpoint cannot show a consent page.
 */
async function isFirstPartyClient({
  client,
}: {
  client: FirstPartyClient;
}): Promise<boolean> {
  if (client.skipConsent !== true) {
    return false;
  }
  const row = await db
    .select({ firstParty: oauthClients.firstParty })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, client.clientId))
    .get();
  return row?.firstParty === true;
}

/**
 * Holds the code back while the user's assurance tier does not meet the
 * requested `acr_values`. The authenticated `auth_session` keeps the sign-in,
 * so the client presents it again once the user's tier rises.
 */
async function requireAssuranceTier({
  request,
  user,
}: FirstPartyAuthorizationPolicyInput): Promise<FirstPartyAuthorizationDecision> {
  if (!request.acr_values) {
    return;
  }
  const { tier } = await getAccountAssurance(user.id, {
    isAuthenticated: true,
  });
  if (findSatisfiedAcr(request.acr_values, tier)) {
    return;
  }
  return {
    type: "insufficient_authorization",
    description: `User assurance is tier-${tier}, does not satisfy acr_values: ${request.acr_values}`,
  };
}

/**
 * Records how the user signed in. `authenticationContext.resolve` reads the
 * session's `authContextId` for the ID token's `amr`. When the endpoint
 * deletes the session again, the session delete hook deletes this context.
 */
async function recordAuthenticationContext({
  method,
  user,
}: FirstPartySessionFieldsInput): Promise<Record<string, unknown>> {
  // Stored identifiers keep the wallet provider id, eip712.
  const wallet = method === "siwe";
  const context = await createAuthenticationContext({
    userId: user.id,
    loginMethod: wallet ? "eip712" : "opaque",
    authenticatedAt: new Date(),
    sourceKind: wallet
      ? "authorize_challenge_eip712"
      : "authorize_challenge_opaque",
  });
  return { authContextId: context.id };
}

/**
 * Deletes `auth_session` rows past their expiry and failure budgets whose
 * window has passed. The plugin deletes an expired row only when a client
 * presents it, so rows from abandoned flows would otherwise build up.
 */
export async function deleteExpiredFirstPartyRows(): Promise<void> {
  const now = new Date();
  await db
    .delete(firstPartyAuthSessions)
    .where(lte(firstPartyAuthSessions.expiresAt, now))
    .run();
  await db
    .delete(firstPartyFailureBudgets)
    .where(lte(firstPartyFailureBudgets.resetAt, now))
    .run();
}

/**
 * The First-Party Apps Authorization Challenge Endpoint
 * (`draft-ietf-oauth-first-party-apps`) at `/oauth2/authorize-challenge`,
 * with Zentity's credential methods in order of preference: OPAQUE, then
 * Sign-In with Ethereum, then `redirect_to_web` when neither applies.
 */
export function firstPartyAppsPlugin() {
  return firstPartyApps({
    isFirstPartyClient,
    methods: [opaqueMethod(), siweMethod()],
    authorizationPolicy: requireAssuranceTier,
    requireDpop: true,
    session: {
      expiresIn: FIRST_PARTY_SESSION_EXPIRES_IN_S,
      fields: recordAuthenticationContext,
    },
  });
}
