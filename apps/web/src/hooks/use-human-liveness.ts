"use client";

import type { Config, Human } from "@vladmandic/human";

import { useEffect, useRef, useState } from "react";

// Models are served locally from the Next.js route `/human-models/*`
const MODEL_BASE = "/human-models";

const clientConfig: Partial<Config> = {
  modelBasePath: MODEL_BASE,
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

export function useHumanLiveness(enabled: boolean) {
  const humanRef = useRef<Human | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (!enabled || ready || humanRef.current) {
        return;
      }
      try {
        const mod = await import("@vladmandic/human");
        const human = new mod.Human(clientConfig);
        const loadPromise = human.load();
        const warmPromise = loadPromise.then(() => human.warmup());
        // Surface a helpful error if models hang for too long.
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  "Model load timeout. Check /human-models/* is reachable."
                )
              ),
            90_000
          )
        );
        await Promise.race([warmPromise, timeoutPromise]);
        if (!cancelled) {
          humanRef.current = human;
          setReady(true);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    }
    init().catch(() => {
      // Error handled via setError() in try block
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, ready]);

  return { human: humanRef.current, ready, error };
}
