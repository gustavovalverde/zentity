"use client";

import { useEffect, useState } from "react";

import { getStoredProfile } from "@/lib/crypto/profile-secret";

export function ProfileGreetingName({
  fallback = "User",
}: {
  fallback?: string;
}) {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getStoredProfile()
      .then((profile) => {
        if (!active) {
          return;
        }
        setName(profile?.firstName ?? null);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setName(null);
      });
    return () => {
      active = false;
    };
  }, []);

  return <span>{name || fallback}</span>;
}
