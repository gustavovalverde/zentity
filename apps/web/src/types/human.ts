/**
 * Type definitions for Human.js face detection results.
 * Used across API routes and components for type safety.
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
export type EmbeddingData =
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
export interface HumanFaceResult {
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
export interface HumanDetectionResult {
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

/**
 * Helper to normalize box format to object.
 */
function _normalizeBox(box: FaceBox | undefined): FaceBoxObject | null {
  if (!box) {
    return null;
  }
  if (Array.isArray(box)) {
    return {
      x: box[0],
      y: box[1],
      width: box[2],
      height: box[3],
    };
  }
  return box;
}

/**
 * Helper to get box area.
 */
export function getBoxArea(box: FaceBox | undefined): number {
  if (!box) {
    return 0;
  }
  if (Array.isArray(box)) {
    return (box[2] ?? 0) * (box[3] ?? 0);
  }
  return (box.width ?? 0) * (box.height ?? 0);
}

/**
 * Helper to extract embedding as number array.
 */
export function normalizeEmbedding(emb: EmbeddingData): number[] | null {
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
