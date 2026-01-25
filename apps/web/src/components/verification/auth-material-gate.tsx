"use client";

import type { ReactNode } from "react";
import type { AuthMaterialStatus } from "@/hooks/verification/use-auth-material-status";

import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { KeyRound, Lock, Wallet } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useSignTypedData } from "wagmi";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useAuthMaterialStatus } from "@/hooks/verification/use-auth-material-status";
import { authClient } from "@/lib/auth/auth-client";
import { evaluatePrf } from "@/lib/auth/webauthn-prf";
import { recordClientMetric } from "@/lib/observability/client-metrics";
import {
  buildKekSignatureTypedData,
  cacheOpaqueExportKey,
  cachePasskeyUnlock,
  cacheWalletSignature,
  signatureToBytes,
} from "@/lib/privacy/credentials";

const KEK_SIGNATURE_VALIDITY_DAYS = 365;

interface WalletAuthSectionProps {
  authStatus: AuthMaterialStatus;
  userId: string;
  isAuthenticating: boolean;
  setIsAuthenticating: (value: boolean) => void;
  setError: (value: string | null) => void;
  onSuccess: () => Promise<void>;
}

/**
 * Wallet auth section - isolated to only render when wallet auth is needed.
 * This ensures wagmi hooks are only called when WagmiProvider is available.
 */
