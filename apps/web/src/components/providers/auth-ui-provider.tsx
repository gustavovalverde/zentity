"use client";

import type { BetterFetchOption } from "better-auth/react";
import type { ReactNode } from "react";

import { AuthUIProvider } from "@daveyplate/better-auth-ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { authClient } from "@/lib/auth/auth-client";
import { prepareForNewSession } from "@/lib/auth/session-manager";

type AuthClientBase = ReturnType<
  typeof import("better-auth/react").createAuthClient
>;

interface BetterAuthUIProviderProps {
  children: ReactNode;
}

/**
 * Wrapper around Better Auth UI's AuthUIProvider configured for Zentity.
 *
 * Note: Passkey support is disabled here because Zentity uses a custom PRF-based
 * passkey flow for FHE key derivation. The custom PasskeySignInForm and
 * PasskeyManagementSection components handle passkey operations with PRF extension.
 */
export function BetterAuthUIProvider({
  children,
}: Readonly<BetterAuthUIProviderProps>) {
  const router = useRouter();
  const authUiClient = useMemo(() => {
    const signIn = authClient.signIn as typeof authClient.signIn & {
      __zentityWrapped?: boolean;
    };
    const client = authClient as typeof authClient &
      Pick<AuthClientBase, "requestPasswordReset" | "resetPassword"> & {
        __zentityPasswordWrapped?: boolean;
      };

    if (!signIn.__zentityWrapped) {
      const email = signIn.email;
      const magicLink = signIn.magicLink;
      const oauth2 = signIn.oauth2;
      const social = signIn.social;

      signIn.email = ((...args: Parameters<typeof email>) => {
        prepareForNewSession();
        return email(...args);
      }) as typeof email;

      signIn.magicLink = ((...args: Parameters<typeof magicLink>) => {
        prepareForNewSession();
        return magicLink(...args);
      }) as typeof magicLink;

      signIn.oauth2 = ((...args: Parameters<typeof oauth2>) => {
        prepareForNewSession();
        return oauth2(...args);
      }) as typeof oauth2;

      signIn.social = ((...args: Parameters<typeof social>) => {
        prepareForNewSession();
        return social(...args);
      }) as typeof social;
      signIn.__zentityWrapped = true;
    }

    if (!client.__zentityPasswordWrapped) {
      type RequestPasswordResetArgs = Parameters<
        AuthClientBase["requestPasswordReset"]
      >;
      type ResetPasswordArgs = Parameters<AuthClientBase["resetPassword"]>;
      type RequestPasswordResetReturn = Awaited<
        ReturnType<AuthClientBase["requestPasswordReset"]>
      >;
      type ResetPasswordReturn = Awaited<
        ReturnType<AuthClientBase["resetPassword"]>
      >;

      client.requestPasswordReset = (async (
        ...args: RequestPasswordResetArgs
      ) => {
        const [payload, fetchOptionsOverride] = args;
        const fetchOptions =
          (fetchOptionsOverride as BetterFetchOption | undefined) ??
          payload?.fetchOptions;
        const email = payload?.email;
        const redirectTo = payload?.redirectTo;

        if (!email) {
          const error = {
            data: null,
            error: {
              message: "Email is required",
              status: 400,
              statusText: "Bad Request",
            },
          } as RequestPasswordResetReturn;
          if (fetchOptions?.throw) {
            throw new Error("Email is required");
          }
          return error;
        }

        const result = await authClient.opaque.requestPasswordReset({
          identifier: email,
          redirectTo,
        });

        if (result.error) {
          if (fetchOptions?.throw) {
            throw new Error(result.error.message);
          }
          return {
            data: null,
            error: {
              message: result.error.message,
              code: result.error.code,
              status: 400,
              statusText: "Bad Request",
            },
          } as RequestPasswordResetReturn;
        }

        const success = {
          status: result.data.status,
          message: result.data.message,
        };
        return fetchOptions?.throw
          ? (success as RequestPasswordResetReturn)
          : ({
              data: success,
              error: null,
            } as RequestPasswordResetReturn);
      }) as AuthClientBase["requestPasswordReset"];

      client.resetPassword = (async (...args: ResetPasswordArgs) => {
        const [payload, fetchOptionsOverride] = args;
        const fetchOptions =
          (fetchOptionsOverride as BetterFetchOption | undefined) ??
          payload?.fetchOptions;
        const token = payload?.token;

        if (!token) {
          const error = {
            data: null,
            error: {
              message: "Reset token is required",
              status: 400,
              statusText: "Bad Request",
            },
          } as ResetPasswordReturn;
          if (fetchOptions?.throw) {
            throw new Error("Reset token is required");
          }
          return error;
        }

        const result = await authClient.opaque.resetPassword({
          token,
          newPassword: payload.newPassword,
        });

        if (result.error) {
          if (fetchOptions?.throw) {
            throw new Error(result.error.message);
          }
          return {
            data: null,
            error: {
              message: result.error.message,
              code: result.error.code,
              status: 400,
              statusText: "Bad Request",
            },
          } as ResetPasswordReturn;
        }

        const success = { status: true };
        return fetchOptions?.throw
          ? (success as ResetPasswordReturn)
          : ({
              data: success,
              error: null,
            } as ResetPasswordReturn);
      }) as AuthClientBase["resetPassword"];

      client.__zentityPasswordWrapped = true;
    }

    return client;
  }, []);

  const baseURL =
    globalThis.window !== undefined
      ? globalThis.window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "";

  return (
    <AuthUIProvider
      authClient={authUiClient}
      basePath=""
      baseURL={baseURL}
      credentials={false}
      Link={Link}
      magicLink={true}
      navigate={router.push}
      onSessionChange={() => {
        // App Router caches routes by default, refresh clears the cache
        router.refresh();
      }}
      // Zentity-specific configuration
      passkey={false} // Disabled - using custom PRF flow for FHE key derivation
      redirectTo="/dashboard"
      replace={router.replace}
      social={{
        providers: ["google", "github"],
      }}
      twoFactor={{ methods: ["totp"], allowPasswordless: true }}
      viewPaths={{
        SIGN_IN: "sign-in",
        SIGN_UP: "sign-up",
        MAGIC_LINK: "magic-link",
        FORGOT_PASSWORD: "forgot-password",
        RESET_PASSWORD: "reset-password",
        TWO_FACTOR: "verify-2fa",
        SIGN_OUT: "sign-out",
        CALLBACK: "callback",
        EMAIL_VERIFICATION: "email-verification",
        RECOVER_ACCOUNT: "recover-account",
      }}
    >
      {children}
    </AuthUIProvider>
  );
}
