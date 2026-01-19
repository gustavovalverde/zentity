import crypto from "node:crypto";

import {
  ArrowRight,
  Calendar,
  CheckCircle,
  FileCheck,
  Globe,
  Shield,
} from "lucide-react";
import Link from "next/link";

import { TransparencySection } from "@/components/dashboard/transparency-section";
import {
  type VerificationChecks,
  VerificationProgress,
} from "@/components/dashboard/verification-progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  getEncryptedAttributeTypesByUserId,
  getLatestEncryptedAttributeByUserAndType,
  getSignedClaimTypesByUserAndDocument,
  getZkProofTypesByUserAndDocument,
} from "@/lib/db/queries/crypto";
import {
  getIdentityBundleByUserId,
  getSelectedIdentityDocumentByUserId,
} from "@/lib/db/queries/identity";
import { getCountryDisplayName } from "@/lib/identity/labels";

interface IdentityCardProps {
  userId: string | undefined;
}

/**
 * Identity Card - The source of truth for user's verification status.
 * Displays verification progress, identity summary, and transparency info.
 */
export async function IdentityCard({ userId }: Readonly<IdentityCardProps>) {
  // First batch: parallelize independent queries
  const [identityBundle, latestDocument, encryptedAttributes, birthYearCipher] =
    userId
      ? await Promise.all([
          getIdentityBundleByUserId(userId),
          getSelectedIdentityDocumentByUserId(userId),
          getEncryptedAttributeTypesByUserId(userId),
          getLatestEncryptedAttributeByUserAndType(userId, "birth_year_offset"),
        ])
      : [null, null, [], null];

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
    identityBindingProof: proofTypes.includes("identity_binding"),
    fheEncryption:
      fheStatus === "complete" ? true : encryptedAttributes.length > 0,
    fheError,
  };

  const isVerified = identityBundle?.status === "verified";
  const hasAnyVerification = isVerified || Object.values(checks).some(Boolean);

  // Transparency data
  const birthYearCiphertextBytes =
    birthYearCipher?.ciphertext?.byteLength ?? undefined;
  const birthYearCiphertextHash = birthYearCipher?.ciphertext
    ? crypto
        .createHash("sha256")
        .update(birthYearCipher.ciphertext)
        .digest("hex")
    : undefined;

  // Not verified - show CTA
  if (!hasAnyVerification) {
    return (
      <Card>
        <CardContent className="py-8">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Shield />
              </EmptyMedia>
              <EmptyTitle>Verify Your Identity</EmptyTitle>
              <EmptyDescription>
                Complete the verification process to generate cryptographic
                proofs of your identity without exposing personal data.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild>
                <Link href="/dashboard/verify">
                  Start Verification
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </EmptyContent>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Verification Progress */}
      <VerificationProgress checks={checks} />

      {/* Identity Summary */}
      {(latestDocument?.documentType || latestDocument?.issuerCountry) && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Identity Summary</CardTitle>
              {isVerified && <Badge variant="success">Verified</Badge>}
            </div>
            <CardDescription>
              Verified document information (non-PII metadata)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {latestDocument?.documentType && (
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-info/10 text-info">
                    <FileCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">
                      Document Type
                    </p>
                    <p className="font-medium">{latestDocument.documentType}</p>
                  </div>
                </div>
              )}

              {latestDocument?.issuerCountry && (
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10 text-success">
                    <Globe className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Country</p>
                    <p className="font-medium">
                      {getCountryDisplayName(latestDocument.issuerCountry)}
                    </p>
                  </div>
                </div>
              )}

              {checks.ageProof && (
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
              )}

              {latestDocument?.verifiedAt && (
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-info/10 text-info">
                    <Calendar className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Verified On</p>
                    <p className="font-medium">
                      {new Date(latestDocument.verifiedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Transparency Section - Collapsible */}
      <TransparencySection
        birthYearOffsetCiphertextBytes={birthYearCiphertextBytes}
        birthYearOffsetCiphertextHash={birthYearCiphertextHash}
        documentHash={latestDocument?.documentHash ?? undefined}
        encryptedAttributes={encryptedAttributes}
        hasAgeProof={checks.ageProof}
        nameCommitment={latestDocument?.nameCommitment ?? undefined}
        proofTypes={proofTypes}
        signedClaimTypes={signedClaimTypes}
      />
    </div>
  );
}

export function IdentityCardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Progress skeleton */}
      <Card>
        <CardHeader className="pb-3">
          <div className="h-5 w-40 animate-pulse rounded bg-muted" />
          <div className="h-4 w-56 animate-pulse rounded bg-muted" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="h-2 w-full animate-pulse rounded bg-muted" />
          <div className="space-y-3">
            {["document", "liveness", "age", "fhe"].map((id) => (
              <div className="flex items-center gap-3" key={id}>
                <div className="h-5 w-5 animate-pulse rounded-full bg-muted" />
                <div className="flex-1 space-y-1">
                  <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-48 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
