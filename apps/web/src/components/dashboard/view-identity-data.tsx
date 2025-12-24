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
import { Eye, EyeOff, KeyRound, Loader2, Lock, RefreshCw } from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IdentityRegistryABI } from "@/lib/contracts";
import { useFHEDecrypt, useInMemoryStorage } from "@/lib/fhevm";
import { trpcReact } from "@/lib/trpc/client";
import { useEthersSigner } from "@/lib/wagmi/use-ethers-signer";

// IdentityRegistry ABI (kept in sync with contracts package)
const IDENTITY_REGISTRY_ABI = IdentityRegistryABI;

// Country code mapping (ISO 3166-1 numeric to name)
const COUNTRY_CODES: Record<number, string> = {
  840: "United States",
  826: "United Kingdom",
  276: "Germany",
  250: "France",
  392: "Japan",
  156: "China",
  124: "Canada",
  36: "Australia",
  // Add more as needed
};

function normalizeHandle(handle: unknown): `0x${string}` | undefined {
  if (!handle) return undefined;
  if (typeof handle === "string") {
    const hex = handle.startsWith("0x") ? handle : `0x${handle}`;
    return /^0x[0-9a-fA-F]+$/.test(hex) ? (hex as `0x${string}`) : undefined;
  }
  if (handle instanceof Uint8Array) {
    const hex = Array.from(handle)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return `0x${hex}` as `0x${string}`;
  }
  return undefined;
}

/**
 * Decrypted identity data structure
 */
