"use client";

import "client-only";

import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { InferAuth } from "better-auth/client";
import {
  anonymousClient,
  magicLinkClient,
  organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { env } from "@/env";
import { opaqueClient } from "@/lib/auth/opaque/client";
import { siweAuthClient } from "@/lib/auth/siwe/client";

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
    siweAuthClient(),
    oauthProviderClient(),
    organizationClient(),
  ],
});

export const { signOut, useSession } = authClient;
