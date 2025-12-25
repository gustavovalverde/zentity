import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { OnChainAttestation } from "@/components/dashboard/on-chain-attestation";
import { ViewIdentityData } from "@/components/dashboard/view-identity-data";
import { auth } from "@/lib/auth/auth";
import { getVerificationStatus } from "@/lib/db";
import { isWeb3Enabled } from "@/lib/feature-flags";

export default async function AttestationPage() {
  // Redirect if Web3 is disabled
  if (!isWeb3Enabled()) {
    redirect("/dashboard");
  }

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  const userId = session?.user?.id;
  const verificationStatus = userId ? getVerificationStatus(userId) : null;
  const isVerified = verificationStatus?.verified ?? false;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">On-Chain Attestation</h1>
          <p className="text-muted-foreground">
            Register your verified identity on blockchain networks
          </p>
        </div>
      </div>

      <OnChainAttestation isVerified={isVerified} />
      <ViewIdentityData />
    </div>
  );
}
