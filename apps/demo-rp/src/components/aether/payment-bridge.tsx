"use client";

import {
  AlertCircleIcon,
  ArrowRight01Icon,
  Copy01Icon,
  CopyCheckIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useState } from "react";

import { IntentPostureBadge } from "@/components/aether/intent-posture-badge";
import {
  describeState,
  describeStatus,
  toneClasses,
} from "@/components/aether/payment-status-copy";
import { PaymentSuccess } from "@/components/aether/payment-success";
import {
  type PaymentEventsState,
  usePaymentEvents,
} from "@/hooks/use-payment-events";
import { computeUriConfirmationCode } from "@/lib/confirmation-code";
import type { PaymentStatusSnapshot } from "@/lib/zpay-client";

const STALL_TIMEOUT_MS = 60_000;

interface PaymentBridgeProps {
  amountZat: number;
  confirmationCode: string;
  onReset?: () => void;
  onSettled?: (transactionId: string | null) => void;
  paymentId: string;
  paymentUri: string;
}

/**
 * Renders the ZIP-321 payment URI as a QR code and a copy-able
 * monospace string, subscribes to zpay's SSE stream via the
 * `/api/aether/payments/{id}/events` proxy, and displays the
 * BFF-derived 6-character `confirmation_code` above the QR. The user
 * matches the code on phone (CIBA push binding) versus laptop (this
 * surface) to defeat URI-swap phishing.
 *
 * Once the stream reaches `final`, the QR card unmounts and a success
 * receipt (`PaymentSuccess`) takes its place. `onSettled` fires with
 * the transaction id (or null) before the swap.
 *
 * Stall affordance: if the bridge has been observing `awaiting` for
 * 60 seconds, a secondary "Check status" button surfaces a one-shot
 * REST refetch against `/api/aether/payments/{id}`. The 60-second
 * window re-arms after each `Check status` round-trip so the user can
 * keep poking the canonical store on long stalls without reloading.
 *
 * As a defense-in-depth measure the bridge re-derives the confirmation
 * code client-side from the payment URI and renders a "Code mismatch"
 * banner if the BFF supplied a different code. A mismatch means either
 * the BFF and bridge are running different versions of the encoder, or
 * something rewrote one of the two values in flight.
 */
