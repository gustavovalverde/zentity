"use client";

import {
  AiChat02Icon,
  ArrowLeft01Icon,
  Logout01Icon,
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
import { getScenario } from "@/lib/scenarios";

const scenario = getScenario("aether");

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

  const { state, tokens, exchangedTokens, userInfo, error, startFlow, reset } =
    useCibaFlow(scenario.id);

  const userEmail = (claims?.email as string) || session?.user?.email || "";

  const triggerCiba = useCallback(() => {
    if (!(userEmail && task)) {
      return;
    }
    const pick =
      task.results.find((p) => p.id === task.pick) ?? task.results[0];
    if (!pick) {
      return;
    }
    const tax = pick.price * 0.0875;
    const total = pick.price + tax;
    startFlow({
      loginHint: userEmail,
      scope: "openid",
      bindingMessage: `Purchase: ${pick.brand} ${pick.name}`,
      authorizationDetails: JSON.stringify([
        {
          type: "purchase",
          merchant: "Aether AI",
          item: `${pick.brand} ${pick.name}`,
          amount: { currency: "USD", value: total.toFixed(2) },
        },
      ]),
      agentClaims: JSON.stringify({
        agent: {
          name: "Aether AI",
          model: "aether-shopping-v1",
          runtime: "demo-rp",
          capabilities: ["search", "compare", "purchase"],
        },
        task: {
          description: `Purchase ${pick.brand} ${pick.name} for $${total.toFixed(2)}`,
        },
        oversight: {
          requires_human_approval_for: ["purchase"],
        },
      }),
      ...(scenario.acrValues === undefined
        ? {}
        : { acrValues: scenario.acrValues }),
    });
  }, [userEmail, task, startFlow]);

  const handleReset = useCallback(() => {
    reset();
    setTask(null);
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
            Aether searches, compares, and purchases on your behalf. When it's
            time to pay, you approve from your own device — the agent never
            touches your credentials.
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
          <DcrRegistration
            clientName={scenario.dcr.clientName}
            defaultScopes={scenario.dcr.defaultScopes}
            grantTypes={scenario.dcr.grantTypes}
            onRegistered={onDcrRegistered}
            providerId={scenario.id}
          />
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
          {SHOPPING_TASKS.map((t) => (
            <button
              className="group flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-left transition-all hover:border-white/20 hover:bg-white/5"
              key={t.id}
              onClick={() => onSelectTask(t)}
              type="button"
            >
              <div className="flex-1">
                <p className="font-medium">{t.label}</p>
                <p className="text-sm text-white/40">{t.prompt}</p>
              </div>
              <span className="text-sm text-white/30 transition-colors group-hover:text-white/60">
                Budget: ${t.budget}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
