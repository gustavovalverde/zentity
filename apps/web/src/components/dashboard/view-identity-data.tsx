"use client";

import { useAppKitAccount } from "@reown/appkit/react";
/**
 * ViewIdentityData Component
 *
 * Allows users to decrypt and view their on-chain identity data.
 * Uses FHE client-side decryption with EIP-712 signature authorization.
 * Self-contained: fetches attestation status via tRPC to determine which
 * contract to read from.
 */
import { Eye, EyeOff, KeyRound, Lock, RefreshCw } from "lucide-react";

/** Matches a valid hex string with 0x prefix */
const HEX_STRING_PATTERN = /^0x[0-9a-fA-F]+$/;

import { useCallback, useEffect, useMemo, useState } from "react";
import { useChainId, useReadContract } from "wagmi";

import { useFhevmContext } from "@/components/providers/fhevm-provider";
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
import { useFHEDecrypt } from "@/hooks/fhevm/use-fhe-decrypt";
import { useInMemoryStorage } from "@/hooks/fhevm/use-in-memory-storage";
import { IdentityRegistryABI } from "@/lib/contracts";
import { trpcReact } from "@/lib/trpc/client";
import { useEthersSigner } from "@/lib/wagmi/use-ethers-signer";
import { getCountryName } from "@/lib/zk/nationality-data";

// IdentityRegistry ABI (kept in sync with contracts package)
const IDENTITY_REGISTRY_ABI = IdentityRegistryABI;

function normalizeHandle(handle: unknown): `0x${string}` | undefined {
  if (!handle) {
    return;
  }
  if (typeof handle === "string") {
    const hex = handle.startsWith("0x") ? handle : `0x${handle}`;
    return HEX_STRING_PATTERN.test(hex) ? (hex as `0x${string}`) : undefined;
  }
  if (handle instanceof Uint8Array) {
    const hex = Array.from(handle)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return `0x${hex}` as `0x${string}`;
  }
  return;
}

/**
 * Decrypted identity data structure
 */
