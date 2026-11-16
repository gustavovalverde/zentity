import type { OpaqueClientOptions } from "./types";

import { client, ready } from "@serenity-kit/opaque";

import { env } from "@/env";
import { base64UrlToBytes } from "@/lib/privacy/primitives/symmetric";

/**
 * Better-fetch returns { data: T | null, error: E | null }
 * This is the actual runtime type, not just T.
 */
interface BetterFetchResponse<T> {
  data: T | null;
  error: {
    message?: string;
    code?: string;
    status?: number;
    statusText?: string;
  } | null;
}

type ClientFetch = <T>(
  path: string,
  options?: Record<string, unknown>
) => Promise<BetterFetchResponse<T>>;

interface OpaqueError {
  code?: string;
  message: string;
}

type Result<T> = { data: T; error: null } | { data: null; error: OpaqueError };

// Cached server public key (fetched from API at runtime)
let cachedServerPublicKey: string | null = null;
let publicKeyFetchPromise: Promise<string | null> | null = null;

/**
 * Fetches the OPAQUE server public key from the API.
 * The key is cached after the first successful fetch.
 */
function fetchServerPublicKey(): Promise<string | null> {
  if (cachedServerPublicKey) {
    return Promise.resolve(cachedServerPublicKey);
  }

  // Deduplicate concurrent fetches
  if (publicKeyFetchPromise) {
    return publicKeyFetchPromise;
  }

  publicKeyFetchPromise = (async () => {
    try {
      const res = await fetch("/api/auth/opaque-public-key");
      if (!res.ok) {
        console.warn("Failed to fetch OPAQUE public key:", res.status);
        return null;
      }
      const { publicKey } = (await res.json()) as { publicKey: string };
      cachedServerPublicKey = publicKey;
      return publicKey;
    } catch (error) {
      console.warn("Failed to fetch OPAQUE public key:", error);
      return null;
    } finally {
      publicKeyFetchPromise = null;
    }
  })();

  return publicKeyFetchPromise;
}

/**
 * Verifies that the received server public key matches the expected key.
 * Prefer pinning via NEXT_PUBLIC_OPAQUE_SERVER_PUBLIC_KEY in production.
 */
async function assertServerPublicKey(
  received: string | undefined,
  options: Pick<
    OpaqueClientOptions,
    "enforceServerPublicKey" | "serverPublicKey"
  >
): Promise<void> {
  const isProduction = process.env.NODE_ENV === "production";
  const pinnedKey =
    options.serverPublicKey?.trim() ||
    env.NEXT_PUBLIC_OPAQUE_SERVER_PUBLIC_KEY?.trim();
  const expectedKey = pinnedKey || (await fetchServerPublicKey());

  if (!expectedKey) {
    if (isProduction) {
      throw new Error("OPAQUE server public key is required in production");
    }
    console.warn(
      "Warning: OPAQUE server public key not available - vulnerable to MITM attacks"
    );
    return;
  }

  const enforce = options.enforceServerPublicKey ?? true;
  if (enforce && received !== expectedKey) {
    throw new Error("Untrusted OPAQUE server key - possible MITM attack");
  }
}

function wrapResult<T>(data: T): Result<T> {
  return { data, error: null };
}

/**
 * Extracts error message from BetterFetchResponse error structure.
 */
function extractErrorMessage(
  error: BetterFetchResponse<unknown>["error"],
  fallback: string
): string {
  if (!error) {
    return fallback;
  }

  // Check for message property
  if (typeof error.message === "string" && error.message !== "Bad Request") {
    return error.message;
  }

  // Check for code-based messages
  if (typeof error.code === "string") {
    if (error.code === "UNAUTHORIZED") {
      return "Session expired. Please refresh the page and try again.";
    }
    if (error.code === "VALIDATION_ERROR") {
      return "Invalid request. Please try again.";
    }
  }

  // Check for statusText as last resort
  if (
    typeof error.statusText === "string" &&
    error.statusText !== "Bad Request" &&
    (error.statusText === "Unauthorized" || error.statusText === "UNAUTHORIZED")
  ) {
    return "Session expired. Please refresh the page and try again.";
  }

  return fallback;
}

/** A refused request, with the server's error code when it sent one. */
class OpaqueRequestError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code: string | undefined) {
    super(message);
    this.code = code;
  }
}

function wrapError(error: unknown): Result<never> {
  let message = "An unknown error occurred";

  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === "string") {
      message = obj.message;
    }
  }

  const code = error instanceof OpaqueRequestError ? error.code : undefined;
  return { data: null, error: code ? { code, message } : { message } };
}

interface RoundTripMessages {
  /** Fallback when the challenge request fails without a usable message. */
  challengeFailed: string;
  /** Fallback when the complete request fails without a usable message. */
  completeFailed: string;
  /**
   * Replaces the WASM deserialization errors ("invalid type", "unit value")
   * that client.finish* throws for a malformed server response.
   */
  finishFailed?: string;
}

interface LoginMessages extends RoundTripMessages {
  /** client.finishLogin returns undefined when the password is wrong. */
  wrongPassword: string;
}

