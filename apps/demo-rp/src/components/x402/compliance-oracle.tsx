import { Badge } from "@/components/ui/badge";
import { SolidityPanel } from "@/components/x402/solidity-panel";
import type { AccessOutcome, PohClaims, X402Resource } from "@/data/x402";

function TierIndicator({ tier }: { tier: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3, 4].map((n) => (
        <div
          className={`size-2.5 rounded-full transition-colors ${
            n <= tier ? "bg-primary" : "bg-border"
          }`}
          key={n}
        />
      ))}
      <span className="ml-1 font-mono text-sm">Tier {tier}</span>
    </div>
  );
}

function TierCard({ pohClaims }: { pohClaims: PohClaims | null }) {
  if (!pohClaims) {
    return (
      <div className="rounded-lg border border-border/50 p-4">
        <h4 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
          Verification Tier
        </h4>
        <p className="text-muted-foreground text-sm">
          Run a request to see your verification tier
        </p>
      </div>
    );
  }

  return (
    <div className="fade-in animate-in rounded-lg border border-border/50 p-4 duration-300">
      <h4 className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">
        Verification Tier
      </h4>
      <TierIndicator tier={pohClaims.tier} />
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge variant={pohClaims.verified ? "default" : "secondary"}>
          {pohClaims.verified ? "Verified" : "Not Verified"}
        </Badge>
        <Badge variant={pohClaims.sybil_resistant ? "default" : "secondary"}>
          {pohClaims.sybil_resistant ? "Sybil Resistant" : "No Sybil Check"}
        </Badge>
        {pohClaims.method && (
          <Badge variant="outline">
            {pohClaims.method === "nfc_chip" ? "NFC Chip" : "OCR"}
          </Badge>
        )}
      </div>
    </div>
  );
}

function onChainClassName(status: string): string {
  if (status === "pass") {
    return "text-emerald-700";
  }
  if (status === "fail") {
    return "text-red-600";
  }
  return "text-muted-foreground";
}

function onChainText(status: string, error?: string): string {
  if (status === "pass") {
    return "✓ compliant";
  }
  if (status === "required") {
    return "pending";
  }
  if (error === "wallet_address_required") {
    return "✗ no wallet";
  }
  if (error === "chain_unavailable") {
    return "✗ chain down";
  }
  return "✗ not compliant";
}

function OnChainLabel({
  error,
  status,
}: {
  error?: string | undefined;
  status: string;
}) {
  return (
    <span className={onChainClassName(status)}>
      {onChainText(status, error)}
    </span>
  );
}

function RequirementCheck({
  accessOutcome,
  pohClaims,
  resource,
}: {
  accessOutcome: AccessOutcome | null;
  pohClaims: PohClaims | null;
  resource: X402Resource | null;
}) {
  if (!resource || resource.requiredTier === 0) {
    return null;
  }
  if (!pohClaims) {
    return null;
  }

  const meetsTier = pohClaims.tier >= resource.requiredTier;

  // For on-chain resources, the final verdict depends on both tier and Base mirror compliance.
  let onChainStatus: "pass" | "fail" | "required" = "pass";
  if (resource.requireOnChain) {
    if (!accessOutcome) {
      onChainStatus = "required";
    } else if (
      accessOutcome.error === "wallet_address_required" ||
      accessOutcome.error === "not_compliant_on_chain" ||
      accessOutcome.error === "chain_unavailable"
    ) {
      onChainStatus = "fail";
    } else if (accessOutcome.onChain?.status === "compliant") {
      onChainStatus = "pass";
    } else {
      onChainStatus = "required";
    }
  }

  const compliant =
    meetsTier &&
    onChainStatus === "pass" &&
    (!resource.requireOnChain || accessOutcome?.granted === true);

  return (
    <div className="fade-in animate-in rounded-lg border border-border/50 p-4 duration-300">
      <h4 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
        Requirement Check
      </h4>
      <div className="space-y-1.5 font-mono text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Required tier</span>
          <span className="font-bold text-amber-700">
            {resource.requiredTier}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Your tier</span>
          <span className={meetsTier ? "text-emerald-700" : "text-red-600"}>
            {pohClaims.tier}
          </span>
        </div>
        {resource.requireOnChain && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Base mirror</span>
            <OnChainLabel error={accessOutcome?.error} status={onChainStatus} />
          </div>
        )}
        <div className="mt-2 border-border/30 border-t pt-2">
          <span
            className={`font-bold ${compliant ? "text-emerald-700" : "text-red-600"}`}
          >
            {compliant ? "✓ Compliant" : "✗ Insufficient"}
          </span>
        </div>
      </div>
    </div>
  );
}

export function ComplianceOracle({
  accessOutcome,
  pohClaims,
  selectedResource,
}: {
  accessOutcome: AccessOutcome | null;
  pohClaims: PohClaims | null;
  selectedResource: X402Resource | null;
}) {
  return (
    <div className="space-y-4 p-4">
      <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
        Compliance Oracle
      </h3>

      <TierCard pohClaims={pohClaims} />

      <RequirementCheck
        accessOutcome={accessOutcome}
        pohClaims={pohClaims}
        resource={selectedResource}
      />

      <SolidityPanel pohClaims={pohClaims} />
    </div>
  );
}
