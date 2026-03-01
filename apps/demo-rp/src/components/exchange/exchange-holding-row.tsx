import type { Holding } from "@/data/exchange";

interface Props {
  holding: Holding;
}

export function ExchangeHoldingRow({ holding }: Props) {
  const value = holding.amount * holding.price;
  const isPositive = holding.change24h >= 0;

  return (
    <div className="group flex items-center px-4 py-3 transition-colors hover:bg-muted/50">
      <div className="flex w-1/4 items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded bg-secondary font-bold font-mono text-[10px] transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
          {holding.symbol.slice(0, 1)}
        </div>
        <div>
          <p className="font-bold font-mono text-sm">{holding.symbol}</p>
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
      <div className="w-1/4 text-right font-mono text-muted-foreground text-sm">
        {holding.amount}
      </div>
      <div className="w-1/4 text-right">
        <p className="font-bold font-mono text-sm">
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
