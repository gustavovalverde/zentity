"use client";

import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useChainId, useSignMessage, useSignTypedData } from "wagmi";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth/auth-client";
import { continueOAuthFlow, hasOAuthParams } from "@/lib/auth/oauth-post-login";
import { prepareForNewSession } from "@/lib/auth/session-manager";
import { signInWithSiwe } from "@/lib/auth/siwe";
import {
  buildKekSignatureTypedData,
  cacheWalletSignature,
  signatureToBytes,
} from "@/lib/privacy/credentials";
import { redirectTo } from "@/lib/utils/navigation";

const KEK_SIGNATURE_VALIDITY_DAYS = 365;

type SignInStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "signing_siwe"
  | "signing_kek";

/**
 * Wallet sign-in form component.
 * Handles two-signature authentication:
 * 1. SIWE (EIP-191) for session authentication
 * 2. EIP-712 for KEK derivation (deterministic)
 */
export function WalletSignInForm() {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const chainId = useChainId();
  const { mutateAsync: signMessage } = useSignMessage();
  const { mutateAsync: signTypedData } = useSignTypedData();

  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SignInStatus>("idle");

  useEffect(() => {
    if (isConnected && address && status === "connecting") {
      setStatus("ready");
      setError(null);
    }
  }, [isConnected, address, status]);

  const handleConnect = useCallback(() => {
    setStatus("connecting");
    setError(null);
    open().catch((err) => {
      setStatus("idle");
      const message =
        err instanceof Error ? err.message : "Failed to open wallet modal.";
      setError(message);
    });
  }, [open]);

  const handleSignIn = useCallback(async () => {
    if (!(isConnected && address)) {
      setError("Please connect your wallet first.");
      return;
    }

    prepareForNewSession();
    setStatus("signing_siwe");
    setError(null);

    try {
      // Step 1: SIWE authentication (session)
      await signInWithSiwe({
        address,
        chainId,
        signMessage: ({ message }) => signMessage({ message }),
      });

      // Check if we're in an OAuth flow - if so, skip KEK and go to consent
      if (hasOAuthParams()) {
        const oauthRedirect = await continueOAuthFlow();
        if (oauthRedirect) {
          toast.success("Signed in successfully!");
          redirectTo(oauthRedirect);
          return;
        }
      }

      // Step 2: Get userId from session
      const session = await authClient.getSession();
      const userId = session.data?.user?.id;

      if (!userId) {
        throw new Error("Failed to retrieve user session after SIWE sign-in.");
      }

      // Step 3: EIP-712 signature for KEK derivation
      setStatus("signing_kek");

      const typedData = buildKekSignatureTypedData({
        userId,
        chainId,
      });

      const signature = await signTypedData({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });

      const signatureBytes = signatureToBytes(signature);
      const signedAt = Math.floor(Date.now() / 1000);
      const expiresAt = signedAt + KEK_SIGNATURE_VALIDITY_DAYS * 24 * 60 * 60;

      // Step 4: Cache signature for FHE key access
      cacheWalletSignature({
        userId,
        address,
        chainId,
        signatureBytes,
        signedAt,
        expiresAt,
      });

      toast.success("Signed in successfully!");
      redirectTo("/dashboard");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Wallet sign-in failed.";

      if (
        message.toLowerCase().includes("user rejected") ||
        message.toLowerCase().includes("denied") ||
        message.toLowerCase().includes("cancel")
      ) {
        setError("Sign-in was cancelled. Please try again.");
      } else {
        setError(message);
        toast.error("Sign in failed", { description: message });
      }

      setStatus(isConnected && address ? "ready" : "idle");
    }
  }, [address, chainId, isConnected, signMessage, signTypedData]);

  const isLoading = status === "signing_siwe" || status === "signing_kek";
  const isReady = isConnected && address;

  const getButtonText = () => {
    if (status === "signing_siwe") {
      return "Signing in...";
    }
    if (status === "signing_kek") {
      return "Deriving encryption keys...";
    }
    return "Sign in with Wallet";
  };

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">Sign in with Wallet</span>
          </div>
          <p className="text-muted-foreground text-sm">
            Connect your Ethereum wallet and sign two messages: one to
            authenticate your session and one to derive your encryption keys.
          </p>
        </CardContent>
      </Card>

      {isReady ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
            <div>
              <p className="text-muted-foreground text-xs">Connected wallet</p>
              <p className="font-mono text-sm">
                {address.slice(0, 6)}...{address.slice(-4)}
              </p>
            </div>
            <Button
              disabled={isLoading}
              onClick={handleConnect}
              size="sm"
              type="button"
              variant="ghost"
            >
              Change
            </Button>
          </div>

          <Button
            className="w-full"
            disabled={isLoading}
            onClick={handleSignIn}
            size="lg"
            type="button"
          >
            {isLoading ? (
              <Spinner aria-hidden="true" className="mr-2" size="sm" />
            ) : (
              <Wallet className="mr-2 h-4 w-4" />
            )}
            {getButtonText()}
          </Button>
        </div>
      ) : (
        <Button
          className="w-full"
          disabled={status === "connecting"}
          onClick={handleConnect}
          size="lg"
          type="button"
        >
          {status === "connecting" ? (
            <Spinner aria-hidden="true" className="mr-2" size="sm" />
          ) : (
            <Wallet className="mr-2 h-4 w-4" />
          )}
          {status === "connecting" ? "Connecting..." : "Connect Wallet"}
        </Button>
      )}
    </div>
  );
}
