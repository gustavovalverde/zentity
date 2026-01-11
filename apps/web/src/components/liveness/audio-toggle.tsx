"use client";

import { Volume2Icon, VolumeXIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/utils";

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
}: AudioToggleProps) {
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

interface FeedbackToggleGroupProps {
  /** Whether earcon audio is enabled */
  audioEnabled: boolean;
  /** Whether TTS speech is enabled */
  speechEnabled: boolean;
  /** Callback when audio is toggled */
  onAudioToggle: () => void;
  /** Callback when speech is toggled */
  onSpeechToggle: () => void;
  /** Optional additional class names */
  className?: string;
}

/**
 * Group of toggle buttons for controlling all feedback types.
 */
export function FeedbackToggleGroup({
  audioEnabled,
  speechEnabled,
  onAudioToggle,
  onSpeechToggle,
  className,
}: FeedbackToggleGroupProps) {
  // Combined state - if either is enabled, show as "audio enabled"
  const combinedEnabled = audioEnabled || speechEnabled;

  const handleToggle = () => {
    // Toggle both together for simpler UX
    if (combinedEnabled) {
      if (audioEnabled) {
        onAudioToggle();
      }
      if (speechEnabled) {
        onSpeechToggle();
      }
    } else {
      if (!audioEnabled) {
        onAudioToggle();
      }
      if (!speechEnabled) {
        onSpeechToggle();
      }
    }
  };

  return (
    <AudioToggle
      audioEnabled={combinedEnabled}
      className={className}
      disabledTooltip="Enable audio feedback"
      enabledTooltip="Mute audio feedback"
      onToggle={handleToggle}
    />
  );
}
