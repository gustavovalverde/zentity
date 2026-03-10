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
  exchangedTokens: Record<string, unknown> | null;
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
const PING_CHECK_INTERVAL = 2;
const CLIENT_EXPIRE_MS = 5 * 60 * 1000;

type PollResult =
  | { kind: "tokens"; tokens: Record<string, unknown> }
  | { kind: "pending" }
  | { kind: "slow_down" }
  | { kind: "terminal"; state: CibaState; message?: string };

function classifyPollResponse(
  status: number,
  body: Record<string, unknown>
): PollResult {
  if (status >= 200 && status < 300 && body.access_token) {
    return { kind: "tokens", tokens: body };
  }

  const errorCode = body.error as string | undefined;

  if (errorCode === "authorization_pending") {
    return { kind: "pending" };
  }
  if (errorCode === "slow_down") {
    return { kind: "slow_down" };
  }
  if (errorCode === "access_denied") {
    return { kind: "terminal", state: "denied" };
  }
  if (errorCode === "expired_token") {
    return { kind: "terminal", state: "expired" };
  }

  return {
    kind: "terminal",
    state: "error",
    message: (body.error_description as string) ?? "Token request failed",
  };
}

const MERCHANT_API = "https://merchant.example.com/api";

export function useCibaFlow(providerId: string): CibaFlowState {
  const [state, setState] = useState<CibaState>("idle");
  const [authReqId, setAuthReqId] = useState<string | null>(null);
  const [tokens, setTokens] = useState<Record<string, unknown> | null>(null);
  const [exchangedTokens, setExchangedTokens] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expireRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef(DEFAULT_POLL_INTERVAL);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (pingCheckRef.current) {
      clearInterval(pingCheckRef.current);
      pingCheckRef.current = null;
    }
    if (expireRef.current) {
      clearTimeout(expireRef.current);
      expireRef.current = null;
    }
  }, []);

  const exchangeToken = useCallback(
    async (accessToken: string) => {
      try {
        const res = await fetch("/api/ciba", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "token-exchange",
            providerId,
            accessToken,
            resource: MERCHANT_API,
            scope: "openid",
          }),
        });
        if (res.ok) {
          const body = (await res.json()) as Record<string, unknown>;
          setExchangedTokens(body);
        }
      } catch {
        // Non-critical — the CIBA token is still valid
      }
    },
    [providerId]
  );

  const reset = useCallback(() => {
    stopPolling();
    setState("idle");
    setAuthReqId(null);
    setTokens(null);
    setExchangedTokens(null);
    setError(null);
    intervalRef.current = DEFAULT_POLL_INTERVAL;
  }, [stopPolling]);

  const handlePollResult = useCallback(
    (result: PollResult, restartPoll: () => void) => {
      if (result.kind === "tokens") {
        stopPolling();
        setTokens(result.tokens);
        setState("approved");
        if (typeof result.tokens.access_token === "string") {
          exchangeToken(result.tokens.access_token);
        }
      } else if (result.kind === "slow_down") {
        restartPoll();
      } else if (result.kind === "terminal") {
        stopPolling();
        setState(result.state);
        if (result.message) {
          setError(result.message);
        }
      }
    },
    [stopPolling, exchangeToken]
  );

  const pollToken = useCallback(
    (reqId: string) => {
      const fetchTokens = async () => {
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
          const result = classifyPollResponse(res.status, body);
          handlePollResult(result, () => {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              intervalRef.current += 5;
              pollRef.current = setInterval(
                fetchTokens,
                intervalRef.current * 1000
              );
            }
          });
        } catch {
          // Network error — retry on next interval
        }
      };

      fetchTokens();
      pollRef.current = setInterval(fetchTokens, intervalRef.current * 1000);

      const checkPing = async () => {
        try {
          const res = await fetch("/api/ciba", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "check-ping", authReqId: reqId }),
          });
          const body = (await res.json()) as { received: boolean };
          if (body.received) {
            if (pingCheckRef.current) {
              clearInterval(pingCheckRef.current);
              pingCheckRef.current = null;
            }
            fetchTokens();
          }
        } catch {
          // Ignore — regular polling is the fallback
        }
      };
      pingCheckRef.current = setInterval(checkPing, PING_CHECK_INTERVAL * 1000);

      expireRef.current = setTimeout(() => {
        stopPolling();
        setState("expired");
      }, CLIENT_EXPIRE_MS);
    },
    [providerId, stopPolling, handlePollResult]
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

  return { state, authReqId, tokens, exchangedTokens, error, startFlow, reset };
}
