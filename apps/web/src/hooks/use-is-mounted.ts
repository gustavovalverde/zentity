"use client";

/**
 * useIsMounted Hook
 *
 * Prevents hydration mismatches by returning false during SSR and true after client mount.
 * Use this when rendering components that depend on client-only state (wallet connection, etc.).
 *
 * @example
 * ```tsx
 * function WalletStatus() {
 *   const isMounted = useIsMounted();
 *   const { address } = useAccount();
 *
 *   // Prevent hydration mismatch - server has no wallet state
 *   if (!isMounted) return <Skeleton />;
 *
 *   return <span>{address}</span>;
 * }
 * ```
 */
import { useEffect, useState } from "react";

export function useIsMounted(): boolean {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return isMounted;
}
