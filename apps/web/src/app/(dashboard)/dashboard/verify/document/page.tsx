import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layouts/page-header";
import { VerificationJourneyCard } from "@/components/verification/verification-journey-card";
import { env } from "@/env";
import { getAccountAssurance } from "@/lib/assurance/data";
import { getCachedSession } from "@/lib/auth/cached-session";
import {
  getIdentityBundleByUserId,
  getLatestVerification,
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

  const [assurance, bundle, latestVerification] = await Promise.all([
    getAccountAssurance(userId),
    getIdentityBundleByUserId(userId),
    getLatestVerification(userId),
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
  const needsProofRegeneration = assurance.details.hasIncompleteProofs;
  const needsDocumentReprocessing = assurance.details.needsDocumentReprocessing;
  const hasActiveVerification = latestVerification?.status === "pending";

  if (
    assurance.details.documentVerified &&
    !needsProofRegeneration &&
    !needsDocumentReprocessing &&
    !hasActiveVerification &&
    !assurance.details.missingProfileSecret
  ) {
    redirect("/dashboard/verify/liveness");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        description="Upload a photo (JPEG, PNG, or WebP) of your government-issued ID"
        title="Verify Your Document"
      />

      <VerificationJourneyCard method="ocr" />

      <DocumentUploadClient
        demoMode={env.DEMO_MODE === true}
        resetOnMount={needsProofRegeneration || needsDocumentReprocessing}
      />
    </div>
  );
}
