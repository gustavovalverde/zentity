"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth/auth-client";

export function BackupCodesClient() {
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasDownloaded, setHasDownloaded] = useState(false);

  useEffect(() => {
    let active = true;

    const fetchBackupCodes = async () => {
      try {
        const result = await authClient.twoFactor.generateBackupCodes({
          fetchOptions: { throw: true },
        });
        if (active && result.backupCodes) {
          setBackupCodes(result.backupCodes);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to generate backup codes"
          );
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    fetchBackupCodes();

    return () => {
      active = false;
    };
  }, []);

  const handleDownload = () => {
    const content = ["Zentity Backup Codes", "", ...backupCodes].join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "zentity-backup-codes.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setHasDownloaded(true);
  };

  const handleContinue = () => {
    globalThis.window.location.assign("/dashboard/settings");
  };

  if (isLoading) {
    return (
      <Card className="w-full max-w-md">
        <CardContent className="flex items-center justify-center py-12">
          <Spinner className="h-8 w-8" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Error</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={handleContinue}>
            Back to Settings
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Save your backup codes</CardTitle>
        <CardDescription>
          Store these codes somewhere safe. You can use them to access your
          account if you lose your authenticator device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-2">
          {backupCodes.map((code) => (
            <div
              className="rounded-md bg-muted p-2 text-center font-mono text-sm"
              key={code}
            >
              {code}
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <Button className="w-full" onClick={handleDownload} variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Download Backup Codes
          </Button>

          <Button
            className="w-full"
            disabled={!hasDownloaded}
            onClick={handleContinue}
          >
            Continue
          </Button>

          {hasDownloaded ? null : (
            <p className="text-center text-muted-foreground text-xs">
              Please download your backup codes before continuing.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
