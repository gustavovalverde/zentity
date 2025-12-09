"use client";

import { CheckCircle, Clock, Loader2, Shield, XCircle } from "lucide-react";
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
import { Input } from "@/components/ui/input";

interface VerifyResult {
  matches: boolean;
  timeMs: number;
}

export function NameVerificationDemo() {
  const [claimedName, setClaimedName] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = async () => {
    if (!claimedName.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    const startTime = Date.now();

    try {
      const response = await fetch("/api/identity/verify-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimedName: claimedName.trim() }),
      });

      const timeMs = Date.now() - startTime;

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Verification failed");
      }

      const data = await response.json();
      setResult({ matches: data.matches, timeMs });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Name Verification Demo</CardTitle>
        <CardDescription>
          Verify if a name matches without revealing the stored name
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Enter name to verify (e.g., Juan Perez)"
            value={claimedName}
            onChange={(e) => setClaimedName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleVerify()}
          />
          <Button
            onClick={handleVerify}
            disabled={loading || !claimedName.trim()}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
          </Button>
        </div>

        {result && (
          <div
            className={`flex items-center gap-3 p-3 rounded-lg border ${
              result.matches
                ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950"
                : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950"
            }`}
          >
            {result.matches ? (
              <CheckCircle className="h-5 w-5 text-green-600" />
            ) : (
              <XCircle className="h-5 w-5 text-red-600" />
            )}
            <div className="flex-1">
              <span className="font-medium">
                {result.matches ? "Name verified" : "Name does not match"}
              </span>
            </div>
            <Badge variant={result.matches ? "default" : "destructive"}>
              {result.matches ? "MATCH" : "NO MATCH"}
            </Badge>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {result.timeMs}ms
            </span>
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Alert className="bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800">
          <Shield className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-xs">
            <strong>Privacy Guarantee:</strong> The stored name is NEVER
            revealed. We compute SHA256(normalize(input) + salt) and compare
            hashes. Only a boolean result is returned.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
