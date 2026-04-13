/**
 * Human.js face detection result types + score/direction extraction helpers.
 */

/**
 * Face bounding box - can be array format [x, y, width, height] or object format.
 */
type FaceBoxArray = [number, number, number, number];

interface FaceBoxObject {
  height: number;
  width: number;
  x: number;
  y: number;
}

type FaceBox = FaceBoxArray | FaceBoxObject;

/**
 * Emotion scores object format (some Human.js versions).
 */
interface EmotionScoresObject {
  angry?: number;
  disgust?: number;
  fear?: number;
  happy?: number;
  neutral?: number;
  sad?: number;
  surprise?: number;
}

/**
 * Emotion item in array format (Human.js default).
 */
interface EmotionItem {
  emotion: string;
  score: number;
}

/**
 * Emotion scores - can be array format or object format depending on Human.js version.
 */
type EmotionScores = EmotionItem[] | EmotionScoresObject;

/**
 * Anti-spoofing detection result.
 */
interface AntispoofResult {
  real?: number;
  score?: number;
}

/**
 * Embedding data - can be Float32Array, number array, or object with data property.
 */
type EmbeddingData =
  | Float32Array
  | number[]
  | { data: number[] }
  | null
  | undefined;

/**
 * Liveness detection result.
 */
interface LivenessResult {
  live?: number;
  score?: number;
}

/**
 * Individual face detection result from Human.js.
 * Uses permissive types to handle null/undefined variations in the library.
 */
interface HumanFaceResult {
  age?: number | null;
  angle?: {
    yaw?: number;
    pitch?: number;
    roll?: number;
  } | null;
  annotations?: Record<string, number[][]> | null;
  antispoof?: AntispoofResult | null;
  box?: FaceBox | null;
  boxRaw?: FaceBox | null;
  description?: { embedding?: EmbeddingData } | EmbeddingData | null;
  descriptor?: EmbeddingData;
  embedding?: EmbeddingData;
  emotion?: EmotionScores | null;
  gender?: string | null;
  genderScore?: number | null;
  live?: number | null;
  liveness?: LivenessResult | null;
  mesh?: number[][] | null;
  real?: number | null;
  rotation?: {
    angle?: {
      pitch?: number;
      yaw?: number;
      roll?: number;
    } | null;
    yaw?: number;
    pitch?: number;
    roll?: number;
    matrix?: unknown;
    gaze?: unknown;
  } | null;
  // Allow additional properties from Human.js
  [key: string]: unknown;
}

/**
 * Full Human.js detection result.
 * Uses permissive types to handle variations in the library output.
 */
interface HumanDetectionResult {
  body?: unknown[] | null;
  face?: HumanFaceResult[] | null;
  gesture?: unknown[] | null;
  hand?: unknown[] | null;
  height?: number;
  object?: unknown[] | null;
  performance?: Record<string, number> | null;
  timestamp?: number;
  width?: number;
  // Allow additional properties from Human.js
  [key: string]: unknown;
}

/** Area of a Human.js face bounding box, supporting both array and object formats. */
function getBoxArea(box: FaceBox | undefined): number {
  if (!box) {
    return 0;
  }
  if (Array.isArray(box)) {
    return (box[2] ?? 0) * (box[3] ?? 0);
  }
  return (box.width ?? 0) * (box.height ?? 0);
}

/** Extract a face embedding vector as a plain number[] regardless of container shape. */
function normalizeEmbedding(emb: EmbeddingData): number[] | null {
  if (!emb) {
    return null;
  }
  if (Array.isArray(emb)) {
    return emb;
  }
  if (emb instanceof Float32Array) {
    return Array.from(emb);
  }
  if (typeof emb === "object" && "data" in emb && Array.isArray(emb.data)) {
    return emb.data.map(Number);
  }
  return null;
}

type FacingDirection = "left" | "right" | "center";

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
  if (faces.length === 0) {
    return null;
  }

  const first = faces[0];
  if (!first) {
    return null;
  }
  return faces.reduce((best, face) => {
    const bestArea = getBoxArea(best?.box ?? undefined);
    const area = getBoxArea(face?.box ?? undefined);
    return area > bestArea ? face : best;
  }, first);
}

function getGestureNames(result: unknown): string[] {
  const res = result as HumanDetectionResult | null;
  const gestures = Array.isArray(res?.gesture) ? res.gesture : [];
  return gestures
    .map((g) => {
      if (!g || typeof g !== "object") {
        return null;
      }
      const maybeGesture = (g as { gesture?: unknown }).gesture;
      const maybeName = (g as { name?: unknown }).name;
      if (typeof maybeGesture === "string") {
        return maybeGesture;
      }
      if (typeof maybeName === "string") {
        return maybeName;
      }
      return null;
    })
    .filter((n): n is string => typeof n === "string");
}

export function getHappyScore(face: HumanFaceResult | null): number {
  const emo = face?.emotion;
  if (!emo) {
    return 0;
  }
  if (Array.isArray(emo)) {
    // Find the specific "happy" emotion entry, not just any emotion
    const happy = emo.find((e) => {
      if (typeof e !== "object" || e === null) {
        return false;
      }
      const emotionName = (e as { emotion?: string }).emotion;
      return (
        emotionName === "happy" ||
        emotionName === "Happy" ||
        emotionName === "happiness"
      );
    }) as { emotion?: string; score?: number } | undefined;
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
  if (typeof yawRad === "number") {
    return radToDeg(yawRad);
  }
  const yaw = face?.angle?.yaw;
  return typeof yaw === "number" ? yaw : 0;
}

export function getFacingDirection(
  result: unknown,
  face: HumanFaceResult | null,
  thresholdDegrees = 10
): FacingDirection {
  const gestureNames = getGestureNames(result);
  for (const name of gestureNames) {
    if (!name.startsWith("facing")) {
      continue;
    }
    if (name.includes("left")) {
      return "left";
    }
    if (name.includes("right")) {
      return "right";
    }
    return "center";
  }

  const yaw = getYawDegrees(face);
  if (yaw < -thresholdDegrees) {
    return "left";
  }
  if (yaw > thresholdDegrees) {
    return "right";
  }
  return "center";
}

export function getEmbeddingVector(
  face: HumanFaceResult | null
): number[] | null {
  if (!face) {
    return null;
  }
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
