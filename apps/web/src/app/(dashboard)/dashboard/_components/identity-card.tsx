import type { AssuranceState } from "@/lib/assurance/types";

import crypto from "node:crypto";

import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle,
  CheckCircle2,
  FileCheck,
  Globe,
  Shield,
} from "lucide-react";
import Link from "next/link";

import { TierBadge } from "@/components/assurance/tier-badge";
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
  assuranceState: AssuranceState | null;
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
    // Check for incomplete proofs (identity done but proofs missing)
    if (details?.hasIncompleteProofs) {
      return (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
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
                    Identity checks passed, but ZK proofs need to be generated.
                  </p>
                </div>
              </div>
              <p className="text-muted-foreground text-sm">
                To complete verification, please re-upload your document. ZK
                proofs are generated during verification and require your
                document data, which is not stored for privacy reasons.
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
          <div className="flex items-center justify-between">
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
                Complete verification to unlock privacy-preserving identity
                proofs.
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

  // Tier 2: Fetch identity data for fully verified display
  const [
    identityBundle,
    latestDocument,
    encryptedAttributes,
    dobDaysCipher,
    birthYearOffsetCipher,
  ] = userId
    ? await Promise.all([
        getIdentityBundleByUserId(userId),
        getSelectedIdentityDocumentByUserId(userId),
        getEncryptedAttributeTypesByUserId(userId),
        // Check for dob_days first (new format), then fall back to birth_year_offset (legacy)
        getLatestEncryptedAttributeByUserAndType(userId, "dob_days"),
        getLatestEncryptedAttributeByUserAndType(userId, "birth_year_offset"),
      ])
    : [null, null, [], null, null];

  // Use whichever FHE ciphertext format exists (prefer new format)
  const birthYearCipher = dobDaysCipher ?? birthYearOffsetCipher;

  const selectedDocumentId = latestDocument?.id ?? null;
  const [zkProofTypes, signedClaimTypes] =
    userId && selectedDocumentId
      ? await Promise.all([
          getZkProofTypesByUserAndDocument(userId, selectedDocumentId),
          getSignedClaimTypesByUserAndDocument(userId, selectedDocumentId),
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
          <div className="flex items-center justify-between">
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
                  Ready for on-chain attestation
                </p>
              </div>
            </div>

            {/* Identity Summary */}
            <IdentitySummary
              hasAgeProof={hasAgeProof}
              isVerified={identityBundle?.status === "verified"}
              latestDocument={latestDocument}
            />
          </div>
        </CardContent>
      </Card>

      {/* Transparency Section - Collapsible */}
      <TransparencySection
        birthYearOffsetCiphertextBytes={birthYearCiphertextBytes}
        birthYearOffsetCiphertextHash={birthYearCiphertextHash}
        documentHash={latestDocument?.documentHash ?? undefined}
        encryptedAttributes={encryptedAttributes}
        hasAgeProof={hasAgeProof}
        nameCommitment={latestDocument?.nameCommitment ?? undefined}
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
  latestDocument,
  isVerified,
  hasAgeProof,
}: {
  latestDocument: Awaited<
    ReturnType<typeof getSelectedIdentityDocumentByUserId>
  >;
  isVerified: boolean;
  hasAgeProof: boolean;
}) {
  if (!(latestDocument?.documentType || latestDocument?.issuerCountry)) {
    return null;
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="font-medium text-sm">Identity Summary</h4>
        {isVerified && <Badge variant="success">Verified</Badge>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {latestDocument?.documentType && (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-info/10 text-info">
              <FileCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Document Type</p>
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
    </div>
  );
}

export function IdentityCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
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
