"use client";

import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth/auth-client";

/**
 * Session state for sign-up flow.
 * Tracks anonymous session data from Better Auth.
 */
export interface SignUpSessionState {
  /** User's email from session */
  email: string | null;
  /** User ID from session */
  userId: string | null;
  /** Whether the session is anonymous (not yet linked to passkey/password) */
  isAnonymous: boolean;
  /** Whether session has been fetched and is ready */
  isReady: boolean;
  /** Error message if session initialization failed */
  error: string | null;
}

/**
 * Ensures a session exists, creating an anonymous one if needed.
 * This is extracted to allow testing and reuse.
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

/**
 * Hook to manage sign-up session state.
 *
 * Automatically ensures an authenticated session exists on mount,
 * creating an anonymous session if needed. Provides session data
 * for the account creation step.
 *
 * @example
 * ```tsx
 * const { email, userId, isAnonymous, isReady, error } = useSignUpSession();
 *
 * if (!isReady) {
 *   return <Spinner />;
 * }
 *
 * if (error) {
 *   return <Alert variant="destructive">{error}</Alert>;
 * }
 * ```
 */
export function useSignUpSession(): SignUpSessionState {
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const fetchSessionData = async () => {
      try {
        const session = await ensureAuthSession();
        if (active) {
          setEmail(session.user.email);
          setUserId(session.user.id);
          setIsAnonymous(session.user.isAnonymous ?? false);
          setIsReady(true);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Failed to initialize session"
          );
        }
      }
    };

    fetchSessionData();

    return () => {
      active = false;
    };
  }, []);

  return { email, userId, isAnonymous, isReady, error };
}
