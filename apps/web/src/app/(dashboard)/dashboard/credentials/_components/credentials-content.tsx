"use client";

import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Code,
  Copy,
  FileCheck2,
  QrCode,
  Shield,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { toDataURL } from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { trpcReact } from "@/lib/trpc/client";

const CLAIM_LABELS: Record<string, string> = {
  verified: "Identity Verified",
  verification_level: "Verification Level",
  document_verified: "Document Verified",
  liveness_verified: "Liveness Verified",
  age_proof_verified: "Age Proof",
  nationality_verified: "Nationality Verified",
  face_match_verified: "Face Match",
};

interface CredentialOfferState {
  offerUri: string;
  offer: Record<string, unknown>;
  expiresIn: number;
  credentialConfigurationId: string;
}

export function CredentialsContent() {
  const [offerDialog, setOfferDialog] = useState<CredentialOfferState | null>(
    null
  );
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);

  const statusQuery = trpcReact.credentials.status.useQuery();
  const createOfferMutation = trpcReact.credentials.createOffer.useMutation();

  // Generate QR code when offer is created
  useEffect(() => {
    if (!offerDialog?.offerUri) {
      setQrCodeDataUrl(null);
      return;
    }

    let active = true;
    toDataURL(offerDialog.offerUri, { width: 280, margin: 2 })
      .then((dataUrl) => {
        if (active) {
          setQrCodeDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (active) {
          setQrCodeDataUrl(null);
        }
      });

    return () => {
      active = false;
    };
  }, [offerDialog?.offerUri]);

  // Countdown timer for offer expiration
  useEffect(() => {
    if (!offerDialog) {
      setCountdown(0);
      return;
    }

    setCountdown(offerDialog.expiresIn);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setOfferDialog(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [offerDialog]);

  const handleGetCredential = useCallback(
    async (credentialConfigurationId: string) => {
      try {
        const result = await createOfferMutation.mutateAsync({
          credentialConfigurationId,
        });

        setOfferDialog({
          offerUri: result.offerUri,
          offer: result.offer,
          expiresIn: result.expiresIn,
          credentialConfigurationId: result.credentialConfigurationId,
        });
      } catch (error) {
        toast.error("Failed to create credential offer", {
          description:
            error instanceof Error ? error.message : "Please try again",
        });
      }
    },
    [createOfferMutation]
  );

  const handleCopyUri = useCallback(async () => {
    if (!offerDialog?.offerUri) {
      return;
    }

    try {
      await navigator.clipboard.writeText(offerDialog.offerUri);
      toast.success("Copied to clipboard", {
        description: "Paste the URI into your wallet app",
      });
    } catch {
      toast.error("Failed to copy");
    }
  }, [offerDialog?.offerUri]);

  const handleCopyOfferJson = useCallback(async () => {
    if (!offerDialog?.offer) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        JSON.stringify(offerDialog.offer, null, 2)
      );
      toast.success("Copied offer JSON", {
        description: "For debugging or manual wallet configuration",
      });
    } catch {
      toast.error("Failed to copy");
    }
  }, [offerDialog?.offer]);

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (statusQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (statusQuery.error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Failed to load credential status. Please try again.
        </AlertDescription>
      </Alert>
    );
  }

  const status = statusQuery.data;

  if (!status?.verified && status?.level === "none") {
    return (
      <Card>
        <CardContent className="py-8">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Shield />
              </EmptyMedia>
              <EmptyTitle>Complete Verification First</EmptyTitle>
              <EmptyDescription>
                You need to complete identity verification before you can
                request verifiable credentials.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild>
                <Link href="/sign-up">Complete Verification</Link>
              </Button>
            </EmptyContent>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-success" />
            Verification Status
          </CardTitle>
          <CardDescription>
            Your verified claims that can be included in credentials
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {status?.verifiedClaims?.map((claim) => (
              <Badge key={claim} variant="secondary">
                <CheckCircle className="mr-1 h-3 w-3" />
                {CLAIM_LABELS[claim] || claim}
              </Badge>
            ))}
            {status?.level && status.level !== "none" && (
              <Badge variant="outline">Level: {status.level}</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Available Credentials */}
      {status?.availableCredentials?.map((credential) => (
        <Card key={credential.id}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCheck2 className="h-5 w-5" />
              {credential.name}
            </CardTitle>
            <CardDescription>{credential.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{credential.format}</Badge>
              <Badge variant="success">Ready to issue</Badge>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              disabled={createOfferMutation.isPending}
              onClick={() => handleGetCredential(credential.id)}
            >
              {createOfferMutation.isPending ? (
                <Spinner aria-hidden="true" className="mr-2" size="sm" />
              ) : (
                <QrCode className="mr-2 h-4 w-4" />
              )}
              Get Credential
            </Button>
          </CardFooter>
        </Card>
      ))}

      {/* How It Works */}
      <Alert>
        <Wallet className="h-4 w-4" />
        <AlertDescription>
          <strong>How it works:</strong> Click &quot;Get Credential&quot; to
          generate a QR code. Scan it with any OIDC4VCI-compliant wallet to
          receive your verifiable credential. The credential uses SD-JWT format
          for selective disclosure.
        </AlertDescription>
      </Alert>

      {/* Credential Offer Dialog */}
      <Dialog
        onOpenChange={(open) => !open && setOfferDialog(null)}
        open={offerDialog !== null}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              Scan with Your Wallet
            </DialogTitle>
            <DialogDescription>
              Scan this QR code with any OIDC4VCI-compliant wallet to receive
              your credential.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-4 py-4">
            {/* QR Code */}
            <div className="flex h-72 w-72 items-center justify-center rounded-lg border bg-white p-2">
              {qrCodeDataUrl ? (
                <Image
                  alt="Credential Offer QR Code"
                  className="h-full w-full"
                  height={280}
                  src={qrCodeDataUrl}
                  unoptimized
                  width={280}
                />
              ) : (
                <Spinner size="lg" />
              )}
            </div>

            {/* Expiration countdown */}
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Clock className="h-4 w-4" />
              <span>Expires in {formatCountdown(countdown)}</span>
            </div>

            {/* Action buttons */}
            <div className="flex w-full flex-col gap-2">
              <Button className="w-full" onClick={handleCopyUri}>
                <Copy className="mr-2 h-4 w-4" />
                Copy Offer URI
              </Button>
              <Button
                className="w-full"
                onClick={handleCopyOfferJson}
                variant="outline"
              >
                <Code className="mr-2 h-4 w-4" />
                Copy Offer JSON
              </Button>
            </div>
          </div>

          <div className="rounded-lg bg-muted p-3">
            <p className="text-muted-foreground text-xs">
              <strong>Compatible wallets:</strong> Any wallet supporting
              OpenID4VCI (e.g., walt.id, Talao, Lissi, EUDI Wallet Reference
              Implementation).
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
