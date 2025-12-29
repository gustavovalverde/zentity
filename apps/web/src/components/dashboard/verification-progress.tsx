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
  const formatFheError = (issue?: string | null): string | null => {
    if (!issue) return null;
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
        <p className="text-sm text-muted-foreground">
          {completedCount}/7 verification checks complete
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={progress} className="h-2" />
        <div className="space-y-3">
          {verificationChecks.map((check) => {
            const isFhe = check.id === "fheEncryption";
            const hasError = isFhe && Boolean(checks.fheError);
            const fheErrorLabel = hasError
              ? formatFheError(checks.fheError)
              : null;
            return (
              <div key={check.id} className="flex items-center gap-3">
                <div className="flex-shrink-0">
                  {check.completed ? (
                    <CheckCircle className="h-5 w-5 text-success" />
                  ) : hasError ? (
                    <XCircle className="h-5 w-5 text-destructive" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{check.icon}</span>
                    <span
                      className={`text-sm font-medium ${
                        check.completed
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {check.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {fheErrorLabel ?? check.description}
                  </p>
                </div>
                <Badge
                  variant={
                    check.completed
                      ? "success"
                      : hasError
                        ? "destructive"
                        : "outline"
                  }
                >
                  {check.completed ? "Done" : hasError ? "Error" : "Pending"}
                </Badge>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
