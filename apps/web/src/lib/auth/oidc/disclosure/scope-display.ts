/**
 * Scope display — consent UI grouping.
 *
 * Only `groupScopes` lives here because it depends on `lucide-react` icons,
 * which don't belong in the pure-data disclosure registry.
 */

import type { LucideIcon } from "lucide-react";

import { BadgeCheck, KeyRound, Lock } from "lucide-react";

import {
  describeScopes,
  isIdentityScope,
  isProofScope,
  type ScopeLine,
} from "./registry";

const SCOPE_GROUP_LABELS = {
  account: "Account",
  proofs: "Verification records",
  identity: "Personal information",
} as const;

interface ScopeGroup {
  icon: LucideIcon;
  label: string;
  lines: ScopeLine[];
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
    groups.push({
      label: SCOPE_GROUP_LABELS.account,
      icon: KeyRound,
      lines: describeScopes(account),
    });
  }
  if (proofs.length > 0) {
    groups.push({
      label: SCOPE_GROUP_LABELS.proofs,
      icon: BadgeCheck,
      lines: describeScopes(proofs),
    });
  }
  if (identity.length > 0) {
    groups.push({
      label: SCOPE_GROUP_LABELS.identity,
      icon: Lock,
      lines: describeScopes(identity),
    });
  }
  return groups;
}
