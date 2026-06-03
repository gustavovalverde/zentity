"use client";

/**
 * ViewIdentityData Component
 *
 * Allows users to decrypt and view their on-chain identity data.
 * Uses the confidential chain SDK with wallet signature authorization.
 * Self-contained: fetches attestation status via tRPC to determine which
 * contract to read from.
 */
import type { LucideIcon } from "lucide-react";

import { useAppKitAccount } from "@reown/appkit/react";
import { identityRegistryAbi } from "@zentity/contracts";
import {
  CalendarDays,
  Eye,
  EyeOff,
  Flag,
  Globe,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { useChainId, useReadContract } from "wagmi";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { asyncHandler } from "@/lib/async-handler";
import {
  CONFIDENTIAL_SESSION_TTL_SECONDS,
  useConfidentialChain,
} from "@/lib/blockchain/confidential/chain";
import {
  type DecryptedIdentityAttributes,
  resolveIdentityAttributeHandles,
} from "@/lib/blockchain/confidential/identity-attributes";
import { cn } from "@/lib/cn";
import { getCountryName } from "@/lib/privacy/zk/country";
import { trpcReact } from "@/lib/trpc/client";

const CONFIDENTIAL_SESSION_TTL_HOURS = Math.round(
  CONFIDENTIAL_SESSION_TTL_SECONDS / 3600
);

function getBlacklistStatusLabel(
  isBlacklisted: boolean | undefined
): string | undefined {
  if (isBlacklisted === undefined) {
    return;
  }
  return isBlacklisted ? "Blacklisted" : "Clear";
}

function getTooltipMessage({
  walletMismatch,
  canDecrypt,
  isVisible,
}: Readonly<{
  walletMismatch: boolean;
  canDecrypt: boolean;
  isVisible: boolean;
}>): string {
  if (walletMismatch) {
    return "Connect the wallet that created the attestation";
  }
  if (!canDecrypt) {
    return "Waiting for wallet and encrypted data";
  }
  if (isVisible) {
    return "Hide your identity data";
  }
  return "Sign a message to decrypt your data";
}

function DecryptButtonContent({
  isDecrypting,
  isVisible,
}: Readonly<{
  isDecrypting: boolean;
  isVisible: boolean;
}>) {
  const label = isVisible ? "Hide Data" : "Decrypt & View";
  if (isDecrypting) {
    return (
      <>
        <Spinner className="mr-2" />
        {label}
      </>
    );
  }
  if (isVisible) {
    return (
      <>
        <EyeOff className="mr-2 h-4 w-4" />
        {label}
      </>
    );
  }
  return (
    <>
      <Eye className="mr-2 h-4 w-4" />
      {label}
    </>
  );
}

interface DecryptionResultState {
  data: DecryptedIdentityAttributes | null;
  error: string | null;
  snapshotKey: string;
}

export function ViewIdentityData() {
  const { address: rawAddress } = useAppKitAccount();
  // Cast to wagmi-compatible type (AppKit returns string, wagmi expects `0x${string}`)
  const address = rawAddress as `0x${string}` | undefined;
  const chainId = useChainId();
  const {
    decryptIdentityAttributes,
    isReady: confidentialChainReady,
    status: confidentialChainStatus,
    error: confidentialChainError,
    refresh: refreshConfidentialChain,
  } = useConfidentialChain();

  const [isDecrypting, setIsDecrypting] = useState(false);
  const [visibleIdentitySnapshotKey, setVisibleIdentitySnapshotKey] = useState<
    string | null
  >(null);
  const [decryptionResult, setDecryptionResult] =
    useState<DecryptionResultState | null>(null);

  // Fetch attestation status to find confirmed attestation and contract address
  const { data: networksData, isLoading: networksLoading } =
    trpcReact.attestation.networks.useQuery();

  // Find first network with confirmed attestation
  const confirmedNetwork = useMemo(() => {
    if (!networksData?.networks) {
      return null;
    }
    if (chainId) {
      const matching = networksData.networks.find(
        (n) =>
          n.attestation?.status === "confirmed" &&
          n.identityRegistry &&
          n.chainId === chainId
      );
      if (matching) {
        return matching;
      }
      return null;
    }
    return (
      networksData.networks.find(
        (n) => n.attestation?.status === "confirmed" && n.identityRegistry
      ) ?? null
    );
  }, [networksData, chainId]);

  const contractAddress = confirmedNetwork?.identityRegistry as
    | `0x${string}`
    | undefined;

  // Get attested wallet from the confirmed network's attestation
  const attestedWallet = confirmedNetwork?.attestation?.walletAddress as
    | `0x${string}`
    | undefined;

  // Check if connected wallet matches attested wallet
  const walletMismatch = useMemo(() => {
    if (!(address && attestedWallet)) {
      return false;
    }
    return address.toLowerCase() !== attestedWallet.toLowerCase();
  }, [address, attestedWallet]);

  // Check if user is attested on-chain
  const readEnabled = Boolean(contractAddress && address);

  const { data: rawIsAttested, isLoading: isAttestedLoading } = useReadContract(
    {
      address: contractAddress,
      abi: identityRegistryAbi,
      functionName: "isAttested",
      args: address ? [address] : undefined,
      account: address,
      query: { enabled: readEnabled },
    }
  );

  const { data: rawBirthYearHandle, isLoading: isBirthYearLoading } =
    useReadContract({
      address: contractAddress,
      abi: identityRegistryAbi,
      functionName: "getBirthYearOffset",
      args: address ? [address] : undefined,
      account: address,
      query: { enabled: readEnabled },
    });

  const { data: rawCountryCodeHandle, isLoading: isCountryLoading } =
    useReadContract({
      address: contractAddress,
      abi: identityRegistryAbi,
      functionName: "getCountryCode",
      args: address ? [address] : undefined,
      account: address,
      query: { enabled: readEnabled },
    });

  const { data: rawComplianceLevelHandle, isLoading: isComplianceLoading } =
    useReadContract({
      address: contractAddress,
      abi: identityRegistryAbi,
      functionName: "getComplianceLevel",
      args: address ? [address] : undefined,
      account: address,
      query: { enabled: readEnabled },
    });

  const { data: rawBlacklistHandle, isLoading: isBlacklistLoading } =
    useReadContract({
      address: contractAddress,
      abi: identityRegistryAbi,
      functionName: "getBlacklistStatus",
      args: address ? [address] : undefined,
      account: address,
      query: { enabled: readEnabled },
    });

  const isAttested = rawIsAttested as boolean | undefined;
  const birthYearHandle = rawBirthYearHandle as `0x${string}` | undefined;
  const countryCodeHandle = rawCountryCodeHandle as `0x${string}` | undefined;
  const complianceLevelHandle = rawComplianceLevelHandle as
    | `0x${string}`
    | undefined;
  const blacklistHandle = rawBlacklistHandle as `0x${string}` | undefined;

  const isLoadingContract =
    isAttestedLoading ||
    isBirthYearLoading ||
    isCountryLoading ||
    isComplianceLoading ||
    isBlacklistLoading;

  const identityAttributeHandles = useMemo(
    () =>
      resolveIdentityAttributeHandles({
        birthYearOffset: birthYearHandle,
        countryCode: countryCodeHandle,
        complianceLevel: complianceLevelHandle,
        isBlacklisted: blacklistHandle,
      }),
    [birthYearHandle, countryCodeHandle, complianceLevelHandle, blacklistHandle]
  );

  const encryptedIdentitySnapshotKey = useMemo(
    () =>
      [
        contractAddress ?? "missing-contract",
        birthYearHandle ?? "missing-birth-year",
        countryCodeHandle ?? "missing-country",
        complianceLevelHandle ?? "missing-compliance",
        blacklistHandle ?? "missing-blacklist",
      ].join(":"),
    [
      contractAddress,
      birthYearHandle,
      countryCodeHandle,
      complianceLevelHandle,
      blacklistHandle,
    ]
  );

  const canDecrypt = Boolean(
    confidentialChainReady &&
      contractAddress &&
      identityAttributeHandles &&
      !isDecrypting
  );

  const decryptedData =
    decryptionResult?.snapshotKey === encryptedIdentitySnapshotKey
      ? decryptionResult.data
      : null;
  const decryptError =
    decryptionResult?.snapshotKey === encryptedIdentitySnapshotKey
      ? decryptionResult.error
      : null;
  const isVisible =
    visibleIdentitySnapshotKey === encryptedIdentitySnapshotKey &&
    Boolean(decryptedData);

  const handleDecrypt = useCallback(async () => {
    if (!(canDecrypt && contractAddress && identityAttributeHandles)) {
      return;
    }

    const snapshotKey = encryptedIdentitySnapshotKey;
    setIsDecrypting(true);
    setDecryptionResult({ snapshotKey, data: null, error: null });
    try {
      const nextDecryptedData = await decryptIdentityAttributes({
        attributeHandles: identityAttributeHandles,
        registryAddress: contractAddress,
      });
      setDecryptionResult({
        snapshotKey,
        data: nextDecryptedData,
        error: null,
      });
      setVisibleIdentitySnapshotKey(snapshotKey);
    } catch (error) {
      setDecryptionResult({
        snapshotKey,
        data: null,
        error:
          error instanceof Error
            ? error.message
            : "Failed to decrypt identity data",
      });
      setVisibleIdentitySnapshotKey(null);
    } finally {
      setIsDecrypting(false);
    }
  }, [
    canDecrypt,
    contractAddress,
    identityAttributeHandles,
    decryptIdentityAttributes,
    encryptedIdentitySnapshotKey,
  ]);

  const handleToggleVisibility = useCallback(async () => {
    // Don't attempt decryption if wallet doesn't match attestation
    if (walletMismatch) {
      return;
    }
    if (isVisible) {
      setVisibleIdentitySnapshotKey(null);
    } else if (decryptedData) {
      setVisibleIdentitySnapshotKey(encryptedIdentitySnapshotKey);
    } else {
      await handleDecrypt();
    }
  }, [
    isVisible,
    decryptedData,
    encryptedIdentitySnapshotKey,
    handleDecrypt,
    walletMismatch,
  ]);

  const canToggleVisibility = Boolean(
    !(walletMismatch || isDecrypting) &&
      (isVisible || decryptedData || canDecrypt)
  );

  // Calculate birth year from offset
  const birthYear = decryptedData
    ? 1900 + decryptedData.birthYearOffset
    : undefined;

  // Get country name from numeric code
  const countryName = decryptedData
    ? (getCountryName(decryptedData.countryCode) ??
      `Unknown (${decryptedData.countryCode})`)
    : undefined;

  // Not connected, no confirmed attestation, or no contract address
  if (!(address && confirmedNetwork && contractAddress)) {
    return null;
  }

  // Loading attestation or contract data
  if (networksLoading || isLoadingContract) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center justify-center py-6">
          <Spinner className="size-5 text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Not attested
  if (!isAttested) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-info" />
            <CardTitle className="text-lg">Your On-Chain Identity</CardTitle>
          </div>
          <Badge variant="info">Encrypted</Badge>
        </div>
        <CardDescription>
          View your encrypted identity data associated with your account
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Confidential SDK Status */}
        {!confidentialChainReady && (
          <Alert
            variant={
              confidentialChainStatus === "error" ? "destructive" : "warning"
            }
          >
            <Lock className="h-4 w-4" />
            <AlertDescription>
              {confidentialChainStatus === "initializing" && (
                <span className="flex items-center gap-2">
                  <Spinner className="size-3" />
                  Initializing decryption…
                </span>
              )}
              {confidentialChainStatus === "error" && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Decryption setup failed.{" "}
                    {confidentialChainError?.message || "Please try again."}
                  </span>
                  <Button
                    onClick={refreshConfidentialChain}
                    size="sm"
                    variant="outline"
                  >
                    <RefreshCw className="mr-1 h-3 w-3" />
                    Retry
                  </Button>
                </div>
              )}
              {confidentialChainStatus !== "initializing" &&
                confidentialChainStatus !== "error" &&
                "Connect your wallet to enable decryption."}
            </AlertDescription>
          </Alert>
        )}

        {/* Wallet Mismatch Warning */}
        {walletMismatch && attestedWallet ? (
          <Alert variant="warning">
            <Lock className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <strong>Different Wallet Connected</strong>
              <div className="mt-1 text-xs">
                This identity data can only be decrypted by the wallet that
                created the attestation.
              </div>
              <div className="mt-2 font-mono text-xs">
                Connected: {address?.slice(0, 6)}…{address?.slice(-4)}
                <br />
                Required: {attestedWallet.slice(0, 6)}…
                {attestedWallet.slice(-4)}
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Decrypt Error */}
        {decryptError ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">{decryptError}</span>
              <Button
                className="shrink-0"
                onClick={refreshConfidentialChain}
                size="sm"
                variant="outline"
              >
                <RefreshCw className="mr-1 h-3 w-3" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Identity Data Display */}
        <div className="space-y-3">
          <IdentityField
            icon={CalendarDays}
            isVisible={isVisible}
            label="Birth Year"
            value={birthYear?.toString()}
          />
          <IdentityField
            icon={Globe}
            isVisible={isVisible}
            label="Country"
            value={countryName}
          />
          <IdentityField
            icon={ShieldCheck}
            isVisible={isVisible}
            label="Compliance Level"
            value={
              decryptedData?.complianceLevel === undefined
                ? undefined
                : `Level ${decryptedData.complianceLevel}`
            }
          />
          <IdentityField
            icon={Flag}
            isVisible={isVisible}
            label="Blacklist Status"
            value={getBlacklistStatusLabel(decryptedData?.isBlacklisted)}
            variant={decryptedData?.isBlacklisted ? "destructive" : "success"}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className="flex-1"
                  disabled={!canToggleVisibility}
                  onClick={asyncHandler(handleToggleVisibility)}
                  variant={isVisible ? "outline" : "default"}
                >
                  <DecryptButtonContent
                    isDecrypting={isDecrypting}
                    isVisible={isVisible}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {getTooltipMessage({
                  walletMismatch,
                  canDecrypt: canDecrypt || Boolean(decryptedData),
                  isVisible,
                })}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Info */}
        <p className="text-muted-foreground text-xs">
          Decryption requires a wallet signature that authorizes access to your
          data for {CONFIDENTIAL_SESSION_TTL_HOURS} hours.
        </p>
      </CardContent>
    </Card>
  );
}

const VARIANT_CLASSES = {
  default: "text-foreground",
  destructive: "text-destructive",
  success: "text-success",
} as const;

/**
 * Individual identity field display.
 * Memoized to prevent re-renders when other fields change.
 */
const IdentityField = memo(function IdentityField({
  label,
  value,
  isVisible,
  icon: Icon,
  variant = "default",
}: Readonly<{
  label: string;
  value: string | undefined;
  isVisible: boolean;
  icon: LucideIcon;
  variant?: "default" | "destructive" | "success";
}>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0">
      <span className="flex items-center gap-2 text-muted-foreground text-sm">
        <Icon className="h-4 w-4" />
        {label}
      </span>
      <span className={cn("font-medium text-sm", VARIANT_CLASSES[variant])}>
        {isVisible && value ? (
          value
        ) : (
          <span className="font-mono text-muted-foreground">•••••••</span>
        )}
      </span>
    </div>
  );
});
