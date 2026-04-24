"use client";

import { useAppKitAccount } from "@reown/appkit/react";
import { ATTR, identityRegistryAbi, Purpose } from "@zentity/contracts";
/**
 * Compliance Access Card
 *
 * Requests the user to grant the ComplianceRules contract access
 * to their encrypted identity data in IdentityRegistry.
 */
import { AlertTriangle, CheckCircle, Scale } from "lucide-react";
import { useEffect, useId, useState } from "react";
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
import { asyncHandler } from "@/lib/async-handler";
import { getUserFriendlyError } from "@/lib/blockchain/tx-errors";
import { useDevFaucet } from "@/lib/blockchain/wagmi";

const PURPOSE_OPTIONS = [
  { value: Purpose.COMPLIANCE_CHECK, label: "Compliance check" },
  { value: Purpose.AGE_VERIFICATION, label: "Age verification" },
  { value: Purpose.NATIONALITY_CHECK, label: "Nationality check" },
  { value: Purpose.TRANSFER_GATING, label: "Transfer gating" },
  { value: Purpose.AUDIT, label: "Audit" },
] as const;

interface ComplianceAccessCardProps {
  complianceRules: `0x${string}` | null | undefined;
  expectedChainId?: number | undefined;
  expectedNetworkName?: string | undefined;
  grantedExplorerUrl?: string | null | undefined;
  grantedTxHash?: string | null | undefined;
  identityRegistry: `0x${string}` | null | undefined;
  isGranted: boolean;
  onGranted: () => void;
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
  const [selectedPurpose, setSelectedPurpose] = useState<Purpose>(
    Purpose.TRANSFER_GATING
  );
  const purposeSelectId = useId();

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
        return undefined;
      })();

      // biome-ignore lint/suspicious/noBitwiseOperators: attribute bitmask is intentional
      const attributeMask = ATTR.COMPLIANCE | ATTR.BLACKLIST;
      await writeContractAsync({
        address: identityRegistry,
        abi: identityRegistryAbi,
        functionName: "grantAttributeAccess",
        args: [complianceRules, attributeMask, selectedPurpose],
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
          <Scale className="h-5 w-5 text-primary" />
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
            <div className="space-y-2">
              <label className="font-medium text-sm" htmlFor={purposeSelectId}>
                Grant purpose
              </label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                id={purposeSelectId}
                onChange={(event) => {
                  setSelectedPurpose(Number(event.target.value) as Purpose);
                }}
                value={selectedPurpose}
              >
                {PURPOSE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <Button
              className="w-full"
              disabled={isActionDisabled}
              onClick={asyncHandler(handleGrant)}
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
                onClick={asyncHandler(async () => {
                  const toppedUp = await faucet(walletAddress);
                  if (toppedUp) {
                    await refetchBalance();
                  }
                })}
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
              {getUserFriendlyError(error)}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
