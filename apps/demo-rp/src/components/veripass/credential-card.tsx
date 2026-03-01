import {
  CheckmarkCircle02Icon,
  Shield01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

interface CredentialCardProps {
  claimCount: number;
  issuedAt: number;
  issuer: string;
}

export function CredentialCard({
  issuer,
  claimCount,
  issuedAt,
}: CredentialCardProps) {
  const issuerHost = (() => {
    try {
      return new URL(issuer).hostname;
    } catch {
      return issuer;
    }
  })();

  return (
    <Card className="overflow-hidden border-0 shadow-xl ring-1 ring-border">
      <div className="bg-gradient-to-br from-primary to-primary/80 p-6 text-primary-foreground">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={Shield01Icon} size={24} />
            <span className="font-bold text-lg">Zentity Identity</span>
          </div>
          <Badge className="border-0 bg-primary-foreground/20 text-primary-foreground text-xs">
            SD-JWT VC
          </Badge>
        </div>
        <div className="mt-6 space-y-1">
          <div className="text-primary-foreground/70 text-sm">Issued by</div>
          <div className="font-mono text-sm">{issuerHost}</div>
        </div>
      </div>
      <div className="flex items-center justify-between p-6">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-muted-foreground text-xs">Claims</div>
            <div className="font-bold text-lg">{claimCount}</div>
          </div>
          <div className="h-8 w-px bg-border" />
          <div>
            <div className="text-muted-foreground text-xs">Issued</div>
            <div className="font-medium text-sm">
              {new Date(issuedAt).toLocaleDateString()}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-success">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} />
          <span className="font-medium">Valid</span>
        </div>
      </div>
    </Card>
  );
}
