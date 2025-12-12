import type { HumanDetectionResult, HumanFaceResult } from "@/types/human";
import {
  type EmbeddingData,
  getBoxArea,
  normalizeEmbedding,
} from "@/types/human";

export type FacingDirection = "left" | "right" | "center";

function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function getPrimaryFace(result: unknown): HumanFaceResult | null {
  const res = result as HumanDetectionResult | null;
  const faces = Array.isArray(res?.face) ? res.face : [];
  return faces[0] ?? null;
}

export function getLargestFace(result: unknown): HumanFaceResult | null {
  const res = result as HumanDetectionResult | null;
  const faces = Array.isArray(res?.face) ? res.face : [];
  if (faces.length === 0) return null;

  return faces.reduce((best, face) => {
    const bestArea = getBoxArea(best?.box ?? undefined);
    const area = getBoxArea(face?.box ?? undefined);
    return area > bestArea ? face : best;
  }, faces[0]);
}

export function getGestureNames(result: unknown): string[] {
  const res = result as HumanDetectionResult | null;
  const gestures = Array.isArray(res?.gesture) ? res.gesture : [];
  return gestures
    .map((g) => {
      if (!g || typeof g !== "object") return null;
      const maybeGesture = (g as { gesture?: unknown }).gesture;
      const maybeName = (g as { name?: unknown }).name;
      if (typeof maybeGesture === "string") return maybeGesture;
      if (typeof maybeName === "string") return maybeName;
      return null;
    })
    .filter((n): n is string => typeof n === "string");
}

export function getHappyScore(face: HumanFaceResult | null): number {
  const emo = face?.emotion;
  if (!emo) return 0;
  if (Array.isArray(emo)) {
    const happy = emo.find(
      (e) =>
        typeof e === "object" && e !== null && ("emotion" in e || "score" in e),
    ) as { emotion?: string; score?: number } | undefined;
    const emotionName = happy?.emotion;
    if (emotionName !== "happy" && emotionName !== "Happy") return 0;
    return typeof happy?.score === "number" ? happy.score : 0;
  }
  if (typeof emo === "object") {
    const obj = emo as { happy?: unknown };
    return typeof obj.happy === "number" ? obj.happy : 0;
  }
  return 0;
}

export function getRealScore(face: HumanFaceResult | null): number {
  const val = face?.real ?? face?.antispoof?.real ?? face?.antispoof?.score;
  return typeof val === "number" ? val : 0;
}

export function getLiveScore(face: HumanFaceResult | null): number {
  const val = face?.live ?? face?.liveness?.live ?? face?.liveness?.score;
  return typeof val === "number" ? val : 0;
}

export function getYawDegrees(face: HumanFaceResult | null): number {
  const yawRad = face?.rotation?.angle?.yaw;
  if (typeof yawRad === "number") return radToDeg(yawRad);
  const yaw = face?.angle?.yaw;
  return typeof yaw === "number" ? yaw : 0;
}

export function getPitchDegrees(face: HumanFaceResult | null): number {
  const pitchRad = face?.rotation?.angle?.pitch;
  if (typeof pitchRad === "number") return radToDeg(pitchRad);
  const pitch = face?.angle?.pitch;
  return typeof pitch === "number" ? pitch : 0;
}

export function getRollDegrees(face: HumanFaceResult | null): number {
  const rollRad = face?.rotation?.angle?.roll;
  if (typeof rollRad === "number") return radToDeg(rollRad);
  const roll = face?.angle?.roll;
  return typeof roll === "number" ? roll : 0;
}

export function getFacingDirection(
  result: unknown,
  face: HumanFaceResult | null,
  thresholdDegrees = 10,
): FacingDirection {
  const gestureNames = getGestureNames(result);
  for (const name of gestureNames) {
    if (!name.startsWith("facing")) continue;
    if (name.includes("left")) return "left";
    if (name.includes("right")) return "right";
    return "center";
  }

  const yaw = getYawDegrees(face);
  if (yaw < -thresholdDegrees) return "left";
  if (yaw > thresholdDegrees) return "right";
  return "center";
}

export function getEmbeddingVector(
  face: HumanFaceResult | null,
): number[] | null {
  if (!face) return null;
  const emb =
    face.embedding ??
    face.descriptor ??
    (face.description &&
    typeof face.description === "object" &&
    "embedding" in face.description
      ? (face.description as { embedding?: unknown }).embedding
      : face.description);
  return normalizeEmbedding(emb as EmbeddingData);
}
