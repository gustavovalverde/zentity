"use client";

import "client-only";

import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { InferAuth } from "better-auth/client";
import {
  anonymousClient,
  genericOAuthClient,
  magicLinkClient,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { env } from "@/env";
import { eip712AuthClient } from "@/lib/auth/eip712/client";
import { opaqueClient } from "@/lib/auth/opaque/client";
import { getSafeRedirectPath } from "@/lib/auth/redirect";

// Use current origin in browser to avoid IPv4/IPv6 localhost mismatch
// Node.js v17+ prefers IPv6, so browser may be at [::1] while env says localhost
const getAuthBaseURL = () => {
  const base =
    globalThis.window === undefined
      ? env.NEXT_PUBLIC_APP_URL
      : globalThis.window.location.origin;
  return new URL("/api/auth", base).toString();
};

type ServerAuth = typeof import("./auth-config").auth;

export const authClient = createAuthClient({
  baseURL: getAuthBaseURL(),
  $InferAuth: InferAuth<ServerAuth>(),
  plugins: [
    magicLinkClient(),
    passkeyClient(),
    opaqueClient(),
    anonymousClient(),
    eip712AuthClient(),
    genericOAuthClient(),
    oauthProviderClient(),
    organizationClient(),
    twoFactorClient({
      // Redirect to 2FA verification page when TOTP is required
      onTwoFactorRedirect: () => {
        if (globalThis.window !== undefined) {
          // Preserve intended destination in URL
          const redirectTo = new URLSearchParams(
            globalThis.window.location.search
          ).get("redirectTo");
          const safeRedirect = getSafeRedirectPath(redirectTo, "");
          const url = safeRedirect
            ? `/verify-2fa?redirectTo=${encodeURIComponent(safeRedirect)}`
            : "/verify-2fa";
          globalThis.window.location.href = url;
        }
      },
    }),
  ],
});

export const { signOut, useSession } = authClient;
