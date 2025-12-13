"use client";

import type { Config, Human } from "@vladmandic/human";
import { useEffect, useRef, useState } from "react";

// Models are served locally from the Next.js route `/human-models/*`
const MODEL_BASE = "/human-models";

const clientConfig: Partial<Config> = {
  modelBasePath: MODEL_BASE,
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

export function useHumanLiveness(enabled: boolean) {
  const humanRef = useRef<Human | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (!enabled || ready || humanRef.current) return;
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
                  "Model load timeout. Check /human-models/* is reachable.",
                ),
              ),
            90_000,
          ),
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
    void init();
    return () => {
      cancelled = true;
    };
  }, [enabled, ready]);

  return { human: humanRef.current, ready, error };
}
