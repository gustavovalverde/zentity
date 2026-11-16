import type { InternalAdapter } from "@better-auth/core";

import { APIError, type BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import { type Address, getAddress, isAddress, verifyMessage } from "viem";
import {
  createSiweMessage,
  parseSiweMessage,
  validateSiweMessage,
} from "viem/siwe";
import { z } from "zod";

import { env } from "@/env";
import { createSessionAuthenticationContext } from "@/lib/auth/auth-context";

/**
 * What a wallet signature authorizes. Each purpose has its own statement, and
 * a challenge redeems only for the purpose it was issued for, so a signature
 * made to sign in cannot create an account or authorize a first-party app.
 */
type SiwePurpose = "sign-in" | "sign-up" | "first-party-app";

const STATEMENTS: Record<SiwePurpose, string> = {
  "sign-in": "Sign in to Zentity with this wallet.",
  "sign-up": "Create a Zentity account with this wallet.",
  "first-party-app": "Sign in to Zentity from a first-party app.",
};

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

interface IssuedChallenge {
  message: string;
  purpose: SiwePurpose;
}

type SiweRedemption =
  | { ok: true; address: Address; chainId: number }
  | {
      ok: false;
      error: "invalid_nonce" | "invalid_message" | "invalid_signature";
    };

function nonceIdentifier(nonce: string): string {
  return `siwe:${nonce}`;
}

/**
 * The app origin every message names: wallets compare it with the page that
 * asks for the signature, and the server accepts no other.
 */
function appOrigin(): { domain: string; scheme: string; uri: string } {
  const url = new URL(env.NEXT_PUBLIC_APP_URL);
  return {
    domain: url.host,
    scheme: url.protocol.slice(0, -1),
    uri: url.origin,
  };
}

function parseIssuedChallenge(value: string): IssuedChallenge | null {
  try {
    const parsed = JSON.parse(value) as Partial<IssuedChallenge>;
    if (typeof parsed.message === "string" && parsed.purpose) {
      return { message: parsed.message, purpose: parsed.purpose };
    }
  } catch {
    // An unreadable row redeems nothing.
  }
  return null;
}

async function isWalletSignature(
  address: Address,
  message: string,
  signature: string
): Promise<boolean> {
  try {
    return await verifyMessage({
      address,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}

/**
 * Builds the EIP-4361 message the wallet signs for one purpose, and stores it
 * under a single-use nonce that expires with the message.
 */
export async function issueSiweChallenge(
  internalAdapter: InternalAdapter,
  params: {
    address: string;
    chainId: number;
    purpose: SiwePurpose;
    requestId?: string;
  }
): Promise<string> {
  const { domain, scheme, uri } = appOrigin();
  const nonce = generateRandomString(32, "a-z", "A-Z", "0-9");
  const issuedAt = new Date();
  const expirationTime = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
  const message = createSiweMessage({
    address: getAddress(params.address),
    chainId: params.chainId,
    domain,
    expirationTime,
    issuedAt,
    nonce,
    ...(params.requestId ? { requestId: params.requestId } : {}),
    scheme,
    statement: STATEMENTS[params.purpose],
    uri,
    version: "1",
  });

  await internalAdapter.createVerificationValue({
    identifier: nonceIdentifier(nonce),
    value: JSON.stringify({
      message,
      purpose: params.purpose,
    } satisfies IssuedChallenge),
    expiresAt: expirationTime,
  });
  return message;
}

/**
 * Consumes the challenge whose nonce the message carries, whatever the
 * outcome, and accepts the signature only when the message is exactly the one
 * issued for this purpose, is unexpired, names this app's origin, and was
 * signed by the address it names. Concurrent callers race on one atomic
 * consume, so at most one of them succeeds.
 */
export async function redeemSiweChallenge(
  internalAdapter: InternalAdapter,
  params: {
    message: string;
    purpose: SiwePurpose;
    requestId?: string;
    signature: string;
  }
): Promise<SiweRedemption> {
  const parsed = parseSiweMessage(params.message);
  if (!parsed.nonce) {
    return { ok: false, error: "invalid_message" };
  }

  const verification = await internalAdapter.consumeVerificationValue(
    nonceIdentifier(parsed.nonce)
  );
  if (!verification) {
    return { ok: false, error: "invalid_nonce" };
  }

  const issued = parseIssuedChallenge(verification.value);
  const { domain, scheme } = appOrigin();
  if (
    !(
      issued?.purpose === params.purpose &&
      issued.message === params.message &&
      parsed.address &&
      parsed.chainId &&
      parsed.requestId === params.requestId &&
      validateSiweMessage({
        message: parsed,
        domain,
        scheme,
        nonce: parsed.nonce,
      })
    )
  ) {
    return { ok: false, error: "invalid_message" };
  }

  const address = getAddress(parsed.address);
  if (!(await isWalletSignature(address, params.message, params.signature))) {
    return { ok: false, error: "invalid_signature" };
  }
  return { ok: true, address, chainId: parsed.chainId };
}

const REDEMPTION_ERRORS = {
  invalid_nonce: "Invalid or expired nonce",
  invalid_message: "Invalid sign-in message",
  invalid_signature: "Invalid signature",
} as const;

async function redeemOrThrow(
  internalAdapter: InternalAdapter,
  params: { message: string; purpose: SiwePurpose; signature: string }
): Promise<{ address: Address; chainId: number }> {
  const redemption = await redeemSiweChallenge(internalAdapter, params);
  if (!redemption.ok) {
    throw new APIError("UNAUTHORIZED", {
      message: REDEMPTION_ERRORS[redemption.error],
    });
  }
  return redemption;
}

const challengeBody = z.object({
  address: z.string().refine((value) => isAddress(value), "Invalid address"),
  chainId: z.number().int().positive(),
});

export const siweAuth = (options: { emailDomainName: string }) => {
  const { emailDomainName } = options;

  return {
    id: "siwe",
    schema: {
      walletAddress: {
        fields: {
          userId: {
            type: "string",
            required: true,
            references: { model: "user", field: "id" },
          },
          address: { type: "string", required: true },
          chainId: { type: "number", required: true },
          isPrimary: { type: "boolean", required: false },
          createdAt: { type: "date", required: false },
        },
      },
    },
    endpoints: {
      siweSignUpChallenge: createAuthEndpoint(
        "/sign-up/siwe/challenge",
        { method: "POST", body: challengeBody },
        async (ctx) => {
          const message = await issueSiweChallenge(
            ctx.context.internalAdapter,
            { ...ctx.body, purpose: "sign-up" }
          );
          return ctx.json({ message });
        }
      ),

      siweSignUpComplete: createAuthEndpoint(
        "/sign-up/siwe/complete",
        {
          method: "POST",
          body: z.object({
            message: z.string().min(1),
            signature: z.string().min(1),
            signature2: z.string().min(1),
            email: z.email().optional(),
          }),
        },
        async (ctx) => {
          const { message, signature, signature2, email } = ctx.body;

          const { address, chainId } = await redeemOrThrow(
            ctx.context.internalAdapter,
            { message, purpose: "sign-up", signature }
          );
          if (!(await isWalletSignature(address, message, signature2))) {
            throw new APIError("UNAUTHORIZED", {
              message: REDEMPTION_ERRORS.invalid_signature,
            });
          }

          // Enforce deterministic signatures server-side
          if (signature !== signature2) {
            throw new APIError("BAD_REQUEST", {
              message:
                "Wallet signatures are not stable for this message. " +
                "Use passkey/password sign-up, or switch wallets and set up backup recovery.",
            });
          }

          // Check wallet not already registered
          const existingWallets = await ctx.context.adapter.findMany({
            model: "walletAddress",
            where: [{ field: "address", value: address }],
          });
          if (existingWallets.length > 0) {
            throw new APIError("BAD_REQUEST", {
              message: "Wallet already registered",
            });
          }

          // Check for existing anonymous session to link to
          let userId: string;
          const session = await getSessionFromCtx(ctx);
          const sessionUser = session
            ? (session.user as typeof session.user & { isAnonymous?: boolean })
            : null;

          // Verify user still exists in DB (session cookie may outlive user row after DB reset)
          const validAnonymousUser =
            sessionUser?.isAnonymous &&
            (await ctx.context.internalAdapter.findUserById(sessionUser.id))
              ? sessionUser
              : null;

          if (validAnonymousUser) {
            userId = validAnonymousUser.id;
            if (email) {
              await ctx.context.internalAdapter.updateUser(userId, {
                email,
                updatedAt: new Date(),
              });
            }
          } else {
            // Create new user
            const walletEmail =
              email ||
              `${address.toLowerCase().slice(2, 10)}@${emailDomainName}`;
            const generatedId = ctx.context.generateId({ model: "user" });
            if (!generatedId) {
              throw new APIError("INTERNAL_SERVER_ERROR", {
                message: "Failed to generate user ID",
              });
            }
            userId = generatedId;
            const now = new Date();
            await ctx.context.internalAdapter.createUser(
              {
                id: userId,
                email: walletEmail,
                emailVerified: false,
                isAnonymous: true,
                name: "",
                createdAt: now,
                updatedAt: now,
              },
              { method: "siwe" }
            );
          }

          // Create account
          const generatedAccountId = ctx.context.generateId({
            model: "account",
          });
          if (!generatedAccountId) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Failed to generate account ID",
            });
          }
          const accountId = generatedAccountId;
          await ctx.context.internalAdapter.createAccount({
            accountId,
            providerId: "eip712",
            userId,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // Create wallet address record
          await ctx.context.adapter.create({
            model: "walletAddress",
            data: {
              userId,
              address,
              chainId,
              isPrimary: true,
              createdAt: new Date(),
            },
          });

          // Create session
          const newSession =
            await ctx.context.internalAdapter.createSession(userId);
          if (!newSession) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Failed to create session",
            });
          }

          const user = await ctx.context.internalAdapter.findUserById(userId);
          if (!user) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Failed to find user",
            });
          }

          await createSessionAuthenticationContext({
            userId,
            loginMethod: "eip712",
            sourceKind: "better_auth",
            sessionId: newSession.id,
          });
          await setSessionCookie(ctx, { session: newSession, user });

          return ctx.json({
            token: newSession.token,
            user: { id: userId },
          });
        }
      ),

      siweSignInChallenge: createAuthEndpoint(
        "/sign-in/siwe/challenge",
        { method: "POST", body: challengeBody },
        async (ctx) => {
          const message = await issueSiweChallenge(
            ctx.context.internalAdapter,
            { ...ctx.body, purpose: "sign-in" }
          );
          return ctx.json({ message });
        }
      ),

      siweSignInComplete: createAuthEndpoint(
        "/sign-in/siwe/complete",
        {
          method: "POST",
          body: z.object({
            message: z.string().min(1),
            signature: z.string().min(1),
          }),
        },
        async (ctx) => {
          const { address, chainId } = await redeemOrThrow(
            ctx.context.internalAdapter,
            { ...ctx.body, purpose: "sign-in" }
          );

          // Look up wallet — try exact chain first, then any chain
          const exactMatches = (await ctx.context.adapter.findMany({
            model: "walletAddress",
            where: [
              { field: "address", value: address },
              { field: "chainId", value: chainId },
            ],
            limit: 1,
          })) as Array<{ userId: string }>;
          let walletRecord = exactMatches[0] ?? null;

          if (!walletRecord) {
            const anyChainMatches = (await ctx.context.adapter.findMany({
              model: "walletAddress",
              where: [{ field: "address", value: address }],
              limit: 1,
            })) as Array<{ userId: string }>;
            walletRecord = anyChainMatches[0] ?? null;
          }

          if (!walletRecord) {
            throw new APIError("UNAUTHORIZED", {
              message: "Wallet not registered",
            });
          }

          const user = await ctx.context.internalAdapter.findUserById(
            walletRecord.userId
          );
          if (!user) {
            throw new APIError("UNAUTHORIZED", {
              message: "User not found",
            });
          }

          const newSession = await ctx.context.internalAdapter.createSession(
            user.id
          );
          if (!newSession) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Failed to create session",
            });
          }

          await createSessionAuthenticationContext({
            userId: user.id,
            loginMethod: "eip712",
            sourceKind: "better_auth",
            sessionId: newSession.id,
          });
          await setSessionCookie(ctx, { session: newSession, user });

          return ctx.json({
            token: newSession.token,
            user: { id: user.id },
          });
        }
      ),
    },
  } satisfies BetterAuthPlugin;
};
