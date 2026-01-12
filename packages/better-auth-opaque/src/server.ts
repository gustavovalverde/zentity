import { ready, server } from "@serenity-kit/opaque";
import { APIError, type BetterAuthPlugin } from "better-auth";
import {
  createAuthEndpoint,
  sensitiveSessionMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import * as z from "zod";

import {
  createDummyRegistrationRecord,
  decryptServerLoginState,
  encryptServerLoginState,
  findOpaqueAccount,
  LOGIN_REQUEST_LENGTH,
  REGISTRATION_RECORD_MAX_LENGTH,
  REGISTRATION_RECORD_MIN_LENGTH,
  REGISTRATION_REQUEST_LENGTH,
  validateBase64Length,
  validateBase64LengthRange,
} from "./utils";
import type { OpaquePluginOptions, ResolveUserByIdentifier } from "./types";

declare module "@better-auth/core" {
  // biome-ignore lint/correctness/noUnusedVariables: Auth and Context need to be same as declared in the module
  interface BetterAuthPluginRegistry<Auth, Context> {
    opaque: {
      creator: typeof opaque;
    };
  }
}

const RESET_TOKEN_PREFIX = "opaque-reset";
const DEFAULT_RESET_TOKEN_EXPIRY = 60 * 60;

const normalizeIdentifier = (identifier: string) =>
  identifier.trim().toLowerCase();

const defaultResolveUserByIdentifier: ResolveUserByIdentifier = async (
  identifier,
  ctx
) => {
  if (!identifier) {
    return null;
  }
  return ctx.context.internalAdapter.findUserByEmail(identifier, {
    includeAccounts: true,
  });
};

async function upsertOpaqueAccount(params: {
  ctx: { context: { internalAdapter: any } };
  userId: string;
  registrationRecord: string;
}) {
  const accounts = await params.ctx.context.internalAdapter.findAccounts(
    params.userId
  );
  const existing = findOpaqueAccount(accounts);
  const now = new Date();

  if (!existing) {
    const accountId = params.ctx.context.generateId({ model: "account" });
    if (!accountId) {
      throw new Error("Failed to generate account ID");
    }
    await params.ctx.context.internalAdapter.createAccount({
      accountId,
      providerId: "opaque",
      userId: params.userId,
      registrationRecord: params.registrationRecord,
      createdAt: now,
      updatedAt: now,
    });
    return;
  }

  await params.ctx.context.internalAdapter.updateAccount(existing.id, {
    registrationRecord: params.registrationRecord,
    updatedAt: now,
  });
}

function buildResetUrl(params: {
  baseURL: string;
  token: string;
  redirectTo?: string | undefined;
}) {
  const url = new URL(params.redirectTo || "/reset-password", params.baseURL);
  url.searchParams.set("token", params.token);
  return url.toString();
}

export const opaque = (options: OpaquePluginOptions) => {
  if (!options?.serverSetup) {
    throw new Error("OPAQUE server setup is required");
  }

  const resolveUserByIdentifier =
    options.resolveUserByIdentifier ?? defaultResolveUserByIdentifier;

  return {
    id: "opaque",
    init: async () => {
      await ready;
    },
    schema: {
      account: {
        fields: {
          registrationRecord: {
            type: "string",
            required: false,
            unique: true,
          },
        },
      },
    },
    endpoints: {
      getLoginChallenge: createAuthEndpoint(
        "/sign-in/opaque/challenge",
        {
          method: "POST",
          body: z.object({
            identifier: z.string().min(1),
            loginRequest: z.string().base64url(),
          }),
        },
        async (ctx) => {
          const identifier = normalizeIdentifier(ctx.body.identifier);
          validateBase64Length(
            ctx.body.loginRequest,
            LOGIN_REQUEST_LENGTH,
            "login request"
          );

          const [{ registrationRecord: dummyRecord, userIdentifier }, resolved] =
            await Promise.all([
              createDummyRegistrationRecord(),
              resolveUserByIdentifier(identifier, ctx),
            ]);

          const opaqueAccount = resolved
            ? findOpaqueAccount(resolved.accounts)
            : undefined;

          const registrationRecord =
            opaqueAccount?.registrationRecord || dummyRecord;
          const loginUserIdentifier = opaqueAccount?.registrationRecord
            ? resolved?.user.id
            : userIdentifier;
          const userId = opaqueAccount?.registrationRecord
            ? resolved?.user.id ?? null
            : null;

          const { serverLoginState, loginResponse } = server.startLogin({
            serverSetup: options.serverSetup,
            userIdentifier: loginUserIdentifier,
            registrationRecord,
            startLoginRequest: ctx.body.loginRequest,
          });

          const encryptedServerState = await encryptServerLoginState({
            serverLoginState,
            userId,
            secret: ctx.context.secret,
          });

          return {
            challenge: loginResponse,
            state: encryptedServerState,
          };
        }
      ),
      completeLogin: createAuthEndpoint(
        "/sign-in/opaque/complete",
        {
          method: "POST",
          body: z.object({
            loginResult: z.string().base64url(),
            encryptedServerState: z.string(),
            rememberMe: z.boolean().optional(),
          }),
        },
        async (ctx) => {
          const { serverLoginState, userId } = await decryptServerLoginState({
            encryptedState: ctx.body.encryptedServerState,
            secret: ctx.context.secret,
          });

          const { sessionKey } = server.finishLogin({
            finishLoginRequest: ctx.body.loginResult,
            serverLoginState,
          });

          if (!sessionKey || !userId) {
            throw new APIError("UNAUTHORIZED", {
              message: "Login failed",
            });
          }

          const user = await ctx.context.internalAdapter.findUserById(userId);
          if (!user) {
            throw new APIError("UNAUTHORIZED", {
              message: "Login failed",
            });
          }

          const session = await ctx.context.internalAdapter.createSession(
            user.id,
            ctx.body.rememberMe === false
          );

          if (!session) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Failed to create session",
            });
          }

          await setSessionCookie(
            ctx,
            { session, user },
            ctx.body.rememberMe === false
          );

          return ctx.json({
            success: true,
            token: session.token,
            user: {
              id: user.id,
            },
          });
        }
      ),
      getRegistrationChallenge: createAuthEndpoint(
        "/password/opaque/registration/challenge",
        {
          method: "POST",
          body: z.object({
            registrationRequest: z.string().base64url(),
          }),
          use: [sensitiveSessionMiddleware],
        },
        async (ctx) => {
          validateBase64Length(
            ctx.body.registrationRequest,
            REGISTRATION_REQUEST_LENGTH,
            "registration request"
          );
          const userId = ctx.context.session?.user?.id;
          if (!userId) {
            throw new APIError("UNAUTHORIZED", {
              message: "Unauthorized",
            });
          }

          const { registrationResponse } = server.createRegistrationResponse({
            serverSetup: options.serverSetup,
            userIdentifier: userId,
            registrationRequest: ctx.body.registrationRequest,
          });

          return { challenge: registrationResponse };
        }
      ),
      completeRegistration: createAuthEndpoint(
        "/password/opaque/registration/complete",
        {
          method: "POST",
          body: z.object({
            registrationRecord: z.string().base64url(),
          }),
          use: [sensitiveSessionMiddleware],
        },
        async (ctx) => {
          validateBase64LengthRange(
            ctx.body.registrationRecord,
            REGISTRATION_RECORD_MIN_LENGTH,
            REGISTRATION_RECORD_MAX_LENGTH,
            "registration record"
          );

          const userId = ctx.context.session?.user?.id;
          if (!userId) {
            throw new APIError("UNAUTHORIZED", {
              message: "Unauthorized",
            });
          }

          await upsertOpaqueAccount({
            ctx,
            userId,
            registrationRecord: ctx.body.registrationRecord,
          });

          return ctx.json({ success: true });
        }
      ),
      getPasswordVerifyChallenge: createAuthEndpoint(
        "/password/opaque/verify/challenge",
        {
          method: "POST",
          body: z.object({
            loginRequest: z.string().base64url(),
          }),
          use: [sensitiveSessionMiddleware],
        },
        async (ctx) => {
          validateBase64Length(
            ctx.body.loginRequest,
            LOGIN_REQUEST_LENGTH,
            "login request"
          );
          const userId = ctx.context.session?.user?.id;
          if (!userId) {
            throw new APIError("UNAUTHORIZED", {
              message: "Unauthorized",
            });
          }

          const accounts = await ctx.context.internalAdapter.findAccounts(userId);
          const opaqueAccount = findOpaqueAccount(accounts);
          if (!opaqueAccount?.registrationRecord) {
            throw new APIError("BAD_REQUEST", {
              message: "Password not set",
            });
          }

          const { serverLoginState, loginResponse } = server.startLogin({
            serverSetup: options.serverSetup,
            userIdentifier: userId,
            registrationRecord: opaqueAccount.registrationRecord,
            startLoginRequest: ctx.body.loginRequest,
          });

          const encryptedServerState = await encryptServerLoginState({
            serverLoginState,
            userId,
            secret: ctx.context.secret,
          });

          return {
            challenge: loginResponse,
            state: encryptedServerState,
          };
        }
      ),
      completePasswordVerify: createAuthEndpoint(
        "/password/opaque/verify/complete",
        {
          method: "POST",
          body: z.object({
            loginResult: z.string().base64url(),
            encryptedServerState: z.string(),
          }),
          use: [sensitiveSessionMiddleware],
        },
        async (ctx) => {
          const { serverLoginState, userId } = await decryptServerLoginState({
            encryptedState: ctx.body.encryptedServerState,
            secret: ctx.context.secret,
          });

          if (!userId || userId !== ctx.context.session?.user?.id) {
            throw new APIError("UNAUTHORIZED", {
              message: "Unauthorized",
            });
          }

          const { sessionKey } = server.finishLogin({
            finishLoginRequest: ctx.body.loginResult,
            serverLoginState,
          });

          if (!sessionKey) {
            throw new APIError("UNAUTHORIZED", {
              message: "Invalid password",
            });
          }

          return ctx.json({ success: true });
        }
      ),
      requestPasswordReset: createAuthEndpoint(
        "/password-reset/opaque/request",
        {
          method: "POST",
          body: z.object({
            identifier: z.string().min(1),
            redirectTo: z.string().optional(),
          }),
        },
        async (ctx) => {
          if (!options.sendResetPassword) {
            throw new APIError("BAD_REQUEST", {
              message: "Reset password is not enabled",
            });
          }

          const identifier = normalizeIdentifier(ctx.body.identifier);
          const resolved = await resolveUserByIdentifier(identifier, ctx);
          if (!resolved) {
            generateRandomString(24);
            await ctx.context.internalAdapter.findVerificationValue(
              "opaque-reset:dummy"
            );
            return ctx.json({
              status: true,
              message:
                "If this account exists, check your inbox for a reset link",
            });
          }

          const expiresIn =
            options.resetPasswordTokenExpiresIn ?? DEFAULT_RESET_TOKEN_EXPIRY;
          const token = generateRandomString(24);
          const expiresAt = new Date(Date.now() + expiresIn * 1000);
          await ctx.context.internalAdapter.createVerificationValue({
            value: resolved.user.id,
            identifier: `${RESET_TOKEN_PREFIX}:${token}`,
            expiresAt,
          });

          const url = buildResetUrl({
            baseURL: ctx.context.baseURL,
            token,
            redirectTo: ctx.body.redirectTo,
          });

          await ctx.context.runInBackgroundOrAwait(
            options.sendResetPassword(
              { user: resolved.user, url, token },
              ctx.request
            )
          );

          return ctx.json({
            status: true,
            message:
              "If this account exists, check your inbox for a reset link",
          });
        }
      ),
      getResetChallenge: createAuthEndpoint(
        "/password-reset/opaque/challenge",
        {
          method: "POST",
          body: z.object({
            token: z.string().min(1),
            registrationRequest: z.string().base64url(),
          }),
        },
        async (ctx) => {
          validateBase64Length(
            ctx.body.registrationRequest,
            REGISTRATION_REQUEST_LENGTH,
            "registration request"
          );

          const verification = await ctx.context.internalAdapter.findVerificationValue(
            `${RESET_TOKEN_PREFIX}:${ctx.body.token}`
          );
          if (!verification || verification.expiresAt < new Date()) {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid reset token",
            });
          }

          const { registrationResponse } = server.createRegistrationResponse({
            serverSetup: options.serverSetup,
            userIdentifier: verification.value,
            registrationRequest: ctx.body.registrationRequest,
          });

          return { challenge: registrationResponse };
        }
      ),
      completeReset: createAuthEndpoint(
        "/password-reset/opaque/complete",
        {
          method: "POST",
          body: z.object({
            token: z.string().min(1),
            registrationRecord: z.string().base64url(),
          }),
        },
        async (ctx) => {
          validateBase64LengthRange(
            ctx.body.registrationRecord,
            REGISTRATION_RECORD_MIN_LENGTH,
            REGISTRATION_RECORD_MAX_LENGTH,
            "registration record"
          );

          const verification = await ctx.context.internalAdapter.findVerificationValue(
            `${RESET_TOKEN_PREFIX}:${ctx.body.token}`
          );
          if (!verification || verification.expiresAt < new Date()) {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid reset token",
            });
          }

          await upsertOpaqueAccount({
            ctx,
            userId: verification.value,
            registrationRecord: ctx.body.registrationRecord,
          });

          await ctx.context.internalAdapter.deleteVerificationValue(verification.id);

          if (options.onPasswordReset) {
            const user = await ctx.context.internalAdapter.findUserById(
              verification.value
            );
            if (user) {
              await options.onPasswordReset({ user }, ctx.request);
            }
          }

          if (options.revokeSessionsOnPasswordReset) {
            await ctx.context.internalAdapter.deleteSessions(verification.value);
          }

          return ctx.json({ success: true });
        }
      ),
    },
  } satisfies BetterAuthPlugin;
};
