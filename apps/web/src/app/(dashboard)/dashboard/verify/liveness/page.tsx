import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layouts/page-header";
import { getAssuranceState } from "@/lib/assurance/data";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getPrimaryWalletAddress } from "@/lib/db/queries/auth";
import {
  getIdentityBundleByUserId,
  getLatestVerification,
} from "@/lib/db/queries/identity";

import { LivenessVerifyClient } from "./_components/liveness-verify-client";

/**
 * Dashboard Liveness Verification Page
 *
 * Allows authenticated users to complete liveness verification.
 * Requires document to be uploaded first (pending or verified status).
 */
export default async function LivenessVerifyPage() {
  const session = await getCachedSession(await headers());
  const userId = session?.user?.id;

  if (!userId) {
    redirect("/sign-in");
  }

  const [assuranceState, latestVerification, bundle, wallet] =
    await Promise.all([
      getAssuranceState(userId, session),
      getLatestVerification(userId),
      getIdentityBundleByUserId(userId),
      getPrimaryWalletAddress(userId),
    ]);

  const hasEnrollment = Boolean(bundle?.fheKeyId);

  // FHE enrollment required before verification
  if (!hasEnrollment) {
    redirect("/dashboard/verify");
  }

  // Need to upload document first (allows pending or verified)
  if (!latestVerification) {
    redirect("/dashboard/verify/document");
  }

  // Already completed liveness and face match - redirect to verify hub
  // Exceptions:
  // - Users with incomplete proofs need to re-verify
  // - Users with a pending document are actively re-verifying
  const needsProofRegeneration = assuranceState.details.hasIncompleteProofs;
  const hasActiveVerification = latestVerification?.status === "pending";

  if (
    assuranceState.details.livenessVerified &&
    assuranceState.details.faceMatchVerified &&
    !needsProofRegeneration &&
    !hasActiveVerification
  ) {
    redirect("/dashboard/verify");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        description="Complete gesture challenges to prove you're a real person, then we'll match your face to your ID"
        title="Liveness & Face Match"
      />

      <LivenessVerifyClient wallet={wallet} />
    </div>
  );
}
