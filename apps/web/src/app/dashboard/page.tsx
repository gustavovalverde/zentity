import { headers } from "next/headers";
import { Suspense } from "react";

import { isWeb3Enabled } from "@/env";
import { getSecurityPostureForSession } from "@/lib/assurance/posture";
import { getCachedSession } from "@/lib/auth/session";
import { getVaultAccess } from "@/lib/privacy/secrets/vault-access";

import { IdentityActionsCard } from "./_components/identity-actions-card";
import {
  IdentityCard,
  IdentityCardSkeleton,
} from "./_components/identity-card";
import { ProfileGreetingName } from "./_components/profile-greeting";
import { VaultAccessNotice } from "./_components/vault-access-notice";

export default async function DashboardPage() {
  const session = await getCachedSession(await headers());
  const userId = session?.user?.id;
  const web3Enabled = isWeb3Enabled;

  const [posture, access] = userId
    ? await Promise.all([
        getSecurityPostureForSession(userId, session),
        getVaultAccess(userId),
      ])
    : [null, null];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-bold text-2xl">
          Welcome back,{" "}
          <ProfileGreetingName fallback={session?.user?.name || "User"} />
        </h1>
        <p className="text-muted-foreground text-sm">
          Manage your verified identity and credentials
        </p>
      </div>

      <VaultAccessNotice access={access} place="dashboard" />

      {/* Identity Card - Unified status card with tier badge */}
      <Suspense fallback={<IdentityCardSkeleton />}>
        <IdentityCard posture={posture} userId={userId} />
      </Suspense>

      {/* Actions Card - What you can do with your identity */}
      <IdentityActionsCard posture={posture} web3Enabled={web3Enabled} />
    </div>
  );
}
