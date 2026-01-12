import type { BetterAuthClientPlugin } from "@better-auth/core";
import { client, ready } from "@serenity-kit/opaque";

import type { opaque } from "./server";
import type { OpaqueClientOptions } from "./types";

type LoginChallengeResponse = Awaited<
  ReturnType<ReturnType<typeof opaque>["endpoints"]["getLoginChallenge"]>
>;

type LoginCompleteResponse = Awaited<
  ReturnType<ReturnType<typeof opaque>["endpoints"]["completeLogin"]>
>;

type RegistrationChallengeResponse = Awaited<
  ReturnType<ReturnType<typeof opaque>["endpoints"]["getRegistrationChallenge"]>
>;

type RegistrationCompleteResponse = Awaited<
  ReturnType<ReturnType<typeof opaque>["endpoints"]["completeRegistration"]>
>;

type VerifyChallengeResponse = Awaited<
  ReturnType<ReturnType<typeof opaque>["endpoints"]["getPasswordVerifyChallenge"]>
>;

type VerifyCompleteResponse = Awaited<
  ReturnType<ReturnType<typeof opaque>["endpoints"]["completePasswordVerify"]>
>;

type ResetRequestResponse = Awaited<
  ReturnType<ReturnType<typeof opaque>["endpoints"]["requestPasswordReset"]>
>;

type ResetChallengeResponse = Awaited<
  ReturnType<ReturnType<typeof opaque>["endpoints"]["getResetChallenge"]>
>;

type ResetCompleteResponse = Awaited<
  ReturnType<ReturnType<typeof opaque>["endpoints"]["completeReset"]>
>;

type ServerPublicKeyOptions = Pick<
  OpaqueClientOptions,
  "serverPublicKey" | "enforceServerPublicKey"
>;

function assertServerPublicKey(
  received: string | undefined,
  options: ServerPublicKeyOptions
) {
  if (!options.serverPublicKey) {
    return;
  }
  const enforce = options.enforceServerPublicKey ?? true;
  if (enforce && received !== options.serverPublicKey) {
    throw new Error("Untrusted OPAQUE server key");
  }
}

