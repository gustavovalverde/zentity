"use client";

import { useState, useSyncExternalStore } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  getCachedGreetingName,
  getProfileSnapshot,
  getServerProfileSnapshot,
  subscribeToProfileCache,
} from "@/lib/privacy/secrets/profile";

const WHITESPACE_RE = /\s+/;

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
  const [isInitialLoad, _setIsInitialLoad] = useState(false);

  const profile = useSyncExternalStore(
    subscribeToProfileCache,
    getProfileSnapshot,
    getServerProfileSnapshot
  );

  if (isInitialLoad && !profile) {
    return <Skeleton className="inline-block h-6 w-24 align-baseline" />;
  }

  // Extract just the first word of the given name for a casual greeting.
  const firstName = profile?.firstName ?? getCachedGreetingName();
  const givenName = firstName?.split(WHITESPACE_RE)[0] || fallback;

  return <span>{givenName}</span>;
}
