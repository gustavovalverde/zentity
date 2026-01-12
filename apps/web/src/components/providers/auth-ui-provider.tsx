"use client";

import type { ReactNode } from "react";

import { AuthUIProvider } from "@daveyplate/better-auth-ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { authClient } from "@/lib/auth/auth-client";
import { prepareForNewSession } from "@/lib/auth/session-manager";

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
export function BetterAuthUIProvider({ children }: BetterAuthUIProviderProps) {
  const router = useRouter();
  const authUiClient = useMemo(() => {
    const signIn = authClient.signIn as typeof authClient.signIn & {
      __zentityWrapped?: boolean;
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

    return authClient;
  }, []);

  const baseURL =
    typeof window !== "undefined"
      ? window.location.origin
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
