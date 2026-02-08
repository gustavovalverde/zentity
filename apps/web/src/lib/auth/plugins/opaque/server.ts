import type {
  OpaqueEndpointContext,
  OpaquePluginOptions,
  ResolveUserByIdentifier,
} from "./types";

import { randomBytes } from "node:crypto";

import { ready, server } from "@serenity-kit/opaque";
import { APIError, type BetterAuthPlugin } from "better-auth";
import {
  createAuthEndpoint,
  sensitiveSessionMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

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

const RESET_TOKEN_PREFIX = "opaque-reset";
const SIGNUP_TOKEN_PREFIX = "opaque-signup";
const DEFAULT_RESET_TOKEN_EXPIRY = 60 * 60;
const DEFAULT_SIGNUP_TOKEN_EXPIRY = 15 * 60; // 15 minutes for sign-up

const normalizeIdentifier = (identifier: string) =>
  identifier.trim().toLowerCase();

const defaultResolveUserByIdentifier: ResolveUserByIdentifier = (
  identifier,
  ctx
) => {
  if (!identifier) {
    return Promise.resolve(null);
  }
  return ctx.context.internalAdapter.findUserByEmail(identifier, {
    includeAccounts: true,
  });
};

async function upsertOpaqueAccount(params: {
  // biome-ignore lint/suspicious/noExplicitAny: better-auth internal types are too strict
  internalAdapter: any;
  // biome-ignore lint/suspicious/noExplicitAny: better-auth internal types are too strict
  generateId: any;
  userId: string;
  registrationRecord: string;
}) {
  const accounts = (await params.internalAdapter.findAccounts(
    params.userId
  )) as Array<{ id: string; providerId: string; registrationRecord?: string }>;
  const existing = accounts.find((a) => a.providerId === "opaque");
  const now = new Date();

  if (!existing) {
    const accountId = params.generateId({ model: "account" });
    if (!accountId) {
      throw new Error("Failed to generate account ID");
    }
    await params.internalAdapter.createAccount({
      accountId,
      providerId: "opaque",
      userId: params.userId,
      registrationRecord: params.registrationRecord,
      createdAt: now,
      updatedAt: now,
    });
    return;
  }

  await params.internalAdapter.updateAccount(existing.id, {
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
  // Allow lazy evaluation of serverSetup to support Next.js builds
  // where env vars may not be available at module load time
  const getServerSetup = (): string => {
    const setup =
      typeof options.serverSetup === "function"
        ? options.serverSetup()
        : options.serverSetup;
    if (!setup) {
      throw new Error("OPAQUE server setup is required");
    }
    return setup;
  };

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

          // Validate identifier length to prevent DoS attacks
          if (identifier.length > 254 || identifier.length < 3) {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid identifier format",
            });
          }

          validateBase64Length(
            ctx.body.loginRequest,
            LOGIN_REQUEST_LENGTH,
            "login request"
          );

          const [
            { registrationRecord: dummyRecord, userIdentifier },
            resolved,
          ] = await Promise.all([
            createDummyRegistrationRecord(),
            resolveUserByIdentifier(
              identifier,
              ctx as unknown as OpaqueEndpointContext
            ),
          ]);

          const opaqueAccount = resolved
            ? findOpaqueAccount(resolved.accounts)
            : undefined;

          const registrationRecord =
            opaqueAccount?.registrationRecord || dummyRecord;
          // If we have a valid OPAQUE account, use the real user ID;
          // otherwise use the dummy userIdentifier for timing consistency
          const loginUserIdentifier =
            opaqueAccount?.registrationRecord && resolved
              ? resolved.user.id
              : userIdentifier;
          const userId =
            opaqueAccount?.registrationRecord && resolved
              ? resolved.user.id
              : null;

          const { serverLoginState, loginResponse } = server.startLogin({
            serverSetup: getServerSetup(),
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

          if (!sessionKey) {
            throw new APIError("UNAUTHORIZED", {
              message: "Login failed",
            });
          }
          if (!userId) {
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
        (ctx) => {
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
            serverSetup: getServerSetup(),
            userIdentifier: userId,
            registrationRequest: ctx.body.registrationRequest,
          });

          return Promise.resolve({ challenge: registrationResponse });
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
            internalAdapter: ctx.context.internalAdapter,
            generateId: ctx.context.generateId,
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

          const accounts =
            await ctx.context.internalAdapter.findAccounts(userId);
          const opaqueAccount = findOpaqueAccount(accounts);
          if (!opaqueAccount?.registrationRecord) {
            throw new APIError("BAD_REQUEST", {
              message: "Password not set",
            });
          }

          const { serverLoginState, loginResponse } = server.startLogin({
            serverSetup: getServerSetup(),
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

          // Validate identifier length to prevent DoS attacks
          if (identifier.length > 254 || identifier.length < 3) {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid identifier format",
            });
          }

          const resolved = await resolveUserByIdentifier(
            identifier,
            ctx as unknown as OpaqueEndpointContext
          );
          const expiresIn =
            options.resetPasswordTokenExpiresIn ?? DEFAULT_RESET_TOKEN_EXPIRY;
          const token = randomBytes(24).toString("base64url");
          const expiresAt = new Date(Date.now() + expiresIn * 1000);

          if (!resolved) {
            // Generate dummy verification to match timing of real path.
            // The dummy entry expires naturally via expiresAt — no immediate
            // delete, so both paths perform identical operations (create + send).
            const dummyToken = randomBytes(24).toString("base64url");
            const dummyExpiresAt = new Date(Date.now() + expiresIn * 1000);

            await ctx.context.internalAdapter.createVerificationValue({
              value: "dummy",
              identifier: `${RESET_TOKEN_PREFIX}:${dummyToken}`,
              expiresAt: dummyExpiresAt,
            });

            // Always perform the same operations regardless of account existence
            const dummyUrl = buildResetUrl({
              baseURL: ctx.context.baseURL,
              token: dummyToken,
              redirectTo: ctx.body.redirectTo,
            });

            // Create a dummy user object for timing consistency
            const now = new Date();
            const dummyUser = {
              id: "dummy",
              email: identifier,
              emailVerified: false,
              name: "",
              createdAt: now,
              updatedAt: now,
            };

            await ctx.context.runInBackgroundOrAwait(
              options.sendResetPassword(
                { user: dummyUser, url: dummyUrl, token: dummyToken },
                ctx.request
              )
            );

            return ctx.json({
              status: true,
              message:
                "If this account exists, check your inbox for a reset link",
            });
          }

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

          const verification =
            await ctx.context.internalAdapter.findVerificationValue(
              `${RESET_TOKEN_PREFIX}:${ctx.body.token}`
            );
          if (!verification || verification.expiresAt < new Date()) {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid reset token",
            });
          }

          const { registrationResponse } = server.createRegistrationResponse({
            serverSetup: getServerSetup(),
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

          const verification =
            await ctx.context.internalAdapter.findVerificationValue(
              `${RESET_TOKEN_PREFIX}:${ctx.body.token}`
            );
          if (!verification || verification.expiresAt < new Date()) {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid reset token",
            });
          }

          await upsertOpaqueAccount({
            internalAdapter: ctx.context.internalAdapter,
            generateId: ctx.context.generateId,
            userId: verification.value,
            registrationRecord: ctx.body.registrationRecord,
          });

          await ctx.context.internalAdapter.deleteVerificationValue(
            verification.id
          );

          if (options.onPasswordReset) {
            const user = await ctx.context.internalAdapter.findUserById(
              verification.value
            );
            if (user) {
              await options.onPasswordReset({ user }, ctx.request);
            }
          }

          if (options.revokeSessionsOnPasswordReset) {
            await ctx.context.internalAdapter.deleteSessions(
              verification.value
            );
          }

          return ctx.json({ success: true });
        }
      ),
      getSignUpChallenge: createAuthEndpoint(
        "/sign-up/opaque/challenge",
        {
          method: "POST",
          body: z.object({
            email: z.email(),
            registrationRequest: z.string().base64url(),
          }),
        },
        async (ctx) => {
          const email = normalizeIdentifier(ctx.body.email);

          // Validate email length
          if (email.length > 254 || email.length < 3) {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid email format",
            });
          }

          validateBase64Length(
            ctx.body.registrationRequest,
            REGISTRATION_REQUEST_LENGTH,
            "registration request"
          );

          // Check if email already exists
          const existingRecord =
            await ctx.context.internalAdapter.findUserByEmail(email);
          if (existingRecord) {
            const existingUser = existingRecord.user;
            // Allow retry if previous signup was incomplete (anonymous + unverified)
            // Check isAnonymous on the extended user fields from our schema
            const userWithExtras = existingUser as typeof existingUser & {
              isAnonymous?: boolean;
            };
            if (userWithExtras.isAnonymous && !existingUser.emailVerified) {
              // Delete incomplete signup to allow fresh start
              const { deleteIncompleteSignup } = await import(
                "@/lib/db/queries/auth"
              );
              await deleteIncompleteSignup(existingUser.id);
            } else {
              // Real user exists - reject
              throw new APIError("BAD_REQUEST", {
                message: "Email already registered",
              });
            }
          }

          // Create user (anonymous until sign-up completes)
          const userId = ctx.context.generateId({ model: "user" });
          if (!userId) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Failed to generate user ID",
            });
          }
          const now = new Date();
          await ctx.context.internalAdapter.createUser({
            id: userId,
            email,
            emailVerified: false,
            isAnonymous: true,
            name: "",
            createdAt: now,
            updatedAt: now,
          });

          // Generate OPAQUE registration response
          const { registrationResponse } = server.createRegistrationResponse({
            serverSetup: getServerSetup(),
            userIdentifier: userId,
            registrationRequest: ctx.body.registrationRequest,
          });

          // Store pending sign-up token
          const token = randomBytes(24).toString("base64url");
          const expiresAt = new Date(
            Date.now() + DEFAULT_SIGNUP_TOKEN_EXPIRY * 1000
          );

          await ctx.context.internalAdapter.createVerificationValue({
            value: JSON.stringify({ userId, email }),
            identifier: `${SIGNUP_TOKEN_PREFIX}:${token}`,
            expiresAt,
          });

          return { challenge: registrationResponse, signupToken: token };
        }
      ),
      completeSignUp: createAuthEndpoint(
        "/sign-up/opaque/complete",
        {
          method: "POST",
          body: z.object({
            signupToken: z.string().min(1),
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

          // Retrieve and validate sign-up token
          const verification =
            await ctx.context.internalAdapter.findVerificationValue(
              `${SIGNUP_TOKEN_PREFIX}:${ctx.body.signupToken}`
            );
          if (!verification || verification.expiresAt < new Date()) {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid or expired sign-up token",
            });
          }

          const { userId, email } = JSON.parse(verification.value) as {
            userId: string;
            email: string;
          };

          // Store OPAQUE registration record
          await upsertOpaqueAccount({
            internalAdapter: ctx.context.internalAdapter,
            generateId: ctx.context.generateId,
            userId,
            registrationRecord: ctx.body.registrationRecord,
          });

          // Mark user as non-anonymous
          await ctx.context.internalAdapter.updateUser(userId, {
            isAnonymous: false,
            updatedAt: new Date(),
          });

          // Create session
          const session =
            await ctx.context.internalAdapter.createSession(userId);
          if (!session) {
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

          await setSessionCookie(ctx, { session, user });

          // Clean up verification token
          await ctx.context.internalAdapter.deleteVerificationValue(
            verification.id
          );

          return ctx.json({
            success: true,
            token: session.token,
            user: { id: userId, email },
          });
        }
      ),
    },
  } satisfies BetterAuthPlugin;
};
