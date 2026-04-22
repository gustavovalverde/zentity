import { zentityFetch } from "../auth/api-client.js";
import { getOAuthContext, requireAuth } from "../auth/context.js";
import { PROFILE_FIELDS } from "../auth/profile-fields.js";
import { config } from "../config.js";

interface AssuranceProfile {
  authStrength: string;
  details: Record<string, boolean>;
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

export interface AccountSummary {
  authStrength: string | null;
  checks: Record<string, boolean> | null;
  email: string | null;
  loginMethod: string | null;
  memberSince: string | null;
  profileToolHint: "my_profile";
  tier: number | null;
  tierName: string | null;
  vaultFieldsAvailable: (typeof PROFILE_FIELDS)[number][];
  verificationLevel: string | null;
}

export async function fetchAccountSummary(): Promise<AccountSummary> {
  const auth = await requireAuth();
  const oauth = getOAuthContext(auth);
  const canDiscloseEmail = oauth.scopes.includes("email");

  const [profileRes, accountRes] = await Promise.all([
    zentityFetch(`${config.zentityUrl}/api/trpc/assurance.profile`),
    zentityFetch(`${config.zentityUrl}/api/trpc/account.getData`),
  ]);

  const profile = profileRes.ok
    ? ((await profileRes.json()) as { result: { data: AssuranceProfile } })
        .result.data
    : null;

  const account = accountRes.ok
    ? ((await accountRes.json()) as { result: { data: AccountData } }).result
        .data
    : null;

  return {
    email: canDiscloseEmail ? (account?.email ?? null) : null,
    memberSince: account?.createdAt ?? null,
    tier: profile?.tier ?? null,
    tierName: profile?.tierName ?? null,
    verificationLevel: account?.verification?.level ?? null,
    authStrength: profile?.authStrength ?? null,
    loginMethod: profile?.loginMethod ?? null,
    checks: account?.verification?.checks ?? profile?.details ?? null,
    vaultFieldsAvailable: [...PROFILE_FIELDS],
    profileToolHint: "my_profile",
  };
}
