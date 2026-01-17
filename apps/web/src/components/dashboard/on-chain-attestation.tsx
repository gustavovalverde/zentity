"use client";

/**
 * On-Chain Attestation Component
 *
 * Allows verified users to register their identity on-chain across
 * multiple blockchain networks. Supports fhEVM (encrypted) and
 * standard EVM networks.
 */
import { useAppKitAccount, useDisconnect } from "@reown/appkit/react";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ExternalLink,
  Lock,
  RefreshCw,
  Shield,
  Wallet,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { ComplianceAccessCard } from "@/components/blockchain/compliance-access-card";
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
import { getStoredProfile } from "@/lib/crypto/profile-secret";
import { calculateBirthYearOffsetFromYear } from "@/lib/identity/birth-year";
import { trpcReact } from "@/lib/trpc/client";
import { getAttestationError } from "@/lib/utils/error-messages";
import { cn } from "@/lib/utils/utils";

interface NetworkStatus {
  id: string;
  name: string;
  chainId: number;
  type: "fhevm" | "evm";
  features: string[];
  explorer?: string;
  identityRegistry?: string | null;
  complianceRules?: string | null;
  attestation: {
    id: string;
    status: "pending" | "submitted" | "confirmed" | "failed";
    txHash: string | null;
    blockNumber: number | null;
    confirmedAt: string | null;
    errorMessage: string | null;
    explorerUrl?: string;
    walletAddress: string;
  } | null;
}

interface OnChainAttestationProps {
  isVerified: boolean;
}

