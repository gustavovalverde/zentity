"use client";

import {
  AiChat02Icon,
  ArrowLeft01Icon,
  Logout01Icon,
  ShieldEnergyIcon,
  ShieldKeyIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { AgentChat } from "@/components/aether/agent-chat";
import { DcrRegistration } from "@/components/shared/dcr-registration";
import { Button } from "@/components/ui/button";
import { SHOPPING_TASKS, type ShoppingTask } from "@/data/aether";
import { useCibaFlow } from "@/hooks/use-ciba-flow";
import { useOAuthFlow } from "@/hooks/use-oauth-flow";
import type { TrustTier } from "@/lib/agent-runtime-storage";
import type { PaymentNetwork, Preparation } from "@/lib/zpay-client";
import { aetherScenario } from "@/scenarios/aether";

const scenario = aetherScenario;

/**
 * Discriminated error tag returned by the prepare BFF (Commit F).
 * The chat surface maps each tag to copy without touching exception
 * strings.
 */
type PreparationErrorKind =
  | "network_error"
  | "server_error"
  | "session_required"
  | "registry_unknown"
  | "zpay_unavailable"
  | "invalid_request";

export interface PreparationError {
  description: string;
  kind: PreparationErrorKind;
}

interface PreparedWithCode extends Preparation {
  chain: { namespace: "zcash"; reference: "main" | "test" | "regtest" };
  confirmation_code: string;
  intent_hash: string;
  recipient: string;
}

type PreparationResult =
  | { ok: true; preparation: PreparedWithCode }
  | { ok: false; error: PreparationError };

const KNOWN_ERROR_TAGS: ReadonlySet<PreparationErrorKind> = new Set([
  "network_error",
  "server_error",
  "session_required",
  "registry_unknown",
  "zpay_unavailable",
  "invalid_request",
]);

function decodeErrorBody(body: unknown): PreparationError {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const rawKind = typeof record.error === "string" ? record.error : "";
    const description =
      typeof record.error_description === "string"
        ? record.error_description
        : "The payment service rejected the request.";
    if (KNOWN_ERROR_TAGS.has(rawKind as PreparationErrorKind)) {
      return { kind: rawKind as PreparationErrorKind, description };
    }
  }
  return {
    kind: "server_error",
    description: "The payment service rejected the request.",
  };
}

async function preparePayment(input: {
  item: string;
  merchant: string;
  network: PaymentNetwork;
  taskId: string;
  itemId: string;
  amountMinorUnits: number;
}): Promise<PreparationResult> {
  let response: Response;
  try {
    response = await fetch("/api/aether/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    return {
      ok: false,
      error: {
        kind: "network_error",
        description: "Could not reach the payment service.",
      },
    };
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false, error: decodeErrorBody(payload) };
  }
  const data = payload as Partial<PreparedWithCode> | null;
  if (
    !(
      data?.payment_uri &&
      data.payment_id &&
      typeof data.amount_zat === "number" &&
      typeof data.expiry_height === "number" &&
      typeof data.confirmation_code === "string" &&
      typeof data.intent_hash === "string" &&
      typeof data.recipient === "string" &&
      data.chain?.namespace === "zcash" &&
      typeof data.chain.reference === "string"
    )
  ) {
    return {
      ok: false,
      error: {
        kind: "server_error",
        description:
          "The payment service returned an incomplete prepare response.",
      },
    };
  }
  return {
    ok: true,
    preparation: {
      payment_uri: data.payment_uri,
      payment_id: data.payment_id,
      amount_zat: data.amount_zat,
      expiry_height: data.expiry_height,
      memo_bytes: data.memo_bytes ?? [],
      confirmation_code: data.confirmation_code,
      intent_hash: data.intent_hash,
      recipient: data.recipient,
      chain: data.chain as PreparedWithCode["chain"],
    },
  };
}