interface DecryptedIdentity {
  birthYearOffset: number;
  countryCode: number;
  complianceLevel: number;
  isBlacklisted: boolean;
}

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
}: {
  walletMismatch: boolean;
  canDecrypt: boolean;
  isVisible: boolean;
}): string {
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
}: {
  isDecrypting: boolean;
  isVisible: boolean;
}) {
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

export function ViewIdentityData() {
  const { address: rawAddress } = useAppKitAccount();
  // Cast to wagmi-compatible type (AppKit returns string, wagmi expects `0x${string}`)
  const address = rawAddress as `0x${string}` | undefined;
  const chainId = useChainId();
  const {
    instance,
    isReady: fhevmReady,
    status: fhevmStatus,
    error: fhevmError,
    refresh: refreshFhevm,
  } = useFhevmContext();
  const { storage } = useInMemoryStorage();
  const ethersSigner = useEthersSigner();

  const [isVisible, setIsVisible] = useState(false);
  const [decryptedData, setDecryptedData] = useState<DecryptedIdentity | null>(
    null
  );

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

  const {
    data: rawIsAttested,
    isLoading: isAttestedLoading,
    refetch: refetchIsAttested,
  } = useReadContract({
    address: contractAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "isAttested",
    args: address ? [address] : undefined,
    account: address,
    query: { enabled: readEnabled },
  });

  const {
    data: rawBirthYearHandle,
    isLoading: isBirthYearLoading,
    refetch: refetchBirthYear,
  } = useReadContract({
    address: contractAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "getBirthYearOffset",
    args: address ? [address] : undefined,
    account: address,
    query: { enabled: readEnabled },
  });

  const {
    data: rawCountryCodeHandle,
    isLoading: isCountryLoading,
    refetch: refetchCountry,
  } = useReadContract({
    address: contractAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "getCountryCode",
    args: address ? [address] : undefined,
    account: address,
    query: { enabled: readEnabled },
  });

  const {
    data: rawComplianceLevelHandle,
    isLoading: isComplianceLoading,
    refetch: refetchCompliance,
  } = useReadContract({
    address: contractAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "getComplianceLevel",
    args: address ? [address] : undefined,
    account: address,
    query: { enabled: readEnabled },
  });

  const {
    data: rawBlacklistHandle,
    isLoading: isBlacklistLoading,
    refetch: refetchBlacklist,
  } = useReadContract({
    address: contractAddress,
    abi: IDENTITY_REGISTRY_ABI,
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

  const refetch = useCallback(async () => {
    await Promise.all([
      refetchIsAttested(),
      refetchBirthYear(),
      refetchCountry(),
      refetchCompliance(),
      refetchBlacklist(),
    ]);
  }, [
    refetchIsAttested,
    refetchBirthYear,
    refetchCountry,
    refetchCompliance,
    refetchBlacklist,
  ]);

  // Build decrypt requests from handles
  const decryptRequests = useMemo(() => {
    if (
      !contractAddress ||
      birthYearHandle === undefined ||
      countryCodeHandle === undefined ||
      complianceLevelHandle === undefined ||
      blacklistHandle === undefined
    ) {
      return [];
    }
    const normalizedHandles = [
      normalizeHandle(birthYearHandle),
      normalizeHandle(countryCodeHandle),
      normalizeHandle(complianceLevelHandle),
      normalizeHandle(blacklistHandle),
    ];
    if (normalizedHandles.some((handle) => !handle || handle.length !== 66)) {
      return [];
    }
    return normalizedHandles.map((handle) => ({
      handle: handle as `0x${string}`,
      contractAddress,
    }));
  }, [
    contractAddress,
    birthYearHandle,
    countryCodeHandle,
    complianceLevelHandle,
    blacklistHandle,
  ]);

  // Use FHE decrypt hook
  const {
    canDecrypt,
    decrypt,
    isDecrypting,
    results: decryptResults,
    error: decryptError,
  } = useFHEDecrypt({
    instance,
    ethersSigner,
    fhevmDecryptionSignatureStorage: storage,
    chainId,
    requests: decryptRequests,
    refreshFhevmInstance: refreshFhevm,
  });

  // Process decryption results when they change
  const handleDecrypt = useCallback(() => {
    if (!canDecrypt) {
      return;
    }
    decrypt();
  }, [canDecrypt, decrypt]);

  // Update decrypted data when results change
  const processedResults = useMemo(() => {
    if (!decryptResults || Object.keys(decryptResults).length === 0) {
      return null;
    }

    const handles = decryptRequests.map((r) => r.handle);
    if (handles.length < 4) {
      return null;
    }

    return {
      birthYearOffset: Number(decryptResults[handles[0]] ?? 0),
      countryCode: Number(decryptResults[handles[1]] ?? 0),
      complianceLevel: Number(decryptResults[handles[2]] ?? 0),
      isBlacklisted: Boolean(decryptResults[handles[3]] ?? false),
    };
  }, [decryptResults, decryptRequests]);

  // Sync processed results to state
  useEffect(() => {
    if (processedResults && !decryptedData) {
      setDecryptedData(processedResults);
      setIsVisible(true);
    }
  }, [processedResults, decryptedData]);

  const handleToggleVisibility = useCallback(() => {
    // Don't attempt decryption if wallet doesn't match attestation
    if (walletMismatch) {
      return;
    }
    if (isVisible) {
      setIsVisible(false);
    } else if (decryptedData) {
      setIsVisible(true);
    } else {
      handleDecrypt();
    }
  }, [isVisible, decryptedData, handleDecrypt, walletMismatch]);

  // Calculate birth year from offset
  const birthYear = decryptedData
    ? 1900 + decryptedData.birthYearOffset
    : undefined;

  // Get country name
  const countryName = decryptedData
    ? getCountryName(decryptedData.countryCode)
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-info" />
            <CardTitle className="text-lg">Your On-Chain Identity</CardTitle>
          </div>
          <Badge variant="info">Encrypted</Badge>
        </div>
        <CardDescription>
          View your encrypted identity data stored on-chain
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* FHEVM SDK Status */}
        {!fhevmReady && (
          <Alert variant={fhevmStatus === "error" ? "destructive" : "warning"}>
            <Lock className="h-4 w-4" />
            <AlertDescription>
              {fhevmStatus === "loading" && (
                <span className="flex items-center gap-2">
                  <Spinner className="size-3" />
                  Initializing FHEVM SDK…
                </span>
              )}
              {fhevmStatus === "error" && (
                <div className="flex items-center justify-between gap-2">
                  <span>
                    SDK initialization failed.{" "}
                    {fhevmError?.message || "Please try again."}
                  </span>
                  <Button
                    className="border-destructive/40 text-destructive hover:bg-destructive/10"
                    onClick={refreshFhevm}
                    size="sm"
                    variant="outline"
                  >
                    <RefreshCw className="mr-1 h-3 w-3" />
                    Retry
                  </Button>
                </div>
              )}
              {fhevmStatus !== "loading" &&
                fhevmStatus !== "error" &&
                "FHEVM SDK not ready. Connect your wallet to enable decryption."}
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
            <AlertDescription className="flex items-center justify-between gap-2">
              <span className="text-sm">{decryptError}</span>
              <Button
                className="shrink-0"
                onClick={refreshFhevm}
                size="sm"
                variant="outline"
              >
                <RefreshCw className="mr-1 h-3 w-3" />
                Refresh SDK
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Identity Data Display */}
        <div className="space-y-3">
          <IdentityField
            icon="calendar"
            isVisible={isVisible}
            label="Birth Year"
            value={birthYear?.toString()}
          />
          <IdentityField
            icon="globe"
            isVisible={isVisible}
            label="Country"
            value={countryName}
          />
          <IdentityField
            icon="shield"
            isVisible={isVisible}
            label="Compliance Level"
            value={
              decryptedData?.complianceLevel !== undefined
                ? `Level ${decryptedData.complianceLevel}`
                : undefined
            }
          />
          <IdentityField
            icon="flag"
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
                  disabled={!canDecrypt || isDecrypting || walletMismatch}
                  onClick={handleToggleVisibility}
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
                  canDecrypt,
                  isVisible,
                })}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Button
            aria-label="Refresh identity data"
            disabled={isLoadingContract}
            onClick={() => refetch()}
            size="icon"
            variant="ghost"
          >
            <RefreshCw
              className={`h-4 w-4 ${isLoadingContract ? "animate-spin" : ""}`}
            />
          </Button>
        </div>

        {/* Info */}
        <p className="text-muted-foreground text-xs">
          Decryption requires signing an EIP-712 message to authorize access to
          your data. This signature is valid for 7 days.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Individual identity field display
 */
function IdentityField({
  label,
  value,
  isVisible,
  icon,
  variant = "default",
}: {
  label: string;
  value: string | undefined;
  isVisible: boolean;
  icon: string;
  variant?: "default" | "destructive" | "success";
}) {
  const iconClasses = "h-4 w-4 text-muted-foreground";

  const variantClasses = {
    default: "text-foreground",
    destructive: "text-destructive",
    success: "text-success",
  };

  return (
    <div className="flex items-center justify-between border-b py-2 last:border-0">
      <span className="flex items-center gap-2 text-muted-foreground text-sm">
        {icon === "calendar" && <span className={iconClasses}>📅</span>}
        {icon === "globe" && <span className={iconClasses}>🌍</span>}
        {icon === "shield" && <span className={iconClasses}>🛡️</span>}
        {icon === "flag" && <span className={iconClasses}>🚩</span>}
        {label}
      </span>
      <span className={`font-medium text-sm ${variantClasses[variant]}`}>
        {isVisible && value ? (
          value
        ) : (
          <span className="text-muted-foreground">•••••••</span>
        )}
      </span>
    </div>
  );
}
