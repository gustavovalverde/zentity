import type { SecurityPosture } from "@zentity/sdk/protocol";
import { config } from "../config.js";
import { getOAuthContext, requireAuth } from "../runtime/auth-context.js";
import { PROFILE_FIELDS } from "./profile-fields.js";
import { zentityFetch } from "./zentity-api.js";

interface ComplianceChecks {
  ageVerified: boolean;
  documentVerified: boolean;
  faceMatchVerified: boolean;
  identityBound: boolean;
  livenessVerified: boolean;
  nationalityVerified: boolean;
  sybilResistant: boolean;
}

interface HumanityCredentialSummary {
  attachedAt: string;
  expiresAt: string | null;
  provider: string;
  providerSubjectKind: string;
}

interface AccountData {
  createdAt: string;
  email: string;
  humanityCredentials?: HumanityCredentialSummary[];
  verification: {
    humanity: { proven: boolean };
    identity: {
      method: "ocr" | "nfc_chip" | null;
      strength: string;
      verified: boolean;
    };
    policy: {
      checks: ComplianceChecks;
      birthYearOffset: number | null;
      version: string;
    };
  };
}

export interface AccountSummary {
  authStrength: string | null;
  checks: Record<string, boolean> | null;
  email: string | null;
  humanity: {
    proven: boolean;
    sources: HumanityCredentialSummary[];
  };
  loginMethod: string | null;
  memberSince: string | null;
  profileToolHint: "my_profile";
  tier: number | null;
  tierName: string | null;
  vaultFieldsAvailable: (typeof PROFILE_FIELDS)[number][];
  verificationStrength: string | null;
}

export async function fetchAccountSummary(): Promise<AccountSummary> {
  const auth = await requireAuth();
  const oauth = getOAuthContext(auth);
  const canDiscloseEmail = oauth.scopes.includes("email");

  const [profileRes, accountRes] = await Promise.all([
    zentityFetch(`${config.zentityUrl}/api/trpc/assurance.profile`),
    zentityFetch(`${config.zentityUrl}/api/trpc/account.getData`),
  ]);

  const posture = profileRes.ok
    ? ((await profileRes.json()) as { result: { data: SecurityPosture } })
        .result.data
    : null;

  const account = accountRes.ok
    ? ((await accountRes.json()) as { result: { data: AccountData } }).result
        .data
    : null;

  const checks = account?.verification?.policy?.checks ?? null;

  return {
    email: canDiscloseEmail ? (account?.email ?? null) : null,
    memberSince: account?.createdAt ?? null,
    tier: posture?.assurance.tier ?? null,
    tierName: posture?.assurance.tierName ?? null,
    verificationStrength: account?.verification?.identity?.strength ?? null,
    authStrength: posture?.auth?.authStrength ?? null,
    loginMethod: posture?.auth?.loginMethod ?? null,
    checks: checks ? { ...checks } : null,
    humanity: {
      proven: account?.verification?.humanity?.proven ?? false,
      sources: account?.humanityCredentials ?? [],
    },
    vaultFieldsAvailable: [...PROFILE_FIELDS],
    profileToolHint: "my_profile",
  };
}
