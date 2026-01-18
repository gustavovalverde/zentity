import type { TierProfile, TierRequirement } from "@/lib/assurance/types";

import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getTierProgress } from "@/lib/assurance/tier";
import { cn } from "@/lib/utils/classname";

import { TierBadge } from "./tier-badge";

interface TierProgressCardProps {
  profile: TierProfile;
  className?: string;
}

/**
 * TierProgressCard - Shows tier progress and next steps
 *
 * Displays:
 * - Current tier badge
 * - Progress bar towards next tier
 * - Requirements checklist with action buttons
 * - CTA to complete verification
 */
export function TierProgressCard({
  profile,
  className,
}: Readonly<TierProgressCardProps>) {
  const { tier, label, nextTierRequirements } = profile;
  const progress = getTierProgress(profile);
  const isMaxTier = tier === 3;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-3">
            Identity Progress
            <TierBadge label={label} size="sm" tier={tier} />
          </CardTitle>
          {!isMaxTier && (
            <span className="text-muted-foreground text-sm">{progress}%</span>
          )}
        </div>
        <CardDescription>
          {isMaxTier
            ? "Your identity is fully verified and ready for on-chain attestation"
            : "Complete verification to unlock more features"}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Progress bar */}
        {!isMaxTier && (
          <Progress
            className="h-2"
            indicatorClassName={tier >= 2 ? "bg-info" : undefined}
            value={progress}
          />
        )}

        {/* Requirements checklist */}
        {nextTierRequirements && nextTierRequirements.length > 0 && (
          <div className="space-y-2">
            <p className="font-medium text-sm">
              Requirements for Tier {tier + 1}:
            </p>
            <ul className="space-y-2">
              {nextTierRequirements.map((req) => (
                <RequirementItem key={req.id} requirement={req} />
              ))}
            </ul>
          </div>
        )}

        {/* CTA */}
        {!isMaxTier && (
          <Button asChild className="w-full">
            <Link href="/dashboard/verify">
              Complete Verification
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        )}

        {isMaxTier && (
          <div className="flex items-center gap-2 rounded-lg bg-success/10 p-3 text-success">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span className="text-sm">
              All requirements complete. You can now attest on-chain.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * RequirementItem - Single requirement with status and action
 */
function RequirementItem({
  requirement,
}: Readonly<{ requirement: TierRequirement }>) {
  const { label, description, completed, action } = requirement;

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3 transition-colors",
        completed ? "border-success/30 bg-success/5" : "bg-muted/30"
      )}
    >
      {completed ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
      ) : (
        <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn("font-medium text-sm", completed && "text-success")}
          >
            {label}
          </span>
          {!completed && action && (
            <Button asChild size="sm" variant="ghost">
              <Link href={action.href}>
                {action.label}
                <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          )}
        </div>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
    </li>
  );
}
