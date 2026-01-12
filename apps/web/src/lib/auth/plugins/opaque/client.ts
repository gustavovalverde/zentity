import type { OpaqueClientOptions } from "./types";

import { client, ready } from "@serenity-kit/opaque";

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
  message: string;
  code?: string;
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
    process.env.NEXT_PUBLIC_OPAQUE_SERVER_PUBLIC_KEY?.trim();
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

/** Decode base64 export key from OPAQUE library to Uint8Array */
function decodeExportKey(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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

  return { data: null, error: { message } };
}

export const opaqueClient = (options: OpaqueClientOptions = {}) => {
  return {
    id: "opaque",
    getActions($fetch: ClientFetch) {
      const setPassword = async (params: {
        password: string;
      }): Promise<Result<{ success: boolean; exportKey: Uint8Array }>> => {
        try {
          await ready;
          const { clientRegistrationState, registrationRequest } =
            client.startRegistration({
              password: params.password,
            });

          const challengeResponse = await $fetch<{ challenge: string }>(
            "/password/opaque/registration/challenge",
            {
              method: "POST",
              body: {
                registrationRequest,
              },
            }
          );

          // Check for error response
          if (challengeResponse.error || !challengeResponse.data) {
            const serverMessage = extractErrorMessage(
              challengeResponse.error,
              "Failed to set password. Please try again."
            );
            return wrapError(new Error(serverMessage));
          }

          // Validate the challenge is present
          if (
            !challengeResponse.data.challenge ||
            typeof challengeResponse.data.challenge !== "string"
          ) {
            return wrapError(
              new Error(
                "Server returned an invalid response. Please try again."
              )
            );
          }

          const { registrationRecord, exportKey, serverStaticPublicKey } =
            client.finishRegistration({
              clientRegistrationState,
              registrationResponse: challengeResponse.data.challenge,
              password: params.password,
            });

          try {
            await assertServerPublicKey(serverStaticPublicKey, options);
          } catch (error) {
            return wrapError(error);
          }

          const completeResponse = await $fetch<{ success: boolean }>(
            "/password/opaque/registration/complete",
            {
              method: "POST",
              body: { registrationRecord },
            }
          );

          if (completeResponse.error || !completeResponse.data) {
            const serverMessage = extractErrorMessage(
              completeResponse.error,
              "Failed to complete password setup. Please try again."
            );
            return wrapError(new Error(serverMessage));
          }

          return wrapResult({
            success: true,
            exportKey: decodeExportKey(exportKey),
          });
        } catch (error) {
          return wrapError(error);
        }
      };

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
              await ready;
              const { clientLoginState, startLoginRequest } = client.startLogin(
                {
                  password: params.password,
                }
              );

              const challengeResponse = await $fetch<{
                challenge: string;
                state: string;
              }>("/sign-in/opaque/challenge", {
                method: "POST",
                body: {
                  identifier: params.identifier,
                  loginRequest: startLoginRequest,
                },
              });

              // Check for error response
              if (challengeResponse.error || !challengeResponse.data) {
                const serverMessage = extractErrorMessage(
                  challengeResponse.error,
                  "Sign-in failed. Please check your credentials and try again."
                );
                return wrapError(new Error(serverMessage));
              }

              // Validate the challenge is present
              if (
                !challengeResponse.data.challenge ||
                typeof challengeResponse.data.challenge !== "string"
              ) {
                return wrapError(
                  new Error(
                    "Server returned an invalid response. Please try again."
                  )
                );
              }

              let loginResult: ReturnType<typeof client.finishLogin>;
              try {
                loginResult = client.finishLogin({
                  clientLoginState,
                  loginResponse: challengeResponse.data.challenge,
                  password: params.password,
                });
              } catch (opaqueError) {
                // Translate cryptic WASM errors to user-friendly messages
                const message =
                  opaqueError instanceof Error
                    ? opaqueError.message
                    : String(opaqueError);
                if (
                  message.includes("invalid type") ||
                  message.includes("unit value")
                ) {
                  return wrapError(
                    new Error(
                      "Sign-in failed. Please check your credentials and try again."
                    )
                  );
                }
                return wrapError(opaqueError);
              }

              if (!loginResult) {
                return wrapError(new Error("Login failed"));
              }

              try {
                await assertServerPublicKey(
                  loginResult.serverStaticPublicKey,
                  options
                );
              } catch (error) {
                return wrapError(error);
              }

              const completeResponse = await $fetch<{
                success: boolean;
                token: string;
                user: { id: string };
              }>("/sign-in/opaque/complete", {
                method: "POST",
                body: {
                  loginResult: loginResult.finishLoginRequest,
                  encryptedServerState: challengeResponse.data.state,
                  rememberMe: params.rememberMe,
                },
              });

              if (completeResponse.error || !completeResponse.data) {
                const serverMessage = extractErrorMessage(
                  completeResponse.error,
                  "Sign-in failed. Please try again."
                );
                return wrapError(new Error(serverMessage));
              }

              return wrapResult({
                ...completeResponse.data,
                exportKey: decodeExportKey(loginResult.exportKey),
              });
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
              await ready;

              // Start OPAQUE registration
              const { clientRegistrationState, registrationRequest } =
                client.startRegistration({
                  password: params.password,
                });

              // Get challenge from server
              const challengeResponse = await $fetch<{
                challenge: string;
                signupToken: string;
              }>("/sign-up/opaque/challenge", {
                method: "POST",
                body: {
                  email: params.email,
                  registrationRequest,
                },
              });

              // Check for error response
              if (challengeResponse.error || !challengeResponse.data) {
                const serverMessage = extractErrorMessage(
                  challengeResponse.error,
                  "Sign-up failed. Please try again."
                );
                return wrapError(new Error(serverMessage));
              }

              // Validate the challenge is present
              if (
                !challengeResponse.data.challenge ||
                typeof challengeResponse.data.challenge !== "string"
              ) {
                return wrapError(
                  new Error(
                    "Server returned an invalid response. Please try again."
                  )
                );
              }

              // Complete OPAQUE registration (derives export key client-side)
              let registrationRecord: string;
              let exportKey: string;
              let serverStaticPublicKey: string;
              try {
                const result = client.finishRegistration({
                  clientRegistrationState,
                  registrationResponse: challengeResponse.data.challenge,
                  password: params.password,
                });
                registrationRecord = result.registrationRecord;
                exportKey = result.exportKey;
                serverStaticPublicKey = result.serverStaticPublicKey;
              } catch (opaqueError) {
                // Translate cryptic WASM errors to user-friendly messages
                const message =
                  opaqueError instanceof Error
                    ? opaqueError.message
                    : String(opaqueError);
                if (
                  message.includes("invalid type") ||
                  message.includes("unit value")
                ) {
                  return wrapError(
                    new Error(
                      "Sign-up failed. Please try again or contact support."
                    )
                  );
                }
                return wrapError(opaqueError);
              }

              // Verify server public key (if pinned)
              try {
                await assertServerPublicKey(serverStaticPublicKey, options);
              } catch (error) {
                return wrapError(error);
              }

              // Complete sign-up on server
              const completeResponse = await $fetch<{
                success: boolean;
                token: string;
                user: { id: string; email: string };
              }>("/sign-up/opaque/complete", {
                method: "POST",
                body: {
                  signupToken: challengeResponse.data.signupToken,
                  registrationRecord,
                },
              });

              if (completeResponse.error || !completeResponse.data) {
                const serverMessage = extractErrorMessage(
                  completeResponse.error,
                  "Sign-up failed. Please try again."
                );
                return wrapError(new Error(serverMessage));
              }

              return wrapResult({
                ...completeResponse.data,
                exportKey: decodeExportKey(exportKey),
              });
            } catch (error) {
              return wrapError(error);
            }
          },
        },
        opaque: {
          setPassword,
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
              await ready;
              const { clientLoginState, startLoginRequest } = client.startLogin(
                {
                  password: params.currentPassword,
                }
              );

              const verifyChallenge = await $fetch<{
                challenge: string;
                state: string;
              }>("/password/opaque/verify/challenge", {
                method: "POST",
                body: { loginRequest: startLoginRequest },
              });

              // Check for error response
              if (verifyChallenge.error || !verifyChallenge.data) {
                const serverMessage = extractErrorMessage(
                  verifyChallenge.error,
                  "Password verification failed. Please try again."
                );
                return wrapError(new Error(serverMessage));
              }

              let verifyResult: ReturnType<typeof client.finishLogin>;
              try {
                verifyResult = client.finishLogin({
                  clientLoginState,
                  loginResponse: verifyChallenge.data.challenge,
                  password: params.currentPassword,
                });
              } catch (opaqueError) {
                const message =
                  opaqueError instanceof Error
                    ? opaqueError.message
                    : String(opaqueError);
                if (
                  message.includes("invalid type") ||
                  message.includes("unit value")
                ) {
                  return wrapError(new Error("Invalid current password"));
                }
                return wrapError(opaqueError);
              }

              if (!verifyResult) {
                return wrapError(new Error("Invalid password"));
              }

              const verifyComplete = await $fetch<{ success: boolean }>(
                "/password/opaque/verify/complete",
                {
                  method: "POST",
                  body: {
                    loginResult: verifyResult.finishLoginRequest,
                    encryptedServerState: verifyChallenge.data.state,
                  },
                }
              );

              if (verifyComplete.error || !verifyComplete.data) {
                const serverMessage = extractErrorMessage(
                  verifyComplete.error,
                  "Password verification failed. Please try again."
                );
                return wrapError(new Error(serverMessage));
              }

              const setPasswordResult = await setPassword({
                password: params.newPassword,
              });

              if (!setPasswordResult.data || setPasswordResult.error) {
                return {
                  data: null,
                  error: setPasswordResult.error || {
                    message: "Failed to set new password",
                  },
                };
              }

              return wrapResult({
                success: true,
                exportKey: setPasswordResult.data.exportKey,
                oldExportKey: decodeExportKey(verifyResult.exportKey),
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
              const response = await $fetch<{
                status: boolean;
                message: string;
              }>("/password-reset/opaque/request", {
                method: "POST",
                body: {
                  identifier: params.identifier,
                  redirectTo: params.redirectTo,
                },
              });

              if (response.error || !response.data) {
                const serverMessage = extractErrorMessage(
                  response.error,
                  "Password reset request failed. Please try again."
                );
                return wrapError(new Error(serverMessage));
              }

              return wrapResult(response.data);
            } catch (error) {
              return wrapError(error);
            }
          },
          resetPassword: async (params: {
            token: string;
            newPassword: string;
          }): Promise<Result<{ success: boolean; exportKey: Uint8Array }>> => {
            try {
              await ready;
              const { clientRegistrationState, registrationRequest } =
                client.startRegistration({
                  password: params.newPassword,
                });

              const challengeResponse = await $fetch<{ challenge: string }>(
                "/password-reset/opaque/challenge",
                {
                  method: "POST",
                  body: {
                    token: params.token,
                    registrationRequest,
                  },
                }
              );

              // Check for error response
              if (challengeResponse.error || !challengeResponse.data) {
                const serverMessage = extractErrorMessage(
                  challengeResponse.error,
                  "Password reset failed. The link may have expired."
                );
                return wrapError(new Error(serverMessage));
              }

              // Validate the challenge is present
              if (
                !challengeResponse.data.challenge ||
                typeof challengeResponse.data.challenge !== "string"
              ) {
                return wrapError(
                  new Error(
                    "Server returned an invalid response. Please try again."
                  )
                );
              }

              let registrationRecord: string;
              let exportKey: string;
              let serverStaticPublicKey: string;
              try {
                const result = client.finishRegistration({
                  clientRegistrationState,
                  registrationResponse: challengeResponse.data.challenge,
                  password: params.newPassword,
                });
                registrationRecord = result.registrationRecord;
                exportKey = result.exportKey;
                serverStaticPublicKey = result.serverStaticPublicKey;
              } catch (opaqueError) {
                const message =
                  opaqueError instanceof Error
                    ? opaqueError.message
                    : String(opaqueError);
                if (
                  message.includes("invalid type") ||
                  message.includes("unit value")
                ) {
                  return wrapError(
                    new Error("Password reset failed. Please try again.")
                  );
                }
                return wrapError(opaqueError);
              }

              try {
                await assertServerPublicKey(serverStaticPublicKey, options);
              } catch (error) {
                return wrapError(error);
              }

              const completeResponse = await $fetch<{ success: boolean }>(
                "/password-reset/opaque/complete",
                {
                  method: "POST",
                  body: {
                    token: params.token,
                    registrationRecord,
                  },
                }
              );

              if (completeResponse.error || !completeResponse.data) {
                const serverMessage = extractErrorMessage(
                  completeResponse.error,
                  "Password reset failed. Please try again."
                );
                return wrapError(new Error(serverMessage));
              }

              return wrapResult({
                success: true,
                exportKey: decodeExportKey(exportKey),
              });
            } catch (error) {
              return wrapError(error);
            }
          },
        },
      };
    },
  };
};
