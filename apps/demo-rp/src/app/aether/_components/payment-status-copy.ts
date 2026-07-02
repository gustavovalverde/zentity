import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  Loading03Icon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";

import type { PaymentEventsState } from "@/hooks/use-payment-events";
import type {
  BroadcastOutcome,
  PaymentStatusSnapshot,
} from "@/lib/zpay-client";

/**
 * Shared status-copy helpers for the payment bridge surfaces.
 *
 * The main `PaymentBridge` status banner, the stall-poll "Latest
 * status" line, and any future surface that reads a
 * `PaymentStatusSnapshot` all route through `describeState` /
 * `describeStatus` so wire status tokens never leak into the UI as raw
 * text. The bridge previously inlined this logic; pulling it out makes
 * the friendly copy a single source of truth.
 *
 * Status copy maps to the Commit F vocabulary:
 * `awaiting` -> "Waiting for your wallet"; `broadcast` -> "Broadcast
 * accepted"; `mined` -> "{n} confirmation(s)"; `final` -> "Settled with
 * finality"; `failed` -> "Broadcast failed"; `never_issued` ->
 * "Unknown payment_id"; `expired` -> "This payment window has expired".
 */

export interface StateDescription {
  icon: typeof Loading03Icon;
  label: string;
  sub: string | null;
  tone: "info" | "success" | "error";
}

export function describeState(state: PaymentEventsState): StateDescription {
  switch (state.kind) {
    case "idle":
      return {
        icon: Loading03Icon,
        label: "Initializing",
        sub: "Opening the event stream.",
        tone: "info",
      };
    case "subscribed":
      return describeStatus(state.snapshot);
    case "terminal":
      return describeStatus(state.snapshot);
    case "error":
      return {
        icon: AlertCircleIcon,
        label: "Connection error",
        sub: state.userMessage,
        tone: "error",
      };
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function describeStatus(
  snapshot: PaymentStatusSnapshot
): StateDescription {
  switch (snapshot.status) {
    case "awaiting":
      return {
        icon: Wallet01Icon,
        label: "Waiting for your wallet",
        sub: "Open the QR with any Zcash wallet that supports ZIP-321, or copy the URI.",
        tone: "info",
      };
    case "broadcast":
      return {
        icon: CheckmarkCircle02Icon,
        label: "Broadcast accepted",
        sub: transactionSub(snapshot.broadcast_outcome),
        tone: "info",
      };
    case "mined": {
      const conf = snapshot.confirmation_count ?? 0;
      return {
        icon: Loading03Icon,
        label: `${conf} confirmation${conf === 1 ? "" : "s"}`,
        sub: transactionSub(snapshot.broadcast_outcome),
        tone: "info",
      };
    }
    case "final":
      return {
        icon: CheckmarkCircle02Icon,
        label: "Settled with finality",
        sub: transactionSub(snapshot.broadcast_outcome),
        tone: "success",
      };
    case "failed":
      return {
        icon: AlertCircleIcon,
        label: "Broadcast failed",
        sub: outcomeMessage(snapshot.broadcast_outcome),
        tone: "error",
      };
    case "never_issued":
      return {
        icon: AlertCircleIcon,
        label: "Unknown payment_id",
        sub: "The payment service has no record of this id. Reset and try again.",
        tone: "error",
      };
    case "expired":
      return {
        icon: AlertCircleIcon,
        label: "This payment window has expired",
        sub: "Reset and prepare a fresh payment.",
        tone: "error",
      };
    default: {
      const _exhaustive: never = snapshot.status;
      return _exhaustive;
    }
  }
}

export function transactionSub(
  outcome: BroadcastOutcome | null
): string | null {
  if (!outcome) {
    return null;
  }
  if (outcome.kind === "accepted") {
    return `txid ${shortTx(outcome.transaction_id)}`;
  }
  return outcome.upstream_message;
}

export function outcomeMessage(
  outcome: BroadcastOutcome | null
): string | null {
  if (!outcome) {
    return null;
  }
  if (outcome.kind === "accepted") {
    return null;
  }
  return outcome.upstream_message;
}

export function toneClasses(tone: "info" | "success" | "error"): string {
  switch (tone) {
    case "info":
      return "border-white/10 bg-white/[0.04]";
    case "success":
      return "border-green-500/30 bg-green-500/[0.08] text-green-200";
    case "error":
      return "border-red-500/30 bg-red-500/[0.08] text-red-200";
    default: {
      const _exhaustive: never = tone;
      return _exhaustive;
    }
  }
}

export function shortTx(tx: string): string {
  if (tx.length <= 12) {
    return tx;
  }
  return `${tx.slice(0, 6)}…${tx.slice(-6)}`;
}
