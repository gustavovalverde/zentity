"use client";

import { authClient } from "@/lib/auth/auth-client";

/**
 * Ensures a session exists, creating an anonymous one if needed.
 * Used during sign-up when passkey registration requires a user context.
 */
export async function ensureAuthSession() {
  const existing = await authClient.getSession();
  if (existing.data?.user?.id) {
    return existing.data;
  }

  const anonymous = await authClient.signIn.anonymous();
  if (anonymous?.error) {
    throw new Error(
      anonymous.error.message || "Unable to start anonymous session."
    );
  }

  const updated = await authClient.getSession();
  if (!updated.data?.user?.id) {
    throw new Error("Unable to start anonymous session.");
  }
  return updated.data;
}
