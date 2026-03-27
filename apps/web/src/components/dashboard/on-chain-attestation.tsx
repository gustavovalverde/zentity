"use client";

import { useAppKitAccount, useDisconnect } from "@reown/appkit/react";
/**
 * On-Chain Attestation Component
 *
 * Allows verified users to register their identity on-chain across
 * multiple blockchain networks. Supports fhEVM (encrypted) and
 * standard EVM networks.
 */
import {
  ATTR,
  CONSENT_TYPES,
  getAttestPermitDomain,
  IdentityRegistryABI,
} from "@zentity/fhevm-contracts";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ExternalLink,
  Lock,
  RefreshCw,
  Stamp,
  Wallet,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { toHex } from "viem";
import {
  useChainId,
  useReadContract,
  useSignTypedData,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { ComplianceAccessCard } from "@/components/dashboard/compliance-access-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useFHEEncryption } from "@/hooks/fhevm/use-fhe-encryption";
import { useFhevmSdk } from "@/hooks/fhevm/use-fhevm-sdk";
import { resolveAttestationConsentRevision } from "@/lib/blockchain/attestation/consent-revision";
import { resolveOnChainAttestationViewState } from "@/lib/blockchain/attestation/on-chain-attestation-view-state";
import { useEthersSigner } from "@/lib/blockchain/wagmi/use-ethers-signer";
import { trpcReact } from "@/lib/trpc/client";
import { cn } from "@/lib/utils/classname";
import { getUserFriendlyError } from "@/lib/utils/error-messages";

interface NetworkStatus {
  attestation: {
    id: string;
    status: "pending" | "submitted" | "confirmed" | "failed" | "revoked";
    txHash: string | null;
    blockNumber: number | null;
    confirmedAt: string | null;
    errorMessage: string | null;
    explorerUrl?: string;
    walletAddress: string;
  } | null;
  chainId: number;
  complianceRules?: string | null;
  explorer?: string;
  features: string[];
  id: string;
  identityRegistry?: string | null;
  name: string;
  type: "fhevm" | "evm";
}

interface OnChainAttestationProps {
  isVerified: boolean;
}

function getFheWriteOverrides(chainId: number | undefined) {
  if (chainId === 31_337) {
    return { gas: BigInt(500_000) };
  }
  if (chainId === 11_155_111) {
    return { gas: BigInt(1_000_000) };
  }
  return undefined;
}

export function OnChainAttestation({
  isVerified,
}: Readonly<OnChainAttestationProps>) {
  const { address, isConnected } = useAppKitAccount();
  const activeChainId = useChainId();
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  const [clientError, setClientError] = useState<string | null>(null);
  const utils = trpcReact.useUtils();

  // Fetch available networks with attestation status
  const {
    data: networksData,
    isLoading: networksLoading,
    refetch: refetchNetworks,
  } = trpcReact.attestation.networks.useQuery(undefined, {
    enabled: isVerified,
  });

  const networks = networksData?.networks;

  // Permit-based attestation mutations
  const createPermitMutation = trpcReact.attestation.createPermit.useMutation({
    onSuccess: () => {
      refetchNetworks();
    },
  });
  const recordSubmissionMutation =
    trpcReact.attestation.recordSubmission.useMutation({
      onSuccess: () => refetchNetworks(),
    });

  // Compute selected network early so FHEVM hooks get reactive values
  const selectedNetworkData = useMemo(
    () => networks?.find((n) => n.id === selectedNetwork),
    [networks, selectedNetwork]
  );
  const registryAddress = selectedNetworkData?.identityRegistry as
    | `0x${string}`
    | undefined;

  // FHEVM SDK — initialize when connected for permit-based attestation

  const ethersSigner = useEthersSigner();
  const { instance: fhevmInstance } = useFhevmSdk({
    provider:
      typeof globalThis.window === "undefined"
        ? undefined
        : globalThis.window.ethereum,
    chainId: selectedNetworkData?.chainId,
    enabled: isConnected && Boolean(registryAddress),
  });
  const { encryptWith } = useFHEEncryption({
    instance: fhevmInstance,
    ethersSigner: ethersSigner ?? undefined,
    contractAddress: registryAddress,
  });
  const { writeContractAsync } = useWriteContract();
  const { data: currentRevision } = useReadContract({
    address: registryAddress,
    abi: IdentityRegistryABI,
    functionName: "revisions",
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: Boolean(registryAddress && address) },
  });
  const { signTypedDataAsync } = useSignTypedData();

  const isSubmitting =
    createPermitMutation.isPending || recordSubmissionMutation.isPending;

  // Refresh attestation status mutation
  const refreshMutation = trpcReact.attestation.refresh.useMutation({
    onSuccess: () => {
      refetchNetworks();
    },
  });

  // Poll blockchain status for pending submissions
  // The refresh mutation checks the actual blockchain and updates the DB
  useEffect(() => {
    const pendingNetworkIds =
      networks
        ?.filter((n) => n.attestation?.status === "submitted")
        .map((n) => n.id) ?? [];
    if (pendingNetworkIds.length === 0) {
      return;
    }

    const interval = setInterval(() => {
      for (const networkId of pendingNetworkIds) {
        refreshMutation.mutate({ networkId });
      }
    }, 8000);

    return () => clearInterval(interval);
  }, [networks, refreshMutation]);

  // Derived state - memoized for performance
  const showComplianceAccess = useMemo(
    () =>
      Boolean(
        selectedNetworkData?.attestation?.status === "confirmed" &&
          selectedNetworkData?.identityRegistry &&
          selectedNetworkData?.complianceRules
      ),
    [selectedNetworkData]
  );

  const confirmedAttestedWalletAddress =
    selectedNetworkData?.attestation?.status === "confirmed"
      ? selectedNetworkData.attestation.walletAddress
      : null;
  const attestationCheckAddress =
    confirmedAttestedWalletAddress ?? address ?? "";

  const { data: onChainStatus, isLoading: isCheckingOnChain } =
    trpcReact.compliantToken.isAttested.useQuery(
      {
        networkId: selectedNetworkData?.id ?? "",
        address: attestationCheckAddress,
      },
      {
        enabled: Boolean(
          showComplianceAccess &&
            selectedNetworkData?.id &&
            attestationCheckAddress
        ),
        staleTime: 30_000,
      }
    );

  const { needsReAttestation, showComplianceCard } =
    resolveOnChainAttestationViewState({
      attestedWalletAddress: confirmedAttestedWalletAddress,
      connectedWalletAddress: address ?? null,
      isCheckingOnChain,
      onChainStatus,
      showComplianceAccess,
    });

  const { data: complianceAccess } =
    trpcReact.compliantToken.complianceAccess.useQuery(
      {
        networkId: selectedNetworkData?.id ?? "",
        walletAddress: address ?? "",
      },
      {
        enabled: Boolean(
          showComplianceCard && selectedNetworkData?.id && address
        ),
      }
    );

  const complianceGranted = Boolean(complianceAccess?.granted);
  const complianceTxHash = complianceAccess?.granted
    ? complianceAccess?.txHash
    : null;
  const complianceExplorerUrl = complianceAccess?.granted
    ? complianceAccess?.explorerUrl
    : null;

  // Auto-select first network if none selected
  useEffect(() => {
    const first = networks?.[0];
    if (first && !selectedNetwork) {
      setSelectedNetwork(first.id);
    }
  }, [networks, selectedNetwork]);

  const handleSubmit = useCallback(async () => {
    if (
      !(selectedNetwork && address && registryAddress && selectedNetworkData)
    ) {
      return;
    }

    setClientError(null);

    if (activeChainId !== selectedNetworkData.chainId) {
      setClientError(
        `Switch your wallet to ${selectedNetworkData.name} before submitting an attestation.`
      );
      return;
    }

    try {
      const attributeMask = ATTR.ALL; // 0x0F — all 4 attributes

      // 1. Server signs the EIP-712 permit
      const result = await createPermitMutation.mutateAsync({
        networkId: selectedNetwork,
        walletAddress: address,
        consentScope: `0x${attributeMask.toString(16).padStart(2, "0")}`,
      });

      if ("status" in result && result.status === "confirmed") {
        return;
      }

      if (!("permit" in result && "identityData" in result)) {
        return;
      }
      const { permit, identityData } = result;

      // 2. User signs consent receipt
      const targetRevision = resolveAttestationConsentRevision({
        walletAddress: address,
        attestedWalletAddress:
          selectedNetworkData.attestation?.walletAddress ?? null,
        currentRevision: (currentRevision as bigint | undefined) ?? 0n,
        status: selectedNetworkData.attestation?.status ?? null,
        needsReAttestation,
      });
      const consentDomain = {
        ...getAttestPermitDomain(selectedNetworkData.chainId, registryAddress),
        verifyingContract: registryAddress,
      };
      const consentDeadline = Math.floor(Date.now() / 1000) + 3600;

      const consentSig = await signTypedDataAsync({
        domain: consentDomain,
        types: CONSENT_TYPES,
        primaryType: "UserConsent",
        message: {
          user: address as `0x${string}`,
          attributeMask,
          chainId: BigInt(selectedNetworkData.chainId),
          revision: targetRevision,
          deadline: BigInt(consentDeadline),
        },
      });

      const sigHex = consentSig.slice(2);
      const consentR = `0x${sigHex.slice(0, 64)}` as `0x${string}`;
      const consentS = `0x${sigHex.slice(64, 128)}` as `0x${string}`;
      const consentV = Number.parseInt(sigHex.slice(128, 130), 16);

      // 3. Client-side FHE encryption
      const encrypted = await encryptWith((builder) => {
        builder.add8(identityData.birthYearOffset);
        builder.add16(identityData.countryCode);
        builder.add8(identityData.complianceLevel);
        builder.addBool(identityData.isBlacklisted);
      });

      if (!encrypted || encrypted.handles.length < 4) {
        throw new Error(
          "FHE encryption failed. Ensure your wallet is connected."
        );
      }

      // 4. Submit attestWithPermit from user's wallet
      const txHash = await writeContractAsync({
        chainId: selectedNetworkData.chainId,
        address: registryAddress,
        abi: IdentityRegistryABI,
        functionName: "attestWithPermit",
        args: [
          {
            birthYearOffset: permit.birthYearOffset,
            countryCode: permit.countryCode,
            complianceLevel: permit.complianceLevel,
            isBlacklisted: permit.isBlacklisted,
            proofSetHash: permit.proofSetHash as `0x${string}`,
            policyVersion: permit.policyVersion,
            deadline: BigInt(permit.deadline),
            v: permit.v,
            r: permit.r as `0x${string}`,
            s: permit.s as `0x${string}`,
          },
          consentV,
          consentR,
          consentS,
          attributeMask,
          BigInt(consentDeadline),
          toHex(encrypted.handles[0] as Uint8Array),
          toHex(encrypted.handles[1] as Uint8Array),
          toHex(encrypted.handles[2] as Uint8Array),
          toHex(encrypted.handles[3] as Uint8Array),
          toHex(encrypted.inputProof),
        ],
        ...getFheWriteOverrides(selectedNetworkData.chainId),
      });

      // 5. Record tx on server
      await recordSubmissionMutation.mutateAsync({
        networkId: selectedNetwork,
        txHash,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Attestation failed";
      setClientError(message);
    }
  }, [
    selectedNetwork,
    address,
    activeChainId,
    registryAddress,
    selectedNetworkData,
    currentRevision,
    needsReAttestation,
    createPermitMutation,
    signTypedDataAsync,
    encryptWith,
    writeContractAsync,
    recordSubmissionMutation,
  ]);

  const handleRefresh = useCallback(async () => {
    if (!selectedNetwork) {
      return;
    }

    await refreshMutation.mutateAsync({
      networkId: selectedNetwork,
    });
  }, [selectedNetwork, refreshMutation]);

  // Count confirmed attestations
  const confirmedCount =
    networks?.filter((n) => n.attestation?.status === "confirmed").length || 0;

  if (!isVerified) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Stamp className="h-5 w-5" />
            On-Chain Attestation
          </CardTitle>
          <CardDescription>
            Register your verified identity on blockchain networks
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <Lock className="h-4 w-4" />
            <AlertDescription>
              Complete identity verification first to enable on-chain
              attestation.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <Collapsible onOpenChange={setIsOpen} open={isOpen}>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Stamp className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">On-Chain Attestation</CardTitle>
              {confirmedCount > 0 && (
                <Badge className="ml-2" variant="secondary">
                  {confirmedCount} network{confirmedCount === 1 ? "" : "s"}
                </Badge>
              )}
            </div>
            <CollapsibleTrigger asChild>
              <Button
                aria-label={
                  isOpen
                    ? "Collapse on-chain attestation"
                    : "Expand on-chain attestation"
                }
                size="sm"
                variant="ghost"
              >
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </Button>
            </CollapsibleTrigger>
          </div>
          <CardDescription>
            Register your verified identity on blockchain networks for DeFi
            compliance
          </CardDescription>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-4">
            <AttestationContentBody
              address={address}
              complianceExplorerUrl={complianceExplorerUrl ?? null}
              complianceGranted={complianceGranted}
              complianceTxHash={complianceTxHash}
              error={
                createPermitMutation.error?.message ?? clientError ?? undefined
              }
              invalidateComplianceAccess={() => {
                if (selectedNetworkData?.id && address) {
                  utils.compliantToken.complianceAccess.invalidate({
                    networkId: selectedNetworkData.id,
                    walletAddress: address,
                  });
                }
              }}
              isCheckingOnChain={isCheckingOnChain}
              isConnected={isConnected}
              isRefreshing={refreshMutation.isPending}
              isSubmitting={isSubmitting}
              needsReAttestation={needsReAttestation}
              networks={networks}
              networksLoading={networksLoading}
              onNetworkSelect={setSelectedNetwork}
              onRefresh={handleRefresh}
              onSubmit={handleSubmit}
              selectedNetwork={selectedNetwork}
              selectedNetworkData={
                selectedNetworkData as NetworkStatus | undefined
              }
              showComplianceCard={showComplianceCard}
            />
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

const STATUS_VARIANT: Record<
  string,
  "warning" | "info" | "success" | "destructive"
> = {
  pending: "warning",
  submitted: "info",
  confirmed: "success",
  failed: "destructive",
  revoked: "warning",
};

// Network type from tRPC may have slightly different status typing
interface ApiNetworkStatus {
  attestation: {
    id: string;
    status:
      | "pending"
      | "submitted"
      | "confirmed"
      | "failed"
      | "revoked"
      | "revocation_pending"
      | null;
    txHash: string | null;
    blockNumber: number | null;
    confirmedAt: string | null;
    errorMessage: string | null;
    explorerUrl?: string;
    walletAddress: string;
  } | null;
  chainId: number;
  complianceRules?: string | null;
  explorer?: string;
  features: string[];
  id: string;
  identityRegistry?: string | null;
  name: string;
  type: "fhevm" | "evm";
}

interface AttestationContentBodyProps {
  address: string | undefined;
  complianceExplorerUrl: string | null;
  complianceGranted: boolean;
  complianceTxHash: string | null;
  error: string | undefined;
  invalidateComplianceAccess: () => void;
  isCheckingOnChain: boolean;
  isConnected: boolean;
  isRefreshing: boolean;
  isSubmitting: boolean;
  needsReAttestation: boolean;
  networks: ApiNetworkStatus[] | undefined;
  networksLoading: boolean;
  onNetworkSelect: (networkId: string) => void;
  onRefresh: () => void;
  onSubmit: () => void;
  selectedNetwork: string | null;
  selectedNetworkData: NetworkStatus | undefined;
  showComplianceCard: boolean;
}

/**
 * Content body for attestation card.
 * Uses guard clauses for clearer control flow than IIFE.
 */
const AttestationContentBody = memo(function AttestationContentBody({
  isConnected,
  networksLoading,
  networks,
  address,
  selectedNetwork,
  selectedNetworkData,
  onNetworkSelect,
  onSubmit,
  onRefresh,
  isSubmitting,
  isRefreshing,
  error,
  showComplianceCard,
  complianceGranted,
  complianceTxHash,
  complianceExplorerUrl,
  invalidateComplianceAccess,
  isCheckingOnChain,
  needsReAttestation,
}: Readonly<AttestationContentBodyProps>) {
  // Guard: Wallet not connected
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center gap-4 py-4">
        <Wallet className="h-12 w-12 text-muted-foreground" />
        <p className="text-center text-muted-foreground text-sm">
          Connect your wallet to register your identity on-chain
        </p>
        <appkit-button />
      </div>
    );
  }

  // Guard: Loading networks
  if (networksLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="lg" />
      </div>
    );
  }

  // Guard: No networks available
  if (!(networks && networks.length > 0)) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertTriangle />
          </EmptyMedia>
          <EmptyTitle>No Networks Available</EmptyTitle>
          <EmptyDescription>
            No blockchain networks are configured. Contact support if this
            persists.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  // Main content: Networks loaded and available
  return (
    <>
      <fieldset className="space-y-3">
        <Label asChild>
          <legend>Select Network</legend>
        </Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {networks.map((network) => (
            <NetworkCard
              isSelected={selectedNetwork === network.id}
              key={network.id}
              network={network}
              onSelect={() => onNetworkSelect(network.id)}
            />
          ))}
        </div>
      </fieldset>

      {selectedNetworkData && address ? (
        <NetworkActions
          attestedWalletAddress={selectedNetworkData.attestation?.walletAddress}
          error={error}
          isRefreshing={isRefreshing}
          isSubmitting={isSubmitting}
          needsReAttestation={needsReAttestation}
          network={selectedNetworkData}
          onRefresh={onRefresh}
          onSubmit={onSubmit}
          walletAddress={address}
        />
      ) : null}

      {needsReAttestation ? (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Re-attestation Required.</strong> The current wallet is no
            longer attested on-chain for this network. Submit a new attestation
            to restore compliance access.
          </AlertDescription>
        </Alert>
      ) : null}

      {selectedNetworkData?.attestation?.status === "confirmed" &&
      isCheckingOnChain ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Spinner size="sm" />
          <span>Verifying on-chain attestation…</span>
        </div>
      ) : null}

      {showComplianceCard ? (
        <ComplianceAccessCard
          complianceRules={
            selectedNetworkData?.complianceRules as `0x${string}` | null
          }
          expectedChainId={selectedNetworkData?.chainId}
          expectedNetworkName={selectedNetworkData?.name}
          grantedExplorerUrl={complianceExplorerUrl}
          grantedTxHash={complianceTxHash}
          identityRegistry={
            selectedNetworkData?.identityRegistry as `0x${string}` | null
          }
          isGranted={complianceGranted}
          onGranted={invalidateComplianceAccess}
        />
      ) : null}

      {selectedNetworkData?.type === "fhevm" && (
        <Alert variant="info">
          <Lock className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <strong>Encrypted Attestation.</strong> Your identity data is
            encrypted before being stored on-chain. Only authorized smart
            contracts can verify your claims; the data itself is never exposed.
          </AlertDescription>
        </Alert>
      )}
    </>
  );
});

