import { ArrowRight, CheckCircle, Shield } from "lucide-react";
import Link from "next/link";

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
  getIdentityBundleByUserId,
  getVerificationStatus,
} from "@/lib/db/queries/identity";

interface VerificationStatusCardProps {
  userId: string | undefined;
}

export async function VerificationStatusCard({
  userId,
}: VerificationStatusCardProps) {
  // Parallelize independent queries
  const [identityBundle, verificationStatus] = userId
    ? await Promise.all([
        getIdentityBundleByUserId(userId),
        getVerificationStatus(userId),
      ])
    : [null, null];

  const isVerified = identityBundle?.status === "verified";
  const checks = verificationStatus?.checks ?? {
    document: false,
    liveness: false,
    ageProof: false,
    docValidityProof: false,
    nationalityProof: false,
    faceMatchProof: false,
  };
  const proofCount = [
    checks.ageProof,
    checks.docValidityProof,
    checks.nationalityProof,
    checks.faceMatchProof,
  ].filter(Boolean).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4" />
            Identity Verification
          </CardTitle>
          {isVerified ? (
            <Badge variant="success">Verified</Badge>
          ) : (
            <Badge variant="secondary">Not Verified</Badge>
          )}
        </div>
        <CardDescription>
          {isVerified
            ? "Your identity is cryptographically verified"
            : "Complete verification to unlock features"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isVerified ? (
          <>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-success">
                <CheckCircle className="h-4 w-4" />
                <span>{proofCount} ZK proofs</span>
              </div>
              <div className="text-muted-foreground">
                Level: {verificationStatus?.level ?? "Basic"}
              </div>
            </div>
            <Button asChild className="w-full" variant="outline">
              <Link href="/dashboard/verification">
                View Details
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </>
        ) : (
          <Button asChild className="w-full">
            <Link href="/sign-up?fresh=1">
              Start Verification
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export async function PrivacyInfoSection({
  userId,
}: VerificationStatusCardProps) {
  const verificationStatus = userId
    ? await getVerificationStatus(userId)
    : null;
  const checks = verificationStatus?.checks ?? {
    document: false,
    liveness: false,
    ageProof: false,
    docValidityProof: false,
    nationalityProof: false,
    faceMatchProof: false,
  };
  const hasProofs =
    checks.ageProof ||
    checks.docValidityProof ||
    checks.nationalityProof ||
    checks.faceMatchProof;

  if (!hasProofs) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-muted/50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
          <Shield className="h-4 w-4" />
        </div>
        <div className="space-y-1">
          <p className="font-medium text-sm">Maximum Privacy Achieved</p>
          <p className="text-muted-foreground text-xs">
            No plaintext PII is stored. Only cryptographic proofs, hashes, and
            encrypted values are persisted. Your passkey is required to decrypt
            any personal data.
          </p>
        </div>
      </div>
    </div>
  );
}

export function PrivacyInfoSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border bg-muted/50 p-4">
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 shrink-0 rounded-full bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-40 rounded bg-muted" />
          <div className="h-3 w-full max-w-md rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}
