"use client";

import {
  Calendar,
  CheckCircle2,
  FileText,
  Globe,
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
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { getStoredProfile } from "@/lib/crypto/profile-secret";
import { hasCachedPasskeyUnlock } from "@/lib/crypto/secret-vault";
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
    if (!hasCachedPasskeyUnlock()) {
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
          <Spinner size="lg" />
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
        <ItemGroup>
          {/* Name */}
          <Item>
            <ItemMedia variant="icon">
              <User className="h-5 w-5" />
            </ItemMedia>
            <ItemContent>
              <ItemDescription>First Name</ItemDescription>
              {profileName ? (
                <ItemTitle>{profileName}</ItemTitle>
              ) : (
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
              )}
            </ItemContent>
          </Item>

          <ItemSeparator />

          {/* Email */}
          <Item>
            <ItemMedia variant="icon">
              <Mail className="h-5 w-5" />
            </ItemMedia>
            <ItemContent>
              <ItemDescription>Email</ItemDescription>
              <ItemTitle>{data.email}</ItemTitle>
            </ItemContent>
          </Item>

          <ItemSeparator />

          {/* Member Since */}
          <Item>
            <ItemMedia variant="icon">
              <Calendar className="h-5 w-5" />
            </ItemMedia>
            <ItemContent>
              <ItemDescription>Member Since</ItemDescription>
              <ItemTitle>{formatDate(data.createdAt)}</ItemTitle>
            </ItemContent>
          </Item>

          {/* Document Type (if verified) */}
          {data.documentType ? (
            <>
              <ItemSeparator />
              <Item>
                <ItemMedia variant="icon">
                  <FileText className="h-5 w-5" />
                </ItemMedia>
                <ItemContent>
                  <ItemDescription>Document Type</ItemDescription>
                  <ItemTitle>{formatDocumentType(data.documentType)}</ItemTitle>
                </ItemContent>
              </Item>
            </>
          ) : null}

          {/* Country (if verified) */}
          {data.countryVerified ? (
            <>
              <ItemSeparator />
              <Item>
                <ItemMedia variant="icon">
                  <Globe className="h-5 w-5" />
                </ItemMedia>
                <ItemContent>
                  <ItemDescription>Country Verified</ItemDescription>
                  <ItemTitle>{data.countryVerified}</ItemTitle>
                </ItemContent>
              </Item>
            </>
          ) : null}
        </ItemGroup>

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
