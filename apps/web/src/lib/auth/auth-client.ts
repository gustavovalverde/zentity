"use client";

import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Use current origin in browser to avoid IPv4/IPv6 localhost mismatch
// Node.js v17+ prefers IPv6, so browser may be at [::1] while env says localhost
const getBaseURL = () => {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
};

export const authClient = createAuthClient({
  baseURL: getBaseURL(),
  plugins: [magicLinkClient()],
});

export const { signIn, signOut, useSession } = authClient;
