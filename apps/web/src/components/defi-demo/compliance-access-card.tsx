"use client";

import { useAppKitAccount } from "@reown/appkit/react";
/**
 * Compliance Access Card
 *
 * Requests the user to grant the ComplianceRules contract access
 * to their encrypted identity data in IdentityRegistry.
 */
import { AlertTriangle, CheckCircle, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import {
  useBalance,
  useChainId,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { IdentityRegistryABI } from "@/lib/contracts";
import { useDevFaucet } from "@/lib/wagmi/use-dev-faucet";

const GRANT_ACCESS_ABI = IdentityRegistryABI;

interface ComplianceAccessCardProps {
  identityRegistry: `0x${string}` | null | undefined;
  complianceRules: `0x${string}` | null | undefined;
  isGranted: boolean;
  onGranted: () => void;
  expectedChainId?: number;
  expectedNetworkName?: string;
  grantedTxHash?: string | null;
  grantedExplorerUrl?: string | null;
}

export function ComplianceAccessCard({
  identityRegistry,
  complianceRules,
  isGranted,
  onGranted,
  expectedChainId,
  expectedNetworkName,
  grantedTxHash,
  grantedExplorerUrl,
}: ComplianceAccessCardProps) {
  const { address } = useAppKitAccount();
  const walletAddress = address as `0x${string}` | undefined;
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const {
    data: balance,
    refetch: refetchBalance,
    isLoading: isBalanceLoading,
  } = useBalance({
    address: walletAddress,
  });
  const {
    faucet,
    isFauceting,
    error: faucetError,
    isSupported: isFaucetSupported,
  } = useDevFaucet(chainId);
  const {
    data: txHash,
    writeContractAsync,
    isPending: isWritePending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  useEffect(() => {
    if (isConfirmed && !isGranted) {
      onGranted();
      resetWrite();
    }
  }, [isConfirmed, isGranted, onGranted, resetWrite]);

  const error = writeError || confirmError || faucetError;
  const isPending =
    isWritePending || isConfirming || isFauceting || isSubmitting;
  const hasExpectedChain = !expectedChainId || chainId === expectedChainId;
  const isChainMismatch = Boolean(expectedChainId && !hasExpectedChain);
  const balanceValue = balance?.value;
  const insufficientFunds =
    !isBalanceLoading &&
    balanceValue !== undefined &&
    balanceValue <= BigInt(0);
  const isActionDisabled = isPending || isChainMismatch || insufficientFunds;

  const handleGrant = async () => {
    if (!identityRegistry || !complianceRules) return;
    if (isPending || txHash) return;
    setIsSubmitting(true);
    try {
      let hasFunds = !insufficientFunds;

      if (!hasFunds && isFaucetSupported) {
        const toppedUp = await faucet(walletAddress);
        if (toppedUp) {
          const refreshed = await refetchBalance();
          hasFunds = (refreshed.data?.value ?? BigInt(0)) > BigInt(0);
        }
      }
      if (!hasFunds) return;

      const txOverrides =
        chainId === 31337 ? { gas: BigInt(500_000) } : undefined;

      await writeContractAsync({
        address: identityRegistry,
        abi: GRANT_ACCESS_ABI,
        functionName: "grantAccessTo",
        args: [complianceRules],
        ...(txOverrides ?? {}),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSwitchNetwork = () => {
    if (!expectedChainId || !switchChain) return;
    switchChain({ chainId: expectedChainId });
  };

  if (!identityRegistry || !complianceRules) {
    return (
      <Card className="border-warning/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-warning">
            <AlertTriangle className="h-5 w-5" />
            Compliance Access Unavailable
          </CardTitle>
          <CardDescription>
            Compliance contract addresses are not configured for this network.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className={isGranted ? "border-success/30" : "border-dashed"}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Compliance Access</CardTitle>
        </div>
        <CardDescription>
          Grant the ComplianceRules contract access to your encrypted identity
          data to enable compliant transfers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isChainMismatch && (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Switch your wallet to{" "}
              <strong>{expectedNetworkName ?? "the correct network"}</strong> to
              grant compliance access.
            </AlertDescription>
          </Alert>
        )}
        {insufficientFunds && (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Your wallet has no ETH available for gas on this network.
            </AlertDescription>
          </Alert>
        )}

        {isGranted ? (
          <Alert variant="success">
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-1">
                <div>
                  Compliance access granted. You can now transfer tokens.
                </div>
                {grantedTxHash && (
                  <div className="text-xs text-muted-foreground">
                    Already granted on-chain.
                    {grantedExplorerUrl ? (
                      <>
                        {" "}
                        <a
                          href={grantedExplorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          View transaction
                        </a>
                      </>
                    ) : (
                      <>
                        {" "}
                        <span className="font-mono">
                          {`${grantedTxHash.slice(0, 6)}...${grantedTxHash.slice(
                            -4,
                          )}`}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                This is a one-time permission for compliance checks. It does not
                reveal your data to Zentity.
              </AlertDescription>
            </Alert>
            <Button
              onClick={handleGrant}
              disabled={isActionDisabled}
              className="w-full"
            >
              {isPending || txHash ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {txHash
                    ? "Waiting for Confirmation..."
                    : "Granting Access..."}
                </>
              ) : (
                "Grant Compliance Access"
              )}
            </Button>
            {isChainMismatch && (
              <Button
                variant="outline"
                onClick={handleSwitchNetwork}
                disabled={isSwitching}
                className="w-full"
              >
                {isSwitching
                  ? "Switching Network..."
                  : `Switch to ${expectedNetworkName ?? "Network"}`}
              </Button>
            )}
            {insufficientFunds && isFaucetSupported && (
              <Button
                variant="outline"
                onClick={async () => {
                  const toppedUp = await faucet(walletAddress);
                  if (toppedUp) {
                    await refetchBalance();
                  }
                }}
                disabled={isFauceting}
                className="w-full"
              >
                {isFauceting ? "Topping Up..." : "Top Up Test ETH"}
              </Button>
            )}
          </>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {error instanceof Error
                ? error.message.split("\n")[0]
                : "Grant failed"}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
