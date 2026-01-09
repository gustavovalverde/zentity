"use client";

import Image from "next/image";
import { toDataURL } from "qrcode";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth/auth-client";

interface VerifyTwoFactorClientProps {
  redirectTo: string;
  totpUri?: string;
}

export function VerifyTwoFactorClient({
  redirectTo,
  totpUri,
}: VerifyTwoFactorClientProps) {
  const isSetup = Boolean(totpUri);
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [trustDevice, setTrustDevice] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);

  const fieldError = error;

  useEffect(() => {
    if (isSetup) {
      setMode("totp");
    }
  }, [isSetup]);

  useEffect(() => {
    if (!totpUri) {
      setQrCodeDataUrl(null);
      setIsGeneratingQr(false);
      return;
    }

    let active = true;
    setIsGeneratingQr(true);
    toDataURL(totpUri, { width: 200, margin: 1 })
      .then((dataUrl) => {
        if (active) {
          setQrCodeDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (active) {
          setQrCodeDataUrl(null);
        }
      })
      .finally(() => {
        if (active) {
          setIsGeneratingQr(false);
        }
      });

    return () => {
      active = false;
    };
  }, [totpUri]);

  const handleVerify = async () => {
    const trimmed = code.trim();
    const verificationMode = isSetup ? "totp" : mode;
    if (verificationMode === "totp" && trimmed.length !== 6) {
      setError("Please enter a 6-digit code");
      return;
    }
    if (verificationMode === "backup" && trimmed.length < 6) {
      setError("Please enter your backup code");
      return;
    }

    setIsVerifying(true);
    setError(null);

    try {
      const result =
        verificationMode === "totp"
          ? await authClient.twoFactor.verifyTotp({
              code: trimmed,
              trustDevice: isSetup ? false : trustDevice,
            })
          : await authClient.twoFactor.verifyBackupCode({
              code: trimmed,
              trustDevice,
            });

      if (result.error) {
        const fallbackMessage =
          verificationMode === "totp"
            ? "Invalid verification code"
            : "Invalid backup code";
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

  const renderQrContent = () => {
    if (!totpUri) {
      return null;
    }
    if (qrCodeDataUrl) {
      return (
        <Image
          alt="Authenticator QR code"
          className="h-40 w-40"
          height={160}
          src={qrCodeDataUrl}
          unoptimized
          width={160}
        />
      );
    }
    if (isGeneratingQr) {
      return (
        <div className="text-muted-foreground text-xs">
          Generating QR code...
        </div>
      );
    }
    return (
      <div className="text-muted-foreground text-xs">QR code unavailable.</div>
    );
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">
          {isSetup
            ? "Set up two-factor authentication"
            : "Two-Factor Authentication"}
        </CardTitle>
        <CardDescription>
          {isSetup
            ? "Scan the QR code and enter the 6-digit code to finish enabling two-factor authentication."
            : "Enter the 6-digit code from your authenticator app"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {totpUri ? (
          <div className="flex flex-col items-center gap-3">
            {renderQrContent()}
          </div>
        ) : null}
        <FieldGroup>
          <Field data-invalid={Boolean(fieldError)}>
            <FieldLabel>
              {mode === "totp" ? "Authentication code" : "Backup code"}
            </FieldLabel>
            {mode === "totp" ? (
              <div className="flex justify-center">
                <InputOTP
                  aria-invalid={Boolean(fieldError)}
                  aria-label="Authentication code"
                  autoComplete="one-time-code"
                  disabled={isVerifying}
                  inputMode="numeric"
                  maxLength={6}
                  name="totpCode"
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
              !isSetup && (
                <Input
                  aria-invalid={Boolean(fieldError)}
                  autoCapitalize="characters"
                  autoComplete="one-time-code"
                  disabled={isVerifying}
                  id="backup-code"
                  inputMode="text"
                  name="backupCode"
                  onChange={(event) => {
                    setCode(event.target.value);
                    setError(null);
                  }}
                  placeholder="ABCDE-12345"
                  spellCheck={false}
                  value={code}
                />
              )
            )}
            <FieldError>{fieldError}</FieldError>
          </Field>
        </FieldGroup>

        {isSetup ? null : (
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
        )}

        <div className="space-y-3">
          <Button
            className="w-full"
            disabled={isVerifying}
            onClick={handleVerify}
          >
            {isVerifying ? (
              <Spinner aria-hidden="true" className="mr-2" />
            ) : null}
            Verify
          </Button>

          {isSetup ? null : (
            <Button
              className="w-full"
              disabled={isVerifying}
              onClick={() => toggleMode(mode === "totp" ? "backup" : "totp")}
              variant="outline"
            >
              {mode === "totp" ? "Use a backup code" : "Use authenticator code"}
            </Button>
          )}
        </div>

        {isSetup ? null : (
          <p className="text-center text-muted-foreground text-xs">
            Lost access to your authenticator app? Use one of your backup codes
            to sign in.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
