import {
  CheckmarkCircle02Icon,
  Shield01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { VerifierScenario } from "@/data/veripass";
import { CLAIM_LABELS } from "@/data/veripass";

interface PresentationResultProps {
  disclosedClaims: Record<string, unknown>;
  onBack: () => void;
  totalClaims: number;
  verifier: VerifierScenario;
}

export function PresentationResult({
  verifier,
  disclosedClaims,
  totalClaims,
  onBack,
}: PresentationResultProps) {
  const disclosedCount = Object.keys(disclosedClaims).length;
  const privacyPercent = Math.round(
    ((totalClaims - disclosedCount) / totalClaims) * 100
  );

  return (
    <div className="space-y-6">
      <Card className="border-success/30 bg-success/5">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={28} />
            </div>
            <div>
              <h3 className="font-bold text-lg">Verification Successful</h3>
              <p className="text-muted-foreground text-sm">
                {verifier.name} received {disclosedCount} of {totalClaims}{" "}
                claims
              </p>
            </div>
          </div>

          {/* Privacy meter */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Privacy preserved</span>
              <span className="font-bold text-success">{privacyPercent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-success transition-all duration-500"
                style={{ width: `${privacyPercent}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Disclosed claims */}
      <div className="space-y-2">
        <h4 className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
          <HugeiconsIcon icon={Shield01Icon} size={14} />
          Shared with {verifier.name}
        </h4>
        <div className="space-y-1">
          {Object.entries(disclosedClaims).map(([key, value]) => (
            <div
              className="flex items-center justify-between rounded-lg border p-3"
              key={key}
            >
              <span className="font-medium text-sm">
                {CLAIM_LABELS[key] || key}
              </span>
              <Badge
                className="max-w-[200px] truncate font-mono text-xs"
                variant="secondary"
              >
                {formatValue(value)}
              </Badge>
            </div>
          ))}
        </div>
      </div>

      <Button className="w-full" onClick={onBack}>
        Back to Wallet
      </Button>
    </div>
  );
}

function formatValue(value: unknown): string {
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
