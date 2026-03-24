import type { AssuranceState } from "@/lib/assurance/types";

import crypto from "node:crypto";

import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle,
  CheckCircle2,
  Shield,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { TierBadge } from "@/components/assurance/tier-badge";
import { FheStatusPoller } from "@/components/dashboard/fhe-status-poller";
import { TransparencySection } from "@/components/dashboard/transparency-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { VerificationFinalizationNotice } from "@/components/verification/verification-finalization-notice";
import {
  getEncryptedAttributeTypesByUserId,
  getLatestEncryptedAttributeByUserAndType,
  getProofTypesByUserAndVerification,
  getSignedClaimTypesByUserAndVerification,
} from "@/lib/db/queries/crypto";
import {
  getIdentityBundleByUserId,
  getSelectedVerification,
  getVerificationStatus,
} from "@/lib/db/queries/identity";

interface IdentityCardProps {
  assuranceState: AssuranceState | null;
  userId: string | undefined;
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
  assuranceState,
}: Readonly<IdentityCardProps>) {
  const tier = assuranceState?.tier ?? 0;
  const details = assuranceState?.details;

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
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Identity Status</CardTitle>
              {assuranceState && <TierBadge tier={tier} />}
            </div>
          </CardHeader>
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
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Identity Status</CardTitle>
              {assuranceState && <TierBadge tier={tier} />}
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="space-y-4">
              <div className="flex items-center gap-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-amber-700 dark:text-amber-400">
                    Verification Incomplete
                  </p>
                  <p className="text-muted-foreground text-sm">
                    Identity checks passed, but verification proofs still need
                    to be generated.
                  </p>
                </div>
              </div>
              <p className="text-muted-foreground text-sm">
                To complete verification, please re-upload your document. Proofs
                are generated during the process and require your document data,
                which we don&apos;t store.
              </p>
              <Button asChild className="w-full">
                <Link href="/dashboard/verify/document">
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
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Identity Status</CardTitle>
            {assuranceState && <TierBadge tier={tier} />}
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Shield />
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
    );
  }

  // Missing profile secret banner — user is verified but can't share identity data
  if (tier >= 2 && details?.missingProfileSecret) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Identity Status</CardTitle>
            {assuranceState && <TierBadge tier={tier} />}
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="space-y-4">
            <div className="flex items-center gap-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-amber-700 dark:text-amber-400">
                  Identity Data Not Saved
                </p>
                <p className="text-muted-foreground text-sm">
                  Your identity was verified, but your personal data could not
                  be saved to your encrypted vault. Re-verify to enable identity
                  sharing with applications.
                </p>
              </div>
            </div>
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
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Identity Status</CardTitle>
            {assuranceState && <TierBadge tier={tier} />}
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="space-y-6">
            <div className="flex items-center gap-4 rounded-lg border border-info/30 bg-info/5 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-info/10 text-info">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium text-info">Chip Verified</p>
                <p className="text-muted-foreground text-sm">
                  Your passport chip has been cryptographically verified, the
                  highest level of assurance
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {verificationStatus.checks.ageVerified && (
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
              {verification?.verifiedAt && (
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-info/10 text-info">
                    <Calendar className="h-5 w-5" />
                  </div>
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
        </CardContent>
      </Card>
    );
  }

  // Tier 2: Fetch identity data for fully verified display
  const [
    identityBundle,
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
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Identity Status</CardTitle>
            {assuranceState && <TierBadge tier={tier} />}
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="space-y-6">
            {/* Completion status */}
            <div className="flex items-center gap-4 rounded-lg border bg-success/5 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success/10 text-success">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium text-success">Fully Verified</p>
                <p className="text-muted-foreground text-sm">
                  {assuranceState?.authStrength === "strong"
                    ? "Ready for on-chain attestation"
                    : "Identity verified. Add a passkey to enable on-chain attestation."}
                </p>
              </div>
            </div>

            {/* Identity Summary */}
            <IdentitySummary
              hasAgeProof={hasAgeProof}
              isVerified={identityBundle?.status === "verified"}
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
    </div>
  );
}

/**
 * Identity Summary - Displays verified document metadata
 */
function IdentitySummary({
  verification,
  isVerified,
  hasAgeProof,
}: {
  verification: Awaited<ReturnType<typeof getSelectedVerification>>;
  isVerified: boolean;
  hasAgeProof: boolean;
}) {
  if (!verification) {
    return null;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-medium text-sm">Identity Summary</h4>
        {isVerified && <Badge variant="success">Verified</Badge>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {hasAgeProof && (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10 text-success">
              <CheckCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Age Verified</p>
              <p className="font-medium">18+ Confirmed</p>
            </div>
          </div>
        )}

        {verification.verifiedAt && (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-info/10 text-info">
              <Calendar className="h-5 w-5" />
            </div>
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
