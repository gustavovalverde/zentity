import {
  ArrowRight,
  Calendar,
  CheckCircle,
  FileCheck,
  Globe,
} from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";

import { TransparencySection } from "@/components/dashboard/transparency-section";
import { VerificationActions } from "@/components/dashboard/verification-actions";
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
import { auth } from "@/lib/auth/auth";
import {
  getIdentityProofByUserId,
  getUserAgeProof,
  getUserFirstName,
  getVerificationStatus,
} from "@/lib/db";
import { getFirstPart } from "@/lib/utils";

// Fallback country names used when the backend doesn't provide a display name.
const COUNTRY_NAMES_FALLBACK: Record<string, string> = {
  DOM: "Dominican Republic",
  USA: "United States",
  ESP: "Spain",
  MEX: "Mexico",
  FRA: "France",
  DEU: "Germany",
  GBR: "United Kingdom",
  CAN: "Canada",
  BRA: "Brazil",
  ARG: "Argentina",
  COL: "Colombia",
  PER: "Peru",
  CHL: "Chile",
  ITA: "Italy",
  PRT: "Portugal",
};

function getCountryDisplayName(code: string, name?: string): string {
  if (name) return name;
  return COUNTRY_NAMES_FALLBACK[code] || code;
}

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
  const checks: VerificationChecks = {
    document: identityProof?.isDocumentVerified ?? false,
    liveness: identityProof?.isLivenessPassed ?? false,
    faceMatch: identityProof?.isFaceMatched ?? false,
    ageProof: Boolean(ageProof?.isOver18),
    fheEncryption:
      !!ageProof?.hasFheEncryption || !!identityProof?.dobCiphertext,
  };

  const hasProof = ageProof?.isOver18 || verificationStatus?.verified || false;

  // Identity data for transparency section
  const identityData = {
    documentHash: identityProof?.documentHash,
    nameCommitment: identityProof?.nameCommitment,
    dobCiphertext: ageProof?.dobCiphertext ?? identityProof?.dobCiphertext,
    // Document metadata (non-PII, safe to display)
    documentType: identityProof?.documentType,
    countryVerified: identityProof?.countryVerified,
    verifiedAt: identityProof?.verifiedAt,
  };

  // Determine the best name to display
  const displayName =
    getFirstPart(firstName) || getFirstPart(session?.user.name) || "User";

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

      {/* Stats Cards */}
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
            <p className="text-lg font-semibold text-success">
              {hasProof ? "No raw PII" : "N/A"}
            </p>
            <p className="text-xs text-muted-foreground">
              {hasProof
                ? "Only proofs, hashes, and encrypted values stored"
                : "Complete verification for privacy"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Verification Progress and Privacy Score */}
      <div className="grid gap-6 md:grid-cols-2">
        <VerificationProgress checks={checks} />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Privacy Score</CardTitle>
            <CardDescription>Your data exposure level</CardDescription>
          </CardHeader>
          <CardContent>
            {hasProof ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <svg
                      className="h-16 w-16 -rotate-90"
                      viewBox="0 0 36 36"
                      aria-hidden="true"
                    >
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="text-muted"
                      />
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeDasharray="100, 100"
                        className="text-success"
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-success">
                      100%
                    </span>
                  </div>
                  <div>
                    <Badge variant="success">Maximum Privacy</Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      No raw PII stored on our servers
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Your identity is verified using cryptographic proofs. Only
                  hashes and encrypted data are stored.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl font-bold text-warning">0%</span>
                  <Badge variant="warning">Not Verified</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Complete verification to enable privacy-preserving identity
                  proofs.
                </p>
                <Button asChild size="sm">
                  <Link href="/sign-up?fresh=1">
                    Start Verification
                    <ArrowRight className="ml-2 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Identity Summary - Show document metadata */}
      {hasProof &&
        (identityData.documentType || identityData.countryVerified) && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Identity Summary</CardTitle>
              <CardDescription>
                Verified document information (non-PII metadata)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {identityData.documentType && (
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-info/10 text-info">
                      <FileCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Document Type
                      </p>
                      <p className="font-medium">{identityData.documentType}</p>
                    </div>
                  </div>
                )}

                {identityData.countryVerified && (
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10 text-success">
                      <Globe className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Country</p>
                      <p className="font-medium">
                        {getCountryDisplayName(identityData.countryVerified)}
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
                      <p className="text-xs text-muted-foreground">
                        Age Verified
                      </p>
                      <p className="font-medium">18+ Confirmed</p>
                    </div>
                  </div>
                )}

                {identityData.verifiedAt && (
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-info/10 text-info">
                      <Calendar className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Verified On
                      </p>
                      <p className="font-medium">
                        {new Date(identityData.verifiedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

      {/* Transparency Section */}
      {hasProof && (
        <TransparencySection
          documentHash={identityData.documentHash}
          nameCommitment={identityData.nameCommitment}
          dobCiphertext={identityData.dobCiphertext}
          hasAgeProof={checks.ageProof}
        />
      )}

      {/* Verification Actions */}
      {hasProof && <VerificationActions />}
    </div>
  );
}
