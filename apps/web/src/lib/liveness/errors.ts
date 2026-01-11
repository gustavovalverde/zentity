/**
 * Liveness error types following AWS Amplify FaceLivenessDetector patterns.
 * Provides granular error classification with recovery actions.
 */

export const LivenessErrorState = {
  // Connection errors
  CONNECTION_TIMEOUT: "connection_timeout",
  WEBSOCKET_ERROR: "websocket_error",

  // Camera errors
  CAMERA_ACCESS_ERROR: "camera_access_error",
  CAMERA_FRAMERATE_ERROR: "camera_framerate_error",
  VIRTUAL_CAMERA_DETECTED: "virtual_camera_detected",

  // Face detection errors
  FACE_DISTANCE_ERROR: "face_distance_error",
  MULTIPLE_FACES_ERROR: "multiple_faces_error",
  FACE_NOT_CENTERED: "face_not_centered",

  // Session errors
  SESSION_TIMEOUT: "session_timeout",
  CHALLENGE_TIMEOUT: "challenge_timeout",
  SESSION_EXPIRED: "session_expired",
  MAX_RETRIES_EXCEEDED: "max_retries_exceeded",

  // Verification errors
  ANTISPOOF_FAILED: "antispoof_failed",
  LIVENESS_FAILED: "liveness_failed",

  // Orientation errors
  MOBILE_LANDSCAPE_ERROR: "mobile_landscape_error",

  // Runtime errors
  RUNTIME_ERROR: "runtime_error",
  SERVER_ERROR: "server_error",
  DETECTION_DEGRADED: "detection_degraded",
} as const;

export type LivenessErrorState =
  (typeof LivenessErrorState)[keyof typeof LivenessErrorState];

export type RecoveryType =
  | "retry"
  | "change_camera"
  | "adjust_position"
  | "adjust_lighting"
  | "rotate_device"
  | "none";

export interface RecoveryAction {
  type: RecoveryType;
  /** Number of automatic retries before showing error UI */
  autoRetryCount?: number;
  /** User-facing recovery instruction */
  message: string;
}

export interface LivenessError {
  state: LivenessErrorState;
  message: string;
  recovery: RecoveryAction;
  canRetry: boolean;
  details?: unknown;
}

type ErrorConfigEntry = Omit<LivenessError, "state" | "details">;

