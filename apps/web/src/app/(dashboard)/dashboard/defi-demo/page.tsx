import { headers } from "next/headers";

import { DefiDemoClient } from "@/components/defi-demo/defi-demo-client";
import { auth } from "@/lib/auth/auth";
import {
  getBlockchainAttestationsByUserId,
  getVerificationStatus,
} from "@/lib/db";

export default async function DefiDemoPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  const userId = session?.user?.id;

  // Get verification and attestation status
  const verificationStatus = userId ? getVerificationStatus(userId) : null;
  const attestations = userId ? getBlockchainAttestationsByUserId(userId) : [];

  // Find confirmed attestation (prefer hardhat for local dev)
  const confirmedAttestation = attestations.find(
    (a) => a.status === "confirmed",
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">DeFi Compliance Demo</h1>
          <p className="text-muted-foreground">
            Experience compliant token transfers with encrypted identity
          </p>
        </div>
      </div>

      <DefiDemoClient
        isVerified={verificationStatus?.verified ?? false}
        attestedNetworkId={confirmedAttestation?.networkId ?? null}
        attestedWallet={confirmedAttestation?.walletAddress ?? null}
      />
    </div>
  );
}
