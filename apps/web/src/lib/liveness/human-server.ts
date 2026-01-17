import "server-only";

import type { Config, Human } from "@vladmandic/human";

import util from "node:util";

import { logger } from "@/lib/logging/logger";
import { recordLivenessDetectDuration } from "@/lib/observability/metrics";

import { HUMAN_MODELS_URL } from "./human-models-path";

// Polyfill for util.isNullOrUndefined required by @tensorflow/tfjs-node
const utilAny = util as unknown as {
  isNullOrUndefined?: (val: unknown) => boolean;
};
if (typeof utilAny.isNullOrUndefined !== "function") {
  utilAny.isNullOrUndefined = (val: unknown) =>
    val === null || val === undefined;
}

const serverConfig: Partial<Config> = {
  modelBasePath: HUMAN_MODELS_URL,
  backend: "tensorflow",
  async: true,
  debug: false,
  cacheSensitivity: 0.7, // Skip re-processing if frame changed <30% (reduces redundant inference)
  face: {
    enabled: true,
    detector: {
      enabled: true,
      rotation: false, // Disable rotated face detection (rarely needed, improves performance)
      return: false, // CRITICAL: Prevents tensor memory leaks across detection calls
      maxDetected: 1, // Only need one face for liveness
    },
    mesh: { enabled: true },
    iris: { enabled: true }, // For eye tracking in liveness
    description: { enabled: true }, // Needed for face embeddings
    emotion: { enabled: true },
    attention: { enabled: false }, // Not needed for gesture-based liveness
    antispoof: { enabled: true },
    liveness: { enabled: true },
  },
  body: { enabled: false }, // Not needed for face liveness
  hand: { enabled: false }, // Not needed for face liveness
  gesture: { enabled: false }, // Manual gesture detection via face metrics is more reliable
  object: { enabled: false }, // Not needed for face liveness
  segmentation: { enabled: false }, // Not needed for face liveness
  filter: {
    enabled: true,
    equalization: true, // Normalize lighting for consistent detection
  },
};

let humanInstance: Human | null = null;
let initPromise: Promise<Human> | null = null;

/**
 * Counting semaphore for limiting concurrent TensorFlow detections.
 * tfjs-node's native backend can handle limited concurrency safely,
 * but too many concurrent calls can exhaust GPU memory or cause contention.
 */
class Semaphore {
  private permits: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }
    // No permits available, wait in queue
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Pass permit directly to next waiter
      next();
    } else {
      // No waiters, return permit to pool
      this.permits++;
    }
  }
}

// Allow 2 concurrent detections by default. This is conservative but safe.
// Increase to 3-4 if testing shows no issues on your hardware.
const MAX_CONCURRENT_DETECTIONS = 2;
const detectionSemaphore = new Semaphore(MAX_CONCURRENT_DETECTIONS);

export function getHumanServer(): Promise<Human> {
  if (humanInstance) {
    return Promise.resolve(humanInstance);
  }
  initPromise ??= (async () => {
    // Load TensorFlow native backend only on the server.
    await import("@tensorflow/tfjs-node");
    const mod = await import("@vladmandic/human");
    const human = new mod.Human(serverConfig);
    await human.load();
    await human.warmup();
    humanInstance = human;
    return human;
  })();
  return initPromise;
}

export function stripDataUrl(input: string): string {
  const comma = input.indexOf(",");
  return comma >= 0 ? input.slice(comma + 1) : input;
}

/**
 * Decode a base64 data URL to a tensor for server-side Human.js detection.
 * tfjs-node cannot directly process base64 strings like the browser version.
 */
// TensorFlow tensor type from dynamic import
type TfTensor = Awaited<
  ReturnType<typeof import("@tensorflow/tfjs-node")["node"]["decodeImage"]>
>;

async function decodeBase64Image(dataUrl: string): Promise<TfTensor> {
  const tf = await import("@tensorflow/tfjs-node");
  const base64 = stripDataUrl(dataUrl);
  const buffer = Buffer.from(base64, "base64");
  return decodeBuffer(tf, buffer);
}

function decodeBuffer(
  tf: typeof import("@tensorflow/tfjs-node"),
  buffer: Buffer
): TfTensor {
  // decodeImage returns a 3D or 4D tensor (height, width, channels)
  return tf.node.decodeImage(buffer, 3);
}

/**
 * Run Human.js detection on a base64 image (server-side).
 * Uses a semaphore to limit concurrent detections and prevent resource exhaustion.
 */
export async function detectFromBase64(dataUrl: string) {
  const start = performance.now();
  let result: "ok" | "error" = "ok";

  await detectionSemaphore.acquire();

  let tensor: TfTensor | null = null;
  try {
    const human = await getHumanServer();
    tensor = await decodeBase64Image(dataUrl);
    return await human.detect(tensor);
  } catch (error) {
    result = "error";
    throw error;
  } finally {
    // Dispose tensor to prevent memory leaks
    try {
      tensor?.dispose();
    } catch {
      // ignore dispose errors
    }
    detectionSemaphore.release();
    recordLivenessDetectDuration(performance.now() - start, { result });
  }
}

/**
 * Run Human.js detection directly from a Buffer (server-side).
 * Skips base64 encoding overhead - use when you already have binary image data.
 * Uses the same semaphore as detectFromBase64 to limit concurrent detections.
 */
export async function detectFromBuffer(buffer: Buffer) {
  const start = performance.now();
  let result: "ok" | "error" = "ok";

  await detectionSemaphore.acquire();

  let tensor: TfTensor | null = null;
  try {
    const tf = await import("@tensorflow/tfjs-node");
    const human = await getHumanServer();
    tensor = decodeBuffer(tf, buffer);
    return await human.detect(tensor);
  } catch (error) {
    result = "error";
    throw error;
  } finally {
    // Dispose tensor to prevent memory leaks
    try {
      tensor?.dispose();
    } catch {
      // ignore dispose errors
    }
    detectionSemaphore.release();
    recordLivenessDetectDuration(performance.now() - start, { result });
  }
}

/**
 * Preload Human.js models on server startup.
 * Called from instrumentation.ts to eliminate cold start latency.
 */
export async function warmupHumanServer(): Promise<void> {
  const startTime = Date.now();
  await getHumanServer();
  logger.info(
    { durationMs: Date.now() - startTime },
    "Human.js models preloaded"
  );
}
