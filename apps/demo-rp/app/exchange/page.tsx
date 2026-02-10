"use client";

import { ArrowLeft01Icon, FlashIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ExchangeHeader } from "@/components/exchange/exchange-header";
import { ExchangeMarkets } from "@/components/exchange/exchange-markets";
import { ExchangePortfolio } from "@/components/exchange/exchange-portfolio";
import { ExchangeTrade } from "@/components/exchange/exchange-trade";
import { DcrRegistration } from "@/components/shared/dcr-registration";
import { DebugPanel } from "@/components/shared/debug-panel";
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
				data-theme="exchange"
				className="flex min-h-screen items-center justify-center bg-background"
			>
				<div className="animate-pulse text-muted-foreground">Loading...</div>
			</div>
		);
	}

	return (
		<div
			data-theme="exchange"
			className="min-h-screen bg-background font-mono text-sm selection:bg-primary/30"
		>
			<ExchangeHeader
				activeSection={activeSection}
				onSectionChange={setActiveSection}
				isAuthenticated={isAuthenticated}
				isVerified={isSteppedUp}
				onConnect={() => {
					if (dcrReady) handleSignIn();
				}}
				onSignOut={handleSignOut}
			/>

			<main className="p-4 md:p-6 max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
				<div className="lg:col-span-3 space-y-6">
					{isAuthenticated ? (
						<div className="p-4 rounded-lg bg-card border border-border shadow-sm">
							<h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-4 font-bold">
								Account Status
							</h3>
							<div className="flex items-center gap-3 mb-4">
								<div className="size-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
									{session?.user.email?.substring(0, 2).toUpperCase()}
								</div>
								<div className="overflow-hidden">
									<p className="truncate font-bold text-foreground">
										{session?.user.email}
									</p>
									<p className="text-xs text-primary">
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
									<span className="text-muted-foreground">Withdrawal Limit</span>
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
						</div>
					) : (
						<div className="p-4 rounded-lg bg-card border border-border shadow-sm space-y-4">
							<div className="flex items-center gap-2.5 mb-2">
								<div className="flex size-6 items-center justify-center rounded bg-primary text-primary-foreground">
									<HugeiconsIcon icon={FlashIcon} size={14} />
								</div>
								<span className="text-sm font-bold tracking-tighter uppercase">
									Nova<span className="text-primary">X</span>
								</span>
							</div>
							<p className="text-xs text-muted-foreground">
								Connect with Zentity to start trading crypto with
								privacy-preserving KYC.
							</p>
							<DcrRegistration
								providerId={scenario.id}
								clientName={scenario.dcr.clientName}
								defaultScopes={scenario.dcr.defaultScopes}
								onRegistered={handleDcrRegistered}
							/>
						</div>
					)}

					<div className="p-4 rounded-lg bg-card border border-border shadow-sm">
						<h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-4 font-bold">
							Market Ticker
						</h3>
						<div className="space-y-3">
							<div className="flex justify-between items-center bg-background/50 p-2 rounded">
								<span className="font-bold">BTC/USD</span>
								<span className="text-success">$64,231.40</span>
							</div>
							<div className="flex justify-between items-center bg-background/50 p-2 rounded">
								<span className="font-bold">ETH/USD</span>
								<span className="text-destructive">$3,412.10</span>
							</div>
							<div className="flex justify-between items-center bg-background/50 p-2 rounded">
								<span className="font-bold">SOL/USD</span>
								<span className="text-success">$148.50</span>
							</div>
						</div>
					</div>

					<div className="hidden lg:flex items-center justify-center">
						<Link
							href="/"
							className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 text-xs uppercase tracking-wider"
						>
							<HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
							Demos
						</Link>
					</div>
				</div>

				<div className="lg:col-span-9 space-y-6">
					{activeSection === "portfolio" && isAuthenticated && (
						<div className="animate-in fade-in zoom-in-95 duration-300">
							<ExchangePortfolio
								isVerified={isSteppedUp}
								onDeposit={handleStepUp}
							/>
						</div>
					)}
					{activeSection === "markets" && (
						<div className="animate-in fade-in zoom-in-95 duration-300">
							<ExchangeMarkets />
						</div>
					)}
					{activeSection === "trade" && isAuthenticated && (
						<div className="animate-in fade-in zoom-in-95 duration-300">
							<ExchangeTrade isVerified={isSteppedUp} onStepUp={handleStepUp} />
						</div>
					)}
				</div>
			</main>

			<DebugPanel
				claims={claims}
				session={session}
				notShared={scenario.notShared}
				isComplete={isSteppedUp}
			/>
		</div>
	);
}
