"use client";

import {
  Fingerprint,
  Lock,
  Shield,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  computeShieldColor,
  type EncryptionLevel,
  type SecurityBadgeInput,
  type ShieldColor,
} from "./security-badges";

export interface SecurityBadge {
  icon: typeof Shield;
  label: string;
  tooltip: string;
}

const ENCRYPTION_BADGES: Record<
  Exclude<EncryptionLevel, "none">,
  SecurityBadge
> = {
  standard: {
    icon: Lock,
    label: "Encrypted",
    tooltip: "Data encrypted with AES-GCM (standard)",
  },
  "post-quantum": {
    icon: ShieldCheck,
    label: "PQ Encrypted",
    tooltip: "Data encrypted with ML-KEM-768 (post-quantum)",
  },
};

const SHIELD_ICONS: Record<ShieldColor, typeof Shield> = {
  green: ShieldCheck,
  yellow: Shield,
  gray: ShieldAlert,
};

export function deriveSecurityBadges(
  input: SecurityBadgeInput
): SecurityBadge[] {
  const badges: SecurityBadge[] = [];

  if (input.signingAlg !== "RS256") {
    const shieldColor = computeShieldColor(input);
    badges.push({
      icon: SHIELD_ICONS[shieldColor],
      label: input.signingAlg,
      tooltip: `Tokens signed with ${input.signingAlg}`,
    });

    if (input.signingAlg === "ML-DSA-65") {
      badges.push({
        icon: ShieldCheck,
        label: "Post-Quantum",
        tooltip: "Protected with quantum-resistant cryptography",
      });
    }
  }

  if (input.encryptionLevel !== "none") {
    badges.push(ENCRYPTION_BADGES[input.encryptionLevel]);
  }

  if (input.isPairwise) {
    badges.push({
      icon: Fingerprint,
      label: "Unlinkable ID",
      tooltip:
        "Your identity is unique to this app and can't be correlated across services",
    });
  }

  if (input.requiresDpop) {
    badges.push({
      icon: Lock,
      label: "Proof-of-Possession",
      tooltip: "Tokens are cryptographically bound to this client",
    });
  }

  return badges;
}

export function ClientSecurityBadges({
  input,
}: Readonly<{ input: SecurityBadgeInput | null }>) {
  if (!input) {
    return null;
  }

  const badges = deriveSecurityBadges(input);
  if (badges.length === 0) {
    return null;
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-wrap justify-center gap-1.5">
        {badges.map((badge) => (
          <Tooltip key={badge.label}>
            <TooltipTrigger asChild>
              <Badge className="gap-1 text-xs" variant="outline">
                <badge.icon className="size-3" />
                {badge.label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>{badge.tooltip}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
