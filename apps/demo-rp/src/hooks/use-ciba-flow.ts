"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CibaState =
  | "idle"
  | "requesting"
  | "polling"
  | "approved"
  | "denied"
  | "expired"
  | "error";

interface CibaFlowState {
  authReqId: string | null;
  error: string | null;
  reset: () => void;
  startFlow: (params: {
    loginHint: string;
    scope: string;
    bindingMessage?: string;
    authorizationDetails?: string;
  }) => Promise<void>;
  state: CibaState;
  tokens: Record<string, unknown> | null;
}

const DEFAULT_POLL_INTERVAL = 5;
const CLIENT_EXPIRE_MS = 5 * 60 * 1000;

export function useCibaFlow(providerId: string): CibaFlowState {
  const [state, setState] = useState<CibaState>("idle");
  const [authReqId, setAuthReqId] = useState<string | null>(null);
  const [tokens, setTokens] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expireRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef(DEFAULT_POLL_INTERVAL);

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
    setAuthReqId(null);
    setTokens(null);
    setError(null);
    intervalRef.current = DEFAULT_POLL_INTERVAL;
  }, [stopPolling]);

  const pollToken = useCallback(
    (reqId: string) => {
      const poll = async () => {
        try {
          const res = await fetch("/api/ciba", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "token",
              providerId,
              authReqId: reqId,
            }),
          });

          const body = (await res.json()) as Record<string, unknown>;

          if (res.ok && body.access_token) {
            stopPolling();
            setTokens(body);
            setState("approved");
            return;
          }

          const errorCode = body.error as string | undefined;

          if (errorCode === "authorization_pending") {
            return; // Keep polling
          }
          if (errorCode === "slow_down") {
            // Increase interval
            stopPolling();
            intervalRef.current += 5;
            pollRef.current = setInterval(poll, intervalRef.current * 1000);
            return;
          }
          if (errorCode === "access_denied") {
            stopPolling();
            setState("denied");
            return;
          }
          if (errorCode === "expired_token") {
            stopPolling();
            setState("expired");
            return;
          }

          // Unknown error
          stopPolling();
          setError(
            (body.error_description as string) ?? "Token request failed"
          );
          setState("error");
        } catch {
          // Network error — retry on next interval
        }
      };

      // Poll immediately, then at interval
      poll();
      pollRef.current = setInterval(poll, intervalRef.current * 1000);

      // Client-side expiry fallback
      expireRef.current = setTimeout(() => {
        stopPolling();
        setState("expired");
      }, CLIENT_EXPIRE_MS);
    },
    [providerId, stopPolling]
  );

  const startFlow = useCallback(
    async (params: {
      loginHint: string;
      scope: string;
      bindingMessage?: string;
      authorizationDetails?: string;
    }) => {
      setState("requesting");
      setError(null);

      try {
        const res = await fetch("/api/ciba", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "authorize",
            providerId,
            loginHint: params.loginHint,
            scope: params.scope,
            bindingMessage: params.bindingMessage,
            authorizationDetails: params.authorizationDetails,
          }),
        });

        const body = (await res.json()) as Record<string, unknown>;

        if (!res.ok) {
          setError(
            (body.error_description as string) ?? "Authorization request failed"
          );
          setState("error");
          return;
        }

        const reqId = body.auth_req_id as string;
        const interval = (body.interval as number) ?? DEFAULT_POLL_INTERVAL;
        intervalRef.current = interval;

        setAuthReqId(reqId);
        setState("polling");
        pollToken(reqId);
      } catch {
        setError("Network error");
        setState("error");
      }
    },
    [providerId, pollToken]
  );

  // Cleanup on unmount
  useEffect(() => stopPolling, [stopPolling]);

  return { state, authReqId, tokens, error, startFlow, reset };
}
