"use client";

import type { Eip712TypedData } from "@/lib/auth/plugins/eip712/types";

import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useChainId, useSignTypedData } from "wagmi";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ensureAuthSession } from "@/lib/auth/anonymous-session";
import { authClient } from "@/lib/auth/auth-client";
import {
  buildKekSignatureTypedData,
  cacheWalletSignature,
  signatureToBytes,
} from "@/lib/privacy/credentials";

const KEK_SIGNATURE_VALIDITY_DAYS = 365;

interface WalletSignUpFormProps {
  email?: string;
  onSuccess: (result: {
    userId: string;
    address: string;
    chainId: number;
  }) => void;
  onBack?: () => void;
  disabled?: boolean;
}

export function WalletSignUpForm({
  email,
  onSuccess,
  onBack,
  disabled = false,
}: Readonly<WalletSignUpFormProps>) {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const chainId = useChainId();
  const { mutateAsync: signTypedData } = useSignTypedData();

  const [error, setError] = useState<string | null>(null);
  const [isSigning, setIsSigning] = useState(false);
  const [hasInitiatedConnect, setHasInitiatedConnect] = useState(false);

  const handleConnect = useCallback(() => {
    setHasInitiatedConnect(true);
    open().catch((err) => {
      const message =
        err instanceof Error ? err.message : "Failed to open wallet modal.";
      setError(message);
    });
  }, [open]);

  // Auto-connect on mount (skip if already connected)
  const autoConnectAttempted = useRef(false);
  useEffect(() => {
    if (autoConnectAttempted.current || isConnected) {
      return;
    }
    autoConnectAttempted.current = true;
    handleConnect();
  }, [handleConnect, isConnected]);

  const handleSign = useCallback(async () => {
    if (!(isConnected && address)) {
      setError("Please connect your wallet first.");
      return;
    }

    setIsSigning(true);
    setError(null);

    try {
      // Step 1: Ensure anonymous session (unified sign-up path)
      await ensureAuthSession();

      // Step 2: EIP-712 auth signature (popup 1)
      const result = await authClient.signUp.eip712({
        address,
        chainId,
        email,
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

      const userId = result.user.id;

      // Step 3: KEK derivation signature (popup 2)
      try {
        const kekTypedData = buildKekSignatureTypedData({ userId, chainId });
        const kekSignature = await signTypedData({
          domain: kekTypedData.domain as Record<string, unknown>,
          types: kekTypedData.types as Record<
            string,
            Array<{ name: string; type: string }>
          >,
          primaryType: kekTypedData.primaryType,
          message: kekTypedData.message as Record<string, unknown>,
        });

        const signedAt = Math.floor(Date.now() / 1000);
        const expiresAt = signedAt + KEK_SIGNATURE_VALIDITY_DAYS * 24 * 60 * 60;

        cacheWalletSignature({
          userId,
          address,
          chainId,
          signatureBytes: signatureToBytes(kekSignature),
          signedAt,
          expiresAt,
        });
      } catch {
        // KEK failure is non-blocking; vault will prompt later
      }

      onSuccess({ userId, address, chainId });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to sign message.";
      if (
        message.toLowerCase().includes("user rejected") ||
        message.toLowerCase().includes("denied") ||
        message.toLowerCase().includes("cancel")
      ) {
        setError("Signature request was cancelled. Please try again.");
      } else {
        setError(message);
      }
    } finally {
      setIsSigning(false);
    }
  }, [address, chainId, email, isConnected, onSuccess, signTypedData]);

  useEffect(() => {
    if (isConnected && address && hasInitiatedConnect) {
      setError(null);
    }
  }, [address, hasInitiatedConnect, isConnected]);

  const isReady = isConnected && address;

  return (
    <div className="space-y-4">
      {!!error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

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
              disabled={disabled || isSigning}
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
            disabled={disabled || isSigning}
            onClick={handleSign}
            type="button"
          >
            {isSigning ? (
              <>
                <Spinner className="mr-2" size="sm" />
                Waiting for signature...
              </>
            ) : (
              "Sign & Create Account"
            )}
          </Button>
        </div>
      ) : (
        <Button
          className="w-full"
          disabled={disabled}
          onClick={handleConnect}
          type="button"
        >
          <Wallet className="mr-2 h-4 w-4" />
          Connect Wallet
        </Button>
      )}

      {onBack ? (
        <Button
          disabled={disabled || isSigning}
          onClick={onBack}
          type="button"
          variant="outline"
        >
          Back
        </Button>
      ) : null}
    </div>
  );
}
