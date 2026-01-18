import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getTierProfile } from "@/lib/assurance/data";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getIdentityBundleByUserId } from "@/lib/db/queries/identity";

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

  const [tierProfile, bundle] = await Promise.all([
    getTierProfile(userId, session),
    getIdentityBundleByUserId(userId),
  ]);

  // FHE keys required for verification finalization
  if (!bundle?.fheKeyId) {
    redirect("/dashboard/verify");
  }

  // Already verified document - skip to liveness
  // Exception: Tier 2 users without proofs need to re-verify to generate proofs
  const needsProofRegeneration =
    tierProfile.tier === 2 && !tierProfile.assurance.proof.zkProofsComplete;

  if (
    tierProfile.assurance.identity.documentVerified &&
    !needsProofRegeneration
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

      <DocumentUploadClient resetOnMount={needsProofRegeneration} />
    </div>
  );
}
