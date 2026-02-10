import type {
  BuildTypedDataParams,
  Eip712AuthOptions,
  Eip712TypedData,
} from "./types";

import { APIError, type BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { getAddress, recoverTypedDataAddress } from "viem";
import { z } from "zod";

const DEFAULT_NONCE_TTL_SECONDS = 900; // 15 minutes
const NONCE_PREFIX = "eip712";

function defaultBuildTypedData(
  params: BuildTypedDataParams,
  appName: string
): Eip712TypedData {
  return {
    domain: {
      name: appName,
      version: "1",
      chainId: params.chainId,
    },
    types: {
      WalletAuth: [
        { name: "address", type: "address" },
        { name: "nonce", type: "string" },
      ],
    },
    primaryType: "WalletAuth",
    message: {
      address: params.address,
      nonce: params.nonce,
    },
  };
}

function nonceIdentifier(address: string, chainId: number): string {
  return `${NONCE_PREFIX}:${address.toLowerCase()}:${chainId}`;
}

export const eip712Auth = (options: Eip712AuthOptions = {}) => {
  const appName = options.appName || "App";
  const emailDomainName = options.emailDomainName || "wallet.app";
  const nonceTtlSeconds = options.nonceTtlSeconds || DEFAULT_NONCE_TTL_SECONDS;

  const buildTypedData = (params: BuildTypedDataParams): Eip712TypedData =>
    options.buildTypedData
      ? options.buildTypedData(params)
      : defaultBuildTypedData(params, appName);

  async function verifySignature(
    signature: string,
    typedData: Eip712TypedData,
    expectedAddress: string
  ): Promise<void> {
    const recovered = await recoverTypedDataAddress({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
      signature: signature as `0x${string}`,
    });

    if (recovered.toLowerCase() !== expectedAddress.toLowerCase()) {
      throw new APIError("UNAUTHORIZED", {
        message: "Invalid signature",
      });
    }
  }

  async function consumeNonce(
    // biome-ignore lint/suspicious/noExplicitAny: better-auth internalAdapter type
    internalAdapter: any,
    address: string,
    chainId: number,
    nonce: string
  ): Promise<void> {
    const identifier = nonceIdentifier(address, chainId);
    const verification =
      await internalAdapter.findVerificationValue(identifier);

    if (!verification || verification.value !== nonce) {
      throw new APIError("UNAUTHORIZED", {
        message: "Invalid or expired nonce",
      });
    }

    if (new Date(verification.expiresAt) < new Date()) {
      await internalAdapter.deleteVerificationValue(verification.id);
      throw new APIError("UNAUTHORIZED", {
        message: "Invalid or expired nonce",
      });
    }

    await internalAdapter.deleteVerificationValue(verification.id);
  }

  return {
    id: "eip712",
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
      eip712Nonce: createAuthEndpoint(
        "/eip712/nonce",
        {
          method: "POST",
          body: z.object({
            address: z.string().min(1),
            chainId: z.number().int().positive(),
          }),
        },
        async (ctx) => {
          const address = getAddress(ctx.body.address);
          const { chainId } = ctx.body;

          const nonce = crypto.randomUUID();
          const expiresAt = new Date(Date.now() + nonceTtlSeconds * 1000);

          await ctx.context.internalAdapter.createVerificationValue({
            identifier: nonceIdentifier(address, chainId),
            value: nonce,
            expiresAt,
          });

          const typedData = buildTypedData({ address, chainId, nonce });

          return ctx.json({ nonce, typedData });
        }
      ),

      eip712Register: createAuthEndpoint(
        "/sign-up/eip712/register",
        {
          method: "POST",
          body: z.object({
            signature: z.string().min(1),
            signature2: z.string().min(1),
            address: z.string().min(1),
            chainId: z.number().int().positive(),
            nonce: z.string().min(1),
            email: z.string().email().optional(),
          }),
        },
        async (ctx) => {
          const address = getAddress(ctx.body.address);
          const { chainId, nonce, signature, signature2, email } = ctx.body;

          // Consume and validate nonce
          await consumeNonce(
            ctx.context.internalAdapter,
            address,
            chainId,
            nonce
          );

          // Reconstruct typed data and verify both signatures
          const typedData = buildTypedData({ address, chainId, nonce });
          await verifySignature(signature, typedData, address);
          await verifySignature(signature2, typedData, address);

          // Enforce deterministic signatures server-side
          if (signature !== signature2) {
            throw new APIError("BAD_REQUEST", {
              message:
                "Wallet does not produce deterministic signatures. " +
                "Sign up with a wallet that supports RFC 6979.",
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
            await ctx.context.internalAdapter.createUser({
              id: userId,
              email: walletEmail,
              emailVerified: false,
              isAnonymous: true,
              name: "",
              createdAt: now,
              updatedAt: now,
            });
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

          await setSessionCookie(ctx, { session: newSession, user });

          return ctx.json({
            token: newSession.token,
            user: { id: userId },
          });
        }
      ),

      eip712Verify: createAuthEndpoint(
        "/sign-in/eip712/verify",
        {
          method: "POST",
          body: z.object({
            signature: z.string().min(1),
            address: z.string().min(1),
            chainId: z.number().int().positive(),
            nonce: z.string().min(1),
          }),
        },
        async (ctx) => {
          const address = getAddress(ctx.body.address);
          const { chainId, nonce, signature } = ctx.body;

          // Consume and validate nonce
          await consumeNonce(
            ctx.context.internalAdapter,
            address,
            chainId,
            nonce
          );

          // Reconstruct typed data and verify signature
          const typedData = buildTypedData({ address, chainId, nonce });
          await verifySignature(signature, typedData, address);

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
