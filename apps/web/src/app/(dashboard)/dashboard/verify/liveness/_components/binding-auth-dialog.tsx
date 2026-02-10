"use client";

import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { KeyRound, Wallet } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useChainId, useSignTypedData } from "wagmi";

import { Web3Provider } from "@/components/providers/web3-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth/auth-client";
import {
  buildKekSignatureTypedData,
  signatureToBytes,
} from "@/lib/privacy/credentials";
import { setCachedBindingMaterial } from "@/lib/privacy/credentials/cache";

type Stage = "idle" | "verifying" | "done";

interface BindingAuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  authMode: "opaque" | "wallet";
  wallet: { address: string; chainId: number } | null;
  userId: string;
  onSuccess: () => void;
}

function WalletSignButton({
  wallet,
  userId,
  stage,
  onStageChange,
  onSuccess,
}: Readonly<{
  wallet: { address: string; chainId: number };
  userId: string;
  stage: Stage;
  onStageChange: (stage: Stage) => void;
  onSuccess: () => void;
}>) {
  const { open: openWalletModal } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const chainId = useChainId();
  const { mutateAsync: signTypedData } = useSignTypedData();

  const isRunning = stage === "verifying";

  const handleClick = useCallback(async () => {
    if (isRunning) {
      return;
    }

    if (!(isConnected && address)) {
      openWalletModal().catch(() => undefined);
      return;
    }

    if (address.toLowerCase() !== wallet.address.toLowerCase()) {
      toast.error(
        `Connect wallet ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
      );
      openWalletModal().catch(() => undefined);
      return;
    }

    if (chainId && chainId !== wallet.chainId) {
      toast.error("Switch to the linked wallet network");
      return;
    }

    onStageChange("verifying");
    try {
      const typedData = buildKekSignatureTypedData({
        userId,
        chainId: wallet.chainId,
      });

      const signArgs = {
        domain: typedData.domain as Record<string, unknown>,
        types: typedData.types as Record<
          string,
          Array<{ name: string; type: string }>
        >,
        primaryType: typedData.primaryType,
        message: typedData.message as Record<string, unknown>,
      };

      const signature1 = await signTypedData(signArgs);
      const signature2 = await signTypedData(signArgs);

      if (signature1 !== signature2) {
        throw new Error(
          "Wallet does not produce deterministic signatures. " +
            "Encryption key wrapping requires a wallet that implements RFC 6979."
        );
      }

      const signatureBytes = signatureToBytes(signature1);
      setCachedBindingMaterial({ mode: "wallet", signatureBytes });

      onStageChange("done");
      onSuccess();
    } catch (error) {
      onStageChange("idle");
      toast.error(
        error instanceof Error ? error.message : "Wallet signing failed"
      );
    }
  }, [
    isRunning,
    isConnected,
    address,
    wallet,
    chainId,
    userId,
    signTypedData,
    openWalletModal,
    onStageChange,
    onSuccess,
  ]);

  return (
    <Button
      className="w-full"
      disabled={isRunning}
      onClick={handleClick}
      size="lg"
    >
      {isRunning ? (
        <Spinner className="mr-2 size-4" />
      ) : (
        <Wallet className="mr-2 size-4" />
      )}
      {isRunning ? "Signing..." : "Sign with Wallet"}
    </Button>
  );
}

export function BindingAuthDialog({
  open,
  onOpenChange,
  authMode,
  wallet,
  userId,
  onSuccess,
}: Readonly<BindingAuthDialogProps>) {
  const [stage, setStage] = useState<Stage>("idle");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isRunning = stage === "verifying";

  const handleOpaqueSubmit = useCallback(async () => {
    if (!password.trim()) {
      setError("Enter your password to continue.");
      return;
    }

    setError(null);
    setStage("verifying");
    try {
      const result = await authClient.opaque.verifyPassword({ password });
      if (!result.data || result.error) {
        throw new Error(
          result.error?.message || "Password verification failed."
        );
      }

      setCachedBindingMaterial({
        mode: "opaque",
        exportKey: result.data.exportKey,
      });

      setStage("done");
      setPassword("");
      onSuccess();
    } catch (err) {
      setStage("idle");
      setError(err instanceof Error ? err.message : "Verification failed");
    }
  }, [password, onSuccess]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !isRunning) {
        handleOpaqueSubmit();
      }
    },
    [isRunning, handleOpaqueSubmit]
  );

  return (
    <Dialog onOpenChange={isRunning ? undefined : onOpenChange} open={open}>
      <DialogContent showCloseButton={!isRunning}>
        <DialogHeader>
          <DialogTitle>Confirm Your Identity</DialogTitle>
          <DialogDescription>
            {authMode === "opaque"
              ? "Enter your password to generate identity binding proofs."
              : "Sign with your wallet to generate identity binding proofs."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {authMode === "opaque" && (
            <>
              <div className="space-y-2">
                <Input
                  autoFocus
                  disabled={isRunning}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Your password"
                  type="password"
                  value={password}
                />
                {error && <p className="text-destructive text-sm">{error}</p>}
              </div>
              <Button
                className="w-full"
                disabled={isRunning || !password.trim()}
                onClick={handleOpaqueSubmit}
                size="lg"
              >
                {isRunning ? (
                  <Spinner className="mr-2 size-4" />
                ) : (
                  <KeyRound className="mr-2 size-4" />
                )}
                {isRunning ? "Verifying..." : "Confirm Password"}
              </Button>
            </>
          )}

          {authMode === "wallet" && wallet && (
            <Web3Provider cookies={null}>
              <WalletSignButton
                onStageChange={setStage}
                onSuccess={onSuccess}
                stage={stage}
                userId={userId}
                wallet={wallet}
              />
            </Web3Provider>
          )}

          {authMode === "wallet" && !wallet && (
            <p className="text-muted-foreground text-sm">
              No wallet linked. Please reconnect your wallet.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
