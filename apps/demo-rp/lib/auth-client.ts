import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3102",
	advanced: {
		cookiePrefix: "demo-rp",
	},
	plugins: [genericOAuthClient()],
});

export const { useSession, signOut } = authClient;
