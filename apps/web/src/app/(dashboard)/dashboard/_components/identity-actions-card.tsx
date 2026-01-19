import type { AssuranceState } from "@/lib/assurance/types";

import {
  ArrowRight,
  FileCheck2,
  Link as LinkIcon,
  Lock,
  Shield,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { canAccessFeature } from "@/lib/assurance/features";
import { cn } from "@/lib/utils/classname";

interface IdentityActionsCardProps {
  assuranceState: AssuranceState | null;
  web3Enabled: boolean;
  hasPasskeys: boolean;
}

/**
 * Identity Actions Card - Shows what users can do with their identity.
 * Displays available actions with locked state for features requiring higher tiers.
 */
export function IdentityActionsCard({
  assuranceState,
  web3Enabled,
  hasPasskeys,
}: Readonly<IdentityActionsCardProps>) {
  const tier = assuranceState?.tier ?? 0;
  const authStrength = assuranceState?.authStrength ?? "basic";

  const canAttest = canAccessFeature("attestation", tier, authStrength);

  const needsStrongAuthForAttestation = tier >= 2 && authStrength !== "strong";
  let attestationPasskeyAction: "auth" | "enroll" | undefined;
  if (!canAttest && needsStrongAuthForAttestation) {
    attestationPasskeyAction = hasPasskeys ? "auth" : "enroll";
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Shield className="h-5 w-5 text-success" />
          What You Can Do
        </CardTitle>
        <CardDescription>
          {tier >= 2
            ? "Use your verified identity across different platforms"
            : "Complete verification to unlock more features"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className={web3Enabled ? "grid gap-3 sm:grid-cols-2" : "space-y-3"}
        >
          {/* Get Credentials - available at Tier 2 */}
          <ActionCard
            actionHref="/dashboard/credentials"
            actionLabel="Get Credentials"
            description="Export your verified claims to any compatible wallet using OIDC4VCI."
            icon={FileCheck2}
            locked={tier < 2}
            requiredTier={2}
            title="Verifiable Credentials"
          />

          {/* On-Chain Attestation - requires Tier 2 + strong auth */}
          {web3Enabled && (
            <ActionCard
              actionHref="/dashboard/attestation"
              actionLabel="Go On-Chain"
              badge="Web3"
              description="Register your identity on-chain for DeFi and Web3 access with encrypted data."
              icon={LinkIcon}
              locked={!canAttest}
              passkeyAction={attestationPasskeyAction}
              requiredTier={2}
              title="On-Chain Attestation"
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface ActionButtonProps {
  actionHref: string;
  actionLabel: string;
  locked: boolean;
  passkeyAction?: "auth" | "enroll";
}

function ActionButton({
  actionHref,
  actionLabel,
  locked,
  passkeyAction,
}: Readonly<ActionButtonProps>) {
  if (passkeyAction === "enroll") {
    return (
      <Button asChild variant="outline">
        <Link href="/dashboard/settings">
          Add Passkey
          <ArrowRight className="ml-2 h-4 w-4" />
        </Link>
      </Button>
    );
  }

  if (passkeyAction === "auth") {
    return (
      <Button asChild variant="outline">
        <Link href={actionHref}>
          Continue with Passkey
          <ArrowRight className="ml-2 h-4 w-4" />
        </Link>
      </Button>
    );
  }

  if (locked) {
    return (
      <Button asChild variant="outline">
        <Link href="/dashboard/verify">
          Unlock with Verification
          <ArrowRight className="ml-2 h-4 w-4" />
        </Link>
      </Button>
    );
  }

  return (
    <Button asChild variant="outline">
      <Link href={actionHref}>
        {actionLabel}
        <ArrowRight className="ml-2 h-4 w-4" />
      </Link>
    </Button>
  );
}

interface ActionCardProps {
  title: string;
  description: string;
  icon: React.ElementType;
  actionLabel: string;
  actionHref: string;
  locked: boolean;
  requiredTier: number;
  badge?: string;
  passkeyAction?: "auth" | "enroll";
}

function ActionCard({
  title,
  description,
  icon: Icon,
  actionLabel,
  actionHref,
  locked,
  requiredTier,
  badge,
  passkeyAction,
}: Readonly<ActionCardProps>) {
  // When tier is met but auth is not, show passkey guidance
  const needsPasskey = locked && Boolean(passkeyAction);

  return (
    <div
      className={cn(
        "relative flex flex-col justify-between rounded-lg border p-4 transition-colors",
        locked && "bg-muted/30"
      )}
    >
      <div className="mb-3">
        <div className="mb-2 flex items-center gap-2">
          <Icon
            className={cn(
              "h-5 w-5",
              locked ? "text-muted-foreground" : "text-info"
            )}
          />
          <span
            className={cn("font-medium", locked && "text-muted-foreground")}
          >
            {title}
          </span>
          {badge && <Badge variant="secondary">{badge}</Badge>}
          {needsPasskey && (
            <Badge className="gap-1" variant="outline">
              <Lock className="h-3 w-3" />
              Passkey
            </Badge>
          )}
          {locked && !needsPasskey && (
            <Badge className="gap-1" variant="outline">
              <Lock className="h-3 w-3" />
              Tier {requiredTier}
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground text-sm">{description}</p>
        {passkeyAction === "auth" && (
          <p className="mt-2 text-warning text-xs">
            Requires passkey authentication
          </p>
        )}
        {passkeyAction === "enroll" && (
          <p className="mt-2 text-warning text-xs">
            Add a passkey to unlock on-chain attestation
          </p>
        )}
      </div>

      <ActionButton
        actionHref={actionHref}
        actionLabel={actionLabel}
        locked={locked}
        passkeyAction={passkeyAction}
      />
    </div>
  );
}
