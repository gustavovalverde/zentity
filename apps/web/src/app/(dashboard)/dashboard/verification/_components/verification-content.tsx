import {
  Calendar,
  CheckCircle,
  Clock,
  Code,
  FileCheck,
  Globe,
  Hash,
  Shield,
} from "lucide-react";
import Link from "next/link";

import { TransparencySection } from "@/components/dashboard/transparency-section";
import { VerificationActions } from "@/components/dashboard/verification-actions";
import {
  type VerificationChecks,
  VerificationProgress,
} from "@/components/dashboard/verification-progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCountryDisplayName } from "@/lib/constants/verification-labels";
import {
  getEncryptedAttributeTypesByUserId,
  getLatestEncryptedAttributeByUserAndType,
  getSignedClaimTypesByUserAndDocument,
  getUserAgeProof,
  getZkProofTypesByUserAndDocument,
} from "@/lib/db/queries/crypto";
import {
  getIdentityBundleByUserId,
  getSelectedIdentityDocumentByUserId,
} from "@/lib/db/queries/identity";

interface VerificationContentProps {
  userId: string | undefined;
}

export async function VerificationContent({
  userId,
}: VerificationContentProps) {
  // First batch: parallelize independent queries
  const [
    proof,
    identityBundle,
    latestDocument,
    encryptedAttributes,
    birthYearOffsetCiphertext,
  ] = userId
    ? await Promise.all([
        getUserAgeProof(userId),
        getIdentityBundleByUserId(userId),
        getSelectedIdentityDocumentByUserId(userId),
        getEncryptedAttributeTypesByUserId(userId),
        getLatestEncryptedAttributeByUserAndType(userId, "birth_year_offset"),
      ])
    : [null, null, null, [], null];

  // Second batch: queries depending on selectedDocumentId
  const selectedDocumentId = latestDocument?.id ?? null;
  const [zkProofTypes, signedClaimTypes] =
    userId && selectedDocumentId
      ? await Promise.all([
          getZkProofTypesByUserAndDocument(userId, selectedDocumentId),
          getSignedClaimTypesByUserAndDocument(userId, selectedDocumentId),
        ])
      : [[], []];

  const proofTypes = Array.from(new Set(zkProofTypes));
  const fheStatus = identityBundle?.fheStatus ?? null;
  const fheError =
    identityBundle?.fheStatus === "error" ? identityBundle.fheError : null;

  // Build verification checks
  const checks: VerificationChecks = {
    document: latestDocument?.status === "verified",
    liveness: signedClaimTypes.includes("liveness_score"),
    ageProof: proofTypes.includes("age_verification"),
    docValidityProof: proofTypes.includes("doc_validity"),
    nationalityProof: proofTypes.includes("nationality_membership"),
    faceMatchProof: proofTypes.includes("face_match"),
    fheEncryption:
      fheStatus === "complete" ? true : encryptedAttributes.length > 0,
    fheError,
  };

  const hasProof =
    identityBundle?.status === "verified" ||
    Object.values(checks).some(Boolean);

  // Identity data for transparency section
  const identityData = {
    documentHash: latestDocument?.documentHash ?? undefined,
    nameCommitment: latestDocument?.nameCommitment ?? undefined,
    birthYearOffsetCiphertext:
      birthYearOffsetCiphertext?.ciphertext ?? undefined,
    documentType: latestDocument?.documentType ?? undefined,
    countryVerified: latestDocument?.issuerCountry ?? undefined,
    verifiedAt: latestDocument?.verifiedAt ?? undefined,
  };

  if (!hasProof) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Shield className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="font-medium">No Verification Found</h3>
          <p className="mt-1 text-muted-foreground text-sm">
            Complete the registration process to generate your identity
            verification proofs.
          </p>
          <Button asChild className="mt-4">
            <Link href="/sign-up">Complete Registration</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Verification Progress */}
      <VerificationProgress checks={checks} />

      {/* Identity Summary */}
      {identityData.documentType || identityData.countryVerified ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Identity Summary</CardTitle>
            <CardDescription>
              Verified document information (non-PII metadata)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {identityData.documentType ? (
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-info/10 text-info">
                    <FileCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">
                      Document Type
                    </p>
                    <p className="font-medium">{identityData.documentType}</p>
                  </div>
                </div>
              ) : null}

              {identityData.countryVerified ? (
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10 text-success">
                    <Globe className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Country</p>
                    <p className="font-medium">
                      {getCountryDisplayName(identityData.countryVerified)}
                    </p>
                  </div>
                </div>
              ) : null}

              {checks.ageProof ? (
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10 text-success">
                    <CheckCircle className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">
                      Age Verified
                    </p>
                    <p className="font-medium">18+ Confirmed</p>
                  </div>
                </div>
              ) : null}

              {identityData.verifiedAt ? (
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-info/10 text-info">
                    <Calendar className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Verified On</p>
                    <p className="font-medium">
                      {new Date(identityData.verifiedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Age Proof Details */}
      {proof ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success/10 text-success">
                <CheckCircle className="h-5 w-5" />
              </div>
              <div>
                <span className="text-lg">Age Proof</span>
                <Badge className="ml-2" variant="success">
                  18+
                </Badge>
              </div>
            </CardTitle>
            <CardDescription>
              Zero-knowledge proof of age verification
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-start gap-3 rounded-lg border p-4">
                <Hash className="mt-0.5 h-5 w-5 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="font-medium text-sm">Proof ID</p>
                  <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                    {proof.proofId}
                  </code>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border p-4">
                <Clock className="mt-0.5 h-5 w-5 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="font-medium text-sm">Generated</p>
                  <p className="text-muted-foreground text-sm">
                    {new Date(proof.createdAt).toLocaleDateString()} at{" "}
                    {new Date(proof.createdAt).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-info" />
                <span className="font-medium">Proof Performance</span>
              </div>
              <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-muted-foreground">Generation Time</p>
                  <p className="font-medium font-mono">
                    {proof.generationTimeMs !== null
                      ? `${proof.generationTimeMs}ms`
                      : "N/A"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Proof Type</p>
                  <p className="font-medium">UltraHonk (zk-SNARK)</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Transparency Section */}
      <TransparencySection
        birthYearOffsetCiphertext={identityData.birthYearOffsetCiphertext}
        documentHash={identityData.documentHash}
        encryptedAttributes={encryptedAttributes}
        hasAgeProof={checks.ageProof}
        nameCommitment={identityData.nameCommitment}
        proofTypes={proofTypes}
        signedClaimTypes={signedClaimTypes}
      />

      {/* Live Verification */}
      <VerificationActions />

      {/* How it works */}
      <Alert>
        <Shield className="h-4 w-4" />
        <AlertDescription>
          <strong>How it works:</strong> Your zero-knowledge proofs
          mathematically prove facts about your identity without revealing the
          underlying data. These proofs can be independently verified by third
          parties while your personal information remains private.
        </AlertDescription>
      </Alert>

      {/* Technical Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Technical Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Cryptographic Scheme</span>
            <span>UltraHonk zk-SNARK</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Elliptic Curve</span>
            <span>BN254</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Proof System</span>
            <span>Noir.js + Barretenberg</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">FHE Encryption</span>
            <span>TFHE-rs</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Verification</span>
            <span className="font-medium text-success">Valid</span>
          </div>
        </CardContent>
      </Card>

      {/* Developer Link */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Code className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium text-sm">Developer View</span>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/dev">View Raw Data</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
