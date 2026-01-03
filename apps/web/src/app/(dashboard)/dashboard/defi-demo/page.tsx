import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { DefiDemoClient } from "@/components/defi-demo/defi-demo-client";
import { auth } from "@/lib/auth/auth";
import { getBlockchainAttestationsByUserId } from "@/lib/db/queries/attestation";
import { getVerificationStatus } from "@/lib/db/queries/identity";
import { isWeb3Enabled } from "@/lib/feature-flags";

export default async function DefiDemoPage() {
  // Redirect if Web3 is disabled
  if (!isWeb3Enabled()) {
    redirect("/dashboard");
  }

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  const userId = session?.user?.id || process.env.E2E_USER_ID || null;

  // Get verification and attestation status
  const verificationStatus = userId
    ? await getVerificationStatus(userId)
    : null;
  const attestations = userId
    ? await getBlockchainAttestationsByUserId(userId)
    : [];

  // Find confirmed attestation (prefer hardhat for local dev)
  const confirmedAttestation = attestations.find(
    (a) => a.status === "confirmed"
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-bold text-3xl">DeFi Compliance Demo</h1>
          <p className="text-muted-foreground">
            Experience compliant token transfers with encrypted identity
          </p>
        </div>
      </div>

      <DefiDemoClient
        attestedNetworkId={confirmedAttestation?.networkId ?? null}
        attestedWallet={confirmedAttestation?.walletAddress ?? null}
        isVerified={verificationStatus?.verified ?? false}
      />
    </div>
  );
}
