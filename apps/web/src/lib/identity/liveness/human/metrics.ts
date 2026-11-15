/**
 * Score and direction helpers over Human.js `FaceResult`. Human only sets
 * `real`, `live`, and `rotation` when it computed them, so absent values
 * score 0.
 */
import type { FaceResult } from "@vladmandic/human";

type FacingDirection = "left" | "right" | "center";

export function getHappyScore(face: FaceResult): number {
  return face.emotion?.find((e) => e.emotion === "happy")?.score ?? 0;
}

export function getRealScore(face: FaceResult): number {
  return face.real ?? 0;
}

export function getLiveScore(face: FaceResult): number {
  return face.live ?? 0;
}

/** Head yaw in degrees; Human reports `rotation.angle.yaw` in radians. */
export function getYawDegrees(face: FaceResult): number {
  return ((face.rotation?.angle.yaw ?? 0) * 180) / Math.PI;
}

export function getFacingDirection(
  face: FaceResult,
  thresholdDegrees = 10
): FacingDirection {
  const yaw = getYawDegrees(face);
  if (yaw < -thresholdDegrees) {
    return "left";
  }
  if (yaw > thresholdDegrees) {
    return "right";
  }
  return "center";
}
