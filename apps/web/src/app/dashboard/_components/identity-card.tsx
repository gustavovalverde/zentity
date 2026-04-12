import type { SecurityPosture } from "@/lib/assurance/types";

import crypto from "node:crypto";

import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Calendar,
  CheckCircle,
  Lock,
  ScanSearch,
} from "lucide-react";
import Link from "next/link";

import { TierBadge } from "@/components/tier-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  getIdentityBundleByUserId,
  getSelectedVerification,
  getVerificationStatus,
} from "@/lib/db/queries/identity";
import {
  getEncryptedAttributeTypesByUserId,
  getLatestEncryptedAttributeByUserAndType,
  getProofTypesByUserAndVerification,
  getSignedClaimTypesByUserAndVerification,
} from "@/lib/db/queries/privacy";

import { VerificationFinalizationNotice } from "../verify/_components/verification-finalization-notice";
import { FheStatusPoller } from "./fhe-status-poller";
import { TransparencySection } from "./transparency-section";
import { VerificationDetails } from "./verification-details";

interface IdentityCardProps {
  posture: SecurityPosture | null;
  userId: string | undefined;
}

function IdentityCardHeader({
  tier,
  assurance,
}: {
  tier: 0 | 1 | 2 | 3;
  assurance: SecurityPosture["assurance"] | null;
}) {
  return (
    <CardHeader className="pb-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <BadgeCheck className="h-5 w-5 text-muted-foreground" />
          Identity Status
        </CardTitle>
        {assurance && <TierBadge tier={tier} />}
      </div>
      <CardDescription>
        {tier >= 2
          ? "Your verified identity summary"
          : "Your verification progress"}
      </CardDescription>
    </CardHeader>
  );
}

/**
 * Identity Card - Unified status card displaying tier and verification state.
 *
 * Renders tier-appropriate content:
 * - Tier 1: Simple CTA to start verification (or warning for incomplete proofs)
 * - Tier 2: Fully verified with identity summary and transparency
 */
