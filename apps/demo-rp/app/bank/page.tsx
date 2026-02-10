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
import { DebugPanel } from "@/components/shared/debug-panel";
import { Button } from "@/components/ui/button";
import { useOAuthFlow } from "@/hooks/use-oauth-flow";
import { getScenario } from "@/lib/scenarios";

const scenario = getScenario("bank");

type SidebarItem = {
	id: string;
	label: string;
	icon: typeof DashboardSquare01Icon;
	active?: boolean;
	locked?: boolean;
	hidden?: boolean;
};

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
				data-theme="bank"
				className="flex min-h-screen items-center justify-center bg-background"
			>
				<div className="flex flex-col items-center gap-4">
					<div className="size-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
					<div className="text-muted-foreground font-medium">
						Loading safe banking environment...
					</div>
				</div>
			</div>
		);
	}

	if (!isAuthenticated) {
		return (
			<div
				data-theme="bank"
				className="min-h-screen bg-surface-dark text-white flex flex-col font-sans selection:bg-primary/20"
			>
				<header className="px-8 py-6 flex items-center justify-between border-b border-white/5">
					<div className="flex items-center gap-3">
						<div className="flex size-10 items-center justify-center rounded-sm bg-white text-primary">
							<HugeiconsIcon icon={BankIcon} size={24} />
						</div>
						<div>
							<span className="font-serif text-2xl tracking-wide font-medium">
								VELOCITY
							</span>
							<span className="block text-[10px] tracking-[0.3em] uppercase opacity-70">
								Private Client
							</span>
						</div>
					</div>
					<div className="flex items-center gap-4">
						<Link
							href="/"
							className="text-white/40 hover:text-white/70 transition-colors flex items-center gap-1.5 text-sm"
						>
							<HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
							Demos
						</Link>
						<div className="text-sm font-light opacity-60">Est. 1894</div>
					</div>
				</header>

				<div className="flex-1 flex flex-col items-center justify-center px-6 relative overflow-hidden">
					<div className="absolute top-1/4 -right-20 size-96 bg-success/5 rounded-full blur-3xl pointer-events-none" />
					<div className="absolute bottom-1/4 -left-20 size-96 bg-primary/5 rounded-full blur-3xl pointer-events-none" />

					<div className="w-full max-w-md space-y-12 text-center relative z-10">
						<div className="space-y-6">
							<h1 className="text-5xl md:text-6xl font-serif font-medium leading-tight">
								Wealth beyond <br />
								<span className="italic text-success">measure.</span>
							</h1>
							<p className="text-lg text-white/60 font-light leading-relaxed max-w-sm mx-auto">
								Exclusive banking services tailored for the distinguished few.
								Access your portfolio with uncompromising security.
							</p>
						</div>

						<div className="space-y-4 pt-4">
							<div className="text-left [&_*]:text-white/80 [&_.border]:border-white/10">
								<DcrRegistration
									providerId={scenario.id}
									clientName={scenario.dcr.clientName}
									defaultScopes={scenario.dcr.defaultScopes}
									onRegistered={handleDcrRegistered}
								/>
							</div>
							<Button
								onClick={handleSignIn}
								disabled={!dcrReady}
								size="lg"
								className="w-full h-14 rounded-none bg-white text-primary hover:bg-secondary text-lg uppercase tracking-widest font-medium transition-all disabled:opacity-40"
							>
								Member Access
							</Button>
							<p className="text-xs text-white/30 uppercase tracking-widest">
								By Invitation Only
							</p>
						</div>
					</div>
				</div>

				<footer className="py-8 border-t border-white/5 text-center text-xs text-white/20 uppercase tracking-widest">
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
		<div data-theme="bank" className="min-h-screen bg-muted/30 flex">
			<aside className="w-64 bg-background border-r hidden md:flex flex-col sticky top-0 h-screen z-10">
				<div className="p-6 flex items-center gap-3">
					<div className="flex size-8 items-center justify-center rounded bg-primary text-primary-foreground shadow-sm">
						<HugeiconsIcon icon={BankIcon} size={20} />
					</div>
					<span className="font-bold text-lg tracking-tight">
						Velocity Bank
					</span>
				</div>

				<nav className="flex-1 px-4 space-y-1 mt-4">
					{sidebarItems
						.filter((item) => !item.hidden)
						.map((item) => (
							<button
								key={item.id}
								type="button"
								disabled={item.locked}
								className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${
									item.active
										? "bg-primary/10 text-primary"
										: item.locked
											? "text-muted-foreground/40 cursor-not-allowed"
											: "text-muted-foreground hover:bg-muted hover:text-foreground"
								}`}
							>
								<HugeiconsIcon icon={item.icon} size={20} />
								{item.label}
								{item.locked && (
									<span className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded">
										Locked
									</span>
								)}
							</button>
						))}
				</nav>

				<div className="p-4 border-t">
					<div className="flex items-center gap-3 px-2 mb-4">
						<div className="size-8 rounded-full bg-accent flex items-center justify-center text-xs font-bold text-accent-foreground">
							{session?.user.email?.substring(0, 2).toUpperCase() || "US"}
						</div>
						<div className="flex-1 min-w-0">
							<p className="text-sm font-medium truncate">
								{session?.user.email}
							</p>
							<p className="text-xs text-muted-foreground truncate">
								{isSteppedUp ? "Private Client" : "Prospect"}
							</p>
						</div>
					</div>
					<Button
						variant="outline"
						size="sm"
						className="w-full text-muted-foreground"
						onClick={handleSignOut}
					>
						Sign Out
					</Button>
				</div>
			</aside>

			<main className="flex-1 min-w-0">
				<div className="p-6 md:p-10 max-w-5xl mx-auto">
					{isSteppedUp ? (
						<div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
							<div>
								<h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
								<p className="text-muted-foreground">
									Welcome back, here&apos;s your financial overview.
								</p>
							</div>
							<BankDashboard claims={claims} />
						</div>
					) : (
						<div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
							<BankProspect onApply={handleStepUp} />
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
