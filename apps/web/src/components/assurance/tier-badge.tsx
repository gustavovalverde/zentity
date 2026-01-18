import type { AccountTier, TierLabel } from "@/lib/assurance/types";

import { CheckCircle2, FileCheck, Shield, User } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/classname";

interface TierBadgeProps {
  tier: AccountTier;
  label: TierLabel;
  showIcon?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const TIER_ICONS = {
  0: Shield,
  1: User,
  2: FileCheck,
  3: CheckCircle2,
} as const;

const TIER_VARIANTS = {
  0: "secondary",
  1: "outline",
  2: "info",
  3: "success",
} as const;

/**
 * TierBadge - Visual indicator for account tier level
 *
 * Displays the current tier with an icon and label.
 * Styling reflects verification progress:
 * - Tier 0 (Explore): Neutral/secondary
 * - Tier 1 (Account): Outline
 * - Tier 2 (Verified): Info (blue)
 * - Tier 3 (Auditable): Success (green)
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
      Tier {tier}: {label}
    </Badge>
  );
}
