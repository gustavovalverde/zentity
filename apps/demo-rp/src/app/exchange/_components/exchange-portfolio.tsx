import { Shield01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HOLDINGS, totalPortfolioValue } from "@/data/exchange";
import { ExchangeHoldingRow } from "./exchange-holding-row";

interface ExchangePortfolioProps {
  isVerified: boolean;
  onDeposit: () => void;
}

export function ExchangePortfolio({
  isVerified,
  onDeposit,
}: ExchangePortfolioProps) {
  if (!isVerified) {
    return (
      <Card className="border-border/40">
        <CardContent className="py-16 text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-secondary">
            <svg
              aria-hidden="true"
              className="size-8 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h3 className="font-bold font-mono text-lg">No holdings yet</h3>
          <p className="mx-auto mt-2 max-w-xs text-muted-foreground text-sm">
            Deposit funds to start trading. Identity verification is required
            for regulatory compliance.
          </p>
          <Button className="mt-6 gap-2" onClick={onDeposit} size="lg">
            <HugeiconsIcon icon={Shield01Icon} size={16} />
            Deposit
          </Button>
        </CardContent>
      </Card>
    );
  }

  const total = totalPortfolioValue(HOLDINGS);
  const change24h = HOLDINGS.reduce(
    (sum, h) => sum + h.amount * h.price * (h.change24h / 100),
    0
  );
  const changePercent = (change24h / (total - change24h)) * 100;
  const isPositive = change24h >= 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success/5 p-3">
        <span className="size-2 rounded-full bg-success" />
        <p className="font-medium text-sm text-success">
          Demo portfolio credited &mdash; you&apos;re ready to trade.
        </p>
      </div>

      <Card className="border-primary/20 bg-card/60 shadow-[0_0_20px_rgba(var(--primary),0.1)] backdrop-blur-sm">
        <CardContent className="grid grid-cols-1 gap-8 pt-6 md:grid-cols-3">
          <div>
            <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
              Total Balance
            </p>
            <p className="mt-1 font-bold font-mono text-5xl text-foreground tracking-tighter">
              $
              {total.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </div>

          <div className="flex flex-col justify-end">
            <div
              className={`flex items-center gap-2 font-bold font-mono text-lg ${isPositive ? "text-success" : "text-destructive"}`}
            >
              <svg
                className={`size-5 ${isPositive ? "" : "rotate-180"}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                viewBox="0 0 24 24"
              >
                <path
                  d="M4.5 15.75l7.5-7.5 7.5 7.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {changePercent.toFixed(2)}%
              <span className="font-normal text-sm opacity-70">24h</span>
            </div>
            <p
              className={`font-mono text-sm ${isPositive ? "text-success/70" : "text-destructive/70"}`}
            >
              {isPositive ? "+" : ""}$
              {Math.abs(change24h).toLocaleString("en-US", {
                minimumFractionDigits: 2,
              })}
            </p>
          </div>

          <div className="flex items-center gap-4 border-border/20 border-l pl-6">
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase">
                Est. BTC Value
              </p>
              <p className="font-mono text-xl">
                {(total / 64_231).toFixed(8)} BTC
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-border/40">
        <CardHeader className="border-border/40 border-b bg-secondary/20 py-3">
          <CardTitle className="flex items-center gap-2 font-mono text-sm uppercase tracking-wider">
            Your Assets
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="divide-y divide-border/40">
              <div className="flex bg-secondary/10 px-4 py-2 font-semibold text-muted-foreground text-xs uppercase">
                <div className="w-1/4">Asset</div>
                <div className="w-1/4 text-right">Price</div>
                <div className="w-1/4 text-right">Balance</div>
                <div className="w-1/4 text-right">Value</div>
              </div>
              {HOLDINGS.map((h) => (
                <ExchangeHoldingRow holding={h} key={h.symbol} />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
