"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { baseSepolia } from "wagmi/chains";
import type {
  AccessOutcome,
  PohClaims,
  TraceEntry,
  X402FlowState,
  X402Resource,
} from "@/data/x402";
import { wagmiConfig } from "@/lib/wagmi-config";
import { createX402PaymentClient } from "@/lib/x402-client";

const STEP_DELAY = 1500;

let traceSeq = 0;
function makeId(): string {
  return `t-${++traceSeq}-${Date.now()}`;
}

function entry(partial: Omit<TraceEntry, "id" | "timestamp">): TraceEntry {
  return { id: makeId(), timestamp: Date.now(), ...partial };
}

interface UseX402FlowReturn {
  accessOutcome: AccessOutcome | null;
  accessResource: (resource: X402Resource, walletAddress?: string) => void;
  error: string | null;
  pohClaims: PohClaims | null;
  reset: () => void;
  selectedResource: X402Resource | null;
  state: X402FlowState;
  traces: TraceEntry[];
}

export function useX402Flow(): UseX402FlowReturn {
  const [state, setState] = useState<X402FlowState>("idle");
  const [traces, setTraces] = useState<TraceEntry[]>([]);
  const [pohClaims, setPohClaims] = useState<PohClaims | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessOutcome, setAccessOutcome] = useState<AccessOutcome | null>(
    null
  );
  const [selectedResource, setSelectedResource] = useState<X402Resource | null>(
    null
  );
  const { isConnected, address: accountAddress } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    abortedRef.current = true;
    setState("idle");
    setTraces([]);
    setPohClaims(null);
    setError(null);
    setAccessOutcome(null);
    setSelectedResource(null);
  }, [clearTimer]);

  useEffect(() => {
    return () => {
      clearTimer();
      abortedRef.current = true;
    };
  }, [clearTimer]);

  const push = useCallback(
    (t: TraceEntry) => setTraces((prev) => [...prev, t]),
    []
  );

  const delay = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        timerRef.current = setTimeout(resolve, ms);
      }),
    []
  );

  const accessResource = useCallback(
    async (resource: X402Resource, walletAddress?: string) => {
      clearTimer();
      abortedRef.current = false;
      setState("requesting");
      setTraces([]);
      setPohClaims(null);
      setError(null);
      setAccessOutcome(null);
      setSelectedResource(resource);

      try {
        // --- Step 1: Request resource → 402 ---
        push(
          entry({
            type: "request",
            method: "POST",
            url: resource.endpoint,
            headers: { "Content-Type": "application/json" },
            body: { resourceId: resource.id },
          })
        );

        const res402 = await fetch("/api/x402/access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resourceId: resource.id }),
        });
        const body402 = await res402.json();

        if (abortedRef.current) {
          return;
        }

        push(
          entry({
            type: "response",
            status: res402.status,
            statusText: res402.status === 402 ? "Payment Required" : "OK",
            body: body402,
          })
        );
        setState("got402");

        // --- Step 2: Sign x402 payment with connected wallet ---
        await delay(STEP_DELAY);
        if (abortedRef.current) {
          return;
        }

        let paymentHeaders: Record<string, string> | null = null;

        if (isConnected) {
          push(
            entry({
              type: "action",
              label: "Signing x402 payment",
              detail: `Wallet signs USDC transfer authorization on ${resource.network}`,
            })
          );

          try {
            // Switch wallet to Base Sepolia for x402 payment
            await switchChainAsync({ chainId: baseSepolia.id });
            const client = await getWalletClient(wagmiConfig, {
              chainId: baseSepolia.id,
              account: accountAddress,
            });
            const { httpClient } = createX402PaymentClient(client);
            const paymentRequired = httpClient.getPaymentRequiredResponse(
              (name: string) => res402.headers.get(name) ?? undefined,
              body402
            );
            const paymentPayload =
              await httpClient.createPaymentPayload(paymentRequired);
            paymentHeaders =
              httpClient.encodePaymentSignatureHeader(paymentPayload);

            const sig =
              paymentHeaders["PAYMENT-SIGNATURE"] ??
              paymentHeaders["X-PAYMENT"] ??
              "";
            push(
              entry({
                type: "response",
                status: 200,
                statusText: "Signed",
                body: {
                  scheme: "exact",
                  network: resource.network,
                  signature: `${sig.substring(0, 40)}...`,
                },
              })
            );
          } catch (e) {
            push(
              entry({
                type: "response",
                status: 400,
                statusText: "Payment signing failed",
                body: {
                  error: e instanceof Error ? e.message : "Unknown error",
                },
              })
            );
            // Continue without payment — server will reject if payment required
          }
        } else {
          push(
            entry({
              type: "action",
              label: "No wallet connected — skipping payment",
              detail:
                "Connect a Base Sepolia wallet with testnet USDC to make real payments",
            })
          );
        }

        // --- Step 3: For compliance tiers, obtain PoH token ---
        if (resource.requiredTier > 0) {
          await delay(STEP_DELAY);
          if (abortedRef.current) {
            return;
          }

          setState("obtainingPoh");
          push(
            entry({
              type: "action",
              label: "Obtaining Proof-of-Human token",
              detail:
                "POST /api/auth/oauth2/proof-of-human (DPoP-authenticated)",
            })
          );

          const pohRes = await fetch("/api/x402/poh", { method: "POST" });
          const pohBody = await pohRes.json();

          if (abortedRef.current) {
            return;
          }

          if (!pohRes.ok) {
            push(
              entry({
                type: "response",
                status: pohRes.status,
                statusText: "Error",
                body: pohBody,
              })
            );
            setError(
              pohBody.error_description ?? pohBody.error ?? "PoH failed"
            );
            setState("denied");
            return;
          }

          const claims = pohBody.claims as PohClaims;
          setPohClaims(claims);

          push(
            entry({
              type: "response",
              status: 200,
              statusText: "OK",
              body: {
                token: `${(pohBody.token as string).substring(0, 40)}...`,
                claims,
              },
            })
          );
          setState("gotPoh");

          // --- Step 4: Retry with payment + compliance ---
          await delay(STEP_DELAY);
          if (abortedRef.current) {
            return;
          }

          setState("retrying");
          push(
            entry({
              type: "action",
              label: "Retrying with payment + compliance proof",
              detail:
                "PAYMENT-SIGNATURE header + PoH token + DPoP binding verification",
            })
          );

          const retryHeaders: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (paymentHeaders) {
            Object.assign(retryHeaders, paymentHeaders);
          }

          push(
            entry({
              type: "request",
              method: "POST",
              url: resource.endpoint,
              headers: {
                ...retryHeaders,
                ...(paymentHeaders
                  ? { "PAYMENT-SIGNATURE": "(base64 signed)" }
                  : {}),
                Authorization: `PoH ${(pohBody.token as string).substring(0, 30)}...`,
              },
              body: {
                resourceId: resource.id,
                pohToken: "(attached)",
                ...(walletAddress ? { walletAddress } : {}),
              },
            })
          );

          const retryRes = await fetch("/api/x402/access", {
            method: "POST",
            headers: retryHeaders,
            body: JSON.stringify({
              resourceId: resource.id,
              pohToken: pohBody.token,
              walletAddress,
            }),
          });
          const retryBody = await retryRes.json();

          if (abortedRef.current) {
            return;
          }

          let retryStatusText = "Error";
          if (retryRes.status === 200) {
            retryStatusText = "OK";
          } else if (retryRes.status === 403) {
            retryStatusText = "Forbidden";
          }

          push(
            entry({
              type: "response",
              status: retryRes.status,
              statusText: retryStatusText,
              body: retryBody,
            })
          );

          if (retryRes.ok) {
            setAccessOutcome({
              granted: true,
              onChain: retryBody.onChain as { status: string } | undefined,
            });
            setState("success");
          } else {
            setAccessOutcome({
              granted: false,
              error: retryBody.error as string,
              onChain: retryBody.onChain as { status: string } | undefined,
            });
            setError(retryBody.error ?? "Access denied");
            setState("denied");
          }
        } else {
          // --- Payment-only: retry with payment signature ---
          await delay(STEP_DELAY);
          if (abortedRef.current) {
            return;
          }

          setState("retrying");

          const retryHeaders: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (paymentHeaders) {
            Object.assign(retryHeaders, paymentHeaders);
          }

          push(
            entry({
              type: "request",
              method: "POST",
              url: resource.endpoint,
              headers: {
                ...retryHeaders,
                ...(paymentHeaders
                  ? { "PAYMENT-SIGNATURE": "(base64 signed)" }
                  : {}),
              },
              body: { resourceId: resource.id, paid: true },
            })
          );

          const paidRes = await fetch("/api/x402/access", {
            method: "POST",
            headers: retryHeaders,
            body: JSON.stringify({ resourceId: resource.id, paid: true }),
          });
          const paidBody = await paidRes.json();

          if (abortedRef.current) {
            return;
          }

          push(
            entry({
              type: "response",
              status: paidRes.status,
              statusText: paidRes.ok ? "OK" : "Error",
              body: paidBody,
            })
          );
          setState(paidRes.ok ? "success" : "denied");
        }
      } catch (e) {
        if (abortedRef.current) {
          return;
        }
        setError(e instanceof Error ? e.message : "Network error");
        setState("denied");
      }
    },
    [clearTimer, push, delay, isConnected, switchChainAsync, accountAddress]
  );

  return {
    accessOutcome,
    state,
    traces,
    pohClaims,
    error,
    selectedResource,
    accessResource,
    reset,
  };
}
