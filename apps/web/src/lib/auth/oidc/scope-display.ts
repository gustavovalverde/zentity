/**
 * Scope display — consent UI grouping.
 *
 * Only `groupScopes` lives here because it depends on `lucide-react` icons,
 * which don't belong in the pure-data disclosure registry.
 */

import type { LucideIcon } from "lucide-react";

import { BadgeCheck, KeyRound, ShieldAlert } from "lucide-react";

import {
  isIdentityScope,
  isProofScope,
} from "@/lib/auth/oidc/disclosure-registry";

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
