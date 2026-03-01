"use client";

import {
  ArrowDataTransferHorizontalIcon,
  ArrowLeft01Icon,
  BankIcon,
  CreditCardIcon,
  DashboardSquare01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { BankDashboard } from "@/components/bank/bank-dashboard";
import { BankProspect } from "@/components/bank/bank-prospect";
import { DcrRegistration } from "@/components/shared/dcr-registration";
import { Button } from "@/components/ui/button";
import { useOAuthFlow } from "@/hooks/use-oauth-flow";
import { getScenario } from "@/lib/scenarios";

const scenario = getScenario("bank");

interface SidebarItem {
  active?: boolean;
  hidden?: boolean;
  icon: typeof DashboardSquare01Icon;
  id: string;
  label: string;
  locked?: boolean;
}

export default function BankPage() {
  const {
    session,
    isPending,
    isAuthenticated,
    claims,
    isSteppedUp,
    handleSignIn,
    handleStepUp,
    handleSignOut,
  } = useOAuthFlow(scenario);

  const [dcrReady, setDcrReady] = useState(false);
  const handleDcrRegistered = useCallback(() => setDcrReady(true), []);

  if (isPending) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background"
        data-theme="bank"
      >
        <div className="flex flex-col items-center gap-4">
          <div className="size-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <div className="font-medium text-muted-foreground">
            Loading safe banking environment...
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div
        className="flex min-h-screen flex-col bg-surface-dark font-sans text-white selection:bg-primary/20"
        data-theme="bank"
      >
        <header className="flex items-center justify-between border-white/5 border-b px-8 py-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-sm bg-white text-primary">
              <HugeiconsIcon icon={BankIcon} size={24} />
            </div>
            <div>
              <span className="font-medium font-serif text-2xl tracking-wide">
                VELOCITY
              </span>
              <span className="block text-[10px] uppercase tracking-[0.3em] opacity-70">
                Private Client
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link
              className="flex items-center gap-1.5 text-sm text-white/40 transition-colors hover:text-white/70"
              href="/"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
              Demos
            </Link>
            <div className="font-light text-sm opacity-60">Est. 1894</div>
          </div>
        </header>

        <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6">
          <div className="pointer-events-none absolute top-1/4 -right-20 size-96 rounded-full bg-success/5 blur-3xl" />
          <div className="pointer-events-none absolute bottom-1/4 -left-20 size-96 rounded-full bg-primary/5 blur-3xl" />

          <div className="relative z-10 w-full max-w-md space-y-12 text-center">
            <div className="space-y-6">
              <h1 className="font-medium font-serif text-5xl leading-tight md:text-6xl">
                Wealth beyond <br />
                <span className="text-success italic">measure.</span>
              </h1>
              <p className="mx-auto max-w-sm font-light text-lg text-white/60 leading-relaxed">
                Exclusive banking services tailored for the distinguished few.
                Access your portfolio with uncompromising security.
              </p>
            </div>

            <div className="space-y-4 pt-4">
              <div className="text-left [&_*]:text-white/80 [&_.border]:border-white/10">
                <DcrRegistration
                  clientName={scenario.dcr.clientName}
                  defaultScopes={scenario.dcr.defaultScopes}
                  onRegistered={handleDcrRegistered}
                  providerId={scenario.id}
                />
              </div>
              <Button
                className="h-14 w-full rounded-none bg-white font-medium text-lg text-primary uppercase tracking-widest transition-all hover:bg-secondary disabled:opacity-40"
                disabled={!dcrReady}
                onClick={handleSignIn}
                size="lg"
              >
                Member Access
              </Button>
              <p className="text-white/30 text-xs uppercase tracking-widest">
                By Invitation Only
              </p>
            </div>
          </div>
        </div>

        <footer className="border-white/5 border-t py-8 text-center text-white/20 text-xs uppercase tracking-widest">
          Velocity Private Bank &bull; Zurich &bull; London &bull; New York
        </footer>
      </div>
    );
  }

  const sidebarItems: SidebarItem[] = isSteppedUp
    ? [
        {
          id: "dashboard",
          label: "Dashboard",
          icon: DashboardSquare01Icon,
          active: true,
        },
        { id: "cards", label: "Cards", icon: CreditCardIcon },
        {
          id: "transfers",
          label: "Transfers",
          icon: ArrowDataTransferHorizontalIcon,
        },
      ]
    : [
        {
          id: "products",
          label: "Products",
          icon: CreditCardIcon,
          active: true,
        },
        {
          id: "dashboard",
          label: "Dashboard",
          icon: DashboardSquare01Icon,
          locked: true,
        },
        {
          id: "transfers",
          label: "Transfers",
          icon: ArrowDataTransferHorizontalIcon,
          locked: true,
        },
      ];

  return (
    <div className="flex min-h-screen bg-muted/30" data-theme="bank">
      <aside className="sticky top-0 z-10 hidden h-screen w-64 flex-col border-r bg-background md:flex">
        <div className="flex items-center gap-3 p-6">
          <div className="flex size-8 items-center justify-center rounded bg-primary text-primary-foreground shadow-sm">
            <HugeiconsIcon icon={BankIcon} size={20} />
          </div>
          <span className="font-bold text-lg tracking-tight">
            Velocity Bank
          </span>
        </div>

        <nav className="mt-4 flex-1 space-y-1 px-4">
          {sidebarItems
            .filter((item) => !item.hidden)
            .map((item) => (
              <button
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 font-medium text-sm transition-colors ${
                  item.active
                    ? "bg-primary/10 text-primary"
                    : item.locked
                      ? "cursor-not-allowed text-muted-foreground/40"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                disabled={item.locked}
                key={item.id}
                type="button"
              >
                <HugeiconsIcon icon={item.icon} size={20} />
                {item.label}
                {item.locked && (
                  <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px]">
                    Locked
                  </span>
                )}
              </button>
            ))}
        </nav>

        <div className="border-t p-4">
          <div className="mb-4 flex items-center gap-3 px-2">
            <div className="flex size-8 items-center justify-center rounded-full bg-accent font-bold text-accent-foreground text-xs">
              {session?.user.email?.substring(0, 2).toUpperCase() || "US"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-sm">
                {session?.user.email}
              </p>
              <p className="truncate text-muted-foreground text-xs">
                {isSteppedUp ? "Private Client" : "Prospect"}
              </p>
            </div>
          </div>
          <Button
            className="w-full text-muted-foreground"
            onClick={handleSignOut}
            size="sm"
            variant="outline"
          >
            Sign Out
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-5xl p-6 md:p-10">
          {isSteppedUp ? (
            <div className="fade-in slide-in-from-bottom-4 animate-in space-y-6 duration-500">
              <div>
                <h1 className="font-bold text-2xl tracking-tight">Dashboard</h1>
                <p className="text-muted-foreground">
                  Welcome back, here&apos;s your financial overview.
                </p>
              </div>
              <BankDashboard claims={claims} />
            </div>
          ) : (
            <div className="fade-in slide-in-from-bottom-4 animate-in duration-500">
              <BankProspect onApply={handleStepUp} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
