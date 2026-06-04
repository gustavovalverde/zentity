import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { IntentPosture } from "@/lib/zpay-client";

/**
 * Small status chip that mirrors `PaymentStatusSnapshot.intent_posture`
 * so the user can see zpay's view of whether the prepared row is
 * verified against the canonical merchant intent.
 *
 * The four posture states are drawn directly from the Commit F wire
 * vocabulary: `unverified` reads as neutral and is the typical
 * post-prepare resting state, `verify_in_flight` shows a spinner while
 * zpay is reaching the verifier, `verified` lights green when the
 * intent attestation matched, and `verification_failed` lights red when
 * the verifier rejected the prepared row.
 */

interface BadgeVariant {
  classes: string;
  icon: typeof Loading03Icon;
  label: string;
  spin: boolean;
}

const VARIANTS: Record<IntentPosture, BadgeVariant> = {
  unverified: {
    icon: InformationCircleIcon,
    label: "Intent unverified",
    classes: "border-white/15 bg-white/[0.04] text-white/60",
    spin: false,
  },
  verify_in_flight: {
    icon: Loading03Icon,
    label: "Verifying intent",
    classes: "border-amber-400/30 bg-amber-400/[0.08] text-amber-200",
    spin: true,
  },
  verified: {
    icon: CheckmarkCircle02Icon,
    label: "Intent verified",
    classes: "border-green-500/30 bg-green-500/[0.08] text-green-200",
    spin: false,
  },
  verification_failed: {
    icon: AlertCircleIcon,
    label: "Intent verification failed",
    classes: "border-red-500/30 bg-red-500/[0.08] text-red-200",
    spin: false,
  },
};

export function IntentPostureBadge({ posture }: { posture: IntentPosture }) {
  const variant = VARIANTS[posture];
  return (
    <div
      aria-atomic="true"
      aria-label={variant.label}
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium text-[10px] uppercase tracking-[0.18em] ${variant.classes}`}
      role="status"
    >
      <HugeiconsIcon
        className={variant.spin ? "animate-spin" : undefined}
        icon={variant.icon}
        size={12}
      />
      <span>{variant.label}</span>
    </div>
  );
}
