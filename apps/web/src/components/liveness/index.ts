/**
 * Liveness detection feedback components.
 *
 * These components implement iProov-style visual feedback
 * for face positioning and challenge guidance.
 */

// biome-ignore lint/performance/noBarrelFile: Re-export of liveness UI components for convenient access
export { AudioToggle, FeedbackToggleGroup } from "./audio-toggle";
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
export { FullscreenCamera } from "./fullscreen-camera";
export { OvalFrame, type OvalFrameStatus } from "./oval-frame";
export {
  deriveQualityIssue,
  QualityAlert,
  type QualityIssue,
} from "./quality-alert";
export { ScreenReaderAnnouncer } from "./screen-reader-announcer";
export { ChallengeSuccessFlash, SuccessAnimation } from "./success-animation";