export async function IdentityCard({
  userId,
  posture,
}: Readonly<IdentityCardProps>) {
  const assurance = posture?.assurance ?? null;
  const tier = assurance?.tier ?? 0;
  const details = assurance?.details;

  // Tier 0 or 1: Show CTA or incomplete proofs warning
  if (tier < 2) {
    if (
      details?.documentVerified &&
      details.livenessVerified &&
      details.faceMatchVerified &&
      details.zkProofsComplete &&
      !details.fheComplete
    ) {
      return (
        <Card>
          <IdentityCardHeader assurance={assurance} tier={tier} />
          <CardContent className="pt-2">
            <div className="space-y-4">
              <FheStatusPoller />
              <VerificationFinalizationNotice />
              <p className="text-muted-foreground text-sm">
                This page will update automatically when encryption finishes.
                You don&apos;t need to re-verify.
              </p>
              <Button asChild className="w-full" variant="outline">
                <Link href="/dashboard/verify">
                  View Verification Status
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }

    // Check for incomplete proofs (identity done but proofs missing)
    if (details?.hasIncompleteProofs) {
      return (
        <Card>
          <IdentityCardHeader assurance={assurance} tier={tier} />
          <CardContent className="pt-2">
            <div className="space-y-4">
              <Alert variant="warning">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Verification Incomplete</AlertTitle>
                <AlertDescription>
                  Your document was checked, but the verification process
                  didn&apos;t complete fully.
                </AlertDescription>
              </Alert>
              <p className="text-muted-foreground text-sm">
                To complete verification, please re-upload your document. The
                process requires your document data, which we don&apos;t store.
              </p>
              <Button asChild className="w-full">
                <Link href="/dashboard/verify">
                  Complete Verification
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }

    // Normal Tier 1: Ready to verify
    return (
      <div className="space-y-6">
        <Card>
          <IdentityCardHeader assurance={assurance} tier={tier} />
          <CardContent className="pt-2">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ScanSearch />
                </EmptyMedia>
                <EmptyTitle>Ready to Verify</EmptyTitle>
                <EmptyDescription>
                  Verify your identity to unlock credentials and on-chain
                  attestation.
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

        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Lock className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="space-y-1.5 text-muted-foreground text-sm">
                <p>
                  <strong className="text-foreground">
                    Privacy-first verification
                  </strong>
                </p>
                <p>
                  Your personal data is never stored in readable form.
                  Verification is processed privately on your device (using
                  zero-knowledge proofs) and sensitive attributes are encrypted
                  so only you can access them. We only keep verified results
                  (e.g., &quot;over 18&quot;). Raw images are processed in
                  memory and immediately discarded.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Missing profile secret banner — user is verified but can't share identity data
  if (tier >= 2 && details?.missingProfileSecret) {
    return (
      <Card>
        <IdentityCardHeader assurance={assurance} tier={tier} />
        <CardContent className="pt-2">
          <div className="space-y-4">
            <Alert variant="warning">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Identity Data Not Saved</AlertTitle>
              <AlertDescription>
                Your identity was verified, but your personal data could not be
                saved to your encrypted vault. Re-verify to enable identity
                sharing with applications.
              </AlertDescription>
            </Alert>
            <Button asChild className="w-full">
              <Link href="/dashboard/verify">
                Re-verify Identity
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Tier 3: Chip Verified display
  if (tier === 3 && userId) {
    const [verification, verificationStatus] = await Promise.all([
      getSelectedVerification(userId),
      getVerificationStatus(userId),
    ]);

    return (
      <div className="space-y-6">
        <Card>
          <IdentityCardHeader assurance={assurance} tier={tier} />
          <CardContent className="pt-2">
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                {verificationStatus.checks.ageVerified && (
                  <div className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 shrink-0 text-success" />
                    <div>
                      <p className="text-muted-foreground text-xs">
                        Age Verified
                      </p>
                      <p className="font-medium">18+ Confirmed</p>
                    </div>
                  </div>
                )}
                {verification?.verifiedAt && (
                  <div className="flex items-center gap-3">
                    <Calendar className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="text-muted-foreground text-xs">
                        Verified On
                      </p>
                      <p className="font-medium">
                        {new Date(verification.verifiedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <VerificationDetails />
      </div>
    );
  }

  // Tier 2: Fetch identity data for fully verified display
  const [
    ,
    verification,
    encryptedAttributes,
    dobDaysCipher,
    birthYearOffsetCipher,
  ] = userId
    ? await Promise.all([
        getIdentityBundleByUserId(userId),
        getSelectedVerification(userId),
        getEncryptedAttributeTypesByUserId(userId),
        // Check for dob_days first (new format), then fall back to birth_year_offset (legacy)
        getLatestEncryptedAttributeByUserAndType(userId, "dob_days"),
        getLatestEncryptedAttributeByUserAndType(userId, "birth_year_offset"),
      ])
    : [null, null, [], null, null];

  // Use whichever FHE ciphertext format exists (prefer new format)
  const birthYearCipher = dobDaysCipher ?? birthYearOffsetCipher;

  const verificationId = verification?.id ?? null;
  const [zkProofTypes, signedClaimTypes]: [string[], string[]] =
    userId && verificationId
      ? await Promise.all([
          getProofTypesByUserAndVerification(userId, verificationId),
          getSignedClaimTypesByUserAndVerification(userId, verificationId),
        ])
      : [[], []];

  const proofTypes = Array.from(new Set(zkProofTypes));

  // Transparency data
  const birthYearCiphertextBytes =
    birthYearCipher?.ciphertext?.byteLength ?? undefined;
  const birthYearCiphertextHash = birthYearCipher?.ciphertext
    ? crypto
        .createHash("sha256")
        .update(birthYearCipher.ciphertext)
        .digest("hex")
    : undefined;

  const hasAgeProof = proofTypes.includes("age_verification");

  // Tier 2: Fully verified
  return (
    <div className="space-y-6">
      <Card>
        <IdentityCardHeader assurance={assurance} tier={tier} />
        <CardContent className="pt-2">
          <div className="space-y-6">
            {posture?.auth?.authStrength !== "strong" && (
              <p className="text-muted-foreground text-sm">
                Add a passkey to enable on-chain attestation.
              </p>
            )}

            <IdentitySummary
              hasAgeProof={hasAgeProof}
              verification={verification}
            />
          </div>
        </CardContent>
      </Card>

      {/* Transparency Section - Collapsible */}
      <TransparencySection
        birthYearOffsetCiphertextBytes={birthYearCiphertextBytes}
        birthYearOffsetCiphertextHash={birthYearCiphertextHash}
        documentHash={verification?.documentHash ?? undefined}
        encryptedAttributes={encryptedAttributes}
        hasAgeProof={hasAgeProof}
        nameCommitment={verification?.nameCommitment ?? undefined}
        proofTypes={proofTypes}
        signedClaimTypes={signedClaimTypes}
      />

      {/* Verification Details - Collapsible developer section */}
      <VerificationDetails />
    </div>
  );
}

/**
 * Identity Summary - Displays verified document metadata
 */
function IdentitySummary({
  verification,
  hasAgeProof,
}: {
  verification: Awaited<ReturnType<typeof getSelectedVerification>>;
  hasAgeProof: boolean;
}) {
  if (!verification) {
    return null;
  }

  return (
    <div>
      <h4 className="mb-3 font-medium text-sm">Identity Summary</h4>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {hasAgeProof && (
          <div className="flex items-center gap-3">
            <CheckCircle className="h-5 w-5 shrink-0 text-success" />
            <div>
              <p className="text-muted-foreground text-xs">Age Verified</p>
              <p className="font-medium">18+ Confirmed</p>
            </div>
          </div>
        )}

        {verification.verifiedAt && (
          <div className="flex items-center gap-3">
            <Calendar className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-muted-foreground text-xs">Verified On</p>
              <p className="font-medium">
                {new Date(verification.verifiedAt).toLocaleDateString()}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function IdentityCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="h-6 w-32 animate-pulse rounded bg-muted" />
          <div className="h-6 w-24 animate-pulse rounded-full bg-muted" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        <div className="flex flex-col items-center gap-4 py-6">
          <div className="h-12 w-12 animate-pulse rounded-full bg-muted" />
          <div className="h-5 w-32 animate-pulse rounded bg-muted" />
          <div className="h-4 w-48 animate-pulse rounded bg-muted" />
          <div className="h-9 w-36 animate-pulse rounded bg-muted" />
        </div>
      </CardContent>
    </Card>
  );
}
