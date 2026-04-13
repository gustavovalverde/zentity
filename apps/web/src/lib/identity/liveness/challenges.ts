/**
 * Liveness flow types and challenge instructions.
 */

export type ChallengeType = "smile" | "turn_left" | "turn_right";

export interface ChallengeInfo {
  challengeType: ChallengeType;
  icon: string;
  index: number;
  instruction: string;
  timeoutSeconds: number;
  title: string;
  total: number;
}

export const CHALLENGE_INSTRUCTIONS: Record<
  ChallengeType,
  Omit<ChallengeInfo, "challengeType" | "index" | "total">
> = {
  smile: {
    title: "Smile",
    instruction: "Please smile!",
    icon: "smile",
    timeoutSeconds: 10,
  },
  turn_left: {
    title: "Turn Left",
    instruction: "Turn your head to the left",
    icon: "arrow-left",
    timeoutSeconds: 8,
  },
  turn_right: {
    title: "Turn Right",
    instruction: "Turn your head to the right",
    icon: "arrow-right",
    timeoutSeconds: 8,
  },
};

export interface FaceMatchResult {
  confidence: number;
  distance: number;
  error?: string | undefined;
  idFaceExtracted: boolean;
  idFaceImage?: string | undefined;
  matched: boolean;
  processingTimeMs: number;
  threshold: number;
}
