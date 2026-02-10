import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BALANCE, TRANSACTIONS } from "@/data/bank";
import { BankTransactionItem } from "./bank-transaction-item";

type BankDashboardProps = {
	claims?: Record<string, unknown>;
};

export function BankDashboard({ claims }: BankDashboardProps) {
	const givenName = claims?.given_name as string | undefined;
	const familyName = claims?.family_name as string | undefined;
	const cardholderName =
		givenName && familyName
			? `${givenName} ${familyName}`.toUpperCase()
			: "ACCOUNT HOLDER";

	return (
		<div className="space-y-8">
			{givenName && (
				<div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 p-4">
					<div className="flex size-8 items-center justify-center rounded-full bg-success/15">
						<HugeiconsIcon
							icon={CheckmarkCircle02Icon}
							size={18}
							className="text-success"
						/>
					</div>
					<p className="text-sm font-medium">
						Welcome, {givenName}. Your account is now active.
					</p>
				</div>
			)}

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
				{/* Left Column: Cards & Assets */}
				<div className="lg:col-span-2 space-y-8">
					{/* Metal Card Visual */}
					<div className="relative h-64 w-full md:w-96 rounded-2xl bg-gradient-to-br from-[#1a1a1a] via-[#2a2a2a] to-[#0a0a0a] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)] border border-white/5 p-8 flex flex-col justify-between overflow-hidden group">
						<div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/5 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

						<div className="flex justify-between items-start z-10">
							<div className="flex items-center gap-2">
								<div className="size-8 rounded-sm bg-white/10 backdrop-blur flex items-center justify-center">
									<div className="size-4 rounded-full bg-white/20" />
								</div>
								<span className="text-white/50 text-[10px] tracking-[0.2em] font-medium uppercase">
									Velocity Private
								</span>
							</div>
							<span className="text-white font-serif italic text-lg opacity-80">
								Infinite
							</span>
						</div>

						<div className="space-y-6 z-10">
							<div className="flex items-center gap-4">
								<div className="h-8 w-12 rounded bg-[#d4af37]/20 border border-[#d4af37]/40 flex items-center justify-center">
									<div className="size-full bg-cover opacity-80" />
								</div>
								<div className="flex gap-1">
									<div className="size-2 rounded-full bg-white/20" />
									<div className="size-2 rounded-full bg-white/20" />
									<div className="size-2 rounded-full bg-white/20" />
									<div className="size-2 rounded-full bg-white/20" />
								</div>
							</div>

							<div>
								<p className="text-white/40 text-[10px] uppercase tracking-wider mb-1">
									Available Balance
								</p>
								<p className="text-3xl text-white font-medium tracking-tight font-mono">
									{BALANCE.toLocaleString("en-US", {
										style: "currency",
										currency: "USD",
									})}
								</p>
							</div>
						</div>

						<div className="flex justify-between items-end z-10 text-white/60 text-xs font-mono tracking-widest">
							<span>{cardholderName}</span>
							<span>12/28</span>
						</div>
					</div>

					{/* Asset Breakdown */}
					<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
						{[
							{ label: "Checking", amount: 15420.5, change: "+2.4%" },
							{ label: "Savings", amount: 84300.0, change: "+0.1%" },
							{ label: "Investments", amount: 245000.0, change: "+5.2%" },
							{ label: "Rewards", amount: 1250.0, change: "" },
						].map((asset) => (
							<div
								key={asset.label}
								className="p-4 rounded-xl bg-card border shadow-sm"
							>
								<p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
									{asset.label}
								</p>
								<p className="text-lg font-medium mt-1 font-mono">
									${asset.amount.toLocaleString()}
								</p>
								{asset.change && (
									<p className="text-xs text-success mt-1">{asset.change}</p>
								)}
							</div>
						))}
					</div>
				</div>

				{/* Right Column: Transactions */}
				<div className="lg:col-span-1">
					<Card className="h-full border-none shadow-none bg-transparent">
						<CardHeader className="px-0 pt-0">
							<CardTitle className="text-base font-medium flex items-center justify-between">
								<span>Recent Activity</span>
								<span className="text-xs text-primary cursor-pointer hover:underline">
									View Ledger
								</span>
							</CardTitle>
						</CardHeader>
						<CardContent className="px-0">
							<div className="space-y-1">
								{TRANSACTIONS.map((tx) => (
									<BankTransactionItem key={tx.id} transaction={tx} />
								))}
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
