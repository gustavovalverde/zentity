"use client";

import { Calendar, CheckCircle2, User, XCircle } from "lucide-react";
import { memo, useCallback, useState } from "react";

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
import { Redacted } from "@/components/ui/redacted";
import { Spinner } from "@/components/ui/spinner";
import { getStoredProfile } from "@/lib/privacy/secrets/profile";
import { trpcReact } from "@/lib/trpc/client";

/**
 * Verification status badge.
 * Memoized to prevent re-renders when other badges change.
 */
const VerificationBadge = memo(function VerificationBadge({
  passed,
  label,
}: Readonly<{
  passed: boolean;
  label: string;
}>) {
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
});

const VERIFICATION_LEVEL_VARIANTS = {
  full: "success",
  basic: "warning",
} as const;

const VERIFICATION_LEVEL_LABELS = {
  full: "Fully Verified",
  basic: "Partially Verified",
} as const;

const VALIDITY_STATUS_LABELS = {
  pending: "Pending",
  verified: "Current",
  failed: "Failed",
  revoked: "Revoked",
  stale: "Expired",
} as const;

const CREDENTIAL_METHOD_LABELS = {
  ocr: "Document OCR",
  nfc_chip: "Passport Chip",
} as const;

const VerificationLevelBadge = memo(function VerificationLevelBadge({
  level,
}: Readonly<{
  level: string | null;
}>) {
  const variant =
    (level &&
      VERIFICATION_LEVEL_VARIANTS[
        level as keyof typeof VERIFICATION_LEVEL_VARIANTS
      ]) ||
    "outline";
  const label =
    (level &&
      VERIFICATION_LEVEL_LABELS[
        level as keyof typeof VERIFICATION_LEVEL_LABELS
      ]) ||
    "Not Verified";
  return <Badge variant={variant}>{label}</Badge>;
});

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

function getCredentialMethodLabel(method: string): string {
  return (
    CREDENTIAL_METHOD_LABELS[method as keyof typeof CREDENTIAL_METHOD_LABELS] ??
    method
  );
}

function getValidityBadgeVariant(
  validityStatus: "pending" | "verified" | "failed" | "revoked" | "stale"
): "success" | "warning" | "outline" {
  if (validityStatus === "verified") {
    return "success";
  }

  if (validityStatus === "stale") {
    return "warning";
  }

  return "outline";
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
          Data we've verified about you (commitments + encrypted profile)
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
                <ItemTitle>
                  <Redacted>{profileName}</Redacted>
                </ItemTitle>
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
                    {profileLoading ? (
                      <Spinner aria-hidden="true" className="mr-2" size="sm" />
                    ) : null}
                    Unlock
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
        </ItemGroup>

        {/* Verification Status */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-sm">Verification Status</p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={getValidityBadgeVariant(
                  data.verification.validityStatus
                )}
              >
                {
                  VALIDITY_STATUS_LABELS[
                    data.verification
                      .validityStatus as keyof typeof VALIDITY_STATUS_LABELS
                  ]
                }
              </Badge>
              <VerificationLevelBadge level={data.verification.level} />
            </div>
          </div>
          {data.verification.verificationExpiresAt ? (
            <p className="text-muted-foreground text-xs">
              Verification expires{" "}
              {formatDate(data.verification.verificationExpiresAt)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <VerificationBadge
              label="Document"
              passed={data.verification.checks.documentVerified}
            />
            <VerificationBadge
              label="Liveness"
              passed={data.verification.checks.livenessVerified}
            />
            <VerificationBadge
              label="Face Match"
              passed={data.verification.checks.faceMatchVerified}
            />
            <VerificationBadge
              label="Age (18+)"
              passed={data.verification.checks.ageVerified}
            />
            <VerificationBadge
              label="Nationality"
              passed={data.verification.checks.nationalityVerified}
            />
            <VerificationBadge
              label="Identity Bound"
              passed={data.verification.checks.identityBound}
            />
          </div>
        </div>

        {data.groupedIdentity.credentials.length > 0 ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-sm">Identity Credentials</p>
              <Badge variant="outline">
                {data.groupedIdentity.credentials.length} credential
                {data.groupedIdentity.credentials.length === 1 ? "" : "s"}
              </Badge>
            </div>

            <div className="space-y-2">
              {data.groupedIdentity.credentials.map((credential) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3"
                  key={credential.credentialId}
                >
                  <div className="space-y-1">
                    <p className="font-medium text-sm">
                      {getCredentialMethodLabel(credential.method)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Verified {formatDate(credential.verifiedAt)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        credential.status === "verified" ? "success" : "outline"
                      }
                    >
                      {credential.status}
                    </Badge>
                    {credential.isEffective ? (
                      <Badge variant="secondary">Selected</Badge>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
