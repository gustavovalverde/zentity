"use client";

import { Volume2Icon, VolumeXIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/classname";

interface AudioToggleProps {
  /** Whether audio feedback is enabled */
  audioEnabled: boolean;
  /** Callback when audio is toggled */
  onToggle: () => void;
  /** Optional additional class names */
  className?: string;
  /** Tooltip text when audio is enabled */
  enabledTooltip?: string;
  /** Tooltip text when audio is disabled */
  disabledTooltip?: string;
}

/**
 * Toggle button for enabling/disabling liveness audio feedback.
 * Provides visual indication of current state with accessibility support.
 */
export function AudioToggle({
  audioEnabled,
  onToggle,
  className,
  enabledTooltip = "Mute audio",
  disabledTooltip = "Enable audio",
}: Readonly<AudioToggleProps>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={audioEnabled ? enabledTooltip : disabledTooltip}
          aria-pressed={audioEnabled}
          className={cn(
            "transition-colors",
            audioEnabled ? "text-foreground" : "text-muted-foreground",
            className
          )}
          onClick={onToggle}
          size="icon"
          type="button"
          variant="ghost"
        >
          {audioEnabled ? (
            <Volume2Icon className="size-5" />
          ) : (
            <VolumeXIcon className="size-5" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{audioEnabled ? enabledTooltip : disabledTooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}
