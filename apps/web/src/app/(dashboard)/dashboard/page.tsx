import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { Suspense } from "react";

import { TierBadge } from "@/components/assurance/tier-badge";
import { TierProgressCard } from "@/components/assurance/tier-progress-card";
import { ProfileGreetingName } from "@/components/dashboard/profile-greeting";
import { getTierProfile } from "@/lib/assurance/data";
import { getCachedSession } from "@/lib/auth/cached-session";
import { db } from "@/lib/db/connection";
import { passkeys } from "@/lib/db/schema/auth";
import { isWeb3Enabled } from "@/lib/feature-flags";

import { IdentityActionsCard } from "./_components/identity-actions-card";
import {
  IdentityCard,
  IdentityCardSkeleton,
} from "./_components/identity-card";

export default async function DashboardPage() {
  const session = await getCachedSession(await headers());
  const userId = session?.user?.id;
  const web3Enabled = isWeb3Enabled();

  // Parallelize tier profile and passkey queries to eliminate waterfall
  const [tierProfile, hasPasskeys] = userId
    ? await Promise.all([
        getTierProfile(userId, session),
        db
          .select({ id: passkeys.id })
          .from(passkeys)
          .where(eq(passkeys.userId, userId))
          .limit(1)
          .get()
          .then((result) => !!result),
      ])
    : [null, false];

  return (
    <div className="space-y-6">
      {/* Header with tier badge */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-bold text-2xl">
            Welcome back, <ProfileGreetingName />
          </h1>
          <p className="text-muted-foreground text-sm">
            Your privacy-preserving identity dashboard
          </p>
        </div>
        {tierProfile && (
          <TierBadge
            label={tierProfile.label}
            size="md"
            tier={tierProfile.tier}
          />
        )}
      </div>

      {/* Tier Progress Card - Shows verification progress */}
      {tierProfile && tierProfile.tier < 3 && (
        <TierProgressCard profile={tierProfile} />
      )}

      {/* Identity Card - Source of truth for verification status */}
      <Suspense fallback={<IdentityCardSkeleton />}>
        <IdentityCard userId={userId} />
      </Suspense>

      {/* Actions Card - What you can do with your identity */}
      <IdentityActionsCard
        hasPasskeys={hasPasskeys}
        tierProfile={tierProfile}
        web3Enabled={web3Enabled}
      />
    </div>
  );
}
