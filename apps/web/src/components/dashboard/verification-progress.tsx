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
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

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

export function VerificationProgress({ checks }: VerificationProgressProps) {
  const router = useRouter();
  const refreshAttemptsRef = useRef(0);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }

    if (checks.fheEncryption || checks.fheError) {
      refreshAttemptsRef.current = 0;
      return;
    }

    if (refreshAttemptsRef.current >= 8) {
      return;
    }

    refreshTimeoutRef.current = setTimeout(() => {
      refreshAttemptsRef.current += 1;
      router.refresh();
    }, 4000);

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [checks.fheEncryption, checks.fheError, router]);

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
        return issue.replace(/_/g, " ");
    }
  };

  const verificationChecks: VerificationCheck[] = [
    {
      id: "document",
      label: "Document Verified",
      description: "ID document processed via OCR",
      completed: checks.document,
      icon: <FileCheck className="h-4 w-4" />,
    },
    {
      id: "liveness",
      label: "Liveness Check",
      description: "Real person confirmed",
      completed: checks.liveness,
      icon: <Camera className="h-4 w-4" />,
    },
    {
      id: "faceMatchProof",
      label: "Face Match (ZK)",
      description: "Selfie matches ID photo",
      completed: checks.faceMatchProof,
      icon: <User className="h-4 w-4" />,
    },
    {
      id: "ageProof",
      label: "Age Proof (ZK)",
      description: "18+ verified cryptographically",
      completed: checks.ageProof,
      icon: <Shield className="h-4 w-4" />,
    },
    {
      id: "docValidityProof",
      label: "Document Valid (ZK)",
      description: "Document is not expired",
      completed: checks.docValidityProof,
      icon: <FileCheck className="h-4 w-4" />,
    },
    {
      id: "nationalityProof",
      label: "Nationality Proof (ZK)",
      description: "Membership in allowlist group",
      completed: checks.nationalityProof,
      icon: <Shield className="h-4 w-4" />,
    },
    {
      id: "fheEncryption",
      label: "FHE Encryption",
      description: "Data encrypted homomorphically",
      completed: checks.fheEncryption,
      icon: <Key className="h-4 w-4" />,
    },
  ];

  const completedCount = [
    checks.document,
    checks.liveness,
    checks.ageProof,
    checks.docValidityProof,
    checks.nationalityProof,
    checks.faceMatchProof,
    checks.fheEncryption,
  ].filter(Boolean).length;
  const progress = (completedCount / 7) * 100;

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
            const hasError = isFhe && Boolean(checks.fheError);
            const fheErrorLabel = hasError
              ? formatFheError(checks.fheError)
              : null;
            return (
              <div className="flex items-center gap-3" key={check.id}>
                <div className="flex-shrink-0">
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
                      className={`font-medium text-sm ${
                        check.completed
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }`}
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
      </CardContent>
    </Card>
  );
}
