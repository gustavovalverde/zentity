"use client";

import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ComplianceBadge } from "@/scenarios/route-scenario";

export function ComplianceBadges({
  compliance,
}: {
  compliance: ComplianceBadge[];
}) {
  return (
    <div className="flex flex-wrap gap-2 pt-3">
      {compliance
        .filter((b) => b.variant === "regulation")
        .map((badge) => (
          <Tooltip key={badge.label}>
            <TooltipTrigger
              className="cursor-default"
              onClick={(e) => e.preventDefault()}
            >
              <Badge
                className="gap-1 border-primary/30 text-primary hover:bg-primary/10"
                variant="outline"
              >
                {badge.label}
                <HugeiconsIcon
                  className="text-primary/50"
                  icon={InformationCircleIcon}
                  size={12}
                />
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs" side="bottom">
              {badge.detail}
            </TooltipContent>
          </Tooltip>
        ))}
      {compliance
        .filter((b) => b.variant === "mechanism")
        .map((badge) => (
          <Badge
            className="bg-primary/10 text-primary hover:bg-primary/15"
            key={badge.label}
            variant="secondary"
          >
            {badge.label}
          </Badge>
        ))}
    </div>
  );
}