export function PaymentBridge({
  amountZat,
  confirmationCode,
  onReset,
  onSettled,
  paymentId,
  paymentUri,
}: PaymentBridgeProps) {
  const state = usePaymentEvents(paymentId);
  const [copied, setCopied] = useState(false);
  const [awaitingStalled, setAwaitingStalled] = useState(false);
  const [stallEpoch, setStallEpoch] = useState(0);
  const [pollSnapshot, setPollSnapshot] =
    useState<PaymentStatusSnapshot | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [codeStatus, setCodeStatus] = useState<
    "checking" | "match" | "mismatch" | "derivation_failed"
  >("checking");

  useEffect(() => {
    let cancelled = false;
    setCodeStatus("checking");
    computeUriConfirmationCode(paymentUri)
      .then((derived) => {
        if (cancelled) {
          return;
        }
        if (derived === confirmationCode) {
          setCodeStatus("match");
        } else {
          console.error("PaymentBridge confirmation-code mismatch", {
            server: confirmationCode,
            client: derived,
          });
          setCodeStatus("mismatch");
        }
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        console.error("PaymentBridge code derivation failed", err);
        setCodeStatus("derivation_failed");
      });
    return () => {
      cancelled = true;
    };
  }, [paymentUri, confirmationCode]);

  useEffect(() => {
    if (state.kind !== "terminal") {
      return;
    }
    if (state.snapshot.status !== "final") {
      return;
    }
    const txId =
      state.snapshot.broadcast_outcome?.kind === "accepted"
        ? state.snapshot.broadcast_outcome.transaction_id
        : null;
    onSettled?.(txId);
  }, [state, onSettled]);

  const awaiting =
    state.kind === "subscribed" && state.snapshot.status === "awaiting";
  // stallEpoch is read inside the effect so handlePoll can re-arm the
  // timer even when `awaiting` stays true across the poll (no SSE
  // update arrives). Biome wants every read value in the dep array.
  useEffect(() => {
    if (!awaiting) {
      setAwaitingStalled(false);
      return;
    }
    const _epoch = stallEpoch;
    const timer = setTimeout(() => setAwaitingStalled(true), STALL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [awaiting, stallEpoch]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(paymentUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail under non-secure contexts; surface
      // would be a toast in production. Demo silently no-ops.
    }
  };

  const handlePoll = useCallback(async () => {
    setPollError(null);
    try {
      const response = await fetch(
        `/api/aether/payments/${encodeURIComponent(paymentId)}`,
        { headers: { Accept: "application/json" } }
      );
      if (!response.ok) {
        setPollError("Status check failed. Try again in a moment.");
        return;
      }
      const snapshot = (await response.json()) as PaymentStatusSnapshot;
      setPollSnapshot(snapshot);
      if (snapshot.status === "awaiting") {
        // Re-arm the 60s stall timer. Dropping the stalled flag is not
        // enough on its own because the `awaiting` value did not change,
        // so the effect would not re-run. Bumping `stallEpoch` forces it.
        setAwaitingStalled(false);
        setStallEpoch((epoch) => epoch + 1);
      }
    } catch {
      setPollError("Status check failed. Try again in a moment.");
    }
  }, [paymentId]);

  const snapshot = snapshotFromState(state);
  const noopReset = useCallback(() => {
    /* No reset wired by the parent; this is intentional. */
  }, []);

  if (state.kind === "terminal" && state.snapshot.status === "final") {
    const txId =
      state.snapshot.broadcast_outcome?.kind === "accepted"
        ? state.snapshot.broadcast_outcome.transaction_id
        : null;
    return (
      <PaymentSuccess
        amountZat={amountZat}
        confirmationCount={state.snapshot.confirmation_count}
        onReset={onReset ?? noopReset}
        paymentId={paymentId}
        transactionId={txId}
      />
    );
  }

  const description = describeState(state);

  return (
    <div className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <ConfirmationCodeChip code={confirmationCode} />
      {snapshot && snapshot.intent_posture !== "unverified" && (
        <div className="flex justify-center">
          <IntentPostureBadge posture={snapshot.intent_posture} />
        </div>
      )}
      {codeStatus === "mismatch" && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/15 p-3 text-red-100">
          <HugeiconsIcon icon={AlertCircleIcon} size={16} />
          <div className="flex-1 text-xs leading-relaxed">
            <p className="font-semibold">Code mismatch</p>
            <p className="text-red-100">
              The confirmation code from the payment service does not match the
              one derived from this URI. Do not approve on your phone.
            </p>
          </div>
        </div>
      )}
      {codeStatus === "derivation_failed" && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/15 p-3 text-amber-100">
          <HugeiconsIcon icon={AlertCircleIcon} size={16} />
          <div className="flex-1 text-xs leading-relaxed">
            <p className="font-semibold">Code check unavailable</p>
            <p className="text-amber-100">
              The browser could not re-derive the confirmation code. The code
              above is the server's claim; verify it against your phone before
              approving.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col items-center gap-4">
        <div
          aria-label="ZIP-321 payment QR code; open with any Zcash wallet that supports ZIP-321"
          className="rounded-lg bg-white p-3"
          role="img"
        >
          <QRCodeSVG level="M" size={192} value={paymentUri} />
        </div>
        <a
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2.5 font-medium text-sm text-white transition-colors hover:bg-white/15"
          href={paymentUri}
          rel="noopener"
        >
          Open in wallet
          <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
        </a>
        <div className="w-full space-y-2">
          <p className="text-center font-medium text-[10px] text-white/40 uppercase tracking-[0.3em]">
            ZIP-321 payment URI
          </p>
          <div className="flex items-start gap-2 rounded-lg border border-white/10 bg-black/40 p-3">
            <code className="block flex-1 break-all font-mono text-[11px] text-white/70 leading-relaxed">
              {paymentUri}
            </code>
            <button
              aria-label={copied ? "Copied" : "Copy payment URI"}
              className="shrink-0 text-white/40 transition-colors hover:text-white"
              onClick={() => {
                handleCopy().catch(() => {
                  /* handleCopy swallows clipboard errors itself */
                });
              }}
              type="button"
            >
              <HugeiconsIcon
                icon={copied ? CopyCheckIcon : Copy01Icon}
                size={16}
              />
            </button>
            <span aria-live="polite" className="sr-only">
              {copied ? "Payment URI copied to clipboard" : ""}
            </span>
          </div>
        </div>
      </div>

      <div
        className={`flex items-center gap-3 rounded-lg border p-4 ${toneClasses(description.tone)}`}
      >
        <HugeiconsIcon icon={description.icon} size={20} />
        <div className="flex-1">
          <p className="font-medium text-sm">{description.label}</p>
          {description.sub && (
            <p className="text-white/40 text-xs">{description.sub}</p>
          )}
        </div>
      </div>

      {awaitingStalled && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-3">
          <p className="text-center text-[11px] text-white/50">
            Still waiting? Re-check the canonical status.
          </p>
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-white text-xs transition-colors hover:bg-white/15"
            onClick={() => {
              handlePoll().catch(() => {
                /* handlePoll captures its own errors */
              });
            }}
            type="button"
          >
            <HugeiconsIcon icon={RefreshIcon} size={12} />
            Check status
          </button>
          {pollSnapshot && (
            <p className="text-center text-[10px] text-white/40">
              Latest status:{" "}
              <span className="text-white/70">
                {describeStatus(pollSnapshot).label}
              </span>
            </p>
          )}
          {pollError && (
            <p className="text-center text-[10px] text-red-300/70">
              {pollError}
            </p>
          )}
        </div>
      )}

      <p className="text-center text-[10px] text-white/30">
        payment_id <span className="font-mono">{paymentId}</span>
      </p>
    </div>
  );
}

function ConfirmationCodeChip({ code }: { code: string }) {
  return (
    <div className="space-y-2">
      <p className="text-center font-medium text-[10px] text-white/40 uppercase tracking-[0.3em]">
        Match this code on your phone
      </p>
      <div className="rounded-lg border border-primary/40 bg-primary/[0.08] px-4 py-3">
        <p className="text-center font-mono font-semibold text-2xl text-white tracking-[0.4em]">
          {code}
        </p>
      </div>
    </div>
  );
}

function snapshotFromState(
  state: PaymentEventsState
): PaymentStatusSnapshot | null {
  if (state.kind === "subscribed" || state.kind === "terminal") {
    return state.snapshot;
  }
  return null;
}
