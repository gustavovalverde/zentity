"use client";

import {
  Calculator,
  CheckCircle,
  Clock,
  Loader2,
  Lock,
  XCircle,
} from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { verifyAgeViaFHE } from "@/lib/crypto";

interface FheVerificationDemoProps {
  dobCiphertext?: string;
  fheClientKeyId?: string;
}

export function FheVerificationDemo({
  dobCiphertext,
  fheClientKeyId: _fheClientKeyId,
}: FheVerificationDemoProps) {
  const [computing, setComputing] = useState(false);
  const [result, setResult] = useState<{
    isOver18: boolean;
    computationTimeMs: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFheVerification = async () => {
    if (!dobCiphertext) return;

    setComputing(true);
    setError(null);
    setResult(null);

    try {
      setResult(
        await verifyAgeViaFHE(dobCiphertext, new Date().getFullYear(), 18),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Computation failed");
    } finally {
      setComputing(false);
    }
  };

  const truncateCiphertext = (ct: string) => {
    if (ct.length <= 60) return ct;
    return `${ct.substring(0, 30)}...${ct.substring(ct.length - 30)}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          FHE Age Verification
        </CardTitle>
        <CardDescription>
          Compute on encrypted data without decryption
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!dobCiphertext ? (
          <Alert>
            <Lock className="h-4 w-4" />
            <AlertDescription>
              No encrypted DOB available. Complete identity verification to
              encrypt your birth year.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  Encrypted Birth Year
                </span>
                <Badge variant="secondary">
                  <Lock className="h-3 w-3 mr-1" />
                  FHE Encrypted
                </Badge>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 font-mono text-xs">
                <code className="break-all">
                  {truncateCiphertext(dobCiphertext)}
                </code>
              </div>
            </div>

            <Button
              onClick={handleFheVerification}
              disabled={computing}
              className="w-full"
              variant="outline"
            >
              {computing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Computing on Encrypted Data...
                </>
              ) : (
                <>
                  <Calculator className="mr-2 h-4 w-4" />
                  Run FHE Age Check
                </>
              )}
            </Button>

            {result && (
              <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
                {result.isOver18 ? (
                  <>
                    <CheckCircle className="h-5 w-5 text-green-500" />
                    <span className="font-medium">Age Check Passed</span>
                    <Badge variant="default" className="ml-auto">
                      {"≥"} 18 Years
                    </Badge>
                  </>
                ) : (
                  <>
                    <XCircle className="h-5 w-5 text-red-500" />
                    <span className="font-medium">Age Check Failed</span>
                    <Badge variant="destructive" className="ml-auto">
                      {"<"} 18 Years
                    </Badge>
                  </>
                )}
              </div>
            )}

            {result && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                FHE computation time: {result.computationTimeMs}ms
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Alert>
              <Lock className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Fully Homomorphic Encryption:</strong> The server
                computed (current_year - birth_year {"≥"} 18) on encrypted data
                without ever decrypting it. The actual birth year remains
                secret.
              </AlertDescription>
            </Alert>
          </>
        )}
      </CardContent>
    </Card>
  );
}
