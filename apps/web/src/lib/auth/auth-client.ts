"use client";

import "client-only";

import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { passkeyClient } from "@better-auth/passkey/client";
import {
  anonymousClient,
  genericOAuthClient,
  lastLoginMethodClient,
  magicLinkClient,
  siweClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { opaqueClient } from "@/lib/auth/plugins/opaque/client";
import { getSafeRedirectPath } from "@/lib/utils/navigation";

// Use current origin in browser to avoid IPv4/IPv6 localhost mismatch
// Node.js v17+ prefers IPv6, so browser may be at [::1] while env says localhost
const getAuthBaseURL = () => {
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return new URL("/api/auth", base).toString();
};

export const authClient = createAuthClient({
  baseURL: getAuthBaseURL(),
  plugins: [
    magicLinkClient(),
    passkeyClient(),
    opaqueClient(),
    anonymousClient(),
    siweClient(),
    genericOAuthClient(),
    lastLoginMethodClient(),
    oauthProviderClient(),
    twoFactorClient({
      // Redirect to 2FA verification page when TOTP is required
      onTwoFactorRedirect: () => {
        if (typeof window !== "undefined") {
          // Preserve intended destination in URL
          const redirectTo = new URLSearchParams(window.location.search).get(
            "redirectTo"
          );
          const safeRedirect = getSafeRedirectPath(redirectTo, "");
          const url = safeRedirect
            ? `/verify-2fa?redirectTo=${encodeURIComponent(safeRedirect)}`
            : "/verify-2fa";
          window.location.href = url;
        }
      },
    }),
  ],
});

export const { signOut, useSession } = authClient;
