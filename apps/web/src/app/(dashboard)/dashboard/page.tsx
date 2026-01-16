import { headers } from "next/headers";
import { Suspense } from "react";

import { ProfileGreetingName } from "@/components/dashboard/profile-greeting";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getVerificationStatus } from "@/lib/db/queries/identity";
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

  // Quick check for verified status (fast query for actions card)
  const verificationStatus = userId
    ? await getVerificationStatus(userId)
    : null;
  const isVerified = verificationStatus?.verified ?? false;

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

      {/* Identity Card - Source of truth for verification status */}
      <Suspense fallback={<IdentityCardSkeleton />}>
        <IdentityCard userId={userId} />
      </Suspense>

      {/* Actions Card - What you can do with your identity */}
      <IdentityActionsCard isVerified={isVerified} web3Enabled={web3Enabled} />
    </div>
  );
}
