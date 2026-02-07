"use client";

import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useChainId, useSignMessage, useSignTypedData } from "wagmi";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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

export function WalletSignInButton() {
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
      // Step 1: SIWE authentication (EIP-191)
      await signInWithSiwe({
        address,
        chainId,
        signMessage: ({ message }) => signMessage({ message }),
      });

      // Step 2: KEK derivation signature (EIP-712) — caches credential for vault unlock
      setStatus("signing_kek");
      try {
        const session = await authClient.getSession();
        const userId = session.data?.user?.id;
        if (userId) {
          const typedData = buildKekSignatureTypedData({ userId, chainId });
          const signature = await signTypedData({
            domain: typedData.domain as Record<string, unknown>,
            types: typedData.types as Record<
              string,
              Array<{ name: string; type: string }>
            >,
            primaryType: typedData.primaryType,
            message: typedData.message as Record<string, unknown>,
          });

          const signatureBytes = signatureToBytes(signature);
          const signedAt = Math.floor(Date.now() / 1000);
          const expiresAt =
            signedAt + KEK_SIGNATURE_VALIDITY_DAYS * 24 * 60 * 60;

          cacheWalletSignature({
            userId,
            address,
            chainId,
            signatureBytes,
            signedAt,
            expiresAt,
          });
        }
      } catch {
        // Non-blocking: KEK signature failure doesn't break sign-in.
        // The user can still access the dashboard; vault unlock will
        // prompt for the signature when needed.
      }

      if (hasOAuthParams()) {
        const oauthRedirect = await continueOAuthFlow();
        if (oauthRedirect) {
          toast.success("Signed in successfully!");
          redirectTo(oauthRedirect);
          return;
        }
      }

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

  return (
    <div className="space-y-2">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {isReady ? (
        <div className="space-y-2">
          <Button
            className="w-full"
            disabled={isLoading}
            onClick={handleSignIn}
            variant="outline"
          >
            {isLoading ? (
              <Spinner aria-hidden="true" className="mr-2" size="sm" />
            ) : (
              <Wallet className="mr-2 h-4 w-4" />
            )}
            {status === "signing_kek"
              ? "Unlocking vault..."
              : `Sign in as ${address.slice(0, 6)}...${address.slice(-4)}`}
          </Button>
          <button
            className="w-full text-center text-muted-foreground text-xs hover:underline"
            disabled={isLoading}
            onClick={handleConnect}
            type="button"
          >
            Change wallet
          </button>
        </div>
      ) : (
        <Button
          className="w-full"
          disabled={status === "connecting"}
          onClick={handleConnect}
          variant="outline"
        >
          {status === "connecting" ? (
            <Spinner aria-hidden="true" className="mr-2" size="sm" />
          ) : (
            <Wallet className="mr-2 h-4 w-4" />
          )}
          {status === "connecting" ? "Connecting..." : "Sign in with Wallet"}
        </Button>
      )}
    </div>
  );
}
