"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth/auth-client";
import {
  getProfileSnapshot,
  getServerProfileSnapshot,
  getStoredProfile,
  subscribeToProfileCache,
} from "@/lib/crypto/profile-secret";
import { hasCachedPasskeyUnlock } from "@/lib/crypto/secret-vault";

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
  const [lastLoginMethod, setLastLoginMethod] = useState<string | null>(null);
  const attemptedUnlockRef = useRef(false);

  // Subscribe to profile cache changes - all instances share the same cache
  const profile = useSyncExternalStore(
    subscribeToProfileCache,
    getProfileSnapshot,
    getServerProfileSnapshot
  );

  // Track when profile loads to transition from skeleton to content
  useEffect(() => {
    if (profile) {
      setIsInitialLoad(false);
    }
  }, [profile]);

  // Trigger a fetch on mount if no profile is cached
  useEffect(() => {
    if (!lastLoginMethod) {
      const lastUsed = authClient.getLastUsedLoginMethod?.() ?? "unknown";
      setLastLoginMethod(lastUsed);
      return;
    }
    if (!profile) {
      const shouldAutoUnlock =
        hasCachedPasskeyUnlock() || lastLoginMethod === "passkey";
      if (!shouldAutoUnlock) {
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
          // Errors are expected if user hasn't completed onboarding
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
  }, [profile, lastLoginMethod]);

  // Show skeleton during initial load to avoid "User" flash
  if (isInitialLoad && !profile) {
    return <Skeleton className="inline-block h-6 w-24 align-baseline" />;
  }

  return <span>{profile?.firstName || fallback}</span>;
}