async function fetchOrThrow<T>(
  $fetch: ClientFetch,
  path: string,
  body: Record<string, unknown>,
  fallback: string
): Promise<T> {
  const response = await $fetch<T>(path, { method: "POST", body });
  if (response.error || !response.data) {
    throw new OpaqueRequestError(
      extractErrorMessage(response.error, fallback),
      response.error?.code
    );
  }
  return response.data;
}

function requireChallenge(challenge: unknown): string {
  if (!challenge || typeof challenge !== "string") {
    throw new Error("Server returned an invalid response. Please try again.");
  }
  return challenge;
}

function finishOrThrow<T>(finish: () => T, finishFailed?: string): T {
  try {
    return finish();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      finishFailed &&
      (message.includes("invalid type") || message.includes("unit value"))
    ) {
      throw new Error(finishFailed);
    }
    throw error;
  }
}

/**
 * Runs both OPAQUE login rounds. The server key is checked after finishLogin
 * and before the complete request.
 */
async function runOpaqueLogin<TComplete>(params: {
  $fetch: ClientFetch;
  options: OpaqueClientOptions;
  password: string;
  challengePath: string;
  challengeBody?: Record<string, unknown>;
  completePath: string;
  completeBody?: Record<string, unknown>;
  messages: LoginMessages;
}): Promise<{ complete: TComplete; exportKey: Uint8Array }> {
  await ready;
  const { clientLoginState, startLoginRequest } = client.startLogin({
    password: params.password,
  });

  const challenge = await fetchOrThrow<{ challenge: string; state: string }>(
    params.$fetch,
    params.challengePath,
    { ...params.challengeBody, loginRequest: startLoginRequest },
    params.messages.challengeFailed
  );
  const loginResponse = requireChallenge(challenge.challenge);

  const loginResult = finishOrThrow(
    () =>
      client.finishLogin({
        clientLoginState,
        loginResponse,
        password: params.password,
      }),
    params.messages.finishFailed
  );
  if (!loginResult) {
    throw new Error(params.messages.wrongPassword);
  }

  await assertServerPublicKey(
    loginResult.serverStaticPublicKey,
    params.options
  );

  const complete = await fetchOrThrow<TComplete>(
    params.$fetch,
    params.completePath,
    {
      loginResult: loginResult.finishLoginRequest,
      encryptedServerState: challenge.state,
      ...params.completeBody,
    },
    params.messages.completeFailed
  );

  return { complete, exportKey: base64UrlToBytes(loginResult.exportKey) };
}

/**
 * Runs both OPAQUE registration rounds. The server key is checked after
 * finishRegistration and before the complete request.
 */
async function runOpaqueRegistration<
  TChallenge extends { challenge: string },
  TComplete,
>(params: {
  $fetch: ClientFetch;
  options: OpaqueClientOptions;
  password: string;
  challengePath: string;
  challengeBody?: Record<string, unknown>;
  completePath: string;
  completeBody?: (challenge: TChallenge) => Record<string, unknown>;
  messages: RoundTripMessages;
}): Promise<{ complete: TComplete; exportKey: Uint8Array }> {
  await ready;
  const { clientRegistrationState, registrationRequest } =
    client.startRegistration({ password: params.password });

  const challenge = await fetchOrThrow<TChallenge>(
    params.$fetch,
    params.challengePath,
    { ...params.challengeBody, registrationRequest },
    params.messages.challengeFailed
  );
  const registrationResponse = requireChallenge(challenge.challenge);

  const { registrationRecord, exportKey, serverStaticPublicKey } =
    finishOrThrow(
      () =>
        client.finishRegistration({
          clientRegistrationState,
          registrationResponse,
          password: params.password,
        }),
      params.messages.finishFailed
    );

  await assertServerPublicKey(serverStaticPublicKey, params.options);

  const complete = await fetchOrThrow<TComplete>(
    params.$fetch,
    params.completePath,
    { ...params.completeBody?.(challenge), registrationRecord },
    params.messages.completeFailed
  );

  return { complete, exportKey: base64UrlToBytes(exportKey) };
}

const PASSWORD_VERIFICATION_FAILED =
  "Password verification failed. Please try again.";

