import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { zentityFetch } from "../auth/api-client.js";
import { requireAuth } from "../auth/context.js";
import { getIdentityResolution } from "../auth/identity.js";
import { config } from "../config.js";

interface AssuranceProfile {
  authStrength: string;
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
  loginMethod: string;
  tier: number;
  tierName: string;
}

interface AccountData {
  createdAt: string;
  email: string;
  verification: {
    level: string;
    checks: Record<string, boolean>;
  };
}

interface WhoamiOptions {
  allowIdentityUnlock?: boolean;
}

type WhoamiIdentityResult =
  | Awaited<ReturnType<typeof getIdentityResolution>>
  | {
      claims: null;
      message: string;
      status: "unavailable";
    };

export function registerWhoamiTool(
  server: McpServer,
  options: WhoamiOptions = {}
): void {
  server.tool(
    "whoami",
    "Get the user's identity: name, email, verification tier, and completed checks. On first use, this may return account status plus an approval URL to unlock the identity vault instead of blocking. Use when the user asks who they are, what their name is, what their account status is, or whether they are verified.",
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
              text:
                error instanceof Error ? error.message : "Not authenticated",
            },
          ],
        };
      }

      const data = await fetchWhoamiData(options);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(data),
          },
        ],
      };
    }
  );
}

async function fetchWhoamiData(options: WhoamiOptions) {
  const identityPromise: Promise<WhoamiIdentityResult> =
    options.allowIdentityUnlock
      ? getIdentityResolution().catch(() => ({
          status: "ready" as const,
          claims: null,
        }))
      : Promise.resolve({
          claims: null,
          message:
            "Full identity unlock is only available to registered installed-agent runtimes.",
          status: "unavailable" as const,
        });
  const [profileRes, accountRes, identity] = await Promise.all([
    zentityFetch(`${config.zentityUrl}/api/trpc/assurance.profile`),
    zentityFetch(`${config.zentityUrl}/api/trpc/account.getData`),
    identityPromise,
  ]);

  const profile = profileRes.ok
    ? ((await profileRes.json()) as { result: { data: AssuranceProfile } })
        .result.data
    : null;

  const account = accountRes.ok
    ? ((await accountRes.json()) as { result: { data: AccountData } }).result
        .data
    : null;

  const claims = identity.status === "ready" ? identity.claims : null;
  const identityApproval =
    identity.status === "approval_required"
      ? {
          approvalUrl: identity.approval.approvalUrl,
          authReqId: identity.approval.authReqId,
          expiresIn: identity.approval.expiresIn,
          intervalSeconds: identity.approval.intervalSeconds,
          message: "Approve the identity unlock and call whoami again.",
        }
      : null;
  const identityMessage =
    identity.status === "denied" ||
    identity.status === "timed_out" ||
    identity.status === "unavailable"
      ? identity.message
      : null;

  return {
    first_name:
      claims?.given_name?.split(" ")[0] ?? claims?.name?.split(" ")[0] ?? null,
    name: claims?.name ?? null,
    given_name: claims?.given_name ?? null,
    family_name: claims?.family_name ?? null,
    email: account?.email ?? null,
    memberSince: account?.createdAt ?? null,
    tier: profile?.tier ?? null,
    tierName: profile?.tierName ?? null,
    verificationLevel: account?.verification?.level ?? null,
    authStrength: profile?.authStrength ?? null,
    loginMethod: profile?.loginMethod ?? null,
    checks: account?.verification?.checks ?? profile?.details ?? null,
    identityApproval,
    identityMessage,
    identityStatus: identity.status,
  };
}
