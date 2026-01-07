import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { OnChainAttestation } from "@/components/dashboard/on-chain-attestation";
import { ViewIdentityData } from "@/components/dashboard/view-identity-data";
import { auth } from "@/lib/auth/auth";
import { getVerificationStatus } from "@/lib/db/queries/identity";
import { isWeb3Enabled } from "@/lib/feature-flags";

import { OffChainAttestationCard } from "./_components/off-chain-attestation-card";
import { OffChainAttestationSkeleton } from "./_components/off-chain-attestation-skeleton";

export default async function AttestationPage() {
  // Redirect if Web3 is disabled
  if (!isWeb3Enabled()) {
    redirect("/dashboard");
  }

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  const userId = session?.user?.id;

  // Only fetch verification status for OnChainAttestation - it's fast
  const verificationStatus = userId
    ? await getVerificationStatus(userId)
    : null;
  const isVerified = verificationStatus?.verified ?? false;

  return (
    <div className="space-y-8">
      {/* INSTANT - Static header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-bold text-3xl">On-Chain Attestation</h1>
          <p className="text-muted-foreground">
            Register your verified identity on blockchain networks
          </p>
        </div>
      </div>

      {/* STREAMING - Off-chain data (5+ queries) */}
      <Suspense fallback={<OffChainAttestationSkeleton />}>
        <OffChainAttestationCard userId={userId} />
      </Suspense>

      {/* INSTANT - Client components with their own loading states */}
      <OnChainAttestation isVerified={isVerified} />
      <ViewIdentityData />
    </div>
  );
}
