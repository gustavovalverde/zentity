import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { isWeb3Enabled } from "@/env";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getVerificationStatus } from "@/lib/db/queries/identity";

import { OnChainAttestation } from "./_components/on-chain-attestation";
import { ViewIdentityData } from "./_components/view-identity-data";

export default async function AttestationPage() {
  // Redirect if Web3 is disabled
  if (!isWeb3Enabled) {
    redirect("/dashboard");
  }

  const session = await getCachedSession(await headers());
  const userId = session?.user?.id;

  // Only fetch verification status for OnChainAttestation
  const verificationStatus = userId
    ? await getVerificationStatus(userId)
    : null;
  const isVerified = verificationStatus?.verified ?? false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-bold text-2xl">On-Chain Attestation</h1>
        <p className="text-muted-foreground text-sm">
          Register your verified identity on blockchain networks with encrypted
          data
        </p>
      </div>

      {/* On-Chain Registration */}
      <OnChainAttestation isVerified={isVerified} />

      {/* View Encrypted On-Chain Data */}
      <ViewIdentityData />
    </div>
  );
}
