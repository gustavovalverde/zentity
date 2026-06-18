import { createAuthClient } from "better-auth/react";

import { env } from "@/lib/env";

export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_APP_URL,
  advanced: {
    cookiePrefix: "demo-rp",
  },
});

export const { useSession, signOut } = authClient;
