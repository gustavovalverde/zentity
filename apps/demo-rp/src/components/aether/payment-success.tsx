import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { shortTx } from "@/components/aether/payment-status-copy";
import { Button } from "@/components/ui/button";

interface PaymentSuccessProps {
  amountZat: number;
  confirmationCount: number | null;
  onReset: () => void;
  paymentId: string;
  transactionId: string | null;
}

const ZATOSHIS_PER_ZEC = 100_000_000;
const TRAILING_ZEROS_RE = /0+$/;
const TRAILING_DOT_RE = /\.$/;

function formatZec(zat: number): string {
  return (zat / ZATOSHIS_PER_ZEC)
    .toFixed(8)
    .replace(TRAILING_ZEROS_RE, "")
    .replace(TRAILING_DOT_RE, ".0");
}

/**
 * Final-state completion view that replaces the QR card once a payment
 * has settled with finality. The QR is no longer relevant: the user has
 * already paid, the oracle has observed enough confirmations to call
 * the transaction final, and the user now needs a clear receipt.
 *
 * The view echoes the same green success treatment used by the CIBA
 * purchase-complete block so the visual language matches across the
 * demo. `onReset` returns the page to its task-picker state.
 */
export function PaymentSuccess({
  amountZat,
  confirmationCount,
  onReset,
  paymentId,
  transactionId,
}: PaymentSuccessProps) {
  return (
    <div className="fade-in animate-in space-y-4 rounded-2xl border border-green-500/20 bg-green-500/[0.06] p-6 duration-500">
      <div className="flex items-center gap-3">
        <HugeiconsIcon
          className="text-green-400"
          icon={CheckmarkCircle02Icon}
          size={28}
        />
        <div>
          <p className="font-semibold text-green-300 text-lg">
            Settled with finality
          </p>
          <p className="text-white/60 text-xs">
            The oracle observed enough confirmations to call this payment
            irreversible.
          </p>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-white/10 bg-black/30 p-4 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-white/50">Amount</span>
          <span className="text-right">
            <span className="font-mono text-white/90">
              {formatZec(amountZat)} ZEC
            </span>
            <span className="ml-2 font-mono text-white/40 text-xs">
              ({amountZat.toLocaleString()} zat)
            </span>
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-white/50">Confirmations</span>
          <span className="font-mono text-white/80">
            {confirmationCount ?? "-"}
          </span>
        </div>
        {transactionId && (
          <div className="flex justify-between gap-4">
            <span className="text-white/50">Transaction</span>
            <span className="break-all text-right font-mono text-white/80">
              {shortTx(transactionId)}
            </span>
          </div>
        )}
        <div className="flex justify-between gap-4 border-white/10 border-t pt-2">
          <span className="text-white/50">payment_id</span>
          <span className="break-all text-right font-mono text-white/60 text-xs">
            {paymentId}
          </span>
        </div>
      </div>

      <Button
        className="w-full text-white/70"
        onClick={onReset}
        variant="outline"
      >
        Start over
      </Button>
    </div>
  );
}
