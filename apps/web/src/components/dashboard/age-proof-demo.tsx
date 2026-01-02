"use client";

import { CheckCircle, FileCheck, Loader2, Shield, XCircle } from "lucide-react";
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
import { getUserProof } from "@/lib/crypto/crypto-client";

export function AgeProofDemo() {
  const [storedProofSummary, setStoredProofSummary] = useState<{
    proofId: string;
    isOver18: boolean;
  } | null>(null);
  const [loadingStoredProof, setLoadingStoredProof] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadStoredProof() {
      try {
        const data = await getUserProof();
        if (cancelled) {
          return;
        }

        if (data?.proofId) {
          setStoredProofSummary({
            proofId: data.proofId,
            isOver18: data.isOver18,
          });
        } else {
          setStoredProofSummary(null);
        }
      } catch {
        // Ignore load errors; the refresh button will surface errors when explicitly invoked.
      } finally {
        if (!cancelled) {
          setLoadingStoredProof(false);
        }
      }
    }

    loadStoredProof().catch(() => {
      // Cache miss is expected; will generate fresh proof
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRefreshProof = async () => {
    setRefreshing(true);
    setError(null);

    try {
      const stored = await getUserProof();
      if (stored?.proofId) {
        setStoredProofSummary({
          proofId: stored.proofId,
          isOver18: stored.isOver18,
        });
      } else {
        setStoredProofSummary(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh proof");
    } finally {
      setRefreshing(false);
    }
  };

  const hasAnyProof = Boolean(storedProofSummary);
  const displayVerified = storedProofSummary?.isOver18 ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileCheck className="h-5 w-5" />
          ZK Age Proof Status
        </CardTitle>
        <CardDescription>
          Review the last verified zero-knowledge proof for age {"≥"} 18
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasAnyProof || loadingStoredProof ? (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">Stored Proof</span>
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
              className="w-full"
              disabled={refreshing}
              onClick={handleRefreshProof}
              variant="outline"
            >
              {refreshing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Refreshing...
                </>
              ) : (
                <>
                  <Shield className="mr-2 h-4 w-4" />
                  Refresh Status
                </>
              )}
            </Button>

            {storedProofSummary ? (
              <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3">
                {displayVerified ? (
                  <>
                    <CheckCircle className="h-5 w-5 text-success" />
                    <span className="font-medium">Proof Verified</span>
                    <Badge className="ml-auto" variant="success">
                      Age {"≥"} 18 Confirmed
                    </Badge>
                  </>
                ) : (
                  <>
                    <XCircle className="h-5 w-5 text-destructive" />
                    <span className="font-medium">Not Verified</span>
                    <Badge className="ml-auto" variant="destructive">
                      Verification Missing
                    </Badge>
                  </>
                )}
              </div>
            ) : null}

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <Alert>
              <Shield className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Zero-Knowledge Proof:</strong> The verifier confirms age{" "}
                {"≥"} 18 without ever learning the actual birth year. The proof
                is cryptographically verifiable by anyone.
              </AlertDescription>
            </Alert>
          </>
        ) : (
          <Alert>
            <Shield className="h-4 w-4" />
            <AlertDescription>
              No ZK proof stored yet. Complete verification to generate an age
              proof.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