function WalletAuthSection({
  authStatus,
  userId,
  isAuthenticating,
  setIsAuthenticating,
  setError,
  onSuccess,
}: Readonly<WalletAuthSectionProps>) {
  // Wagmi hooks - only called when this component renders (wallet auth mode)
  const { open: openWalletModal } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { mutateAsync: signTypedData } = useSignTypedData();

  const walletInfo =
    authStatus.status === "expired" ? authStatus.walletInfo : undefined;
  const isCorrectWallet =
    isConnected &&
    address &&
    walletInfo &&
    address.toLowerCase() === walletInfo.address.toLowerCase();

  const handleWalletAuth = useCallback(async () => {
    if (!walletInfo) {
      setError("Wallet information not available");
      return;
    }

    if (!(isConnected && address)) {
      openWalletModal().catch(() => undefined);
      return;
    }

    if (address.toLowerCase() !== walletInfo.address.toLowerCase()) {
      setError(
        `Please connect wallet ${walletInfo.address.slice(0, 6)}...${walletInfo.address.slice(-4)}`
      );
      openWalletModal().catch(() => undefined);
      return;
    }

    setIsAuthenticating(true);
    setError(null);

    try {
      const typedData = buildKekSignatureTypedData({
        userId,
        chainId: walletInfo.chainId,
      });

      const signStart = performance.now();
      let signResult: "ok" | "error" = "ok";
      let signature: string;
      try {
        signature = await signTypedData({
          domain: typedData.domain,
          types: typedData.types,
          primaryType: typedData.primaryType,
          message: typedData.message,
        });
      } catch (err) {
        signResult = "error";
        throw err;
      } finally {
        recordClientMetric({
          name: "client.wallet.sign.duration",
          value: performance.now() - signStart,
          attributes: { result: signResult },
        });
      }

      const signatureBytes = signatureToBytes(signature);
      const signedAt = Math.floor(Date.now() / 1000);
      const expiresAt = signedAt + KEK_SIGNATURE_VALIDITY_DAYS * 24 * 60 * 60;

      cacheWalletSignature({
        userId,
        address: walletInfo.address,
        chainId: walletInfo.chainId,
        signatureBytes,
        signedAt,
        expiresAt,
      });

      await onSuccess();
      toast.success("Wallet verified");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Wallet sign failed";
      if (
        message.toLowerCase().includes("rejected") ||
        message.toLowerCase().includes("denied") ||
        message.toLowerCase().includes("cancel")
      ) {
        setError("Signature request was cancelled. Please try again.");
      } else {
        setError(message);
      }
    } finally {
      setIsAuthenticating(false);
    }
  }, [
    walletInfo,
    userId,
    isConnected,
    address,
    openWalletModal,
    signTypedData,
    setIsAuthenticating,
    setError,
    onSuccess,
  ]);

  const renderButtonContent = () => {
    if (isAuthenticating) {
      return (
        <>
          <Spinner className="mr-2" size="sm" />
          Waiting for signature...
        </>
      );
    }
    if (isCorrectWallet) {
      return (
        <>
          <Wallet className="mr-2 h-4 w-4" />
          Sign with Wallet
        </>
      );
    }
    return (
      <>
        <Wallet className="mr-2 h-4 w-4" />
        Connect Wallet
      </>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-4">
        <Wallet className="h-8 w-8 text-muted-foreground" />
        <div>
          <p className="font-medium">Wallet Authentication</p>
          <p className="text-muted-foreground text-sm">
            Sign a message with your wallet to unlock your encryption keys
          </p>
        </div>
      </div>
      {isCorrectWallet ? (
        <div className="flex items-center justify-between rounded-lg bg-muted/30 p-3">
          <div>
            <p className="text-muted-foreground text-xs">Connected wallet</p>
            <p className="font-mono text-sm">
              {address.slice(0, 6)}...{address.slice(-4)}
            </p>
          </div>
        </div>
      ) : null}
      <Button
        className="w-full"
        disabled={isAuthenticating}
        onClick={() => handleWalletAuth().catch(() => undefined)}
      >
        {renderButtonContent()}
      </Button>
    </div>
  );
}

interface AuthMaterialGateProps {
  children: ReactNode;
}

/**
 * Gate component that ensures auth material cache is fresh before rendering children.
 * Shows a re-auth modal if the cache has expired.
 */
export function AuthMaterialGate({
  children,
}: Readonly<AuthMaterialGateProps>) {
  const { authStatus, recheckStatus, userId } = useAuthMaterialStatus();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordValue, setPasswordValue] = useState("");

  const handlePasskeyAuth = useCallback(async () => {
    if (authStatus.status !== "expired" || authStatus.authMode !== "passkey") {
      return;
    }

    setIsAuthenticating(true);
    setError(null);

    try {
      const passkeyCreds = authStatus.passkeyCreds;
      if (!passkeyCreds?.length) {
        throw new Error("No passkey credentials available");
      }

      const saltByCredential: Record<string, Uint8Array> = {};
      for (const cred of passkeyCreds) {
        saltByCredential[cred.credentialId] = cred.prfSalt;
      }

      const { prfOutputs, selectedCredentialId } = await evaluatePrf({
        credentialIdToSalt: saltByCredential,
      });

      const prfOutput = prfOutputs.get(selectedCredentialId);
      if (!prfOutput) {
        throw new Error("Failed to get PRF output from passkey");
      }

      cachePasskeyUnlock({
        credentialId: selectedCredentialId,
        prfOutput,
      });

      await recheckStatus();
      toast.success("Passkey verified");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Passkey authentication failed";
      if (
        message.includes("cancelled") ||
        message.includes("NotAllowedError")
      ) {
        setError("Authentication was cancelled. Please try again.");
      } else {
        setError(message);
      }
    } finally {
      setIsAuthenticating(false);
    }
  }, [authStatus, recheckStatus]);

  const handleOpaqueAuth = useCallback(async () => {
    if (!(passwordValue && userId)) {
      setError("Password is required");
      return;
    }

    setIsAuthenticating(true);
    setError(null);

    try {
      const sessionResult = await authClient.getSession();
      const identifier = sessionResult.data?.user?.email ?? null;

      if (!identifier) {
        throw new Error("Unable to determine account identifier");
      }

      const opaqueStart = performance.now();
      let opaqueResult: "ok" | "error" = "ok";
      let result: Awaited<ReturnType<typeof authClient.signIn.opaque>>;
      try {
        result = await authClient.signIn.opaque({
          identifier,
          password: passwordValue,
        });

        if (!result.data || result.error) {
          opaqueResult = "error";
          throw new Error(
            result.error?.message || "Password verification failed"
          );
        }
      } finally {
        recordClientMetric({
          name: "client.opaque.duration",
          value: performance.now() - opaqueStart,
          attributes: { result: opaqueResult },
        });
      }

      const exportKey = result.data.exportKey ?? null;
      const resultUserId = result.data.user?.id ?? null;

      if (!(exportKey && resultUserId)) {
        throw new Error("Password verified but export key was missing");
      }

      cacheOpaqueExportKey({ userId: resultUserId, exportKey });

      setPasswordValue("");
      await recheckStatus();
      toast.success("Password verified");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Password authentication failed";
      setError(message);
    } finally {
      setIsAuthenticating(false);
    }
  }, [passwordValue, userId, recheckStatus]);

  // Loading state
  if (authStatus.status === "checking") {
    return (
      <div className="space-y-6">
        <Skeleton className="h-50 w-full" />
        <Skeleton className="h-25 w-full" />
      </div>
    );
  }

  // Error state
  if (authStatus.status === "error") {
    return (
      <Alert variant="destructive">
        <AlertDescription>{authStatus.message}</AlertDescription>
      </Alert>
    );
  }

  // Fresh cache or no wrappers - render children
  if (authStatus.status === "fresh" || authStatus.status === "no_wrappers") {
    return <>{children}</>;
  }

  // Expired - show re-auth modal
  const isExpired = authStatus.status === "expired";
  const authMode = isExpired ? authStatus.authMode : null;

  return (
    <>
      {children}
      <Dialog open={isExpired}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Security Verification
            </DialogTitle>
            <DialogDescription>
              Please verify your identity to continue with verification. Your
              session has expired.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {authMode === "passkey" ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-4">
                  <KeyRound className="h-8 w-8 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Passkey Authentication</p>
                    <p className="text-muted-foreground text-sm">
                      Use your passkey to unlock your encryption keys
                    </p>
                  </div>
                </div>
                <Button
                  className="w-full"
                  disabled={isAuthenticating}
                  onClick={handlePasskeyAuth}
                >
                  {isAuthenticating ? (
                    <>
                      <Spinner className="mr-2" size="sm" />
                      Verifying...
                    </>
                  ) : (
                    <>
                      <KeyRound className="mr-2 h-4 w-4" />
                      Continue with Passkey
                    </>
                  )}
                </Button>
              </div>
            ) : null}

            {authMode === "opaque" ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-4">
                  <Lock className="h-8 w-8 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Password Authentication</p>
                    <p className="text-muted-foreground text-sm">
                      Enter your password to unlock your encryption keys
                    </p>
                  </div>
                </div>
                <Input
                  autoComplete="current-password"
                  disabled={isAuthenticating}
                  onChange={(e) => setPasswordValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleOpaqueAuth().catch(() => undefined);
                    }
                  }}
                  placeholder="Enter your password"
                  type="password"
                  value={passwordValue}
                />
                <Button
                  className="w-full"
                  disabled={isAuthenticating || !passwordValue}
                  onClick={() => handleOpaqueAuth().catch(() => undefined)}
                >
                  {isAuthenticating ? (
                    <>
                      <Spinner className="mr-2" size="sm" />
                      Verifying...
                    </>
                  ) : (
                    "Verify Password"
                  )}
                </Button>
              </div>
            ) : null}

            {authMode === "wallet" && userId ? (
              <WalletAuthSection
                authStatus={authStatus}
                isAuthenticating={isAuthenticating}
                onSuccess={recheckStatus}
                setError={setError}
                setIsAuthenticating={setIsAuthenticating}
                userId={userId}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
