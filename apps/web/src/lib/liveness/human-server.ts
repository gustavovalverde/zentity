import "server-only";

import type { Config, Human } from "@vladmandic/human";

import util from "node:util";

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

// Mutex for detection calls - TensorFlow.js doesn't handle concurrent inference well
// and can deadlock when multiple detect() calls run simultaneously on the same model.
let detectionLock: Promise<void> = Promise.resolve();

export async function getHumanServer(): Promise<Human> {
  if (humanInstance) return humanInstance;
  if (!initPromise) {
    initPromise = (async () => {
      // Load TensorFlow native backend only on the server.
      await import("@tensorflow/tfjs-node");
      const mod = await import("@vladmandic/human");
      const human = new mod.Human(serverConfig);
      await human.load();
      await human.warmup();
      humanInstance = human;
      return human;
    })();
  }
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
  // decodeImage returns a 3D or 4D tensor (height, width, channels)
  const tensor = tf.node.decodeImage(buffer, 3);
  return tensor;
}

/**
 * Create a deferred promise with external resolve control.
 */
function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Run Human.js detection on a base64 image (server-side).
 * Uses a mutex to prevent concurrent detection calls which can deadlock TensorFlow.js.
 */
export async function detectFromBase64(dataUrl: string) {
  // Acquire lock - wait for any pending detection to complete
  const previousLock = detectionLock;
  const { promise: currentLock, resolve: releaseLock } = createDeferred();
  detectionLock = currentLock;

  await previousLock;

  let tensor: TfTensor | null = null;
  try {
    const human = await getHumanServer();
    tensor = await decodeBase64Image(dataUrl);
    return await human.detect(tensor);
  } finally {
    // Dispose tensor to prevent memory leaks
    try {
      tensor?.dispose();
    } catch {
      // ignore dispose errors
    }
    // Release lock for next detection
    releaseLock();
  }
}
