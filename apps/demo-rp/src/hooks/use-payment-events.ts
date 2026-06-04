"use client";

import { useEffect, useState } from "react";

import type { PaymentStatus, PaymentStatusSnapshot } from "@/lib/zpay-client";

/**
 * Subscribes to `/api/aether/payments/{id}/events` (the SSE proxy that
 * forwards zpay's per-payment event stream) and exposes the connection
 * state as a discriminated union.
 *
 * Event names emitted by zpay and consumed here:
 *
 * - `snapshot`: canonical `PaymentStatusSnapshot`. Drives state.
 * - `lag` / `serialization_failed`: triggers a one-shot REST refetch
 *   against `/api/aether/payments/{id}` so a missed snapshot does not
 *   leave the UI stale.
 * - `resync_failed`: surfaces as a fatal error; the bridge tells the
 *   user to retry.
 *
 * The EventSource closes itself once a terminal snapshot lands so the
 * browser does not auto-reconnect to a stream that has nothing left
 * to deliver. Per Commit F the terminal set is
 * `final | failed | never_issued | expired`; `awaiting`, `broadcast`,
 * and `mined` are non-terminal and the stream stays open through them.
 *
 * Errors are surfaced as a `{ code, userMessage }` pair so the bridge
 * never renders a raw exception string at the user. Map the code to UI
 * affordances; show `userMessage` directly.
 */

export type PaymentEventsErrorCode =
  | "connection_lost"
  | "stream_closed"
  | "malformed_snapshot"
  | "resync_unavailable";

export type PaymentEventsState =
  | { kind: "idle" }
  | { kind: "subscribed"; snapshot: PaymentStatusSnapshot }
  | { kind: "terminal"; snapshot: PaymentStatusSnapshot }
  | {
      kind: "error";
      code: PaymentEventsErrorCode;
      userMessage: string;
    };

function isTerminal(status: PaymentStatus): boolean {
  return (
    status === "final" ||
    status === "failed" ||
    status === "never_issued" ||
    status === "expired"
  );
}

const ERROR_COPY: Record<PaymentEventsErrorCode, string> = {
  connection_lost:
    "Lost connection to the payment service. Refresh to reconnect.",
  stream_closed:
    "The payment service ended this session. Refresh to see the latest status.",
  malformed_snapshot:
    "The payment service sent unexpected data. Refresh to retry.",
  resync_unavailable:
    "Could not refetch the payment status. Check your connection and refresh.",
};

function buildError(code: PaymentEventsErrorCode) {
  return { kind: "error" as const, code, userMessage: ERROR_COPY[code] };
}

export function usePaymentEvents(paymentId: string | null): PaymentEventsState {
  const [state, setState] = useState<PaymentEventsState>({ kind: "idle" });

  useEffect(() => {
    if (!paymentId) {
      setState({ kind: "idle" });
      return;
    }

    const eventsUrl = `/api/aether/payments/${encodeURIComponent(paymentId)}/events`;
    const statusUrl = `/api/aether/payments/${encodeURIComponent(paymentId)}`;
    const source = new EventSource(eventsUrl);
    let closed = false;

    const finalize = (next: PaymentEventsState) => {
      if (closed) {
        return;
      }
      setState(next);
      if (next.kind === "terminal" || next.kind === "error") {
        closed = true;
        source.close();
      }
    };

    const applySnapshot = (snapshot: PaymentStatusSnapshot) => {
      if (isTerminal(snapshot.status)) {
        finalize({ kind: "terminal", snapshot });
      } else {
        setState({ kind: "subscribed", snapshot });
      }
    };

    const fallbackResync = async () => {
      try {
        const response = await fetch(statusUrl, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          finalize(buildError("resync_unavailable"));
          return;
        }
        const snapshot = (await response.json()) as PaymentStatusSnapshot;
        applySnapshot(snapshot);
      } catch {
        finalize(buildError("resync_unavailable"));
      }
    };

    source.addEventListener("snapshot", (event) => {
      try {
        const snapshot = JSON.parse(
          (event as MessageEvent<string>).data
        ) as PaymentStatusSnapshot;
        applySnapshot(snapshot);
      } catch {
        finalize(buildError("malformed_snapshot"));
      }
    });

    source.addEventListener("lag", () => {
      fallbackResync().catch(() => {
        /* finalize already records the error inside fallbackResync */
      });
    });

    source.addEventListener("serialization_failed", () => {
      fallbackResync().catch(() => {
        /* finalize already records the error inside fallbackResync */
      });
    });

    source.addEventListener("resync_failed", () => {
      finalize(buildError("stream_closed"));
    });

    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED && !closed) {
        finalize(buildError("connection_lost"));
      }
    };

    return () => {
      closed = true;
      source.close();
    };
  }, [paymentId]);

  return state;
}
