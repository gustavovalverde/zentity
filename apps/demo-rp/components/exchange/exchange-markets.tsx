import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MARKET_DATA } from "@/data/exchange";

export function ExchangeMarkets() {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Markets</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="overflow-x-auto">
					<table className="w-full">
						<thead>
							<tr className="border-b text-left text-xs text-muted-foreground">
								<th className="pb-3 font-medium">Asset</th>
								<th className="pb-3 text-right font-medium">Price</th>
								<th className="pb-3 text-right font-medium">24h Change</th>
								<th className="pb-3 text-right font-medium">Volume</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-border">
							{MARKET_DATA.map((asset) => {
								const isPositive = asset.change24h >= 0;
								return (
									<tr key={asset.symbol}>
										<td className="py-3">
											<div className="flex items-center gap-3">
												<div className="flex size-8 items-center justify-center rounded-full bg-secondary font-mono text-xs font-bold">
													{asset.symbol.slice(0, 2)}
												</div>
												<div>
													<p className="text-sm font-medium">{asset.name}</p>
													<p className="font-mono text-xs text-muted-foreground">
														{asset.symbol}
													</p>
												</div>
											</div>
										</td>
										<td className="py-3 text-right font-mono text-sm">
											$
											{asset.price.toLocaleString("en-US", {
												minimumFractionDigits: 2,
												maximumFractionDigits: 2,
											})}
										</td>
										<td
											className={`py-3 text-right font-mono text-sm ${isPositive ? "text-success" : "text-destructive"}`}
										>
											{isPositive ? "+" : ""}
											{asset.change24h.toFixed(2)}%
										</td>
										<td className="py-3 text-right font-mono text-sm text-muted-foreground">
											{asset.volume}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</CardContent>
		</Card>
	);
}
