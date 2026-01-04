"use client";

import {
  Calendar,
  CheckCircle2,
  FileText,
  Globe,
  Loader2,
  Mail,
  User,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getStoredProfile } from "@/lib/crypto/profile-secret";
import { trpcReact } from "@/lib/trpc/client";

function VerificationBadge({
  passed,
  label,
}: {
  passed: boolean;
  label: string;
}) {
  return (
    <Badge variant={passed ? "success" : "outline"}>
      {passed ? (
        <CheckCircle2 className="mr-1 h-3 w-3" />
      ) : (
        <XCircle className="mr-1 h-3 w-3" />
      )}
      {label}
    </Badge>
  );
}

function formatDate(dateString: string | null): string {
  if (!dateString) {
    return "Unknown";
  }
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "Unknown";
  }
}

function formatDocumentType(type: string | null): string {
  if (!type) {
    return "Unknown";
  }
  const types: Record<string, string> = {
    cedula: "National ID (Cedula)",
    passport: "Passport",
    drivers_license: "Driver's License",
  };
  return types[type] ?? type;
}

export function UserDataSection() {
  // Use trpcReact hook for automatic data fetching, caching, and state management
  const {
    data,
    isLoading: loading,
    error: queryError,
  } = trpcReact.account.getData.useQuery();
  const error = queryError?.message ?? null;

  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const profile = await getStoredProfile();
      const firstName = profile?.firstName ?? null;
      setProfileName(firstName);
    } catch (err) {
      setProfileError(
        err instanceof Error ? err.message : "Unable to unlock profile"
      );
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!data) {
      return;
    }
    if (profileName) {
      return;
    }
    loadProfile().catch(() => {
      // Ignore auto-unlock errors; user can retry manually.
    });
  }, [data, profileName, loadProfile]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Your Information
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Your Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            {error ?? "Unable to load account data"}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          Your Information
        </CardTitle>
        <CardDescription>
          Data we've verified about you (commitments + encrypted profile,
          passkey required to unlock)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Name */}
        {profileName ? (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <User className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-muted-foreground text-sm">First Name</p>
                  <p className="font-medium">{profileName}</p>
                </div>
              </div>
            </div>
            <Separator />
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <User className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-muted-foreground text-sm">First Name</p>
                  <div className="flex items-center gap-2">
                    <Button
                      disabled={profileLoading}
                      onClick={() => {
                        loadProfile().catch(() => {
                          // handled via state
                        });
                      }}
                      size="sm"
                      variant="outline"
                    >
                      {profileLoading ? "Unlocking..." : "Unlock with passkey"}
                    </Button>
                    {profileError ? (
                      <span className="text-destructive text-xs">
                        {profileError}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
            <Separator />
          </>
        )}

        {/* Email */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <p className="text-muted-foreground text-sm">Email</p>
              <p className="font-medium">{data.email}</p>
            </div>
          </div>
        </div>

        <Separator />

        {/* Member Since */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <p className="text-muted-foreground text-sm">Member Since</p>
              <p className="font-medium">{formatDate(data.createdAt)}</p>
            </div>
          </div>
        </div>

        {/* Document Type & Country (if verified) */}
        {data.documentType ? (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-muted-foreground text-sm">Document Type</p>
                  <p className="font-medium">
                    {formatDocumentType(data.documentType)}
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {data.countryVerified ? (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Globe className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-muted-foreground text-sm">
                    Country Verified
                  </p>
                  <p className="font-medium">{data.countryVerified}</p>
                </div>
              </div>
            </div>
          </>
        ) : null}

        <Separator />

        {/* Verification Status */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-medium text-sm">Verification Status</p>
            <Badge
              variant={(() => {
                if (data.verification.level === "full") {
                  return "success";
                }
                if (data.verification.level === "basic") {
                  return "warning";
                }
                return "outline";
              })()}
            >
              {(() => {
                if (data.verification.level === "full") {
                  return "Fully Verified";
                }
                if (data.verification.level === "basic") {
                  return "Partially Verified";
                }
                return "Not Verified";
              })()}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <VerificationBadge
              label="Document"
              passed={data.verification.checks.document}
            />
            <VerificationBadge
              label="Liveness"
              passed={data.verification.checks.liveness}
            />
            <VerificationBadge
              label="Face Match (ZK)"
              passed={data.verification.checks.faceMatchProof}
            />
            <VerificationBadge
              label="Age (18+)"
              passed={data.verification.checks.ageProof}
            />
            <VerificationBadge
              label="Document Valid"
              passed={data.verification.checks.docValidityProof}
            />
            <VerificationBadge
              label="Nationality"
              passed={data.verification.checks.nationalityProof}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
