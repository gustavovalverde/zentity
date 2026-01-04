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
import { getStoredProfile } from "@/lib/crypto/profile-secret";
import { trpc } from "@/lib/trpc/client";

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
    if (!claimedName.trim()) {
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    const startTime = Date.now();

    try {
      const profile = await getStoredProfile();
      if (!profile?.userSalt) {
        throw new Error("User salt unavailable. Unlock your profile first.");
      }
      const data = await trpc.identity.verifyName.mutate({
        claimedName: claimedName.trim(),
        userSalt: profile.userSalt,
      });
      const timeMs = Date.now() - startTime;
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
            onChange={(e) => setClaimedName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleVerify()}
            placeholder="Enter name to verify (e.g., Juan Perez)"
            value={claimedName}
          />
          <Button
            disabled={loading || !claimedName.trim()}
            onClick={handleVerify}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
          </Button>
        </div>

        {result ? (
          <div
            className={`flex items-center gap-3 rounded-lg border p-3 ${
              result.matches
                ? "border-success/30 bg-success/10 text-success"
                : "border-destructive/30 bg-destructive/10 text-destructive"
            }`}
          >
            {result.matches ? (
              <CheckCircle className="h-5 w-5" />
            ) : (
              <XCircle className="h-5 w-5" />
            )}
            <div className="flex-1">
              <span className="font-medium">
                {result.matches ? "Name verified" : "Name does not match"}
              </span>
            </div>
            <Badge variant={result.matches ? "success" : "destructive"}>
              {result.matches ? "MATCH" : "NO MATCH"}
            </Badge>
            <span className="flex items-center gap-1 text-muted-foreground text-xs">
              <Clock className="h-3 w-3" />
              {result.timeMs}ms
            </span>
          </div>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Alert variant="info">
          <Shield className="h-4 w-4" />
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
