import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { env } from "@/lib/env";

export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_APP_URL,
  advanced: {
    cookiePrefix: "demo-rp",
  },
  plugins: [genericOAuthClient()],
});

export const { useSession, signOut } = authClient;
