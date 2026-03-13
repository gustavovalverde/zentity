import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { zentityFetch } from "../auth/api-client.js";
import { requireAuth } from "../auth/context.js";
import { getCachedIdentity, getIdentity } from "../auth/identity.js";
import { config } from "../config.js";

interface AssuranceProfile {
	tier: number;
	tierName: string;
	authStrength: string;
	loginMethod: string;
	details: {
		isAuthenticated: boolean;
		hasSecuredKeys: boolean;
		chipVerified: boolean;
		documentVerified: boolean;
		livenessVerified: boolean;
		faceMatchVerified: boolean;
		zkProofsComplete: boolean;
		fheComplete: boolean;
		onChainAttested: boolean;
	};
}

interface AccountData {
	email: string;
	createdAt: string;
	verification: {
		level: string;
		checks: Record<string, boolean>;
	};
}

export function registerWhoamiTool(server: McpServer): void {
	server.tool(
		"whoami",
		"Get the user's identity: name, email, verification tier, and completed checks. On first use, sends a push notification to unlock the identity vault. Use when the user asks who they are, what their name is, what their account status is, or whether they are verified.",
		{},
		async () => {
			try {
				await requireAuth();
			} catch (error) {
				return {
					isError: true,
					content: [
						{
							type: "text" as const,
							text: error instanceof Error ? error.message : "Not authenticated",
						},
					],
				};
			}

			const [profileRes, accountRes, identity] = await Promise.all([
				zentityFetch(`${config.zentityUrl}/api/trpc/assurance.profile`),
				zentityFetch(`${config.zentityUrl}/api/trpc/account.getData`),
				resolveIdentity().catch(() => null),
			]);

			const profile = profileRes.ok
				? ((await profileRes.json()) as { result: { data: AssuranceProfile } })
						.result.data
				: null;

			const account = accountRes.ok
				? ((await accountRes.json()) as { result: { data: AccountData } })
						.result.data
				: null;

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							first_name:
								identity?.given_name?.split(" ")[0] ??
								identity?.name?.split(" ")[0] ??
								null,
							name: identity?.name ?? null,
							given_name: identity?.given_name ?? null,
							family_name: identity?.family_name ?? null,
							email: account?.email ?? null,
							memberSince: account?.createdAt ?? null,
							tier: profile?.tier ?? null,
							tierName: profile?.tierName ?? null,
							verificationLevel: account?.verification?.level ?? null,
							authStrength: profile?.authStrength ?? null,
							loginMethod: profile?.loginMethod ?? null,
							checks: account?.verification?.checks ?? profile?.details ?? null,
						}),
					},
				],
			};
		},
	);
}

async function resolveIdentity() {
	return getCachedIdentity() ?? (await getIdentity());
}
