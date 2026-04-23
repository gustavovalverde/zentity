import { Badge } from "@/components/ui/badge";
import { Redacted } from "@/components/ui/redacted";
import { CLAIM_LABELS } from "@/scenarios/veripass/verifier-registry";

interface ClaimListProps {
  claims: Record<string, unknown>;
  onToggle: (key: string) => void;
  presentableKeys: string[];
  requiredClaims?: string[];
  selectedClaims: Set<string>;
}

export function ClaimList({
  claims,
  presentableKeys,
  selectedClaims,
  requiredClaims = [],
  onToggle,
}: ClaimListProps) {
  const requiredSet = new Set(requiredClaims);

  return (
    <div className="space-y-2">
      {presentableKeys.map((key) => {
        const isRequired = requiredSet.has(key);
        const isSelected = selectedClaims.has(key);
        const value = claims[key];

        return (
          <label
            className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
              isSelected
                ? "border-primary/30 bg-primary/5"
                : "hover:bg-muted/50"
            } ${isRequired ? "ring-1 ring-primary/20" : ""}`}
            key={key}
          >
            <input
              checked={isSelected}
              className="size-4 rounded border-border accent-primary"
              disabled={isRequired}
              onChange={() => onToggle(key)}
              type="checkbox"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">
                  {CLAIM_LABELS[key] || key}
                </span>
                {isRequired && (
                  <Badge className="px-1.5 py-0 text-[10px]" variant="outline">
                    Required
                  </Badge>
                )}
              </div>
              <div className="truncate font-mono text-muted-foreground text-xs">
                <Redacted>{formatClaimValue(value)}</Redacted>
              </div>
            </div>
          </label>
        );
      })}
    </div>
  );
}

function formatClaimValue(value: unknown): string {
  if (value === true) {
    return "Yes";
  }
  if (value === false) {
    return "No";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}
