import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { Suspense } from "react";

import { ProfileGreetingName } from "@/components/dashboard/profile-greeting";
import { getAssuranceState } from "@/lib/assurance/data";
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

  // Parallelize assurance state and passkey queries to eliminate waterfall
  const [assuranceState, hasPasskeys] = userId
    ? await Promise.all([
        getAssuranceState(userId, session),
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
      {/* Header */}
      <div>
        <h1 className="font-bold text-2xl">
          Welcome back, <ProfileGreetingName />
        </h1>
        <p className="text-muted-foreground text-sm">
          Your privacy-preserving identity dashboard
        </p>
      </div>

      {/* Identity Card - Unified status card with tier badge */}
      <Suspense fallback={<IdentityCardSkeleton />}>
        <IdentityCard assuranceState={assuranceState} userId={userId} />
      </Suspense>

      {/* Actions Card - What you can do with your identity */}
      <IdentityActionsCard
        assuranceState={assuranceState}
        hasPasskeys={hasPasskeys}
        web3Enabled={web3Enabled}
      />
    </div>
  );
}
