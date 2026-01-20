"use client";

/**
 * useCrossOriginIsolated Hook
 *
 * Detects whether the page has cross-origin isolation enabled, which enables
 * SharedArrayBuffer and multi-threaded WebAssembly execution. When cross-origin
 * isolation is unavailable, FHE key generation falls back to single-threaded mode,
 * resulting in significantly slower operations.
 *
 */
import { useEffect, useState } from "react";

export function useCrossOriginIsolated() {
  const [isIsolated, setIsIsolated] = useState<boolean | null>(null);

  useEffect(() => {
    setIsIsolated(globalThis.crossOriginIsolated ?? false);
  }, []);

  return {
    isIsolated,
    isLoading: isIsolated === null,
    hasThreadSupport: isIsolated === true,
  };
}
