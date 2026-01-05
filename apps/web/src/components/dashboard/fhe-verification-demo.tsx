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
import { verifyAgeViaFHE } from "@/lib/crypto/crypto-client";

interface FheVerificationDemoProps {
  birthYearOffsetCiphertextHash?: string | null;
  birthYearOffsetCiphertextBytes?: number | null;
  fheKeyId?: string;
}

export function FheVerificationDemo({
  birthYearOffsetCiphertextHash,
  birthYearOffsetCiphertextBytes,
  fheKeyId,
}: FheVerificationDemoProps) {
  const [computing, setComputing] = useState(false);
  const [result, setResult] = useState<{
    isOver18: boolean;
    computationTimeMs: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFheVerification = async () => {
    if (!(birthYearOffsetCiphertextBytes && fheKeyId)) {
      return;
    }

    setComputing(true);
    setError(null);
    setResult(null);

    try {
      setResult(await verifyAgeViaFHE(fheKeyId, new Date().getFullYear(), 18));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Computation failed");
    } finally {
      setComputing(false);
    }
  };

  const truncateHash = (hash: string) => {
    if (hash.length <= 16) {
      return hash;
    }
    return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Calculator className="h-5 w-5" />
          FHE Age Verification
        </CardTitle>
        <CardDescription>
          Compute on encrypted data without decryption
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {birthYearOffsetCiphertextBytes && fheKeyId ? (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">
                  Encrypted Birth Year Offset
                </span>
                <Badge variant="secondary">
                  <Lock className="mr-1 h-3 w-3" />
                  FHE Encrypted
                </Badge>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 font-mono text-xs">
                <div className="flex flex-col gap-1">
                  <span>{birthYearOffsetCiphertextBytes} bytes</span>
                  {birthYearOffsetCiphertextHash ? (
                    <span>
                      sha256: {truncateHash(birthYearOffsetCiphertextHash)}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <Button
              className="w-full"
              disabled={computing}
              onClick={handleFheVerification}
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

            {result ? (
              <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3">
                {result.isOver18 ? (
                  <>
                    <CheckCircle className="h-5 w-5 text-success" />
                    <span className="font-medium">Age Check Passed</span>
                    <Badge className="ml-auto" variant="success">
                      {"≥"} 18 Years
                    </Badge>
                  </>
                ) : (
                  <>
                    <XCircle className="h-5 w-5 text-destructive" />
                    <span className="font-medium">Age Check Failed</span>
                    <Badge className="ml-auto" variant="destructive">
                      {"<"} 18 Years
                    </Badge>
                  </>
                )}
              </div>
            ) : null}

            {result ? (
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <Clock className="h-3 w-3" />
                FHE computation time: {result.computationTimeMs}ms
              </div>
            ) : null}

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <Alert>
              <Lock className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Fully Homomorphic Encryption:</strong> The server
                computed (current_year_offset - birth_year_offset {"≥"} 18) on
                encrypted data without ever decrypting it. The actual birth year
                remains secret.
              </AlertDescription>
            </Alert>
          </>
        ) : (
          <Alert>
            <Lock className="h-4 w-4" />
            <AlertDescription>
              No encrypted birth year offset or key available. Complete identity
              verification to encrypt your data.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
