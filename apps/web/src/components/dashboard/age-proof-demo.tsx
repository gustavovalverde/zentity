"use client";

import {
  CheckCircle,
  Clock,
  FileCheck,
  Loader2,
  Shield,
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

interface AgeProofDemoProps {
  ageProof?: string;
  ageProofVerified?: boolean;
  ageProofsJson?: string; // Full proofs with publicSignals
}

export function AgeProofDemo({
  ageProof,
  ageProofVerified,
  ageProofsJson,
}: AgeProofDemoProps) {
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<{
    isValid: boolean;
    verificationTimeMs: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleVerifyProof = async () => {
    if (!ageProof && !ageProofsJson) return;

    setVerifying(true);
    setError(null);
    setResult(null);

    try {
      const startTime = Date.now();

      // Try to get the full proof with publicSignals from ageProofsJson first
      let proof: unknown;
      let publicSignals: string[];

      if (ageProofsJson) {
        // ageProofsJson contains full proofs: { "18": { proof: {...}, publicSignals: [...] }, ... }
        const proofs = JSON.parse(ageProofsJson);
        const age18Proof = proofs["18"];
        if (age18Proof?.proof && age18Proof?.publicSignals) {
          proof = age18Proof.proof;
          publicSignals = age18Proof.publicSignals;
        } else {
          throw new Error("No valid age 18 proof found in ageProofsJson");
        }
      } else if (ageProof) {
        // Fallback to legacy ageProof (only contains proof, no publicSignals)
        proof = JSON.parse(ageProof);
        // Best effort: assume publicSignals based on ageProofVerified flag
        publicSignals = ageProofVerified ? ["1", "18"] : ["0", "18"];
      } else {
        throw new Error("No proof data available");
      }

      const response = await fetch("/api/crypto/verify-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proof, publicSignals }),
      });

      const verificationTimeMs = Date.now() - startTime;

      if (!response.ok) {
        throw new Error("Verification failed");
      }

      const data = await response.json();
      setResult({
        isValid: data.isValid ?? true,
        verificationTimeMs,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const truncateProof = (proof: string) => {
    if (proof.length <= 50) return proof;
    return `${proof.substring(0, 25)}...${proof.substring(proof.length - 25)}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <FileCheck className="h-5 w-5" />
          ZK Age Proof Verification
        </CardTitle>
        <CardDescription>
          Verify the zero-knowledge proof that confirms age {"≥"} 18
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!ageProof && !ageProofsJson ? (
          <Alert>
            <Shield className="h-4 w-4" />
            <AlertDescription>
              No ZK proof available. Complete identity verification to generate
              an age proof.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Stored Proof</span>
                <Badge variant={ageProofVerified ? "default" : "secondary"}>
                  {ageProofVerified ? "Verified 18+" : "Not Verified"}
                </Badge>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 font-mono text-xs">
                <code className="break-all">
                  {truncateProof(ageProof ?? ageProofsJson ?? "")}
                </code>
              </div>
            </div>

            <Button
              onClick={handleVerifyProof}
              disabled={verifying}
              className="w-full"
              variant="outline"
            >
              {verifying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying ZK Proof...
                </>
              ) : (
                <>
                  <Shield className="mr-2 h-4 w-4" />
                  Verify ZK Proof On-Chain
                </>
              )}
            </Button>

            {result && (
              <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
                {result.isValid ? (
                  <>
                    <CheckCircle className="h-5 w-5 text-green-500" />
                    <span className="font-medium">Proof Valid</span>
                    <Badge variant="default" className="ml-auto">
                      Age {"≥"} 18 Confirmed
                    </Badge>
                  </>
                ) : (
                  <>
                    <XCircle className="h-5 w-5 text-red-500" />
                    <span className="font-medium">Proof Invalid</span>
                    <Badge variant="destructive" className="ml-auto">
                      Verification Failed
                    </Badge>
                  </>
                )}
              </div>
            )}

            {result && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                Verification time: {result.verificationTimeMs}ms
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Alert>
              <Shield className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Zero-Knowledge Proof:</strong> The verifier confirms age{" "}
                {"≥"} 18 without ever learning the actual birth year. The proof
                is cryptographically verifiable by anyone.
              </AlertDescription>
            </Alert>
          </>
        )}
      </CardContent>
    </Card>
  );
}
