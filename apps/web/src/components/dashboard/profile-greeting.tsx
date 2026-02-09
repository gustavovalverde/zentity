"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

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
 * Defers sessionStorage read to after hydration to avoid mismatch.
 */
export function ProfileGreetingName({
  fallback = "User",
}: Readonly<{
  fallback?: string;
}>) {
  const [greetingName, setGreetingName] = useState<string | null>(null);

  const profile = useSyncExternalStore(
    subscribeToProfileCache,
    getProfileSnapshot,
    getServerProfileSnapshot
  );

  useEffect(() => {
    if (!profile?.firstName) {
      setGreetingName(getCachedGreetingName());
    }
  }, [profile?.firstName]);

  const firstName = profile?.firstName ?? greetingName;
  const givenName = firstName?.split(WHITESPACE_RE)[0] || fallback;

  return <span>{givenName}</span>;
}
