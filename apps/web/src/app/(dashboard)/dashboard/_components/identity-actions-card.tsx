import type { TierProfile } from "@/lib/assurance/types";

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
import { isFeatureUnlocked } from "@/lib/assurance/tier";
import { cn } from "@/lib/utils/classname";

interface IdentityActionsCardProps {
  tierProfile: TierProfile | null;
  web3Enabled: boolean;
  hasPasskeys: boolean;
}

/**
 * Identity Actions Card - Shows what users can do with their identity.
 * Displays available actions with locked state for features requiring higher tiers.
 */
export function IdentityActionsCard({
  tierProfile,
  web3Enabled,
  hasPasskeys,
}: Readonly<IdentityActionsCardProps>) {
  // Show card even if not verified - just with locked state
  const tier = tierProfile?.tier ?? 0;
  const aal = tierProfile?.aal ?? 0;

  const canExportCredentials = isFeatureUnlocked("export_bundle", tier, aal);
  const canAttest = isFeatureUnlocked("attestation", tier, aal);

  const needsAal2ForAttestation = tier >= 3 && aal < 2;
  let attestationPasskeyAction: "auth" | "enroll" | undefined;
  if (!canAttest && needsAal2ForAttestation) {
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
          {/* Get Credentials */}
          <ActionCard
            actionHref="/dashboard/credentials"
            actionLabel="Get Credentials"
            description="Export your verified claims to any compatible wallet using OIDC4VCI."
            icon={FileCheck2}
            locked={!canExportCredentials}
            requiredTier={2}
            title="Verifiable Credentials"
          />

          {/* On-Chain Attestation */}
          {web3Enabled && (
            <ActionCard
              actionHref="/dashboard/attestation"
              actionLabel="Go On-Chain"
              badge="Web3"
              description="Register your identity on-chain for DeFi and Web3 access with encrypted data."
              icon={LinkIcon}
              locked={!canAttest}
              passkeyAction={attestationPasskeyAction}
              requiredTier={3}
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
  // When tier is met but AAL is not, show passkey guidance instead of verification.
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
              AAL2
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
            Requires passkey authentication (AAL2)
          </p>
        )}
        {passkeyAction === "enroll" && (
          <p className="mt-2 text-warning text-xs">
            Add a passkey to unlock on-chain attestation (AAL2)
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
