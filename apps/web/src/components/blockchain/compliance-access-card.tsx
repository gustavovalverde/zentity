"use client";

import { useAppKitAccount } from "@reown/appkit/react";
/**
 * Compliance Access Card
 *
 * Requests the user to grant the ComplianceRules contract access
 * to their encrypted identity data in IdentityRegistry.
 */
import { AlertTriangle, CheckCircle, ShieldCheck } from "lucide-react";

/** Matches error reason text (e.g., "reason: Some error message") */
const ERROR_REASON_PATTERN = /reason:\s*(.+)/;
/** Matches hex error data (e.g., "data: 0x12345abc") */
const ERROR_DATA_PATTERN = /data:\s*(0x[a-fA-F0-9]+)/;

import { IdentityRegistryABI } from "@zentity/fhevm-contracts";
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
import { Spinner } from "@/components/ui/spinner";
import { useDevFaucet } from "@/lib/wagmi/use-dev-faucet";

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
}: Readonly<ComplianceAccessCardProps>) {
  const { address } = useAppKitAccount();
  const walletAddress = address as `0x${string}` | undefined;
  const chainId = useChainId();
  const { mutate: switchChain, isPending: isSwitching } = useSwitchChain();
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
    mutateAsync: writeContractAsync,
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

  const error = writeError ?? confirmError ?? faucetError;
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
    if (!(identityRegistry && complianceRules)) {
      return;
    }
    if (isPending || txHash) {
      return;
    }
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
      if (!hasFunds) {
        return;
      }

      // Gas overrides for networks where wagmi auto-estimation fails with FHE contracts
      const txOverrides = (() => {
        if (chainId === 31_337) {
          return { gas: BigInt(500_000) }; // Hardhat
        }
        if (chainId === 11_155_111) {
          return { gas: BigInt(1_000_000) }; // Sepolia (fhEVM operations need more gas)
        }
      })();

      await writeContractAsync({
        address: identityRegistry,
        abi: IdentityRegistryABI,
        functionName: "grantAccessTo",
        args: [complianceRules],
        ...txOverrides,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSwitchNetwork = () => {
    if (!(expectedChainId && switchChain)) {
      return;
    }
    switchChain({ chainId: expectedChainId });
  };

  if (!(identityRegistry && complianceRules)) {
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
        {isChainMismatch ? (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Switch your wallet to{" "}
              <strong>{expectedNetworkName ?? "the correct network"}</strong> to
              grant compliance access.
            </AlertDescription>
          </Alert>
        ) : null}
        {insufficientFunds ? (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Your wallet has no ETH available for gas on this network.
            </AlertDescription>
          </Alert>
        ) : null}

        {isGranted ? (
          <Alert variant="success">
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-1">
                <div>
                  Compliance access granted. You can now transfer tokens.
                </div>
                {grantedTxHash ? (
                  <div className="text-muted-foreground text-xs">
                    Already granted on-chain.
                    {grantedExplorerUrl ? (
                      <>
                        {" "}
                        <a
                          className="underline"
                          href={grantedExplorerUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          View transaction
                        </a>
                      </>
                    ) : (
                      <>
                        {" "}
                        <span className="font-mono">
                          {`${grantedTxHash.slice(0, 6)}…${grantedTxHash.slice(
                            -4
                          )}`}
                        </span>
                      </>
                    )}
                  </div>
                ) : null}
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
              className="w-full"
              disabled={isActionDisabled}
              onClick={handleGrant}
            >
              {isPending || txHash ? (
                <Spinner aria-hidden="true" className="mr-2" />
              ) : null}
              Grant Compliance Access
            </Button>
            {isChainMismatch ? (
              <Button
                className="w-full"
                disabled={isSwitching}
                onClick={handleSwitchNetwork}
                variant="outline"
              >
                {isSwitching ? (
                  <Spinner aria-hidden="true" className="mr-2" />
                ) : null}
                Switch to {expectedNetworkName ?? "Network"}
              </Button>
            ) : null}
            {insufficientFunds && isFaucetSupported ? (
              <Button
                className="w-full"
                disabled={isFauceting}
                onClick={async () => {
                  const toppedUp = await faucet(walletAddress);
                  if (toppedUp) {
                    await refetchBalance();
                  }
                }}
                variant="outline"
              >
                {isFauceting ? (
                  <Spinner aria-hidden="true" className="mr-2" />
                ) : null}
                Top Up Test ETH
              </Button>
            ) : null}
          </>
        )}

        {error ? (
          <Alert variant="destructive">
            <AlertDescription className="wrap-break-word">
              {(() => {
                if (!(error instanceof Error)) {
                  return "Grant failed";
                }
                const msg = error.message;
                // Check for FHE/ACL error selectors
                if (msg.includes("0x23dada53")) {
                  return "ACL permission denied. The contract lacks permission to your encrypted data. Please update your attestation.";
                }
                if (msg.includes("0x99efb890")) {
                  return "Identity not attested. Please attest on-chain first.";
                }
                if (msg.includes("0x72c0afff") || msg.includes("0xa4fbc572")) {
                  return "Invalid encrypted data. Your attestation may have expired. Please re-attest.";
                }
                // Extract reason or show more context
                const reason = ERROR_REASON_PATTERN.exec(msg)?.[1];
                if (reason) {
                  return reason;
                }
                // Show error data if present
                const dataMatch = ERROR_DATA_PATTERN.exec(msg);
                if (dataMatch) {
                  return `Contract reverted with: ${dataMatch[1].slice(0, 10)}…`;
                }
                return msg.split("\n").slice(0, 3).join(" ").slice(0, 250);
              })()}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