export const ERROR_CONFIG: Record<LivenessErrorState, ErrorConfigEntry> = {
  // Connection errors
  [LivenessErrorState.CONNECTION_TIMEOUT]: {
    message: "Connection timed out. Check your network.",
    recovery: { type: "retry", autoRetryCount: 2, message: "Trying again..." },
    canRetry: true,
  },
  [LivenessErrorState.WEBSOCKET_ERROR]: {
    message: "Connection error occurred.",
    recovery: { type: "retry", autoRetryCount: 1, message: "Reconnecting..." },
    canRetry: true,
  },

  // Camera errors
  [LivenessErrorState.CAMERA_ACCESS_ERROR]: {
    message: "Camera access denied.",
    recovery: {
      type: "none",
      message: "Enable camera access in browser settings.",
    },
    canRetry: false,
  },
  [LivenessErrorState.CAMERA_FRAMERATE_ERROR]: {
    message: "Camera frame rate too low for reliable detection.",
    recovery: {
      type: "change_camera",
      message: "Try a different camera or close other apps.",
    },
    canRetry: true,
  },
  [LivenessErrorState.VIRTUAL_CAMERA_DETECTED]: {
    message: "Virtual camera detected.",
    recovery: {
      type: "change_camera",
      message: "Please use a physical camera for verification.",
    },
    canRetry: true,
  },

  // Face detection errors
  [LivenessErrorState.FACE_DISTANCE_ERROR]: {
    message: "Face is too close or too far.",
    recovery: {
      type: "adjust_position",
      message: "Move to arm's length from the camera.",
    },
    canRetry: true,
  },
  [LivenessErrorState.MULTIPLE_FACES_ERROR]: {
    message: "Multiple faces detected.",
    recovery: {
      type: "adjust_position",
      message: "Ensure only one face is visible.",
    },
    canRetry: true,
  },
  [LivenessErrorState.FACE_NOT_CENTERED]: {
    message: "Face not centered in frame.",
    recovery: {
      type: "adjust_position",
      message: "Center your face in the oval guide.",
    },
    canRetry: true,
  },

  // Session errors
  [LivenessErrorState.SESSION_TIMEOUT]: {
    message: "Session timed out.",
    recovery: { type: "retry", autoRetryCount: 1, message: "Starting over..." },
    canRetry: true,
  },
  [LivenessErrorState.CHALLENGE_TIMEOUT]: {
    message: "Challenge timed out.",
    recovery: { type: "retry", autoRetryCount: 1, message: "Try again..." },
    canRetry: true,
  },
  [LivenessErrorState.SESSION_EXPIRED]: {
    message: "Your session has expired.",
    recovery: { type: "retry", message: "Please start over." },
    canRetry: true,
  },
  [LivenessErrorState.MAX_RETRIES_EXCEEDED]: {
    message: "Maximum attempts exceeded.",
    recovery: { type: "none", message: "Please try again later." },
    canRetry: false,
  },

  // Verification errors
  [LivenessErrorState.ANTISPOOF_FAILED]: {
    message: "Could not verify you are a real person.",
    recovery: {
      type: "adjust_lighting",
      message: "Try better lighting and remove glasses.",
    },
    canRetry: true,
  },
  [LivenessErrorState.LIVENESS_FAILED]: {
    message: "Liveness check failed.",
    recovery: { type: "retry", message: "Please try again." },
    canRetry: true,
  },

  // Orientation errors
  [LivenessErrorState.MOBILE_LANDSCAPE_ERROR]: {
    message: "Please rotate to portrait mode.",
    recovery: {
      type: "rotate_device",
      message: "Liveness works best in portrait orientation.",
    },
    canRetry: true,
  },

  // Runtime errors
  [LivenessErrorState.RUNTIME_ERROR]: {
    message: "An unexpected error occurred.",
    recovery: { type: "retry", message: "Please try again." },
    canRetry: true,
  },
  [LivenessErrorState.SERVER_ERROR]: {
    message: "Server error occurred.",
    recovery: { type: "retry", autoRetryCount: 1, message: "Retrying..." },
    canRetry: true,
  },
  [LivenessErrorState.DETECTION_DEGRADED]: {
    message: "Having trouble processing frames.",
    recovery: {
      type: "adjust_lighting",
      message: "Try adjusting lighting or camera position.",
    },
    canRetry: true,
  },
};

/**
 * Create a structured liveness error from an error state.
 */
export function createLivenessError(
  state: LivenessErrorState,
  details?: unknown
): LivenessError {
  const config = ERROR_CONFIG[state];
  return { state, ...config, details };
}

/**
 * Map legacy string error codes to typed error states.
 * Provides backwards compatibility with existing error handling.
 */
export function mapLegacyErrorCode(code: string): LivenessErrorState {
  const mapping: Record<string, LivenessErrorState> = {
    timeout: LivenessErrorState.SESSION_TIMEOUT,
    challenge_timeout: LivenessErrorState.CHALLENGE_TIMEOUT,
    no_session: LivenessErrorState.SESSION_EXPIRED,
    session_expired: LivenessErrorState.SESSION_EXPIRED,
    detection_degraded: LivenessErrorState.DETECTION_DEGRADED,
    antispoof_failed: LivenessErrorState.ANTISPOOF_FAILED,
    liveness_failed: LivenessErrorState.LIVENESS_FAILED,
    max_retries: LivenessErrorState.MAX_RETRIES_EXCEEDED,
  };

  return mapping[code] ?? LivenessErrorState.RUNTIME_ERROR;
}

/**
 * Check if an error state supports automatic retry.
 */
export function supportsAutoRetry(state: LivenessErrorState): boolean {
  const config = ERROR_CONFIG[state];
  return (config.recovery.autoRetryCount ?? 0) > 0;
}

/**
 * Get the number of automatic retries for an error state.
 */
export function getAutoRetryCount(state: LivenessErrorState): number {
  return ERROR_CONFIG[state].recovery.autoRetryCount ?? 0;
}
