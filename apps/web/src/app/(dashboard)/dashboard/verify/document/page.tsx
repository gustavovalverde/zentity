import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAssuranceState } from "@/lib/assurance/data";
import { getCachedSession } from "@/lib/auth/cached-session";
import {
  getIdentityBundleByUserId,
  getLatestIdentityDocumentByUserId,
} from "@/lib/db/queries/identity";

import { DocumentUploadClient } from "./_components/document-upload-client";

/**
 * Dashboard Document Verification Page
 *
 * Allows authenticated users to upload and verify their identity document.
 * After successful verification, redirects to liveness step.
 */
export default async function DocumentVerifyPage() {
  const session = await getCachedSession(await headers());
  const userId = session?.user?.id;

  if (!userId) {
    redirect("/sign-in");
  }

  const [assuranceState, bundle, latestDocument] = await Promise.all([
    getAssuranceState(userId, session),
    getIdentityBundleByUserId(userId),
    getLatestIdentityDocumentByUserId(userId),
  ]);

  const hasEnrollment = Boolean(bundle?.fheKeyId);

  // FHE enrollment required before verification
  if (!hasEnrollment) {
    redirect("/dashboard/verify");
  }

  // Already verified document - skip to liveness
  // Exceptions:
  // - Users with incomplete proofs or missing claim hashes need to re-verify
  // - Users with a pending document are actively re-verifying
  const needsProofRegeneration = assuranceState.details.hasIncompleteProofs;
  const needsDocumentReprocessing =
    assuranceState.details.needsDocumentReprocessing;
  const hasActiveVerification = latestDocument?.status === "pending";

  if (
    assuranceState.details.documentVerified &&
    !needsProofRegeneration &&
    !needsDocumentReprocessing &&
    !hasActiveVerification
  ) {
    redirect("/dashboard/verify/liveness");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl">Verify Your Document</h1>
        <p className="text-muted-foreground">
          Upload a government-issued ID to verify your identity
        </p>
      </div>

      <DocumentUploadClient
        demoMode={process.env.DEMO_MODE === "true"}
        resetOnMount={needsProofRegeneration || needsDocumentReprocessing}
      />
    </div>
  );
}
