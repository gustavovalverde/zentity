import { headers } from "next/headers";
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import {
  getIdentityProofByUserId,
  getUserAgeProof,
  getUserFirstName,
  getVerificationStatus,
} from "@/lib/db";
import { getFirstPart } from "@/lib/name-utils";

export default async function DashboardPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  const userId = session?.user?.id;

  // Fetch age proof (ZK proof from onboarding)
  const ageProof = userId ? getUserAgeProof(userId) : null;

  // Fetch identity proof (from document verification)
  const identityProof = userId ? getIdentityProofByUserId(userId) : null;

  // Get verification status
  const verificationStatus = userId ? getVerificationStatus(userId) : null;

  // Fetch decrypted first name for personalized greeting
  const firstName = userId ? await getUserFirstName(userId) : null;

  // Build verification checks combining both sources
  const checks = {
    document: identityProof?.isDocumentVerified ?? false,
    liveness: identityProof?.isLivenessPassed ?? false,
    faceMatch: identityProof?.isFaceMatched ?? false,
    ageProof: ageProof?.isOver18 ?? identityProof?.ageProofVerified ?? false,
    fheEncryption:
      !!ageProof?.hasFheEncryption || !!identityProof?.dobCiphertext,
  };

  const hasProof = ageProof?.isOver18 || verificationStatus?.verified || false;

  // Identity data for transparency section and RP demos
  const identityData = {
    documentHash: identityProof?.documentHash,
    nameCommitment: identityProof?.nameCommitment,
    dobCiphertext: ageProof?.dobCiphertext ?? identityProof?.dobCiphertext,
    fheClientKeyId: identityProof?.fheClientKeyId,
    ageProof: identityProof?.ageProof,
    ageProofVerified: identityProof?.ageProofVerified,
    // Full age proofs with publicSignals (for ZK verification)
    ageProofsJson: identityProof?.ageProofsJson,
    // Document metadata (non-PII, safe to display)
    documentType: identityProof?.documentType,
    countryVerified: identityProof?.countryVerified,
    verifiedAt: identityProof?.verifiedAt,
  };

  // Determine the best name to display (priority: decrypted first name > display name > "User")
  const displayName = firstName || getFirstPart(session?.user.name) || "User";

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Welcome, {displayName}</h1>
          <p className="text-muted-foreground">
            Manage your privacy-preserving identity verification
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Account
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold truncate">
              {session?.user.email}
            </p>
            <p className="text-xs text-muted-foreground">
              Member since{" "}
              {session?.user.createdAt
                ? new Date(session.user.createdAt).toLocaleDateString()
                : "Today"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Verification Level
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold capitalize">
              {verificationStatus?.level ?? "None"}
            </p>
            <p className="text-xs text-muted-foreground">
              {hasProof
                ? "Identity cryptographically verified"
                : "Complete verification to unlock features"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Data Exposure
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold text-green-600">
              {hasProof ? "Zero PII" : "N/A"}
            </p>
            <p className="text-xs text-muted-foreground">
              {hasProof
                ? "Only cryptographic proofs stored"
                : "Complete verification for privacy"}
            </p>
          </CardContent>
        </Card>
      </div>

      <DashboardTabs
        checks={checks}
        hasProof={hasProof}
        identityData={identityData}
      />
    </div>
  );
}
