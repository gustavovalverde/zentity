"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/auth-client";

interface VerifyTwoFactorClientProps {
  redirectTo: string;
}

export function VerifyTwoFactorClient({
  redirectTo,
}: VerifyTwoFactorClientProps) {
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [trustDevice, setTrustDevice] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCodeInvalid =
    mode === "totp" ? code.trim().length !== 6 : code.trim().length < 6;

  const handleVerify = async () => {
    const trimmed = code.trim();
    if (mode === "totp" && trimmed.length !== 6) {
      setError("Please enter a 6-digit code");
      return;
    }
    if (mode === "backup" && trimmed.length < 6) {
      setError("Please enter your backup code");
      return;
    }

    setIsVerifying(true);
    setError(null);

    try {
      const result =
        mode === "totp"
          ? await authClient.twoFactor.verifyTotp({
              code: trimmed,
              trustDevice,
            })
          : await authClient.twoFactor.verifyBackupCode({
              code: trimmed,
              trustDevice,
            });

      if (result.error) {
        const fallbackMessage =
          mode === "totp" ? "Invalid verification code" : "Invalid backup code";
        setError(result.error.message || fallbackMessage);
        setCode("");
        return;
      }

      window.location.assign(redirectTo);
    } catch (err) {
      const fallbackMessage =
        mode === "totp"
          ? "Failed to verify code"
          : "Failed to verify backup code";
      setError(err instanceof Error ? err.message : fallbackMessage);
      setCode("");
    } finally {
      setIsVerifying(false);
    }
  };

  const toggleMode = (next: "totp" | "backup") => {
    setMode(next);
    setCode("");
    setError(null);
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Two-Factor Authentication</CardTitle>
        <CardDescription>
          Enter the 6-digit code from your authenticator app
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {mode === "totp" ? (
          <div className="flex justify-center">
            <InputOTP
              disabled={isVerifying}
              maxLength={6}
              onChange={(value) => {
                setCode(value);
                setError(null);
              }}
              value={code}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="backup-code">Backup code</Label>
            <Input
              autoComplete="one-time-code"
              disabled={isVerifying}
              id="backup-code"
              onChange={(event) => {
                setCode(event.target.value);
                setError(null);
              }}
              placeholder="ABCDE-12345"
              value={code}
            />
          </div>
        )}

        {error ? (
          <p className="text-center text-destructive text-sm">{error}</p>
        ) : null}

        <div className="flex items-center space-x-2">
          <Checkbox
            checked={trustDevice}
            id="trust-device"
            onCheckedChange={(checked) => setTrustDevice(checked === true)}
          />
          <Label className="text-sm" htmlFor="trust-device">
            Trust this device for 30 days
          </Label>
        </div>

        <div className="space-y-3">
          <Button
            className="w-full"
            disabled={isVerifying || isCodeInvalid}
            onClick={handleVerify}
          >
            {isVerifying ? "Verifying..." : "Verify"}
          </Button>

          <Button
            className="w-full"
            disabled={isVerifying}
            onClick={() => toggleMode(mode === "totp" ? "backup" : "totp")}
            variant="outline"
          >
            {mode === "totp" ? "Use a backup code" : "Use authenticator code"}
          </Button>
        </div>

        <p className="text-center text-muted-foreground text-xs">
          Lost access to your authenticator app? Use one of your backup codes to
          sign in.
        </p>
      </CardContent>
    </Card>
  );
}
