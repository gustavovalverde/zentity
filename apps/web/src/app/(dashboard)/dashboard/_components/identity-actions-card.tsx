"use client";

import type { SecurityPosture } from "@/lib/assurance/types";

import { ArrowRight, FileCheck2, Lock, Stamp, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { canAccessFeature } from "@/lib/assurance/features";
import { cn } from "@/lib/utils/classname";

import { CredentialsContent } from "./credentials-content";

interface IdentityActionsCardProps {
  posture: SecurityPosture | null;
  web3Enabled: boolean;
}

/**
 * Identity Actions Card - Shows what users can do with their identity.
 * Displays available actions with locked state for features requiring higher tiers.
 */
export function IdentityActionsCard({
  posture,
  web3Enabled,
}: Readonly<IdentityActionsCardProps>) {
  const assurance = posture?.assurance ?? null;
  const auth = posture?.auth ?? null;
  const tier = assurance?.tier ?? 0;

  const [credentialsOpen, setCredentialsOpen] = useState(false);

  const canAttest = canAccessFeature("attestation", tier, auth);

  const needsStrongAuthForAttestation =
    tier >= 2 && auth?.authStrength !== "strong";
  let attestationPasskeyAction: "auth" | "enroll" | undefined;
  if (!canAttest && needsStrongAuthForAttestation) {
    attestationPasskeyAction = posture?.capabilities.hasPasskeys
      ? "auth"
      : "enroll";
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Zap className="h-5 w-5 text-success" />
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
              actionLabel="Get Digital ID"
              description="Get a digital identity you can share with apps, choosing exactly what they can see."
              icon={FileCheck2}
              locked={tier < 2}
              onAction={() => setCredentialsOpen(true)}
              requiredTier={2}
              title="Digital ID"
            />

            {/* On-Chain Attestation - requires Tier 2 + strong auth */}
            {web3Enabled && (
              <ActionCard
                actionHref="/dashboard/attestation"
                actionLabel="Go On-Chain"
                badge="Web3"
                description="Publish your verification status on-chain for DeFi and Web3 compliance."
                icon={Stamp}
                locked={!canAttest}
                passkeyAction={attestationPasskeyAction}
                requiredTier={2}
                title="On-Chain Attestation"
              />
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog onOpenChange={setCredentialsOpen} open={credentialsOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader className="sr-only">
            <DialogTitle>Verifiable Credentials</DialogTitle>
          </DialogHeader>
          <CredentialsContent />
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ActionButtonProps {
  actionHref?: string | undefined;
  actionLabel: string;
  locked: boolean;
  onAction?: (() => void) | undefined;
  passkeyAction?: "auth" | "enroll" | undefined;
}

function ActionButton({
  actionHref,
  actionLabel,
  locked,
  onAction,
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
        <Link href={actionHref ?? "#"}>
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

  if (onAction) {
    return (
      <Button onClick={onAction} variant="outline">
        {actionLabel}
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    );
  }

  return (
    <Button asChild variant="outline">
      <Link href={actionHref ?? "#"}>
        {actionLabel}
        <ArrowRight className="ml-2 h-4 w-4" />
      </Link>
    </Button>
  );
}

interface ActionCardProps {
  actionHref?: string | undefined;
  actionLabel: string;
  badge?: string | undefined;
  description: string;
  icon: React.ElementType;
  locked: boolean;
  onAction?: (() => void) | undefined;
  passkeyAction?: "auth" | "enroll" | undefined;
  requiredTier: number;
  title: string;
}

function ActionCard({
  title,
  description,
  icon: Icon,
  actionLabel,
  actionHref,
  locked,
  onAction,
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
        onAction={onAction}
        passkeyAction={passkeyAction}
      />
    </div>
  );
}
