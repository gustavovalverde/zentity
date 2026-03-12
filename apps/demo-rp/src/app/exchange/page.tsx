"use client";

import { ArrowLeft01Icon, FlashIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ExchangeHeader } from "@/components/exchange/exchange-header";
import { ExchangeMarkets } from "@/components/exchange/exchange-markets";
import { ExchangePortfolio } from "@/components/exchange/exchange-portfolio";
import { ExchangeTrade } from "@/components/exchange/exchange-trade";
import { AssuranceBadges } from "@/components/shared/assurance-badges";
import { DcrRegistration } from "@/components/shared/dcr-registration";
import { MARKET_DATA } from "@/data/exchange";
import { useOAuthFlow } from "@/hooks/use-oauth-flow";
import { getScenario } from "@/lib/scenarios";

const scenario = getScenario("exchange");

export default function ExchangePage() {
  const {
    session,
    isPending,
    isAuthenticated,
    claims,
    isSteppedUp,
    oauthError,
    dismissError,
    handleSignIn,
    handleStepUp,
    handleSignOut,
  } = useOAuthFlow(scenario);

  const [dcrReady, setDcrReady] = useState(false);
  const handleDcrRegistered = useCallback(() => setDcrReady(true), []);

  const [activeSection, setActiveSection] = useState<
    "portfolio" | "markets" | "trade"
  >("markets");

  useEffect(() => {
    if (isAuthenticated) {
      setActiveSection("portfolio");
    }
  }, [isAuthenticated]);

  if (isPending) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background"
        data-theme="exchange"
      >
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-background font-mono text-sm selection:bg-primary/30"
      data-theme="exchange"
    >
      <ExchangeHeader
        activeSection={activeSection}
        isAuthenticated={isAuthenticated}
        isVerified={isSteppedUp}
        onConnect={() => {
          if (dcrReady) {
            handleSignIn();
          }
        }}
        onSectionChange={setActiveSection}
        onSignOut={handleSignOut}
      />

      {oauthError && (
        <div className="mx-auto max-w-[1600px] px-4 pt-4 md:px-6 md:pt-6">
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-destructive text-sm">
                Verification Required
              </p>
              <p className="mt-1 text-muted-foreground text-xs">{oauthError}</p>
            </div>
            <button
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={dismissError}
              type="button"
            >
              <span className="text-lg leading-none">&times;</span>
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto grid max-w-[1600px] grid-cols-1 gap-6 p-4 md:p-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-3">
          {isAuthenticated ? (
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
              <h3 className="mb-4 font-bold text-muted-foreground text-xs uppercase tracking-wider">
                Account Status
              </h3>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-full bg-primary/20 font-bold text-primary">
                  {session?.user.email?.substring(0, 2).toUpperCase()}
                </div>
                <div className="overflow-hidden">
                  <p className="truncate font-bold text-foreground">
                    {session?.user.email}
                  </p>
                  <p className="text-primary text-xs">
                    {isSteppedUp ? "Level 2 Verified" : "Level 1 Verified"}
                  </p>
                </div>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">KYC Status</span>
                  <span
                    className={isSteppedUp ? "text-success" : "text-accent"}
                  >
                    {isSteppedUp ? "Enhanced" : "Basic"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Withdrawal Limit
                  </span>
                  <span className="font-mono text-foreground">
                    {isSteppedUp ? "100 BTC" : "2 BTC"}
                  </span>
                </div>
                {isSteppedUp && claims?.nationality != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Nationality</span>
                    <span className="text-foreground">
                      {String(claims.nationality)}
                    </span>
                  </div>
                )}
              </div>
              <AssuranceBadges claims={claims} />
            </div>
          ) : (
            <div className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-sm">
              <div className="mb-2 flex items-center gap-2.5">
                <div className="flex size-6 items-center justify-center rounded bg-primary text-primary-foreground">
                  <HugeiconsIcon icon={FlashIcon} size={14} />
                </div>
                <span className="font-bold text-sm uppercase tracking-tighter">
                  Nova<span className="text-primary">X</span>
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                MiCA requires identity verification for all trading accounts.
                Connect with Zentity for privacy-preserving KYC.
              </p>
              <DcrRegistration
                clientName={scenario.dcr.clientName}
                defaultScopes={scenario.dcr.defaultScopes}
                onRegistered={handleDcrRegistered}
                providerId={scenario.id}
              />
            </div>
          )}

          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <h3 className="mb-4 font-bold text-muted-foreground text-xs uppercase tracking-wider">
              Market Ticker
            </h3>
            <div className="space-y-3">
              {MARKET_DATA.slice(0, 3).map((asset) => (
                <div
                  className="flex items-center justify-between rounded bg-background/50 p-2"
                  key={asset.symbol}
                >
                  <span className="font-bold">{asset.symbol}/USD</span>
                  <span
                    className={
                      asset.change24h >= 0 ? "text-success" : "text-destructive"
                    }
                  >
                    $
                    {asset.price.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="hidden items-center justify-center lg:flex">
            <Link
              className="flex items-center gap-1.5 text-muted-foreground text-xs uppercase tracking-wider transition-colors hover:text-foreground"
              href="/"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
              Demos
            </Link>
          </div>
        </div>

        <div className="space-y-6 lg:col-span-9">
          {activeSection === "portfolio" && isAuthenticated && (
            <div className="fade-in zoom-in-95 animate-in duration-300">
              <ExchangePortfolio
                isVerified={isSteppedUp}
                onDeposit={handleStepUp}
              />
            </div>
          )}
          {activeSection === "markets" && (
            <div className="fade-in zoom-in-95 animate-in duration-300">
              <ExchangeMarkets />
            </div>
          )}
          {activeSection === "trade" && isAuthenticated && (
            <div className="fade-in zoom-in-95 animate-in duration-300">
              <ExchangeTrade isVerified={isSteppedUp} onStepUp={handleStepUp} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