export default function AetherPage() {
  const {
    isPending,
    isAuthenticated,
    claims,
    session,
    handleSignIn,
    handleSignOut,
  } = useOAuthFlow(scenario);

  const [task, setTask] = useState<ShoppingTask | null>(null);
  const [dcrReady, setDcrReady] = useState(false);
  const [prepared, setPrepared] = useState<PreparedWithCode | null>(null);
  const [preparationError, setPreparationError] =
    useState<PreparationError | null>(null);

  const { state, tokens, exchangedTokens, userInfo, error, startFlow, reset } =
    useCibaFlow(scenario.id);

  const userEmail = (claims?.email as string) || session?.user?.email || "";

  const triggerCiba = useCallback(async () => {
    if (!(userEmail && task)) {
      return;
    }
    const pick =
      task.results.find((p) => p.id === task.pick) ?? task.results[0];
    if (!pick) {
      return;
    }
    const tierActions: Record<string, string> = {
      anonymous: "Purchase request",
      registered: "Aether AI requests purchase of",
      attested: "Verified Aether AI requests purchase of",
    };
    const action = tierActions[task.trustTier] ?? tierActions.registered;
    const itemLine = `${action} ${pick.brand} ${pick.name}`;
    const acr =
      scenario.acrValues === undefined ? {} : { acrValues: scenario.acrValues };

    // Tasks without a payment network (identity-disclosure or basic approvals)
    // trigger CIBA on scopes alone, with no payment_authorization.
    if (!task.zpay) {
      setPreparationError(null);
      setPrepared(null);
      startFlow({
        loginHint: userEmail,
        scope: task.scope ?? "openid",
        bindingMessage: itemLine,
        trustTier: task.trustTier,
        ...acr,
      });
      return;
    }

    const tax = pick.price * 0.0875;
    const total = pick.price + tax;
    const merchant = "Aether AI";
    const item = `${pick.brand} ${pick.name}`;

    const result = await preparePayment({
      merchant,
      item,
      network: task.zpay.network,
      taskId: task.id,
      itemId: pick.id,
      amountMinorUnits: Math.round(total * 100),
    });
    if (!result.ok) {
      setPreparationError(result.error);
      setPrepared(null);
      return;
    }
    const preparedPayment = result.preparation;
    setPreparationError(null);
    setPrepared(preparedPayment);

    const paymentAuthorization = {
      type: "payment_authorization" as const,
      chain: preparedPayment.chain,
      recipient: preparedPayment.recipient,
      amount: {
        currency: "ZEC",
        value: String(preparedPayment.amount_zat),
        unit: "base" as const,
      },
      payment_id: preparedPayment.payment_id,
      intent_hash: preparedPayment.intent_hash,
      expires_at: {
        kind: "block_height" as const,
        value: preparedPayment.expiry_height,
      },
    };

    // Single line, no control characters: the CIBA backchannel rejects
    // newlines and other control chars in binding_message.
    const bindingMessage = `Confirm code: ${preparedPayment.confirmation_code} · ${itemLine}`;

    startFlow({
      loginHint: userEmail,
      scope: task.scope ?? "openid",
      bindingMessage,
      trustTier: task.trustTier,
      authorizationDetails: JSON.stringify([paymentAuthorization]),
      ...acr,
    });
  }, [userEmail, task, startFlow]);

  const handleReset = useCallback(() => {
    reset();
    setTask(null);
    setPrepared(null);
    setPreparationError(null);
  }, [reset]);

  const handleDcrRegistered = useCallback(() => setDcrReady(true), []);

  if (isPending) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-surface-dark"
        data-theme="aether"
      >
        <div className="animate-pulse text-white/40">Loading...</div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-screen flex-col bg-surface-dark font-sans text-white selection:bg-primary/20"
      data-theme="aether"
    >
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-white/5 border-b px-6 py-4 sm:px-8 sm:py-6">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-white text-primary sm:size-10">
            <HugeiconsIcon icon={AiChat02Icon} size={22} />
          </div>
          <div>
            <span className="font-bold text-xl tracking-tight sm:text-2xl">
              Aether AI
            </span>
            <span className="block text-[10px] uppercase tracking-[0.3em] opacity-70">
              Personal Shopping Agent
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {isAuthenticated && (
            <button
              className="flex items-center gap-1.5 text-sm text-white/40 transition-colors hover:text-white/70"
              onClick={handleSignOut}
              type="button"
            >
              <HugeiconsIcon icon={Logout01Icon} size={16} />
              Sign out
            </button>
          )}
          <Link
            className="flex items-center gap-1.5 text-sm text-white/40 transition-colors hover:text-white/70"
            href="/"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
            Demos
          </Link>
        </div>
      </header>

      {/* Content */}
      {isAuthenticated ? (
        task ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-3 border-white/5 border-b bg-white/[0.02] px-6 py-3">
              <div className="size-2 animate-pulse rounded-full bg-green-400" />
              <span className="text-sm text-white/50">
                Agent working on:{" "}
                <span className="text-white/80">{task.label}</span> for{" "}
                <span className="font-mono text-white/80">{userEmail}</span>
              </span>
            </div>
            <AgentChat
              cibaState={state}
              error={error}
              exchangedTokens={exchangedTokens}
              onReset={handleReset}
              onTriggerCiba={triggerCiba}
              preparationError={preparationError}
              prepared={prepared}
              task={task}
              tokens={tokens}
              userInfo={userInfo}
            />
          </div>
        ) : (
          <TaskPickerView onSelectTask={setTask} userEmail={userEmail} />
        )
      ) : (
        <LandingView
          dcrReady={dcrReady}
          onDcrRegistered={handleDcrRegistered}
          onSignIn={handleSignIn}
        />
      )}

      {/* Footer */}
      <footer className="shrink-0 border-white/5 border-t py-4 text-center text-white/20 text-xs uppercase tracking-widest sm:py-6">
        Aether AI &bull; CIBA Agent Authorization &bull; OpenID Connect
      </footer>
    </div>
  );
}