export const opaqueClient = (options: OpaqueClientOptions = {}) => {
  return {
    id: "opaque",
    getActions($fetch) {
      const setPassword = async (params: { password: string }) => {
        await ready;
        const { clientRegistrationState, registrationRequest } =
          client.startRegistration({
            password: params.password,
          });

        const challengeResponse = await $fetch<RegistrationChallengeResponse>(
          "/password/opaque/registration/challenge",
          {
            method: "POST",
            body: {
              registrationRequest,
            },
          }
        );

        if (!challengeResponse.data || challengeResponse.error) {
          return {
            data: null,
            error:
              challengeResponse.error ||
              ({ message: "Failed to get registration challenge" } as const),
          };
        }

        const { registrationRecord, exportKey, serverStaticPublicKey } =
          client.finishRegistration({
            clientRegistrationState,
            registrationResponse: challengeResponse.data.challenge,
            password: params.password,
          });

        try {
          assertServerPublicKey(serverStaticPublicKey, options);
        } catch (error) {
          return {
            data: null,
            error: {
              message:
                error instanceof Error
                  ? error.message
                  : "Untrusted OPAQUE server key",
            },
          };
        }

        const complete = await $fetch<RegistrationCompleteResponse>(
          "/password/opaque/registration/complete",
          {
            method: "POST",
            body: { registrationRecord },
          }
        );

        if (!complete.data || complete.error) {
          return complete;
        }

        return {
          ...complete,
          data: {
            ...complete.data,
            exportKey,
          },
        };
      };

      return {
        signIn: {
          opaque: async (params: {
            identifier: string;
            password: string;
            rememberMe?: boolean;
          }) => {
            await ready;
            const { clientLoginState, startLoginRequest } = client.startLogin({
              password: params.password,
            });

            const challengeResponse =
              await $fetch<LoginChallengeResponse>(
                "/sign-in/opaque/challenge",
                {
                  method: "POST",
                  body: {
                    identifier: params.identifier,
                    loginRequest: startLoginRequest,
                  },
                }
              );

            if (!challengeResponse.data || challengeResponse.error) {
              return {
                data: null,
                error:
                  challengeResponse.error ||
                  ({ message: "Failed to get login challenge" } as const),
              };
            }

            const { challenge: loginResponse, state: encryptedServerState } =
              challengeResponse.data;

            const loginResult = client.finishLogin({
              clientLoginState,
              loginResponse,
              password: params.password,
            });

            if (!loginResult) {
              return {
                data: null,
                error: { message: "Login failed" },
              };
            }

            try {
              assertServerPublicKey(
                loginResult.serverStaticPublicKey,
                options
              );
            } catch (error) {
              return {
                data: null,
                error: {
                  message:
                    error instanceof Error
                      ? error.message
                      : "Untrusted OPAQUE server key",
                },
              };
            }

            const complete = await $fetch<LoginCompleteResponse>(
              "/sign-in/opaque/complete",
              {
                method: "POST",
                body: {
                  loginResult: loginResult.finishLoginRequest,
                  encryptedServerState,
                  rememberMe: params.rememberMe,
                },
              }
            );

            if (!complete.data || complete.error) {
              return complete;
            }

            return {
              ...complete,
              data: {
                ...complete.data,
                exportKey: loginResult.exportKey,
              },
            };
          },
        },
        opaque: {
          setPassword,
          changePassword: async (params: {
            currentPassword: string;
            newPassword: string;
          }) => {
            await ready;
            const { clientLoginState, startLoginRequest } = client.startLogin({
              password: params.currentPassword,
            });

            const verifyChallenge = await $fetch<VerifyChallengeResponse>(
              "/password/opaque/verify/challenge",
              {
                method: "POST",
                body: { loginRequest: startLoginRequest },
              }
            );

            if (!verifyChallenge.data || verifyChallenge.error) {
              return {
                data: null,
                error:
                  verifyChallenge.error ||
                  ({ message: "Failed to verify current password" } as const),
              };
            }

            const verifyResult = client.finishLogin({
              clientLoginState,
              loginResponse: verifyChallenge.data.challenge,
              password: params.currentPassword,
            });

            if (!verifyResult) {
              return { data: null, error: { message: "Invalid password" } };
            }

            const verifyComplete = await $fetch<VerifyCompleteResponse>(
              "/password/opaque/verify/complete",
              {
                method: "POST",
                body: {
                  loginResult: verifyResult.finishLoginRequest,
                  encryptedServerState: verifyChallenge.data.state,
                },
              }
            );

            if (!verifyComplete.data || verifyComplete.error) {
              return verifyComplete;
            }

            return await setPassword({ password: params.newPassword });
          },
          requestPasswordReset: async (params: {
            identifier: string;
            redirectTo?: string;
          }) => {
            return await $fetch<ResetRequestResponse>(
              "/password-reset/opaque/request",
              {
                method: "POST",
                body: {
                  identifier: params.identifier,
                  redirectTo: params.redirectTo,
                },
              }
            );
          },
          resetPassword: async (params: {
            token: string;
            newPassword: string;
          }) => {
            await ready;
            const { clientRegistrationState, registrationRequest } =
              client.startRegistration({
                password: params.newPassword,
              });

            const challengeResponse = await $fetch<ResetChallengeResponse>(
              "/password-reset/opaque/challenge",
              {
                method: "POST",
                body: {
                  token: params.token,
                  registrationRequest,
                },
              }
            );

            if (!challengeResponse.data || challengeResponse.error) {
              return {
                data: null,
                error:
                  challengeResponse.error ||
                  ({ message: "Failed to start password reset" } as const),
              };
            }

            const { registrationRecord, exportKey, serverStaticPublicKey } =
              client.finishRegistration({
                clientRegistrationState,
                registrationResponse: challengeResponse.data.challenge,
                password: params.newPassword,
              });

            try {
              assertServerPublicKey(serverStaticPublicKey, options);
            } catch (error) {
              return {
                data: null,
                error: {
                  message:
                    error instanceof Error
                      ? error.message
                      : "Untrusted OPAQUE server key",
                },
              };
            }

            const complete = await $fetch<ResetCompleteResponse>(
              "/password-reset/opaque/complete",
              {
                method: "POST",
                body: {
                  token: params.token,
                  registrationRecord,
                },
              }
            );

            if (!complete.data || complete.error) {
              return complete;
            }

            return {
              ...complete,
              data: {
                ...complete.data,
                exportKey,
              },
            };
          },
        },
      };
    },
  } satisfies BetterAuthClientPlugin;
};
