"use client";

import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { passkeyClient } from "@better-auth/passkey/client";
import {
  anonymousClient,
  genericOAuthClient,
  lastLoginMethodClient,
  magicLinkClient,
  siweClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

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
    anonymousClient(),
    siweClient(),
    genericOAuthClient(),
    lastLoginMethodClient(),
    oauthProviderClient(),
  ],
});

export const { signIn, signOut, useSession } = authClient;
