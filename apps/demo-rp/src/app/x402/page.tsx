"use client";

import { ArrowLeft01Icon, BlockchainIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useState } from "react";
import { WagmiProvider } from "wagmi";

import { DcrRegistration } from "@/components/shared/dcr-registration";
import { Button } from "@/components/ui/button";
import { ComplianceOracle } from "@/components/x402/compliance-oracle";
import { ProtocolTrace } from "@/components/x402/protocol-trace";
import { ResourceSelector } from "@/components/x402/resource-selector";
import { useWalletAddress } from "@/components/x402/wallet-connect";
import { RESOURCES } from "@/data/x402";
import { useOAuthFlow } from "@/hooks/use-oauth-flow";
import { useX402Flow } from "@/hooks/use-x402-flow";
import { getScenario } from "@/lib/scenarios";
import { wagmiConfig } from "@/lib/wagmi-config";

const scenario = getScenario("x402");
const queryClient = new QueryClient();

function X402Demo() {
	const { session, isPending, isAuthenticated, handleSignIn, handleSignOut } =
		useOAuthFlow(scenario);

	const {
		accessOutcome,
		state,
		traces,
		pohClaims,
		selectedResource,
		accessResource,
		reset,
	} = useX402Flow();

	const walletAddress = useWalletAddress();
	const [dcrReady, setDcrReady] = useState(false);
	const handleDcrRegistered = useCallback(() => setDcrReady(true), []);

	// --- Loading ---
	if (isPending) {
		return (
			<div
				className="flex min-h-screen items-center justify-center bg-background"
				data-theme="x402"
			>
				<div className="flex flex-col items-center gap-4">
					<div className="size-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
					<div className="font-medium font-mono text-muted-foreground text-sm">
						Initializing protocol...
					</div>
				</div>
			</div>
		);
	}

	// --- Unauthenticated ---
	if (!isAuthenticated) {
		return (
			<div
				className="flex min-h-screen flex-col bg-surface-dark font-sans text-white selection:bg-primary/20"
				data-theme="x402"
			>
				<header className="flex items-center justify-between border-white/5 border-b px-8 py-6">
					<div className="flex items-center gap-3">
						<div className="flex size-10 items-center justify-center rounded bg-primary text-primary-foreground">
							<HugeiconsIcon icon={BlockchainIcon} size={24} />
						</div>
						<div>
							<span className="font-bold font-mono text-2xl tracking-tight">
								x402
							</span>
							<span className="block text-[10px] uppercase tracking-[0.3em] opacity-70">
								Machine Commerce
							</span>
						</div>
					</div>
					<Link
						className="flex items-center gap-1.5 text-sm text-white/40 transition-colors hover:text-white/70"
						href="/"
					>
						<HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
						Demos
					</Link>
				</header>

				<div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6">
					<div className="pointer-events-none absolute top-1/4 -right-20 size-96 rounded-full bg-primary/5 blur-3xl" />
					<div className="pointer-events-none absolute bottom-1/4 -left-20 size-96 rounded-full bg-accent/5 blur-3xl" />

					<div className="relative z-10 w-full max-w-md space-y-12 text-center">
						<div className="space-y-6">
							<h1 className="font-bold font-mono text-5xl leading-tight md:text-6xl">
								Proof of
								<br />
								<span className="text-primary">Human</span>
							</h1>
							<p className="mx-auto max-w-sm font-light text-lg text-white/60 leading-relaxed">
								Autonomous agents need to pay for services, but compliance rules
								still apply. Zentity issues a Proof-of-Human token: a compact
								attestation of the user's verification tier and sybil
								resistance, with no identity data attached. Services can enforce
								per-human rate limits and gate access by compliance tier.
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
								className="h-14 w-full bg-primary font-bold font-mono text-lg text-primary-foreground uppercase tracking-widest transition-all hover:bg-primary/80 disabled:opacity-40"
								disabled={!dcrReady}
								onClick={handleSignIn}
								size="lg"
							>
								Connect
							</Button>
							<p className="text-white/30 text-xs">
								Sign in with Zentity to explore the x402 protocol flow
							</p>
						</div>
					</div>
				</div>

				<footer className="border-white/5 border-t py-6 text-center font-mono text-white/20 text-xs">
					x402 Protocol Demo &bull; Proof-of-Human &bull; FHEVM Oracle
				</footer>
			</div>
		);
	}

	// --- Authenticated: Split-screen demo ---
	return (
		<div className="flex min-h-screen flex-col bg-background" data-theme="x402">
			{/* Header */}
			<header className="flex items-center justify-between border-border/50 border-b px-4 py-3">
				<div className="flex items-center gap-3">
					<div className="flex size-8 items-center justify-center rounded bg-primary text-primary-foreground">
						<HugeiconsIcon icon={BlockchainIcon} size={18} />
					</div>
					<span className="font-bold font-mono text-lg tracking-tight">
						x402
					</span>
				</div>
				<div className="flex items-center gap-3">
					<span className="font-mono text-muted-foreground text-xs">
						{session?.user?.email}
					</span>
					<Button
						className="text-muted-foreground"
						onClick={handleSignOut}
						size="sm"
						variant="ghost"
					>
						Sign Out
					</Button>
				</div>
			</header>

			{/* Split-screen */}
			<div className="mx-auto flex w-full max-w-7xl flex-1 flex-col lg:flex-row">
				{/* Left: Protocol Exchange */}
				<div className="flex flex-1 flex-col border-border/50 border-b lg:border-r lg:border-b-0">
					<ResourceSelector
						onReset={reset}
						onSelect={(r) =>
							accessResource(r, r.requireOnChain ? walletAddress : undefined)
						}
						resources={RESOURCES}
						selected={selectedResource}
						state={state}
					/>
					<div className="border-border/30 border-t" />
					<ProtocolTrace traces={traces} />
				</div>

				{/* Right: Compliance Oracle */}
				<div className="w-full overflow-y-auto lg:w-[420px]">
					<ComplianceOracle
						accessOutcome={accessOutcome}
						pohClaims={pohClaims}
						selectedResource={selectedResource}
					/>
				</div>
			</div>
		</div>
	);
}

export default function X402Page() {
	return (
		<WagmiProvider config={wagmiConfig}>
			<QueryClientProvider client={queryClient}>
				<X402Demo />
			</QueryClientProvider>
		</WagmiProvider>
	);
}
