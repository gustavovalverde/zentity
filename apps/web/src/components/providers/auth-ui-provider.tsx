"use client";

import type { NavigateFn } from "@better-auth-ui/core";
import type { ReactNode } from "react";
import type { SocialProviderId } from "@/lib/auth/auth-config";

import { magicLinkPlugin } from "@better-auth-ui/core/plugins/magic-link";
import { AuthProvider } from "@better-auth-ui/react";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { authClient } from "@/lib/auth/auth-client";

const plugins = [magicLinkPlugin({ sentPath: "magic-link/sent" })];

// Zentity serves its auth views at the root rather than under `/auth`.
const basePaths = { auth: "" };

const viewPaths = {
  auth: {
    verifyEmail: "email-verification",
    forgotPassword: "recovery/password",
    resetPassword: "recovery/password/reset",
    resetLinkSent: "recovery/password/sent",
  },
};

// Passwords go through OPAQUE and passkeys through the PRF flow, so Better
// Auth's email-and-password views stay off.
const emailAndPassword = { enabled: false };

interface BetterAuthUIProviderProps {
  children: ReactNode;
  socialProviders: SocialProviderId[];
}

/** Better Auth UI's provider, configured for Zentity's routes. */
export function BetterAuthUIProvider({
  children,
  socialProviders,
}: Readonly<BetterAuthUIProviderProps>) {
  const router = useRouter();
  const navigate = useCallback<NavigateFn>(
    ({ to, replace }) => (replace ? router.replace(to) : router.push(to)),
    [router]
  );

  return (
    <AuthProvider
      authClient={authClient}
      basePaths={basePaths}
      emailAndPassword={emailAndPassword}
      navigate={navigate}
      plugins={plugins}
      redirectTo="/dashboard"
      socialProviders={socialProviders}
      viewPaths={viewPaths}
    >
      {children}
    </AuthProvider>
  );
}
