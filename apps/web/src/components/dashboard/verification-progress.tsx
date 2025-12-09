"use client";

import {
  Camera,
  CheckCircle,
  Circle,
  FileCheck,
  Key,
  Shield,
  User,
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
  faceMatch: boolean;
  ageProof: boolean;
  fheEncryption: boolean;
}

interface VerificationProgressProps {
  checks: VerificationChecks;
}

export function VerificationProgress({ checks }: VerificationProgressProps) {
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
      id: "faceMatch",
      label: "Face Match",
      description: "Selfie matches ID photo",
      completed: checks.faceMatch,
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
      id: "fheEncryption",
      label: "FHE Encryption",
      description: "Data encrypted homomorphically",
      completed: checks.fheEncryption,
      icon: <Key className="h-4 w-4" />,
    },
  ];

  const completedCount = Object.values(checks).filter(Boolean).length;
  const progress = (completedCount / 5) * 100;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Verification Progress</CardTitle>
        <p className="text-sm text-muted-foreground">
          {completedCount}/5 verification checks complete
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={progress} className="h-2" />
        <div className="space-y-3">
          {verificationChecks.map((check) => (
            <div key={check.id} className="flex items-center gap-3">
              <div className="flex-shrink-0">
                {check.completed ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
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
                  {check.description}
                </p>
              </div>
              <Badge
                variant={check.completed ? "default" : "outline"}
                className={
                  check.completed ? "bg-green-600 hover:bg-green-600" : ""
                }
              >
                {check.completed ? "Done" : "Pending"}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
