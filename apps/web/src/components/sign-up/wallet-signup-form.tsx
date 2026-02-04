"use client";

import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useChainId, useSignTypedData } from "wagmi";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  buildKekSignatureTypedData,
  signatureToBytes,
} from "@/lib/privacy/credentials";

const KEK_SIGNATURE_VALIDITY_DAYS = 365;

interface WalletSignUpFormProps {
  userId: string;
  onSuccess: (result: {
    userId: string;
    address: string;
    chainId: number;
    signatureBytes: Uint8Array;
    signedAt: number;
    expiresAt: number;
  }) => void;
  onBack: () => void;
  disabled?: boolean;
}

/**
 * Wallet sign-up form component.
 * Connects wallet and collects EIP-712 signature for FHE key wrapping.
 */
export function WalletSignUpForm({
  userId,
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

  const handleSign = useCallback(async () => {
    if (!(isConnected && address)) {
      setError("Please connect your wallet first.");
      return;
    }

    setIsSigning(true);
    setError(null);

    try {
      // Build deterministic typed data (no timestamp to ensure reproducibility)
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

      // Track when signature was obtained for cache management (not part of message)
      const signedAt = Math.floor(Date.now() / 1000);
      const expiresAt = signedAt + KEK_SIGNATURE_VALIDITY_DAYS * 24 * 60 * 60;

      onSuccess({
        userId,
        address,
        chainId,
        signatureBytes,
        signedAt,
        expiresAt,
      });
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
  }, [address, chainId, isConnected, onSuccess, signTypedData, userId]);

  useEffect(() => {
    if (isConnected && address && hasInitiatedConnect) {
      setError(null);
    }
  }, [address, hasInitiatedConnect, isConnected]);

  const isReady = isConnected && address;

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-muted-foreground" />
          <span className="font-medium">Web3 Wallet Sign-up</span>
        </div>
        <p className="text-muted-foreground text-sm">
          Connect your Ethereum wallet and sign a message to derive your
          encryption keys. This signature never leaves your browser and is only
          used locally to protect your data.
        </p>
      </div>

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
        <div className="space-y-4">
          <p className="text-center text-muted-foreground text-sm">
            Step 1: Connect your wallet
          </p>
          <Button
            className="w-full"
            disabled={disabled}
            onClick={handleConnect}
            type="button"
          >
            <Wallet className="mr-2 h-4 w-4" />
            Connect Wallet
          </Button>
        </div>
      )}

      <div className="flex gap-3">
        <Button
          disabled={disabled || isSigning}
          onClick={onBack}
          type="button"
          variant="outline"
        >
          Back
        </Button>
      </div>
    </div>
  );
}
