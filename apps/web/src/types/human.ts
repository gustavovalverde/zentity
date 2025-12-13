/**
 * Type definitions for Human.js face detection results.
 * Used across API routes and components for type safety.
 */

/**
 * Face bounding box - can be array format [x, y, width, height] or object format.
 */
export type FaceBoxArray = [number, number, number, number];

export interface FaceBoxObject {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FaceBox = FaceBoxArray | FaceBoxObject;

/**
 * Emotion scores object format (some Human.js versions).
 */
export interface EmotionScoresObject {
  angry?: number;
  disgust?: number;
  fear?: number;
  happy?: number;
  sad?: number;
  surprise?: number;
  neutral?: number;
}

/**
 * Emotion item in array format (Human.js default).
 */
export interface EmotionItem {
  score: number;
  emotion: string;
}

/**
 * Emotion scores - can be array format or object format depending on Human.js version.
 */
export type EmotionScores = EmotionItem[] | EmotionScoresObject;

/**
 * Gender detection scores.
 */
export interface GenderScores {
  male: number;
  female: number;
}

/**
 * Anti-spoofing detection result.
 */
export interface AntispoofResult {
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
export interface LivenessResult {
  live?: number;
  score?: number;
}

/**
 * Individual face detection result from Human.js.
 * Uses permissive types to handle null/undefined variations in the library.
 */
export interface HumanFaceResult {
  box?: FaceBox | null;
  boxRaw?: FaceBox | null;
  embedding?: EmbeddingData;
  descriptor?: EmbeddingData;
  description?: { embedding?: EmbeddingData } | EmbeddingData | null;
  emotion?: EmotionScores | null;
  gender?: string | null;
  genderScore?: number | null;
  age?: number | null;
  real?: number | null;
  live?: number | null;
  liveness?: LivenessResult | null;
  antispoof?: AntispoofResult | null;
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
  angle?: {
    yaw?: number;
    pitch?: number;
    roll?: number;
  } | null;
  mesh?: number[][] | null;
  annotations?: Record<string, number[][]> | null;
  // Allow additional properties from Human.js
  [key: string]: unknown;
}

/**
 * Full Human.js detection result.
 * Uses permissive types to handle variations in the library output.
 */
export interface HumanDetectionResult {
  face?: HumanFaceResult[] | null;
  body?: unknown[] | null;
  hand?: unknown[] | null;
  gesture?: unknown[] | null;
  object?: unknown[] | null;
  performance?: Record<string, number> | null;
  timestamp?: number;
  width?: number;
  height?: number;
  // Allow additional properties from Human.js
  [key: string]: unknown;
}

/**
 * Helper type for functions that process face results.
 */
export type FaceProcessor<T> = (face: HumanFaceResult) => T;

/**
 * Helper to normalize box format to object.
 */
export function normalizeBox(box: FaceBox | undefined): FaceBoxObject | null {
  if (!box) return null;
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
  if (!box) return 0;
  if (Array.isArray(box)) {
    return (box[2] ?? 0) * (box[3] ?? 0);
  }
  return (box.width ?? 0) * (box.height ?? 0);
}

/**
 * Helper to extract embedding as number array.
 */
export function normalizeEmbedding(emb: EmbeddingData): number[] | null {
  if (!emb) return null;
  if (Array.isArray(emb)) return emb;
  if (emb instanceof Float32Array) return Array.from(emb);
  if (typeof emb === "object" && "data" in emb && Array.isArray(emb.data)) {
    return emb.data.map((n) => Number(n));
  }
  return null;
}
