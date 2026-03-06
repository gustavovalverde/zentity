"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type VpState =
  | "idle"
  | "creating"
  | "pending"
  | "verified"
  | "failed"
  | "expired";

interface VpFlowState {
  authorizationUri: string | null;
  createSession: (scenarioId: string) => Promise<void>;
  reset: () => void;
  result: Record<string, unknown> | null;
  sessionId: string | null;
  state: VpState;
}

const POLL_INTERVAL_MS = 2000;
const CLIENT_EXPIRE_MS = 5 * 60 * 1000;

export function useVpFlow(): VpFlowState {
  const [state, setState] = useState<VpState>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [authorizationUri, setAuthorizationUri] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expireRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (expireRef.current) {
      clearTimeout(expireRef.current);
      expireRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    setState("idle");
    setSessionId(null);
    setAuthorizationUri(null);
    setResult(null);
  }, [stopPolling]);

  const pollStatus = useCallback(
    (sid: string) => {
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(
            `/api/oid4vp/status?session_id=${encodeURIComponent(sid)}`
          );
          if (!res.ok) {
            return;
          }

          const data = (await res.json()) as {
            status: string;
            result: Record<string, unknown> | null;
          };

          if (data.status === "verified") {
            stopPolling();
            setResult(data.result);
            setState("verified");
          } else if (data.status === "failed") {
            stopPolling();
            setState("failed");
          } else if (data.status === "expired") {
            stopPolling();
            setState("expired");
          }
        } catch {
          // Retry on next interval
        }
      }, POLL_INTERVAL_MS);

      // Client-side expiry fallback
      expireRef.current = setTimeout(() => {
        stopPolling();
        setState("expired");
      }, CLIENT_EXPIRE_MS);
    },
    [stopPolling]
  );

  const createSession = useCallback(
    async (scenarioId: string) => {
      setState("creating");
      try {
        const res = await fetch("/api/oid4vp/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenarioId }),
        });

        if (!res.ok) {
          setState("failed");
          return;
        }

        const data = (await res.json()) as {
          sessionId: string;
          authorizationUri: string;
        };

        setSessionId(data.sessionId);
        setAuthorizationUri(data.authorizationUri);
        setState("pending");
        pollStatus(data.sessionId);
      } catch {
        setState("failed");
      }
    },
    [pollStatus]
  );

  // Cleanup on unmount
  useEffect(() => stopPolling, [stopPolling]);

  return { state, sessionId, authorizationUri, result, createSession, reset };
}
