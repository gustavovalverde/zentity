"use client";

import { EyeIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { usePrivacyMode } from "@/components/providers/privacy-mode-provider";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function PrivacyToggle() {
  const { privacyMode, togglePrivacyMode } = usePrivacyMode();

  return (
    <div className="fixed right-4 bottom-4 z-50">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={
                privacyMode
                  ? "Show personal information"
                  : "Hide personal information"
              }
              onClick={togglePrivacyMode}
              size="icon"
              variant="outline"
            >
              <HugeiconsIcon
                icon={privacyMode ? ViewOffIcon : EyeIcon}
                size={20}
              />
            </Button>
          }
        />
        <TooltipContent side="left">
          {privacyMode ? "Show personal info" : "Hide personal info"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
