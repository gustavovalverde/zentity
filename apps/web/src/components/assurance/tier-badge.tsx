import type { AccountTier, TierName } from "@/lib/assurance/types";

import { CheckCircle2, Shield, User } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/classname";

interface TierBadgeProps {
  tier: AccountTier;
  label?: TierName;
  showIcon?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const TIER_ICONS = {
  0: Shield,
  1: User,
  2: CheckCircle2,
} as const;

const TIER_VARIANTS = {
  0: "secondary",
  1: "outline",
  2: "success",
} as const;

const TIER_LABELS: Record<AccountTier, TierName> = {
  0: "Anonymous",
  1: "Account",
  2: "Verified",
};

/**
 * TierBadge - Visual indicator for account tier level
 *
 * Displays the current tier with an icon and label.
 * Styling reflects verification progress:
 * - Tier 0 (Anonymous): Neutral/secondary (gray)
 * - Tier 1 (Account): Outline
 * - Tier 2 (Verified): Success (green)
 */
export function TierBadge({
  tier,
  label,
  showIcon = true,
  size = "md",
  className,
}: Readonly<TierBadgeProps>) {
  const Icon = TIER_ICONS[tier];
  const variant = TIER_VARIANTS[tier];
  const displayLabel = label ?? TIER_LABELS[tier];

  const sizeClasses = {
    sm: "text-xs px-2 py-0.5",
    md: "text-sm px-2.5 py-1",
    lg: "text-base px-3 py-1.5",
  };

  const iconSizes = {
    sm: "h-3 w-3",
    md: "h-3.5 w-3.5",
    lg: "h-4 w-4",
  };

  return (
    <Badge className={cn(sizeClasses[size], className)} variant={variant}>
      {showIcon && <Icon className={cn(iconSizes[size], "mr-1")} />}
      {displayLabel}
    </Badge>
  );
}
