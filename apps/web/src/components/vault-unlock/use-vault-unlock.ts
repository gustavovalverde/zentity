"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  classifyVaultError,
  VAULT_ERRORS,
  type VaultState,
} from "@/components/vault-unlock/vault-unlock";
import {
  getStoredProfile,
  type ProfileSecretPayload,
  resetProfileSecretCache,
} from "@/lib/privacy/secrets/profile";

// ── Types ──────────────────────────────────────────────────

export interface IdentityIntentState {
  expiresAt: number;
  scopeKey: string;
  token: string;
}

interface UseVaultUnlockOptions {
  active: boolean;
  fetchIntentToken: () => Promise<{
    intent_token: string;
    expires_at: number;
  }>;
  logTag: string;
  scopeKey: string;
}

export interface UseVaultUnlockReturn {
  clearIntent: () => void;
  fetchIdentityIntent: () => Promise<void>;
  handleProfileLoaded: (profile: ProfileSecretPayload) => void;
  handleVaultError: (err: unknown) => void;
  hasValidIdentityIntent: boolean;
  identityIntent: IdentityIntentState | null;
  intentError: string | null;
  intentLoading: boolean;
  loadProfilePasskey: () => Promise<void>;
  profileRef: React.RefObject<ProfileSecretPayload | null>;
  resetToGesture: () => void;
  vaultState: VaultState;
}

// ── Helpers ────────────────────────────────────────────────

const INTENT_EXPIRY_GRACE_MS = 2000;

export async function fetchIntentFromEndpoint(
  url: string,
  body: Record<string, unknown>
): Promise<{ intent_token: string; expires_at: number }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await response.json().catch(() => null)) as {
    intent_token?: string;
    expires_at?: number;
    error?: string;
  } | null;

  if (!response.ok) {
    throw new Error(data?.error || "Unable to prepare identity consent.");
  }

  if (
    !data ||
    typeof data.intent_token !== "string" ||
    typeof data.expires_at !== "number"
  ) {
    throw new Error("Identity consent token response was invalid.");
  }

  return { intent_token: data.intent_token, expires_at: data.expires_at };
}

// ── Hook ───────────────────────────────────────────────────

export function useVaultUnlock({
  logTag,
  scopeKey,
  active,
  fetchIntentToken,
}: UseVaultUnlockOptions): UseVaultUnlockReturn {
  const [vaultState, setVaultState] = useState<VaultState>({ status: "idle" });
  const profileRef = useRef<ProfileSecretPayload | null>(null);
  const [identityIntent, setIdentityIntent] =
    useState<IdentityIntentState | null>(null);
  const [intentLoading, setIntentLoading] = useState(false);
  const [intentError, setIntentError] = useState<string | null>(null);

  const hasValidIdentityIntent = useMemo(() => {
    if (!identityIntent) {
      return false;
    }
    if (identityIntent.scopeKey !== scopeKey) {
      return false;
    }
    return (
      identityIntent.expiresAt * 1000 > Date.now() + INTENT_EXPIRY_GRACE_MS
    );
  }, [identityIntent, scopeKey]);

  const handleProfileLoaded = useCallback((profile: ProfileSecretPayload) => {
    profileRef.current = profile;
    setIntentError(null);
    setIdentityIntent(null);
    setVaultState({ status: "loaded" });
  }, []);

  const handleVaultError = useCallback(
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      let name: string = typeof err;
      if (err instanceof DOMException) {
        name = `DOMException.${err.name}`;
      } else if (err instanceof Error) {
        name = err.constructor.name;
      }
      console.error(`[${logTag}] Vault unlock failed (${name}): ${msg}`);
      profileRef.current = null;
      setIdentityIntent(null);
      setIntentError(null);
      setVaultState({ status: "error", error: classifyVaultError(err) });
    },
    [logTag]
  );

  const loadProfilePasskey = useCallback(async () => {
    setVaultState({ status: "loading" });
    try {
      const profile = await getStoredProfile();
      if (profile) {
        handleProfileLoaded(profile);
      } else {
        profileRef.current = null;
        const { title, remedy } = VAULT_ERRORS.not_enrolled;
        setVaultState({
          status: "not_enrolled",
          error: { category: "not_enrolled", title, remedy },
        });
      }
    } catch (err) {
      handleVaultError(err);
    }
  }, [handleProfileLoaded, handleVaultError]);

  const fetchIdentityIntent = useCallback(async () => {
    setIntentLoading(true);
    setIntentError(null);
    try {
      const result = await fetchIntentToken();
      setIdentityIntent({
        token: result.intent_token,
        expiresAt: result.expires_at,
        scopeKey,
      });
    } catch (err) {
      setIdentityIntent(null);
      setIntentError(
        err instanceof Error
          ? err.message
          : "Unable to prepare identity consent."
      );
    } finally {
      setIntentLoading(false);
    }
  }, [fetchIntentToken, scopeKey]);

  const resetToGesture = useCallback(() => {
    setVaultState({ status: "gesture_required" });
  }, []);

  const clearIntent = useCallback(() => {
    setIdentityIntent(null);
  }, []);

  useEffect(() => {
    if (!active) {
      profileRef.current = null;
      setIdentityIntent(null);
      setIntentError(null);
      setIntentLoading(false);
      setVaultState({ status: "idle" });
      return;
    }

    resetProfileSecretCache();
    profileRef.current = null;
    setIdentityIntent(null);
    setIntentError(null);
    setIntentLoading(false);
    setVaultState({ status: "gesture_required" });
  }, [active]);

  useEffect(() => {
    if (!active || vaultState.status !== "loaded") {
      return;
    }
    if (hasValidIdentityIntent || intentLoading) {
      return;
    }
    fetchIdentityIntent().catch(() => undefined);
  }, [
    active,
    vaultState.status,
    hasValidIdentityIntent,
    intentLoading,
    fetchIdentityIntent,
  ]);

  return {
    vaultState,
    profileRef,
    identityIntent,
    intentLoading,
    intentError,
    hasValidIdentityIntent,
    handleProfileLoaded,
    handleVaultError,
    loadProfilePasskey,
    fetchIdentityIntent,
    resetToGesture,
    clearIntent,
  };
}
