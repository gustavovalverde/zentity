import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAssuranceState } from "@/lib/assurance/data";
import { getCachedSession } from "@/lib/auth/cached-session";
import {
  getIdentityBundleByUserId,
  getLatestIdentityDocumentByUserId,
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

  const [assuranceState, latestDocument, bundle] = await Promise.all([
    getAssuranceState(userId, session),
    getLatestIdentityDocumentByUserId(userId),
    getIdentityBundleByUserId(userId),
  ]);

  // FHE keys required for verification finalization
  if (!bundle?.fheKeyId) {
    redirect("/dashboard/verify");
  }

  // Need to upload document first (allows pending or verified)
  if (!latestDocument) {
    redirect("/dashboard/verify/document");
  }

  // Already completed liveness and face match - redirect to verify hub
  // Exception: users with incomplete proofs need to re-verify
  const needsProofRegeneration = assuranceState.details.hasIncompleteProofs;

  if (
    assuranceState.details.livenessVerified &&
    assuranceState.details.faceMatchVerified &&
    !needsProofRegeneration
  ) {
    redirect("/dashboard/verify");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl">Liveness Verification</h1>
        <p className="text-muted-foreground">
          Complete a quick liveness check to verify you're a real person
        </p>
      </div>

      <LivenessVerifyClient />
    </div>
  );
}