interface DecryptedIdentity {
  birthYearOffset: number;
  countryCode: number;
  kycLevel: number;
  isBlacklisted: boolean;
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
    null,
  );

  // Fetch attestation status to find confirmed attestation and contract address
  const { data: networksData, isLoading: networksLoading } =
    trpcReact.attestation.networks.useQuery();

  // Find first network with confirmed attestation
  const confirmedNetwork = useMemo(() => {
    if (!networksData?.networks) return null;
    if (chainId) {
      const matching = networksData.networks.find(
        (n) =>
          n.attestation?.status === "confirmed" &&
          n.identityRegistry &&
          n.chainId === chainId,
      );
      if (matching) return matching;
      return null;
    }
    return (
      networksData.networks.find(
        (n) => n.attestation?.status === "confirmed" && n.identityRegistry,
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
    if (!address || !attestedWallet) return false;
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
    data: rawKycLevelHandle,
    isLoading: isKycLoading,
    refetch: refetchKyc,
  } = useReadContract({
    address: contractAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "getKycLevel",
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
  const kycLevelHandle = rawKycLevelHandle as `0x${string}` | undefined;
  const blacklistHandle = rawBlacklistHandle as `0x${string}` | undefined;

  const isLoadingContract =
    isAttestedLoading ||
    isBirthYearLoading ||
    isCountryLoading ||
    isKycLoading ||
    isBlacklistLoading;

  const refetch = useCallback(async () => {
    await Promise.all([
      refetchIsAttested(),
      refetchBirthYear(),
      refetchCountry(),
      refetchKyc(),
      refetchBlacklist(),
    ]);
  }, [
    refetchIsAttested,
    refetchBirthYear,
    refetchCountry,
    refetchKyc,
    refetchBlacklist,
  ]);

  // Build decrypt requests from handles
  const decryptRequests = useMemo(() => {
    if (
      !contractAddress ||
      birthYearHandle === undefined ||
      countryCodeHandle === undefined ||
      kycLevelHandle === undefined ||
      blacklistHandle === undefined
    ) {
      return [];
    }
    const normalizedHandles = [
      normalizeHandle(birthYearHandle),
      normalizeHandle(countryCodeHandle),
      normalizeHandle(kycLevelHandle),
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
    kycLevelHandle,
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
    if (!canDecrypt) return;
    decrypt();
  }, [canDecrypt, decrypt]);

  // Update decrypted data when results change
  const processedResults = useMemo(() => {
    if (!decryptResults || Object.keys(decryptResults).length === 0)
      return null;

    const handles = decryptRequests.map((r) => r.handle);
    if (handles.length < 4) return null;

    return {
      birthYearOffset: Number(decryptResults[handles[0]] ?? 0),
      countryCode: Number(decryptResults[handles[1]] ?? 0),
      kycLevel: Number(decryptResults[handles[2]] ?? 0),
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
    ? COUNTRY_CODES[decryptedData.countryCode] ||
      `Country ${decryptedData.countryCode}`
    : undefined;

  // Not connected, no confirmed attestation, or no contract address
  if (!address || !confirmedNetwork || !contractAddress) {
    return null;
  }

  // Loading attestation or contract data
  if (networksLoading || isLoadingContract) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
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
            <KeyRound className="h-5 w-5 text-purple-600" />
            <CardTitle className="text-lg">Your On-Chain Identity</CardTitle>
          </div>
          <Badge
            variant="outline"
            className="bg-purple-100 text-purple-800 border-purple-300"
          >
            Encrypted
          </Badge>
        </div>
        <CardDescription>
          View your encrypted identity data stored on-chain
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* FHEVM SDK Status */}
        {!fhevmReady && (
          <Alert
            className={
              fhevmStatus === "error"
                ? "bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800"
                : "bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800"
            }
          >
            <Lock
              className={`h-4 w-4 ${fhevmStatus === "error" ? "text-red-600 dark:text-red-400" : "text-yellow-600 dark:text-yellow-400"}`}
            />
            <AlertDescription
              className={
                fhevmStatus === "error"
                  ? "text-red-800 dark:text-red-200"
                  : "text-yellow-800 dark:text-yellow-200"
              }
            >
              {fhevmStatus === "loading" ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Initializing FHEVM SDK...
                </span>
              ) : fhevmStatus === "error" ? (
                <div className="flex items-center justify-between gap-2">
                  <span>
                    SDK initialization failed.{" "}
                    {fhevmError?.message || "Please try again."}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={refreshFhevm}
                    className="border-red-300 hover:bg-red-100 dark:border-red-700 dark:hover:bg-red-900"
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Retry
                  </Button>
                </div>
              ) : (
                "FHEVM SDK not ready. Connect your wallet to enable decryption."
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Wallet Mismatch Warning */}
        {walletMismatch && attestedWallet && (
          <Alert className="bg-orange-50 border-orange-200 dark:bg-orange-950 dark:border-orange-800">
            <Lock className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            <AlertDescription className="text-orange-800 dark:text-orange-200 text-sm">
              <strong>Different Wallet Connected</strong>
              <div className="mt-1 text-xs">
                This identity data can only be decrypted by the wallet that
                created the attestation.
              </div>
              <div className="mt-2 text-xs font-mono">
                Connected: {address?.slice(0, 6)}...{address?.slice(-4)}
                <br />
                Required: {attestedWallet.slice(0, 6)}...
                {attestedWallet.slice(-4)}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Decrypt Error */}
        {decryptError && (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-2">
              <span className="text-sm">{decryptError}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={refreshFhevm}
                className="shrink-0"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Refresh SDK
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Identity Data Display */}
        <div className="space-y-3">
          <IdentityField
            label="Birth Year"
            value={birthYear?.toString()}
            isVisible={isVisible}
            icon="calendar"
          />
          <IdentityField
            label="Country"
            value={countryName}
            isVisible={isVisible}
            icon="globe"
          />
          <IdentityField
            label="KYC Level"
            value={
              decryptedData?.kycLevel !== undefined
                ? `Level ${decryptedData.kycLevel}`
                : undefined
            }
            isVisible={isVisible}
            icon="shield"
          />
          <IdentityField
            label="Blacklist Status"
            value={
              decryptedData?.isBlacklisted !== undefined
                ? decryptedData.isBlacklisted
                  ? "Blacklisted"
                  : "Clear"
                : undefined
            }
            isVisible={isVisible}
            icon="flag"
            variant={decryptedData?.isBlacklisted ? "destructive" : "success"}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={isVisible ? "outline" : "default"}
                  onClick={handleToggleVisibility}
                  disabled={!canDecrypt || isDecrypting || walletMismatch}
                  className="flex-1"
                >
                  {isDecrypting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Decrypting...
                    </>
                  ) : isVisible ? (
                    <>
                      <EyeOff className="h-4 w-4 mr-2" />
                      Hide Data
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4 mr-2" />
                      Decrypt & View
                    </>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {walletMismatch
                  ? "Connect the wallet that created the attestation"
                  : !canDecrypt
                    ? "Waiting for wallet and encrypted data"
                    : isVisible
                      ? "Hide your identity data"
                      : "Sign a message to decrypt your data"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            disabled={isLoadingContract}
          >
            <RefreshCw
              className={`h-4 w-4 ${isLoadingContract ? "animate-spin" : ""}`}
            />
          </Button>
        </div>

        {/* Info */}
        <p className="text-xs text-muted-foreground">
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
    destructive: "text-red-600 dark:text-red-400",
    success: "text-green-600 dark:text-green-400",
  };

  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <span className="text-sm text-muted-foreground flex items-center gap-2">
        {icon === "calendar" && <span className={iconClasses}>📅</span>}
        {icon === "globe" && <span className={iconClasses}>🌍</span>}
        {icon === "shield" && <span className={iconClasses}>🛡️</span>}
        {icon === "flag" && <span className={iconClasses}>🚩</span>}
        {label}
      </span>
      <span className={`text-sm font-medium ${variantClasses[variant]}`}>
        {isVisible && value ? (
          value
        ) : (
          <span className="text-muted-foreground">•••••••</span>
        )}
      </span>
    </div>
  );
}