export function OnChainAttestation({
  isVerified,
}: Readonly<OnChainAttestationProps>) {
  const { address, isConnected } = useAppKitAccount();
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

  // Extract networks array and demo flag from response
  const networks = networksData?.networks;
  const isDemo = networksData?.demo ?? false;

  // Submit attestation mutation
  const submitMutation = trpcReact.attestation.submit.useMutation({
    onSuccess: () => {
      refetchNetworks();
    },
  });

  // Refresh attestation status mutation
  // This endpoint actively checks the blockchain via provider.checkTransaction()
  // and updates the database - not just a cache refresh
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

  // Track initial wallet for change detection
  const [initialWallet, setInitialWallet] = useState<string | undefined>();

  useEffect(() => {
    if (address && !initialWallet) {
      setInitialWallet(address);
    }
  }, [address, initialWallet]);

  const walletChanged = initialWallet && address && address !== initialWallet;

  // Get selected network data - memoized to prevent recalculation
  const selectedNetworkData = useMemo(
    () => networks?.find((n) => n.id === selectedNetwork),
    [networks, selectedNetwork]
  );

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

  // Verify on-chain attestation status (catches stale DB records after contract redeployment)
  const { data: onChainStatus, isLoading: isCheckingOnChain } =
    trpcReact.token.isAttested.useQuery(
      {
        networkId: selectedNetworkData?.id ?? "",
        address: address ?? "",
      },
      {
        enabled: Boolean(
          showComplianceAccess && selectedNetworkData?.id && address && !isDemo
        ),
        staleTime: 30_000,
      }
    );

  // If DB says attested but on-chain says not, user needs to re-attest
  const needsReAttestation = useMemo(
    () =>
      !isDemo &&
      showComplianceAccess &&
      onChainStatus &&
      !onChainStatus.isAttested,
    [isDemo, showComplianceAccess, onChainStatus]
  );

  // Only show compliance card if actually attested on-chain (or still loading)
  const showComplianceCard = useMemo(
    () => showComplianceAccess && !needsReAttestation && !isCheckingOnChain,
    [showComplianceAccess, needsReAttestation, isCheckingOnChain]
  );

  const { data: complianceAccess } = trpcReact.token.complianceAccess.useQuery(
    {
      networkId: selectedNetworkData?.id ?? "",
      walletAddress: address ?? "",
    },
    {
      enabled: Boolean(
        showComplianceCard && selectedNetworkData?.id && address && !isDemo
      ),
    }
  );

  const complianceGranted = isDemo ? true : Boolean(complianceAccess?.granted);
  const complianceTxHash =
    isDemo || !complianceAccess?.granted ? null : complianceAccess?.txHash;
  const complianceExplorerUrl =
    isDemo || !complianceAccess?.granted ? null : complianceAccess?.explorerUrl;

  // Auto-select first network if none selected
  useEffect(() => {
    if (networks && networks.length > 0 && !selectedNetwork) {
      setSelectedNetwork(networks[0].id);
    }
  }, [networks, selectedNetwork]);

  const handleSubmit = useCallback(async () => {
    if (!(selectedNetwork && address)) {
      return;
    }

    setClientError(null);
    let birthYearOffset: number | undefined;
    try {
      const profile = await getStoredProfile();
      birthYearOffset = calculateBirthYearOffsetFromYear(profile?.birthYear);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to unlock your profile. Please try again.";
      setClientError(message);
      return;
    }

    if (birthYearOffset === undefined) {
      setClientError(
        "Unlock your passkey to continue. We need your birth year locally to attest on-chain."
      );
      return;
    }

    await submitMutation.mutateAsync({
      networkId: selectedNetwork,
      walletAddress: address,
      birthYearOffset,
    });
  }, [selectedNetwork, address, submitMutation]);

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
            <Shield className="h-5 w-5" />
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">On-Chain Attestation</CardTitle>
              {isDemo ? (
                <Badge className="ml-2" variant="warning">
                  DEMO
                </Badge>
              ) : null}
              {confirmedCount > 0 && (
                <Badge className="ml-2" variant="secondary">
                  {confirmedCount} network{confirmedCount !== 1 ? "s" : ""}
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
              error={submitMutation.error?.message ?? clientError ?? undefined}
              invalidateComplianceAccess={() => {
                if (selectedNetworkData?.id && address) {
                  utils.token.complianceAccess.invalidate({
                    networkId: selectedNetworkData.id,
                    walletAddress: address,
                  });
                }
              }}
              isCheckingOnChain={isCheckingOnChain}
              isConnected={isConnected}
              isDemo={isDemo}
              isRefreshing={refreshMutation.isPending}
              isSubmitting={submitMutation.isPending}
              needsReAttestation={needsReAttestation ?? false}
              networks={networks}
              networksLoading={networksLoading}
              onNetworkSelect={setSelectedNetwork}
              onRefresh={handleRefresh}
              onSubmit={handleSubmit}
              selectedNetwork={selectedNetwork}
              selectedNetworkData={
                selectedNetworkData as NetworkStatus | undefined
              }
              showComplianceAccess={showComplianceAccess}
              showComplianceCard={showComplianceCard}
              walletChanged={Boolean(walletChanged)}
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
};

// Network type from tRPC may have slightly different status typing
interface ApiNetworkStatus {
  id: string;
  name: string;
  chainId: number;
  type: "fhevm" | "evm";
  features: string[];
  explorer?: string;
  identityRegistry?: string | null;
  complianceRules?: string | null;
  attestation: {
    id: string;
    status: "pending" | "submitted" | "confirmed" | "failed" | null;
    txHash: string | null;
    blockNumber: number | null;
    confirmedAt: string | null;
    errorMessage: string | null;
    explorerUrl?: string;
    walletAddress: string;
  } | null;
}

interface AttestationContentBodyProps {
  isConnected: boolean;
  networksLoading: boolean;
  networks: ApiNetworkStatus[] | undefined;
  isDemo: boolean;
  walletChanged: boolean;
  address: string | undefined;
  selectedNetwork: string | null;
  selectedNetworkData: NetworkStatus | undefined;
  onNetworkSelect: (networkId: string) => void;
  onSubmit: () => void;
  onRefresh: () => void;
  isSubmitting: boolean;
  isRefreshing: boolean;
  error: string | undefined;
  needsReAttestation: boolean;
  showComplianceAccess: boolean;
  isCheckingOnChain: boolean;
  showComplianceCard: boolean;
  complianceGranted: boolean;
  complianceTxHash: string | null;
  complianceExplorerUrl: string | null;
  invalidateComplianceAccess: () => void;
}

/**
 * Content body for attestation card.
 * Uses guard clauses for clearer control flow than IIFE.
 */
const AttestationContentBody = memo(function AttestationContentBody({
  isConnected,
  networksLoading,
  networks,
  isDemo,
  walletChanged,
  address,
  selectedNetwork,
  selectedNetworkData,
  onNetworkSelect,
  onSubmit,
  onRefresh,
  isSubmitting,
  isRefreshing,
  error,
  needsReAttestation,
  showComplianceAccess,
  isCheckingOnChain,
  showComplianceCard,
  complianceGranted,
  complianceTxHash,
  complianceExplorerUrl,
  invalidateComplianceAccess,
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
      {isDemo ? (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Demo Mode</strong> - No real blockchain transactions.
            Configure contract addresses for production use.
          </AlertDescription>
        </Alert>
      ) : null}

      {walletChanged ? (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Wallet Changed</strong> - Attestation will be linked to:{" "}
            <code className="rounded bg-warning/10 px-1.5 py-0.5 font-mono text-xs">
              {address?.slice(0, 6)}…{address?.slice(-4)}
            </code>
          </AlertDescription>
        </Alert>
      ) : null}

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
            <strong>Re-attestation Required</strong> - The identity contracts
            have been updated. Click &quot;Update Attestation&quot; above to
            re-register your identity on-chain before granting compliance
            access.
          </AlertDescription>
        </Alert>
      ) : null}

      {showComplianceAccess && isCheckingOnChain ? (
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
            <strong>Encrypted Attestation</strong> - Your identity data will be
            encrypted using Fully Homomorphic Encryption (FHE) before being
            stored on-chain. Only authorized smart contracts can verify claims.
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
}: Readonly<{
  network: NetworkStatus;
  walletAddress: string;
  attestedWalletAddress?: string;
  onSubmit: () => void;
  onRefresh: () => void;
  isSubmitting: boolean;
  isRefreshing: boolean;
  error?: string;
}>) {
  const { disconnect } = useDisconnect();
  const attestation = network.attestation;

  // Already confirmed
  if (attestation?.status === "confirmed") {
    const walletMismatch =
      attestedWalletAddress &&
      walletAddress.toLowerCase() !== attestedWalletAddress.toLowerCase();

    return (
      <div className="space-y-3">
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
                Change
              </Button>
            </ItemActions>
          </Item>
        ) : null}

        {/* Wallet mismatch warning */}
        {walletMismatch ? (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <strong>Different Wallet Connected</strong>
              <div className="mt-1 text-xs">
                Connected: {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
                <br />
                Attested: {attestedWalletAddress.slice(0, 6)}…
                {attestedWalletAddress.slice(-4)}
              </div>
              <div className="mt-2 text-xs">
                Updating will link attestation to the new wallet and require
                re-granting compliance access.
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex gap-2">
          <Button
            disabled={isSubmitting}
            onClick={onSubmit}
            size="sm"
            variant="outline"
          >
            {isSubmitting ? (
              <Spinner className="mr-2" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Update Attestation
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
                View TX
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
        <Alert variant="destructive">
          <AlertTriangle className="h-5 w-5" />
          <AlertTitle>Attestation Failed</AlertTitle>
          {attestation.errorMessage ? (
            <AlertDescription>
              {getAttestationError(attestation.errorMessage)}
            </AlertDescription>
          ) : null}
        </Alert>
        {attestation.txHash ? (
          <div className="rounded-lg border bg-muted/50 p-2 font-mono text-xs">
            <span className="text-muted-foreground">TX: </span>
            <span className="break-all">{attestation.txHash}</span>
          </div>
        ) : null}
        <Button disabled={isSubmitting} onClick={onSubmit} size="sm">
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
          <AlertDescription>{getAttestationError(error)}</AlertDescription>
        </Alert>
      ) : null}

      <Button className="w-full" disabled={isSubmitting} onClick={onSubmit}>
        {isSubmitting ? (
          <Spinner aria-hidden="true" className="mr-2" />
        ) : (
          <Shield className="mr-2 h-4 w-4" />
        )}
        Register on {network.name}
      </Button>
    </div>
  );
});
