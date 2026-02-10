import type { Transaction } from "@/data/bank";

type Props = {
	transaction: Transaction;
};

export function BankTransactionItem({ transaction }: Props) {
	const isIncome = transaction.amount > 0;

	// Get initials for the "logo" placeholder
	const initials = transaction.merchant
		.split(" ")
		.map((n) => n[0])
		.join("")
		.substring(0, 2)
		.toUpperCase();

	return (
		<div className="flex items-center justify-between py-3 px-2 group hover:bg-muted/50 transition-colors border-b border-border/40 last:border-0">
			<div className="flex items-center gap-4">
				{/* Minimalist Logo Placeholder */}
				<div className="flex size-8 items-center justify-center rounded-full bg-secondary text-[10px] font-medium text-muted-foreground border border-border/50">
					{initials}
				</div>
				<div>
					<p className="text-sm font-medium leading-none">
						{transaction.merchant}
					</p>
					<p className="text-[11px] text-muted-foreground mt-1 font-mono tracking-tight">
						{transaction.date}
					</p>
				</div>
			</div>
			<div className="text-right">
				<span
					className={`font-mono text-sm ${isIncome ? "text-success" : "text-foreground"}`}
				>
					{isIncome ? "+" : ""}
					{transaction.amount.toLocaleString("en-US", {
						style: "currency",
						currency: "USD",
					})}
				</span>
				<p className="text-[10px] text-muted-foreground uppercase tracking-wider">
					{transaction.category}
				</p>
			</div>
		</div>
	);
}
