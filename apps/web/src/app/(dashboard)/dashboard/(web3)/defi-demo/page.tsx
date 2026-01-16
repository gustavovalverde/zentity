import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { DefiDemoClient } from "@/components/defi-demo/defi-demo-client";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getBlockchainAttestationsByUserId } from "@/lib/db/queries/attestation";
import { getVerificationStatus } from "@/lib/db/queries/identity";
import { isWeb3Enabled } from "@/lib/feature-flags";

export default async function DefiDemoPage() {
  // Redirect if Web3 is disabled
  if (!isWeb3Enabled()) {
    redirect("/dashboard");
  }

  const session = await getCachedSession(await headers());

  const userId = session?.user?.id || process.env.E2E_USER_ID || null;

  // Parallelize independent queries for faster page load
  const [verificationStatus, attestations] = userId
    ? await Promise.all([
        getVerificationStatus(userId),
        getBlockchainAttestationsByUserId(userId),
      ])
    : [null, []];

  // Find confirmed attestation (prefer hardhat for local dev)
  const confirmedAttestation = attestations.find(
    (a) => a.status === "confirmed"
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl">DeFi Compliance Demo</h1>
        <p className="text-muted-foreground text-sm">
          Experience compliant token transfers with encrypted identity
        </p>
      </div>

      <DefiDemoClient
        attestedNetworkId={confirmedAttestation?.networkId ?? null}
        attestedWallet={confirmedAttestation?.walletAddress ?? null}
        isVerified={verificationStatus?.verified ?? false}
      />
    </div>
  );
}
