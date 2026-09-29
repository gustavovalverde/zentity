"use client";

import { Fingerprint, Lock, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type EncryptionLevel = "none" | "standard" | "post-quantum";

export interface SecurityBadgeInput {
  encryptionLevel: EncryptionLevel;
  isPairwise: boolean;
  requiresDpop: boolean;
}

interface SecurityBadge {
  icon: typeof Lock;
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
    tooltip: "Your data is encrypted in transit and at rest",
  },
  "post-quantum": {
    icon: ShieldCheck,
    label: "Quantum-safe",
    tooltip: "Your data is protected with quantum-resistant encryption",
  },
};

function deriveSecurityBadges(input: SecurityBadgeInput): SecurityBadge[] {
  const badges: SecurityBadge[] = [];

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
      label: "Bound access",
      tooltip: "Your access tokens can only be used by this app",
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
