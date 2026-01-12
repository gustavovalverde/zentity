/**
 * Liveness detection feedback components.
 *
 * These components implement iProov-style visual feedback
 * for face positioning and challenge guidance.
 */

// Legacy/shared UI components
// biome-ignore lint/performance/noBarrelFile: Intentional re-export for component library
export { AudioToggle, FeedbackToggleGroup } from "./audio-toggle";
export { CameraView } from "./camera-view";
export {
  ChallengeBanner,
  type ChallengeType,
  CountdownOverlay,
  StatusBadge,
} from "./challenge-banner";
export {
  DirectionalNudge,
  DirectionalNudgeContainer,
  type NudgeDirection,
} from "./directional-nudge";
export { LivenessFlow } from "./liveness-flow";
// Server-authoritative provider and hooks
export {
  type ChallengeState,
  type FaceBox,
  LivenessProvider,
  type LivenessProviderProps,
  useLiveness,
  useLivenessChallenge,
  useLivenessContext,
  useLivenessFace,
  useLivenessPhase,
} from "./liveness-provider";
export { OvalFrame, type OvalFrameStatus } from "./oval-frame";
export {
  deriveQualityIssue,
  QualityAlert,
  type QualityIssue,
} from "./quality-alert";
export { ScreenReaderAnnouncer } from "./screen-reader-announcer";
export { ChallengeSuccessFlash, SuccessAnimation } from "./success-animation";
