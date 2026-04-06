"use client";

import { Eye, EyeOff } from "lucide-react";

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
    <Tooltip>
      <TooltipTrigger asChild>
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
          {privacyMode ? (
            <EyeOff className="size-5" />
          ) : (
            <Eye className="size-5" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {privacyMode ? "Show personal info" : "Hide personal info"}
      </TooltipContent>
    </Tooltip>
  );
}
