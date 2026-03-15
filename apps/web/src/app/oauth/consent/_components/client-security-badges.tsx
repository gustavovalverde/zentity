"use client";

import { Fingerprint, Lock, Shield, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface SecurityBadge {
  icon: typeof Shield;
  label: string;
  tooltip: string;
}

export interface SecurityBadgeInput {
  isPairwise: boolean;
  requiresDpop: boolean;
  signingAlg: string;
}

export function deriveSecurityBadges(
  input: SecurityBadgeInput
): SecurityBadge[] {
  const badges: SecurityBadge[] = [];

  if (input.signingAlg !== "RS256") {
    badges.push({
      icon: input.signingAlg === "ML-DSA-65" ? ShieldCheck : Shield,
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
  badges,
}: Readonly<{ badges: SecurityBadge[] }>) {
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
