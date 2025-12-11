type Meta = Record<string, unknown>;

const isDev = process.env.NODE_ENV === "development";

function logDev(_event: string, _payload?: Meta) {
  if (isDev && typeof console !== "undefined") {
  }
}

export function trackStep(stepNumber: number, stepName?: string) {
  logDev("step", { stepNumber, stepName });
}

export function trackError(scope: string, message: string, meta?: Meta) {
  logDev("error", { scope, message, ...meta });
}

export function trackCameraPermission(
  status: "granted" | "denied" | "prompt" | "checking",
) {
  logDev("camera_permission", { status });
}

export function trackDocResult(
  status: "verified" | "rejected" | "error",
  meta?: Meta,
) {
  logDev("document", { status, ...meta });
}

export function trackLiveness(
  status: "passed" | "failed" | "timeout",
  meta?: Meta,
) {
  logDev("liveness", { status, ...meta });
}

export function trackFaceMatch(
  status: "matched" | "no_match" | "error",
  meta?: Meta,
) {
  logDev("face_match", { status, ...meta });
}