/**
 * Individual network card for selection.
 * Memoized to prevent re-renders when parent state changes.
 */
function getStatusIcon(status: string | undefined) {
  if (status === "confirmed") {
    return <CheckCircle className="h-3 w-3" />;
  }
  if (status === "failed") {
    return <AlertTriangle className="h-3 w-3" />;
  }
  if (status) {
    return <Spinner className="size-3" />;
  }
  return null;
}

const NetworkCard = memo(function NetworkCard({
  network,
  isSelected,
  onSelect,
}: Readonly<{
  network: ApiNetworkStatus;
  isSelected: boolean;
  onSelect: () => void;
}>) {
  const status = network.attestation?.status ?? undefined;
  const statusIcon = getStatusIcon(status);

  return (
    <button
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
        isSelected
          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
          : "border-border bg-card hover:border-primary/50 hover:bg-accent/50"
      )}
      onClick={onSelect}
      type="button"
    >
      <div
        className={cn(
          "size-2.5 shrink-0 rounded-full",
          network.type === "fhevm" ? "bg-info" : "bg-primary"
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">{network.name}</p>
        <p className="text-muted-foreground text-xs">
          {network.type === "fhevm" ? "Encrypted" : "Standard"}
        </p>
      </div>
      {network.attestation && status ? (
        <Badge className="shrink-0" variant={STATUS_VARIANT[status]}>
          {statusIcon}
          <span className="ml-1 capitalize">{status}</span>
        </Badge>
      ) : null}
    </button>
  );
});

