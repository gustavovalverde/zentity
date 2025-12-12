import "server-only";

import util from "node:util";
import type { Config, Human } from "@vladmandic/human";
import { HUMAN_MODELS_URL } from "./human-models-path";

// Polyfill for deprecated util.isNullOrUndefined (removed in Node.js 12+)
// Required by @tensorflow/tfjs-node internals
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
  face: {
    enabled: true,
    detector: { enabled: true, rotation: true },
    mesh: { enabled: true },
    description: { enabled: true },
    emotion: { enabled: true },
    antispoof: { enabled: true },
    liveness: { enabled: true },
  },
  gesture: { enabled: true },
  filter: { enabled: true },
};

let humanInstance: Human | null = null;
let initPromise: Promise<Human> | null = null;

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

export async function decodeBase64Image(dataUrl: string): Promise<TfTensor> {
  const tf = await import("@tensorflow/tfjs-node");
  const base64 = stripDataUrl(dataUrl);
  const buffer = Buffer.from(base64, "base64");
  // decodeImage returns a 3D or 4D tensor (height, width, channels)
  const tensor = tf.node.decodeImage(buffer, 3);
  return tensor;
}

/**
 * Run Human.js detection on a base64 image (server-side).
 */
export async function detectFromBase64(dataUrl: string) {
  const human = await getHumanServer();
  const tensor = await decodeBase64Image(dataUrl);
  try {
    const result = await human.detect(tensor);
    return result;
  } finally {
    // Dispose tensor to prevent memory leaks
    tensor.dispose();
  }
}
