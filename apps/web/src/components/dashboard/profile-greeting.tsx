"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { hasCachedPasskeyUnlock } from "@/lib/privacy/credentials";
import {
  getProfileSnapshot,
  getServerProfileSnapshot,
  getStoredProfile,
  subscribeToProfileCache,
} from "@/lib/privacy/secrets/profile";

/**
 * Displays the user's first name from their passkey-encrypted profile.
 * Uses useSyncExternalStore to subscribe to the module-level cache,
 * ensuring all instances update when the profile is fetched.
 * Shows a skeleton during initial load to prevent "User" → actual name flash.
 */
export function ProfileGreetingName({
  fallback = "User",
}: Readonly<{
  fallback?: string;
}>) {
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const attemptedUnlockRef = useRef(false);

  // Subscribe to profile cache changes - all instances share the same cache
  const profile = useSyncExternalStore(
    subscribeToProfileCache,
    getProfileSnapshot,
    getServerProfileSnapshot
  );

  // Note: No effect needed to sync isInitialLoad with profile.
  // When profile loads, the condition `isInitialLoad && !profile` already evaluates to false.
  // Adding a sync effect would cause an unnecessary extra render.

  // Trigger a fetch on mount if no profile is cached
  useEffect(() => {
    if (!profile) {
      // Only auto-unlock when it can succeed without prompting the user.
      // (Prevents unexpected WebAuthn prompts when entering the dashboard.)
      if (!hasCachedPasskeyUnlock()) {
        setIsInitialLoad(false);
        return;
      }
      if (attemptedUnlockRef.current) {
        return;
      }
      attemptedUnlockRef.current = true;
      let isCancelled = false;
      // Fire and forget - the subscription will pick up the result
      getStoredProfile()
        .catch(() => {
          // Errors are expected if the user hasn't completed account setup yet
        })
        .finally(() => {
          // After fetch attempt completes (success or fail), stop showing skeleton
          if (!isCancelled) {
            setIsInitialLoad(false);
          }
        });

      return () => {
        isCancelled = true;
      };
    }
  }, [profile]);

  // Show skeleton during initial load to avoid "User" flash
  if (isInitialLoad && !profile) {
    return <Skeleton className="inline-block h-6 w-24 align-baseline" />;
  }

  return <span>{profile?.firstName || fallback}</span>;
}
