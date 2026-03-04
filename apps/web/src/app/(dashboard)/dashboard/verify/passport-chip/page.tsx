import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAssuranceState } from "@/lib/assurance/data";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getPrimaryWalletAddress } from "@/lib/db/queries/auth";
import {
  getIdentityBundleByUserId,
  getSelectedVerification,
  isChipVerified,
} from "@/lib/db/queries/identity";

import { ZkPassportFlow } from "./_components/zkpassport-flow";

export default async function PassportChipPage() {
  const session = await getCachedSession(await headers());
  const userId = session?.user?.id;

  if (!userId) {
    redirect("/sign-in");
  }

  const [assuranceState, bundle, verification, wallet] = await Promise.all([
    getAssuranceState(userId, session),
    getIdentityBundleByUserId(userId),
    getSelectedVerification(userId),
    getPrimaryWalletAddress(userId),
  ]);

  // Already chip-verified → dashboard
  const alreadyChipVerified = isChipVerified(verification);
  if (alreadyChipVerified || assuranceState.tier >= 3) {
    redirect("/dashboard");
  }

  // FHE enrollment required
  const hasEnrollment = Boolean(bundle?.fheKeyId);
  if (!hasEnrollment) {
    redirect("/dashboard/verify");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">
          NFC Chip Verification
        </h1>
        <p className="text-muted-foreground text-sm">
          Verify your document&apos;s NFC chip for the highest level of identity
          assurance.
        </p>
      </div>
      <ZkPassportFlow wallet={wallet} />
    </div>
  );
}
