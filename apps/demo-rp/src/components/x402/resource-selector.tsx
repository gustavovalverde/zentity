import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/components/ui/badge";
import { WalletConnect } from "@/components/x402/wallet-connect";
import type { X402FlowState, X402Resource } from "@/data/x402";

interface ResourceSelectorProps {
  onReset: () => void;
  onSelect: (resource: X402Resource) => void;
  resources: X402Resource[];
  selected: X402Resource | null;
  state: X402FlowState;
}

function tierLabel(tier: number): string {
  if (tier === 0) {
    return "Payment Only";
  }
  if (tier === 2) {
    return "Tier 2+";
  }
  if (tier === 3) {
    return "Tier 3 + On-Chain";
  }
  return `Tier ${tier}+`;
}

export function ResourceSelector({
  resources,
  selected,
  state,
  onSelect,
  onReset,
}: ResourceSelectorProps) {
  const isActive = state !== "idle";
  const isTerminal = state === "success" || state === "denied";

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
          Resources
        </h3>
        {isTerminal && (
          <button
            className="rounded px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-secondary hover:text-foreground"
            onClick={onReset}
            type="button"
          >
            Reset
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {resources.map((r) => {
          const isSelected = selected?.id === r.id;
          const isDisabled = isActive && !isSelected;

          let cardStyle =
            "border-border/50 hover:border-primary/30 hover:bg-primary/5";
          if (isSelected) {
            cardStyle = "border-primary/50 bg-primary/5 ring-1 ring-primary/30";
          } else if (isDisabled) {
            cardStyle = "pointer-events-none border-border/30 opacity-40";
          }

          return (
            <button
              className={`relative rounded-lg border p-3 text-left transition-all ${cardStyle}`}
              disabled={isDisabled}
              key={r.id}
              onClick={() => onSelect(r)}
              type="button"
            >
              <div className="mb-2 flex items-center gap-2">
                <HugeiconsIcon
                  className="text-muted-foreground"
                  icon={r.icon}
                  size={16}
                />
                <span className="font-medium text-xs">{r.name}</span>
              </div>
              <p className="mb-2 text-[10px] text-muted-foreground leading-tight">
                {r.description}
              </p>
              <Badge
                className="text-[9px]"
                variant={r.requiredTier === 0 ? "secondary" : "default"}
              >
                {tierLabel(r.requiredTier)}
              </Badge>
            </button>
          );
        })}
      </div>

      {!isActive && (
        <div className="space-y-1">
          <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
            Wallet (for regulated tier)
          </span>
          <WalletConnect />
        </div>
      )}
    </div>
  );
}
