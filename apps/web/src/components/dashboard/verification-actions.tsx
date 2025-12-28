"use client";

import {
  CheckCircle,
  Clock,
  Key,
  Loader2,
  Shield,
  XCircle,
} from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getUserProof, verifyAgeViaFHE } from "@/lib/crypto";

interface VerificationResult {
  method: "zk" | "fhe";
  isValid: boolean;
  timeMs: number;
}

interface ProofData {
  proof: string; // Base64 encoded UltraHonk ZK proof
  publicSignals: string[];
  dobCiphertext: string | null;
}

export function VerificationActions() {
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isVerifyingZK, setIsVerifyingZK] = useState(false);
  const [isVerifyingFHE, setIsVerifyingFHE] = useState(false);
  const [zkResult, setZkResult] = useState<VerificationResult | null>(null);
  const [fheResult, setFheResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proofData, setProofData] = useState<ProofData | null>(null);

  const loadProofData = async () => {
    if (proofData) return proofData;

    setIsLoadingData(true);
    try {
      const data = await getUserProof(true);
      if (!data) {
        throw new Error("No proof data found");
      }
      const loaded = {
        proof: data.proof || "",
        publicSignals: data.publicSignals || [],
        dobCiphertext: data.dobCiphertext || null,
      };
      setProofData(loaded);
      return loaded;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load proof data",
      );
      return null;
    } finally {
      setIsLoadingData(false);
    }
  };

  const handleVerifyZK = async () => {
    setIsVerifyingZK(true);
    setError(null);
    setZkResult(null);

    try {
      const summary = await getUserProof();
      if (!summary?.proofId) {
        throw new Error("No stored ZK proof available");
      }
      setZkResult({
        method: "zk",
        isValid: summary.isOver18,
        timeMs: 0,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to refresh ZK status",
      );
    } finally {
      setIsVerifyingZK(false);
    }
  };

  const handleVerifyFHE = async () => {
    setIsVerifyingFHE(true);
    setError(null);
    setFheResult(null);

    try {
      const data = await loadProofData();
      if (!data || !data.dobCiphertext) {
        throw new Error(
          "FHE ciphertext not available. FHE service may have been unavailable during registration.",
        );
      }

      const result = await verifyAgeViaFHE(data.dobCiphertext);

      setFheResult({
        method: "fhe",
        isValid: result.isOver18,
        timeMs: result.computationTimeMs,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "FHE verification failed");
    } finally {
      setIsVerifyingFHE(false);
    }
  };

  const ResultBadge = ({ result }: { result: VerificationResult }) => (
    <div className="flex items-center gap-2">
      {result.isValid ? (
        <>
          <CheckCircle className="h-4 w-4 text-success" />
          <Badge variant="success">Verified 18+</Badge>
        </>
      ) : (
        <>
          <XCircle className="h-4 w-4 text-destructive" />
          <Badge variant="destructive">Not Verified</Badge>
        </>
      )}
      {result.timeMs > 0 ? (
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {result.timeMs}ms
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">stored</span>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live Age Verification</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {/* ZK Verification */}
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-info" />
              <span className="font-medium">Stored ZK Proof</span>
            </div>
            <p className="text-xs text-muted-foreground">
              View the last verified ZK proof status from registration
            </p>
            <Button
              onClick={handleVerifyZK}
              disabled={isVerifyingZK || isLoadingData}
              className="w-full"
              variant="outline"
            >
              {isVerifyingZK ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Refreshing...
                </>
              ) : (
                "Refresh ZK Status"
              )}
            </Button>
            {zkResult && <ResultBadge result={zkResult} />}
          </div>

          {/* FHE Verification */}
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5 text-info" />
              <span className="font-medium">FHE Computation</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Compute age check on encrypted data without decryption
            </p>
            <Button
              onClick={handleVerifyFHE}
              disabled={isVerifyingFHE || isLoadingData}
              className="w-full"
              variant="outline"
            >
              {isVerifyingFHE ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Computing...
                </>
              ) : (
                "Verify via FHE"
              )}
            </Button>
            {fheResult && <ResultBadge result={fheResult} />}
          </div>
        </div>

        {(zkResult || fheResult) && (
          <Alert>
            <AlertDescription className="text-xs">
              <strong>Comparison:</strong> ZK proofs are fast to verify (~
              {zkResult?.timeMs || "N/A"}ms) but require the original proof. FHE
              computation takes longer (~{fheResult?.timeMs || "N/A"}ms) but
              allows verification without storing the proof, only the encrypted
              data.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
