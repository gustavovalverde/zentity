import type { LucideIcon } from "lucide-react";

import { BadgeCheck, KeyRound, ShieldAlert } from "lucide-react";

import {
  IDENTITY_SCOPE_DESCRIPTIONS,
  isIdentityScope,
} from "@/lib/auth/oidc/identity-scopes";
import {
  isProofScope,
  PROOF_SCOPE_DESCRIPTIONS,
} from "@/lib/auth/oidc/proof-scopes";

export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  email: "Email address",
  offline_access: "Access when you're not using the app",
  "proof:identity": "All identity verification proofs",
  "compliance:key:read": "Read compliance encryption key",
  "compliance:key:write": "Manage compliance encryption key",
  ...PROOF_SCOPE_DESCRIPTIONS,
  ...IDENTITY_SCOPE_DESCRIPTIONS,
};

export const HIDDEN_SCOPES = new Set(["openid", "profile"]);

interface ScopeGroup {
  icon: LucideIcon;
  label: string;
  scopes: string[];
}

export function groupScopes(scopes: string[]): ScopeGroup[] {
  const account: string[] = [];
  const proofs: string[] = [];
  const identity: string[] = [];

  for (const scope of scopes) {
    if (scope === "proof:identity" || isProofScope(scope)) {
      proofs.push(scope);
    } else if (isIdentityScope(scope)) {
      identity.push(scope);
    } else {
      account.push(scope);
    }
  }

  const groups: ScopeGroup[] = [];
  if (account.length > 0) {
    groups.push({ label: "Account", icon: KeyRound, scopes: account });
  }
  if (proofs.length > 0) {
    groups.push({
      label: "Verification proofs",
      icon: BadgeCheck,
      scopes: proofs,
    });
  }
  if (identity.length > 0) {
    groups.push({
      label: "Personal information",
      icon: ShieldAlert,
      scopes: identity,
    });
  }
  return groups;
}