function LandingView({
  dcrReady,
  onDcrRegistered,
  onSignIn,
}: {
  dcrReady: boolean;
  onDcrRegistered: () => void;
  onSignIn: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg space-y-10">
        <div className="space-y-4 text-center">
          <h1 className="font-bold text-3xl tracking-tight sm:text-4xl">
            Your AI Shopping Assistant
          </h1>
          <p className="mx-auto max-w-md text-base text-white/60 leading-relaxed sm:text-lg">
            Aether searches, compares, and purchases on your behalf. When it is
            time to pay, the agent requests your authorization through a
            separate channel; you approve on your own device. The service knows
            a verified human authorized the action, enabling per-human trust
            rather than per-agent guesswork.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4 text-center">
          {[
            { step: "1", label: "Connect", desc: "Sign in with Zentity" },
            { step: "2", label: "Agent shops", desc: "Searches and compares" },
            { step: "3", label: "You approve", desc: "Authorize the purchase" },
          ].map((s) => (
            <div className="space-y-1.5" key={s.step}>
              <div className="mx-auto flex size-8 items-center justify-center rounded-full border border-white/10 font-bold text-white/40 text-xs">
                {s.step}
              </div>
              <p className="font-medium text-sm">{s.label}</p>
              <p className="text-white/40 text-xs">{s.desc}</p>
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <DcrRegistration onRegistered={onDcrRegistered} scenario={scenario} />
          <Button
            className="h-12 w-full rounded-lg bg-white font-medium text-primary hover:bg-white/90 disabled:opacity-40"
            disabled={!dcrReady}
            onClick={onSignIn}
          >
            <HugeiconsIcon icon={ShieldKeyIcon} size={18} />
            Sign in with Zentity
          </Button>
        </div>
      </div>
    </div>
  );
}

const TIER_BADGE: Record<TrustTier, { label: string; className: string }> = {
  anonymous: {
    label: "Anonymous",
    className: "border-white/10 text-white/30",
  },
  registered: {
    label: "Registered",
    className: "border-amber-500/30 text-amber-400",
  },
  attested: {
    label: "Attested",
    className: "border-green-500/30 text-green-400",
  },
};

function TaskPickerView({
  userEmail,
  onSelectTask,
}: {
  onSelectTask: (t: ShoppingTask) => void;
  userEmail: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg space-y-8">
        <div className="space-y-3 text-center">
          <p className="text-sm text-white/50">
            Signed in as{" "}
            <span className="font-mono text-white/70">{userEmail}</span>
          </p>
          <h2 className="font-bold text-2xl tracking-tight sm:text-3xl">
            What should the agent find?
          </h2>
          <p className="text-white/50">
            Pick a task. Aether will search, compare, and add the best option to
            your cart.
          </p>
        </div>

        <div className="grid gap-3">
          {SHOPPING_TASKS.map((t) => {
            const badge = TIER_BADGE[t.trustTier];
            return (
              <button
                className="group flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-left transition-all hover:border-white/20 hover:bg-white/5"
                key={t.id}
                onClick={() => onSelectTask(t)}
                type="button"
              >
                <div className="flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <p className="font-medium">{t.label}</p>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${badge.className}`}
                    >
                      <HugeiconsIcon icon={ShieldEnergyIcon} size={10} />
                      {badge.label}
                    </span>
                  </div>
                  <p className="text-sm text-white/40">{t.prompt}</p>
                </div>
                <span className="text-sm text-white/30 transition-colors group-hover:text-white/60">
                  Budget: ${t.budget}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
