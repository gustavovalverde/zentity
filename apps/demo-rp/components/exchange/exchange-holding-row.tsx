import type { Holding } from "@/data/exchange";

type Props = {
	holding: Holding;
};

export function ExchangeHoldingRow({ holding }: Props) {
	const value = holding.amount * holding.price;
	const isPositive = holding.change24h >= 0;

	return (
		<div className="flex items-center py-3 px-4 hover:bg-muted/50 transition-colors group">
			<div className="w-1/4 flex items-center gap-3">
				<div className="flex size-8 items-center justify-center rounded bg-secondary font-mono text-[10px] font-bold group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
					{holding.symbol.slice(0, 1)}
				</div>
				<div>
					<p className="text-sm font-bold font-mono">{holding.symbol}</p>
					<p className="text-[10px] text-muted-foreground uppercase">
						{holding.name}
					</p>
				</div>
			</div>
			<div className="w-1/4 text-right font-mono text-sm">
				$
				{holding.price.toLocaleString("en-US", {
					minimumFractionDigits: 2,
					maximumFractionDigits: 2,
				})}
			</div>
			<div className="w-1/4 text-right font-mono text-sm text-muted-foreground">
				{holding.amount}
			</div>
			<div className="w-1/4 text-right">
				<p className="font-mono text-sm font-bold">
					$
					{value.toLocaleString("en-US", {
						minimumFractionDigits: 2,
						maximumFractionDigits: 2,
					})}
				</p>
				<p
					className={`font-mono text-xs ${isPositive ? "text-success" : "text-destructive"}`}
				>
					{isPositive ? "+" : ""}
					{holding.change24h.toFixed(2)}%
				</p>
			</div>
		</div>
	);
}
