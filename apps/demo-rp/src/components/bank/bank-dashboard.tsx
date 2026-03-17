import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BALANCE, TRANSACTIONS } from "@/data/bank";
import { BankTransactionItem } from "./bank-transaction-item";

interface BankDashboardProps {
  claims?: Record<string, unknown> | undefined;
}

export function BankDashboard({ claims }: BankDashboardProps) {
  const name = claims?.name as string | undefined;
  const cardholderName = name ? name.toUpperCase() : "ACCOUNT HOLDER";

  return (
    <div className="space-y-8">
      {name && (
        <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 p-4">
          <div className="flex size-8 items-center justify-center rounded-full bg-success/15">
            <HugeiconsIcon
              className="text-success"
              icon={CheckmarkCircle02Icon}
              size={18}
            />
          </div>
          <p className="font-medium text-sm">
            Welcome, {name}. Your account is now active.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Left Column: Cards & Assets */}
        <div className="space-y-8 lg:col-span-2">
          {/* Metal Card Visual */}
          <div className="group relative flex h-64 w-full flex-col justify-between overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-br from-[#1a1a1a] via-[#2a2a2a] to-[#0a0a0a] p-8 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)] md:w-96">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-white/0 via-white/5 to-white/0 opacity-0 transition-opacity duration-700 group-hover:opacity-100" />

            <div className="z-10 flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-sm bg-white/10 backdrop-blur">
                  <div className="size-4 rounded-full bg-white/20" />
                </div>
                <span className="font-medium text-[10px] text-white/50 uppercase tracking-[0.2em]">
                  Velocity Private
                </span>
              </div>
              <span className="font-serif text-lg text-white italic opacity-80">
                Infinite
              </span>
            </div>

            <div className="z-10 space-y-6">
              <div className="flex items-center gap-4">
                <div className="flex h-8 w-12 items-center justify-center rounded border border-[#d4af37]/40 bg-[#d4af37]/20">
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
                <p className="mb-1 text-[10px] text-white/40 uppercase tracking-wider">
                  Available Balance
                </p>
                <p className="font-medium font-mono text-3xl text-white tracking-tight">
                  {BALANCE.toLocaleString("en-US", {
                    style: "currency",
                    currency: "USD",
                  })}
                </p>
              </div>
            </div>

            <div className="z-10 flex items-end justify-between font-mono text-white/60 text-xs tracking-widest">
              <span>{cardholderName}</span>
              <span>12/28</span>
            </div>
          </div>

          {/* Asset Breakdown */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              { label: "Checking", amount: 15_420.5, change: "+2.4%" },
              { label: "Savings", amount: 84_300.0, change: "+0.1%" },
              { label: "Investments", amount: 245_000.0, change: "+5.2%" },
              { label: "Rewards", amount: 1250.0, change: "" },
            ].map((asset) => (
              <div
                className="rounded-xl border bg-card p-4 shadow-sm"
                key={asset.label}
              >
                <p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
                  {asset.label}
                </p>
                <p className="mt-1 font-medium font-mono text-lg">
                  ${asset.amount.toLocaleString()}
                </p>
                {asset.change && (
                  <p className="mt-1 text-success text-xs">{asset.change}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Transactions */}
        <div className="lg:col-span-1">
          <Card className="h-full border-none bg-transparent shadow-none">
            <CardHeader className="px-0 pt-0">
              <CardTitle className="flex items-center justify-between font-medium text-base">
                <span>Recent Activity</span>
                <span className="cursor-pointer text-primary text-xs hover:underline">
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