export const opaqueClient = (options: OpaqueClientOptions = {}) => {
  return {
    id: "opaque",
    getActions($fetch: ClientFetch) {
      const setPassword = async (params: {
        password: string;
      }): Promise<Result<{ success: boolean; exportKey: Uint8Array }>> => {
        try {
          const { exportKey } = await runOpaqueRegistration<
            { challenge: string },
            { success: boolean }
          >({
            $fetch,
            options,
            password: params.password,
            challengePath: "/password/opaque/registration/challenge",
            completePath: "/password/opaque/registration/complete",
            messages: {
              challengeFailed: "Failed to set password. Please try again.",
              completeFailed:
                "Failed to complete password setup. Please try again.",
            },
          });
          return wrapResult({ success: true, exportKey });
        } catch (error) {
          return wrapError(error);
        }
      };

      const verifyCurrentPassword = (password: string, finishFailed: string) =>
        runOpaqueLogin<{ success: boolean }>({
          $fetch,
          options,
          password,
          challengePath: "/password/opaque/verify/challenge",
          completePath: "/password/opaque/verify/complete",
          messages: {
            challengeFailed: PASSWORD_VERIFICATION_FAILED,
            completeFailed: PASSWORD_VERIFICATION_FAILED,
            finishFailed,
            wrongPassword: "Invalid password",
          },
        });

      return {
        signIn: {
          opaque: async (params: {
            identifier: string;
            password: string;
            rememberMe?: boolean;
          }): Promise<
            Result<{
              success: boolean;
              token: string;
              user: { id: string };
              exportKey: Uint8Array;
            }>
          > => {
            try {
              const { complete, exportKey } = await runOpaqueLogin<{
                success: boolean;
                token: string;
                user: { id: string };
              }>({
                $fetch,
                options,
                password: params.password,
                challengePath: "/sign-in/opaque/challenge",
                challengeBody: { identifier: params.identifier },
                completePath: "/sign-in/opaque/complete",
                completeBody: { rememberMe: params.rememberMe },
                messages: {
                  challengeFailed:
                    "Sign-in failed. Please check your credentials and try again.",
                  completeFailed: "Sign-in failed. Please try again.",
                  finishFailed:
                    "Sign-in failed. Please check your credentials and try again.",
                  wrongPassword: "Login failed",
                },
              });
              return wrapResult({ ...complete, exportKey });
            } catch (error) {
              return wrapError(error);
            }
          },
        },
        signUp: {
          opaque: async (params: {
            email: string;
            password: string;
          }): Promise<
            Result<{
              success: boolean;
              token: string;
              user: { id: string; email: string };
              exportKey: Uint8Array;
            }>
          > => {
            try {
              const { complete, exportKey } = await runOpaqueRegistration<
                { challenge: string; signupToken: string },
                {
                  success: boolean;
                  token: string;
                  user: { id: string; email: string };
                }
              >({
                $fetch,
                options,
                password: params.password,
                challengePath: "/sign-up/opaque/challenge",
                challengeBody: { email: params.email },
                completePath: "/sign-up/opaque/complete",
                completeBody: (challenge) => ({
                  signupToken: challenge.signupToken,
                }),
                messages: {
                  challengeFailed: "Sign-up failed. Please try again.",
                  completeFailed: "Sign-up failed. Please try again.",
                  finishFailed:
                    "Sign-up failed. Please try again or contact support.",
                },
              });
              return wrapResult({ ...complete, exportKey });
            } catch (error) {
              return wrapError(error);
            }
          },
        },
        opaque: {
          setPassword,
          verifyPassword: async (params: {
            password: string;
          }): Promise<
            Result<{
              success: boolean;
              exportKey: Uint8Array;
            }>
          > => {
            try {
              const { exportKey } = await verifyCurrentPassword(
                params.password,
                "Invalid password"
              );
              return wrapResult({ success: true, exportKey });
            } catch (error) {
              return wrapError(error);
            }
          },
          changePassword: async (params: {
            currentPassword: string;
            newPassword: string;
          }): Promise<
            Result<{
              success: boolean;
              exportKey: Uint8Array;
              oldExportKey: Uint8Array;
            }>
          > => {
            try {
              const { exportKey: oldExportKey } = await verifyCurrentPassword(
                params.currentPassword,
                "Invalid current password"
              );

              const setPasswordResult = await setPassword({
                password: params.newPassword,
              });
              if (!setPasswordResult.data) {
                return setPasswordResult;
              }

              return wrapResult({
                success: true,
                exportKey: setPasswordResult.data.exportKey,
                oldExportKey,
              });
            } catch (error) {
              return wrapError(error);
            }
          },
          requestPasswordReset: async (params: {
            identifier: string;
            redirectTo?: string;
          }): Promise<Result<{ status: boolean; message: string }>> => {
            try {
              const response = await fetchOrThrow<{
                status: boolean;
                message: string;
              }>(
                $fetch,
                "/password-reset/opaque/request",
                {
                  identifier: params.identifier,
                  redirectTo: params.redirectTo,
                },
                "Password reset request failed. Please try again."
              );
              return wrapResult(response);
            } catch (error) {
              return wrapError(error);
            }
          },
          resetPassword: async (params: {
            token: string;
            newPassword: string;
          }): Promise<Result<{ success: boolean; exportKey: Uint8Array }>> => {
            try {
              const { exportKey } = await runOpaqueRegistration<
                { challenge: string },
                { success: boolean }
              >({
                $fetch,
                options,
                password: params.newPassword,
                challengePath: "/password-reset/opaque/challenge",
                challengeBody: { token: params.token },
                completePath: "/password-reset/opaque/complete",
                completeBody: () => ({ token: params.token }),
                messages: {
                  challengeFailed:
                    "Password reset failed. The link may have expired.",
                  completeFailed: "Password reset failed. Please try again.",
                  finishFailed: "Password reset failed. Please try again.",
                },
              });
              return wrapResult({ success: true, exportKey });
            } catch (error) {
              return wrapError(error);
            }
          },
        },
      };
    },
  };
};
