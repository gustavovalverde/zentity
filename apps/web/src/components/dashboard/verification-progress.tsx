"use client";

import {
  Camera,
  CheckCircle,
  Circle,
  FileCheck,
  Key,
  Shield,
  User,
  XCircle,
} from "lucide-react";
import { useMemo, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { trpcReact } from "@/lib/trpc/client";
import { cn } from "@/lib/utils/classname";

interface VerificationCheck {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  icon: React.ReactNode;
}

export interface VerificationChecks {
  document: boolean;
  liveness: boolean;
  ageProof: boolean;
  docValidityProof: boolean;
  nationalityProof: boolean;
  faceMatchProof: boolean;
  fheEncryption: boolean;
  fheError?: string | null;
}

interface VerificationProgressProps {
  checks: VerificationChecks;
}

export function VerificationProgress({
  checks,
}: Readonly<VerificationProgressProps>) {
  const refreshAttemptsRef = useRef(0);
  const shouldPoll = !(checks.fheEncryption || checks.fheError);
  const { data: assuranceProfile } = trpcReact.assurance.profile.useQuery(
    undefined,
    {
      enabled: shouldPoll,
      refetchInterval: (query) => {
        if (!shouldPoll) {
          return false;
        }
        const data = query.state.data;
        if (data?.assurance.proof.fheComplete || (data?.tier ?? 0) >= 3) {
          return false;
        }
        if (refreshAttemptsRef.current >= 8) {
          return false;
        }
        refreshAttemptsRef.current += 1;
        return 4000;
      },
    }
  );

  const fheEncryption =
    checks.fheEncryption ||
    (assuranceProfile?.assurance.proof.fheComplete ?? false);
  const fheError = checks.fheError ?? null;
  const effectiveChecks: VerificationChecks = {
    ...checks,
    fheEncryption,
    fheError,
  };

  const formatFheError = (issue?: string | null): string | null => {
    if (!issue) {
      return null;
    }
    switch (issue) {
      case "fhe_key_missing":
        return "FHE key registration failed";
      case "fhe_encryption_failed":
        return "FHE encryption failed";
      case "fhe_service_unavailable":
        return "FHE service unavailable";
      case "liveness_score_fhe_encryption_failed":
        return "Liveness encryption failed";
      case "liveness_score_fhe_service_unavailable":
        return "Liveness encryption unavailable";
      default:
        return issue.replaceAll("_", " ");
    }
  };

  const verificationChecks = useMemo<VerificationCheck[]>(
    () => [
      {
        id: "document",
        label: "Document Verified",
        description: "ID document processed via OCR",
        completed: effectiveChecks.document,
        icon: <FileCheck className="h-4 w-4" />,
      },
      {
        id: "liveness",
        label: "Liveness Check",
        description: "Real person confirmed",
        completed: effectiveChecks.liveness,
        icon: <Camera className="h-4 w-4" />,
      },
      {
        id: "faceMatchProof",
        label: "Face Match (ZK)",
        description: "Selfie matches ID photo",
        completed: effectiveChecks.faceMatchProof,
        icon: <User className="h-4 w-4" />,
      },
      {
        id: "ageProof",
        label: "Age Proof (ZK)",
        description: "18+ verified cryptographically",
        completed: effectiveChecks.ageProof,
        icon: <Shield className="h-4 w-4" />,
      },
      {
        id: "docValidityProof",
        label: "Document Valid (ZK)",
        description: "Document is not expired",
        completed: effectiveChecks.docValidityProof,
        icon: <FileCheck className="h-4 w-4" />,
      },
      {
        id: "nationalityProof",
        label: "Nationality Proof (ZK)",
        description: "Membership in allowlist group",
        completed: effectiveChecks.nationalityProof,
        icon: <Shield className="h-4 w-4" />,
      },
      {
        id: "fheEncryption",
        label: "FHE Encryption",
        description: "Data encrypted homomorphically",
        completed: effectiveChecks.fheEncryption,
        icon: <Key className="h-4 w-4" />,
      },
    ],
    [
      effectiveChecks.document,
      effectiveChecks.liveness,
      effectiveChecks.faceMatchProof,
      effectiveChecks.ageProof,
      effectiveChecks.docValidityProof,
      effectiveChecks.nationalityProof,
      effectiveChecks.fheEncryption,
    ]
  );

  const { completedCount, progress } = useMemo(() => {
    const count = [
      effectiveChecks.document,
      effectiveChecks.liveness,
      effectiveChecks.ageProof,
      effectiveChecks.docValidityProof,
      effectiveChecks.nationalityProof,
      effectiveChecks.faceMatchProof,
      effectiveChecks.fheEncryption,
    ].filter(Boolean).length;
    return { completedCount: count, progress: (count / 7) * 100 };
  }, [
    effectiveChecks.document,
    effectiveChecks.liveness,
    effectiveChecks.ageProof,
    effectiveChecks.docValidityProof,
    effectiveChecks.nationalityProof,
    effectiveChecks.faceMatchProof,
    effectiveChecks.fheEncryption,
  ]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Verification Progress</CardTitle>
        <p className="text-muted-foreground text-sm">
          {completedCount}/7 verification checks complete
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress className="h-2" value={progress} />
        <div className="space-y-3">
          {verificationChecks.map((check) => {
            const isFhe = check.id === "fheEncryption";
            const hasError = isFhe && Boolean(effectiveChecks.fheError);
            const fheErrorLabel = hasError
              ? formatFheError(effectiveChecks.fheError)
              : null;
            return (
              <div className="flex items-center gap-3" key={check.id}>
                <div className="shrink-0">
                  {(() => {
                    if (check.completed) {
                      return <CheckCircle className="h-5 w-5 text-success" />;
                    }
                    if (hasError) {
                      return <XCircle className="h-5 w-5 text-destructive" />;
                    }
                    return <Circle className="h-5 w-5 text-muted-foreground" />;
                  })()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{check.icon}</span>
                    <span
                      className={cn(
                        "font-medium text-sm",
                        check.completed
                          ? "text-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      {check.label}
                    </span>
                  </div>
                  <p className="truncate text-muted-foreground text-xs">
                    {fheErrorLabel ?? check.description}
                  </p>
                </div>
                <Badge
                  variant={(() => {
                    if (check.completed) {
                      return "success";
                    }
                    if (hasError) {
                      return "destructive";
                    }
                    return "outline";
                  })()}
                >
                  {(() => {
                    if (check.completed) {
                      return "Done";
                    }
                    if (hasError) {
                      return "Error";
                    }
                    return "Pending";
                  })()}
                </Badge>
              </div>
            );
          })}
        </div>
        {!(effectiveChecks.fheEncryption || effectiveChecks.fheError) && (
          <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <Spinner className="size-3" />
            Encrypting data securely… This may take a moment.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
