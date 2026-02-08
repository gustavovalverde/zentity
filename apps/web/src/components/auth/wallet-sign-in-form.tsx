"use client";

import type { Eip712TypedData } from "@/lib/auth/plugins/eip712/types";

import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useChainId, useSignTypedData } from "wagmi";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth/auth-client";
import { continueOAuthFlow, hasOAuthParams } from "@/lib/auth/oauth-post-login";
import { prepareForNewSession } from "@/lib/auth/session-manager";
import { redirectTo } from "@/lib/utils/navigation";

type SignInStatus = "idle" | "connecting" | "ready" | "signing";

export function WalletSignInButton() {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const chainId = useChainId();
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
    setStatus("signing");
    setError(null);

    try {
      // Step 1: EIP-712 authentication
      const _result = await authClient.signIn.eip712({
        address,
        chainId,
        signTypedData: async (typedData: Eip712TypedData) =>
          signTypedData({
            domain: typedData.domain as Record<string, unknown>,
            types: typedData.types as Record<
              string,
              Array<{ name: string; type: string }>
            >,
            primaryType: typedData.primaryType,
            message: typedData.message,
          }),
      });

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
  }, [address, chainId, isConnected, signTypedData]);

  const isLoading = status === "signing";
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
            Sign in as {address.slice(0, 6)}...{address.slice(-4)}
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
