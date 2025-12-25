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
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc/client";

type AccountData = {
  email: string;
  firstName: string | null;
  createdAt: string | null;
  verification: {
    level: "none" | "basic" | "full";
    checks: {
      document: boolean;
      liveness: boolean;
      faceMatch: boolean;
      ageProof: boolean;
    };
  };
  documentType: string | null;
  countryVerified: string | null;
};

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
  if (!dateString) return "Unknown";
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
  if (!type) return "Unknown";
  const types: Record<string, string> = {
    cedula: "National ID (Cedula)",
    passport: "Passport",
    drivers_license: "Driver's License",
  };
  return types[type] ?? type;
}

export function UserDataSection() {
  const [data, setData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const result = await trpc.account.getData.query();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    void fetchData();
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
          <p className="text-sm text-muted-foreground">
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
          Data we've verified about you (stored as encrypted commitments)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Name */}
        {data.firstName && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <User className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">First Name</p>
                  <p className="font-medium">{data.firstName}</p>
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
              <p className="text-sm text-muted-foreground">Email</p>
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
              <p className="text-sm text-muted-foreground">Member Since</p>
              <p className="font-medium">{formatDate(data.createdAt)}</p>
            </div>
          </div>
        </div>

        {/* Document Type & Country (if verified) */}
        {data.documentType && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Document Type</p>
                  <p className="font-medium">
                    {formatDocumentType(data.documentType)}
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {data.countryVerified && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Globe className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    Country Verified
                  </p>
                  <p className="font-medium">{data.countryVerified}</p>
                </div>
              </div>
            </div>
          </>
        )}

        <Separator />

        {/* Verification Status */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Verification Status</p>
            <Badge
              variant={
                data.verification.level === "full"
                  ? "success"
                  : data.verification.level === "basic"
                    ? "warning"
                    : "outline"
              }
            >
              {data.verification.level === "full"
                ? "Fully Verified"
                : data.verification.level === "basic"
                  ? "Partially Verified"
                  : "Not Verified"}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <VerificationBadge
              passed={data.verification.checks.document}
              label="Document"
            />
            <VerificationBadge
              passed={data.verification.checks.liveness}
              label="Liveness"
            />
            <VerificationBadge
              passed={data.verification.checks.faceMatch}
              label="Face Match"
            />
            <VerificationBadge
              passed={data.verification.checks.ageProof}
              label="Age (18+)"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