/**
 * Actions for the selected network.
 * Memoized to prevent re-renders when unrelated parent state changes.
 */
const NetworkActions = memo(function NetworkActions({
  network,
  walletAddress,
  attestedWalletAddress,
  onSubmit,
  onRefresh,
  isSubmitting,
  isRefreshing,
  error,
  needsReAttestation,
}: Readonly<{
  network: NetworkStatus;
  walletAddress: string;
  attestedWalletAddress?: string | undefined;
  onSubmit: () => void;
  onRefresh: () => void;
  isSubmitting: boolean;
  isRefreshing: boolean;
  error?: string | undefined;
  needsReAttestation: boolean;
}>) {
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const attestation = network.attestation;
  const isChainMismatch = chainId !== network.chainId;
  const walletMismatch =
    Boolean(attestedWalletAddress) &&
    walletAddress.toLowerCase() !== attestedWalletAddress?.toLowerCase();
  const chainMismatchNotice = isChainMismatch ? (
    <Alert variant="warning">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span>
          Switch your wallet to <strong>{network.name}</strong> before sending
          an attestation transaction.
        </span>
        <Button
          disabled={isSwitching}
          onClick={() => switchChain({ chainId: network.chainId })}
          size="sm"
          variant="outline"
        >
          {isSwitching ? <Spinner className="mr-2" /> : null}
          Switch Network
        </Button>
      </AlertDescription>
    </Alert>
  ) : null;

  // Already confirmed
  if (attestation?.status === "confirmed") {
    return (
      <div className="space-y-3">
        {(needsReAttestation || walletMismatch) && chainMismatchNotice}

        <Alert variant="success">
          <CheckCircle className="h-5 w-5" />
          <AlertTitle>Attested on {network.name}</AlertTitle>
          <AlertDescription>
            {attestation.blockNumber !== null && (
              <span>Block: {attestation.blockNumber}</span>
            )}
            {attestation.blockNumber !== null && attestation.confirmedAt && (
              <span> · </span>
            )}
            {attestation.confirmedAt ? (
              <span>
                Confirmed:{" "}
                {new Date(attestation.confirmedAt).toLocaleDateString()}
              </span>
            ) : null}
          </AlertDescription>
        </Alert>

        {/* Wallet display with Change option */}
        {attestedWalletAddress ? (
          <Item size="sm" variant="muted">
            <ItemContent>
              <ItemDescription>Attested Wallet</ItemDescription>
              <ItemTitle>
                <code className="font-mono text-sm">
                  {attestedWalletAddress.slice(0, 6)}…
                  {attestedWalletAddress.slice(-4)}
                </code>
              </ItemTitle>
            </ItemContent>
            <ItemActions>
              <Button onClick={() => disconnect()} size="sm" variant="outline">
                <Wallet className="mr-2 h-3 w-3" />
                Disconnect
              </Button>
            </ItemActions>
          </Item>
        ) : null}

        {walletMismatch ? (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <strong>Different Wallet Connected.</strong> Re-attesting will
              register the currently connected wallet on {network.name}.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex gap-2">
          {needsReAttestation || walletMismatch ? (
            <Button
              disabled={isSubmitting || isChainMismatch}
              onClick={onSubmit}
              size="sm"
              variant="outline"
            >
              {isSubmitting ? (
                <Spinner className="mr-2" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {needsReAttestation ? "Re-attest" : "Update Attestation"}
            </Button>
          ) : null}
          {attestation.explorerUrl ? (
            <Button asChild size="sm" variant="outline">
              <a
                href={attestation.explorerUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                View on Explorer
                <ExternalLink className="ml-2 h-3 w-3" />
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  // Submitted - waiting for confirmation
  if (attestation?.status === "submitted") {
    return (
      <div className="space-y-3">
        <Alert variant="info">
          <Spinner className="size-5" />
          <AlertTitle>Transaction Pending</AlertTitle>
          <AlertDescription>
            Your attestation is being confirmed on {network.name}
          </AlertDescription>
        </Alert>
        {attestation.txHash ? (
          <div className="rounded-lg border bg-muted/50 p-2 font-mono text-xs">
            <span className="text-muted-foreground">TX: </span>
            <span className="break-all">{attestation.txHash}</span>
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button
            disabled={isRefreshing}
            onClick={onRefresh}
            size="sm"
            variant="outline"
          >
            {isRefreshing ? (
              <Spinner className="mr-2" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Check Status
          </Button>
          {attestation.explorerUrl ? (
            <Button asChild size="sm" variant="outline">
              <a
                href={attestation.explorerUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                View on Explorer
                <ExternalLink className="ml-2 h-3 w-3" />
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  // Failed - show error and retry option
  if (attestation?.status === "failed") {
    return (
      <div className="space-y-3">
        {chainMismatchNotice}

        <Alert variant="destructive">
          <AlertTriangle className="h-5 w-5" />
          <AlertTitle>Attestation Failed</AlertTitle>
          {attestation.errorMessage ? (
            <AlertDescription>
              {getUserFriendlyError(attestation.errorMessage)}
            </AlertDescription>
          ) : null}
        </Alert>
        {attestation.txHash ? (
          <div className="rounded-lg border bg-muted/50 p-2 font-mono text-xs">
            <span className="text-muted-foreground">TX: </span>
            <span className="break-all">{attestation.txHash}</span>
          </div>
        ) : null}
        <Button
          disabled={isSubmitting || isChainMismatch}
          onClick={() => onSubmit()}
          size="sm"
        >
          {isSubmitting ? (
            <Spinner className="mr-2" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Retry Attestation
        </Button>
      </div>
    );
  }

  // Not attested - show submit button
  return (
    <div className="space-y-3">
      {chainMismatchNotice}

      <Item size="sm" variant="outline">
        <ItemContent>
          <ItemDescription>Connected Wallet</ItemDescription>
          <ItemTitle>
            <code className="font-mono text-sm">
              {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
            </code>
          </ItemTitle>
          <p className="mt-1 text-muted-foreground text-xs">
            Your verified identity will be attested to this wallet on{" "}
            {network.name}.
          </p>
        </ItemContent>
        <ItemActions>
          <Button onClick={() => disconnect()} size="sm" variant="outline">
            <Wallet className="mr-2 h-3 w-3" />
            Change
          </Button>
        </ItemActions>
      </Item>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{getUserFriendlyError(error)}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        className="w-full"
        disabled={isSubmitting || isChainMismatch}
        onClick={() => onSubmit()}
      >
        {isSubmitting ? (
          <Spinner aria-hidden="true" className="mr-2" />
        ) : (
          <Stamp className="mr-2 h-4 w-4" />
        )}
        Register on {network.name}
      </Button>
    </div>
  );
});
