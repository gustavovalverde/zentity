"use client";

import {
  CheckCircle,
  Clock,
  FileCheck,
  Loader2,
  Shield,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
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

export function AgeProofDemo() {
  const [storedProofSummary, setStoredProofSummary] = useState<{
    proofId: string;
    isOver18: boolean;
  } | null>(null);
  const [loadingStoredProof, setLoadingStoredProof] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<{
    isValid: boolean;
    verificationTimeMs: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadStoredProof() {
      try {
        const res = await fetch("/api/user/proof");
        if (!res.ok) {
          if (res.status === 404) {
            if (!cancelled) setStoredProofSummary(null);
            return;
          }
          return;
        }
        const data = (await res.json()) as {
          proofId?: unknown;
          isOver18?: unknown;
        };
        if (!cancelled) {
          if (
            typeof data.proofId === "string" &&
            typeof data.isOver18 === "boolean"
          ) {
            setStoredProofSummary({
              proofId: data.proofId,
              isOver18: data.isOver18,
            });
          } else {
            setStoredProofSummary(null);
          }
        }
      } catch {
        // Ignore load errors; the verify button will surface errors when explicitly invoked.
      } finally {
        if (!cancelled) setLoadingStoredProof(false);
      }
    }

    void loadStoredProof();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleVerifyProof = async () => {
    setVerifying(true);
    setError(null);
    setResult(null);

    try {
      const startTime = Date.now();

      let proof: string;
      let publicInputs: string[];

      // Use the stored proof from /api/user/proof (current format).
      const storedRes = await fetch("/api/user/proof?full=true");
      if (storedRes.ok) {
        const stored = (await storedRes.json()) as {
          proof?: unknown;
          publicSignals?: unknown;
        };
        if (typeof stored.proof !== "string") {
          throw new Error("Stored proof is missing or invalid");
        }
        if (!Array.isArray(stored.publicSignals)) {
          throw new Error("Stored public signals are missing or invalid");
        }
        proof = stored.proof;
        publicInputs = stored.publicSignals.map(String);
      } else {
        throw new Error("No stored proof available");
      }

      const response = await fetch("/api/crypto/verify-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proof,
          publicInputs,
          circuitType: "age_verification",
        }),
      });

      const verificationTimeMs = Date.now() - startTime;

      if (!response.ok) {
        throw new Error("Verification failed");
      }

      const data = (await response.json()) as { isValid?: boolean };
      setResult({
        isValid: Boolean(data.isValid),
        verificationTimeMs,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const hasAnyProof = Boolean(storedProofSummary);
  const displayVerified = storedProofSummary?.isOver18 ?? false;

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
        {!hasAnyProof && !loadingStoredProof ? (
          <Alert>
            <Shield className="h-4 w-4" />
            <AlertDescription>
              No ZK proof stored yet. Complete verification to generate an age
              proof.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Stored Proof</span>
                <Badge variant={displayVerified ? "default" : "secondary"}>
                  {displayVerified ? "Verified 18+" : "Not Verified"}
                </Badge>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 font-mono text-xs">
                <code className="break-all">
                  {storedProofSummary
                    ? `Proof ID: ${storedProofSummary.proofId}`
                    : "Loading..."}
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
                  Verify ZK Proof
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
