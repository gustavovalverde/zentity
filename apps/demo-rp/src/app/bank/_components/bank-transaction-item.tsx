import type { Transaction } from "@/data/bank";

interface Props {
  transaction: Transaction;
}

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
    <div className="group flex items-center justify-between border-border/40 border-b px-2 py-3 transition-colors last:border-0 hover:bg-muted/50">
      <div className="flex items-center gap-4">
        {/* Minimalist Logo Placeholder */}
        <div className="flex size-8 items-center justify-center rounded-full border border-border/50 bg-secondary font-medium text-[10px] text-muted-foreground">
          {initials}
        </div>
        <div>
          <p className="font-medium text-sm leading-none">
            {transaction.merchant}
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground tracking-tight">
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
