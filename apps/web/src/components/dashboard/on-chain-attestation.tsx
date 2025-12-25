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
  Loader2,
  LoaderCircle,
  Lock,
  RefreshCw,
  Shield,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ComplianceAccessCard } from "@/components/defi-demo/compliance-access-card";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useIsMounted } from "@/hooks/use-is-mounted";
import { trpcReact } from "@/lib/trpc/client";
import { getAttestationError } from "@/lib/utils/error-messages";

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

export function OnChainAttestation({ isVerified }: OnChainAttestationProps) {
  const { address, isConnected } = useAppKitAccount();
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  const isMounted = useIsMounted();
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
  const refreshMutation = trpcReact.attestation.refresh.useMutation({
    onSuccess: () => {
      refetchNetworks();
    },
  });

  // Track initial wallet for change detection
  const [initialWallet, setInitialWallet] = useState<string | undefined>();

  useEffect(() => {
    if (address && !initialWallet) {
      setInitialWallet(address);
    }
  }, [address, initialWallet]);

  const walletChanged = initialWallet && address && address !== initialWallet;

  // Get selected network data
  const selectedNetworkData = networks?.find((n) => n.id === selectedNetwork);

  const showComplianceAccess = Boolean(
    selectedNetworkData?.attestation?.status === "confirmed" &&
      selectedNetworkData?.identityRegistry &&
      selectedNetworkData?.complianceRules,
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
          showComplianceAccess && selectedNetworkData?.id && address && !isDemo,
        ),
        staleTime: 30000,
      },
    );

  // If DB says attested but on-chain says not, user needs to re-attest
  const needsReAttestation =
    !isDemo &&
    showComplianceAccess &&
    onChainStatus &&
    !onChainStatus.isAttested;

  // Only show compliance card if actually attested on-chain (or still loading)
  const showComplianceCard =
    showComplianceAccess && !needsReAttestation && !isCheckingOnChain;

  const { data: complianceAccess } = trpcReact.token.complianceAccess.useQuery(
    {
      networkId: selectedNetworkData?.id ?? "",
      walletAddress: address ?? "",
    },
    {
      enabled: Boolean(
        showComplianceCard && selectedNetworkData?.id && address && !isDemo,
      ),
    },
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

  // Auto-refresh TX status when attestation is submitted (poll every 8 seconds)
  useEffect(() => {
    if (selectedNetworkData?.attestation?.status !== "submitted") return;
    if (!selectedNetwork) return;

    const interval = setInterval(() => {
      refreshMutation.mutate({ networkId: selectedNetwork });
    }, 8000);

    return () => clearInterval(interval);
  }, [
    selectedNetworkData?.attestation?.status,
    selectedNetwork,
    refreshMutation,
  ]);

  const handleSubmit = useCallback(async () => {
    if (!selectedNetwork || !address) return;

    await submitMutation.mutateAsync({
      networkId: selectedNetwork,
      walletAddress: address,
    });
  }, [selectedNetwork, address, submitMutation]);

  const handleRefresh = useCallback(async () => {
    if (!selectedNetwork) return;

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
          <CardTitle className="text-lg flex items-center gap-2">
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
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">On-Chain Attestation</CardTitle>
              {isDemo && (
                <Badge variant="warning" className="ml-2">
                  DEMO
                </Badge>
              )}
              {confirmedCount > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {confirmedCount} network{confirmedCount !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
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
            {/* Show loading until client hydration completes to avoid mismatch */}
            {!isMounted ? (
              <div className="flex items-center justify-center py-8">
                <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : /* Wallet Connection */
            !isConnected ? (
              <div className="flex flex-col items-center gap-4 py-4">
                <Wallet className="h-12 w-12 text-muted-foreground" />
                <p className="text-sm text-muted-foreground text-center">
                  Connect your wallet to register your identity on-chain
                </p>
                {/* AppKit web component - globally available after createAppKit init */}
                <appkit-button />
              </div>
            ) : networksLoading ? (
              <div className="flex items-center justify-center py-8">
                <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : networks && networks.length > 0 ? (
              <>
                {/* Demo Mode Warning */}
                {isDemo && (
                  <Alert variant="warning">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Demo Mode</strong> - No real blockchain
                      transactions. Configure contract addresses for production
                      use.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Wallet Change Warning */}
                {walletChanged && (
                  <Alert variant="warning">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Wallet Changed</strong> - Attestation will be
                      linked to:{" "}
                      <code className="text-xs bg-warning/15 px-1 rounded">
                        {address?.slice(0, 6)}...{address?.slice(-4)}
                      </code>
                    </AlertDescription>
                  </Alert>
                )}

                {/* Network Selector */}
                <div className="space-y-2">
                  <span className="text-sm font-medium">Select Network</span>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {networks.map((network) => (
                      <NetworkCard
                        key={network.id}
                        network={network as NetworkStatus}
                        isSelected={selectedNetwork === network.id}
                        onSelect={() => setSelectedNetwork(network.id)}
                      />
                    ))}
                  </div>
                </div>

                {/* Selected Network Actions */}
                {selectedNetworkData && address && (
                  <NetworkActions
                    network={selectedNetworkData as NetworkStatus}
                    walletAddress={address}
                    attestedWalletAddress={
                      selectedNetworkData.attestation?.walletAddress
                    }
                    onSubmit={handleSubmit}
                    onRefresh={handleRefresh}
                    isSubmitting={submitMutation.isPending}
                    isRefreshing={refreshMutation.isPending}
                    error={submitMutation.error?.message}
                  />
                )}

                {/* Re-attestation required warning (DB says confirmed but chain says not) */}
                {needsReAttestation && (
                  <Alert variant="warning">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Re-attestation Required</strong> - The identity
                      contracts have been updated. Click &quot;Update
                      Attestation&quot; above to re-register your identity
                      on-chain before granting compliance access.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Loading on-chain status */}
                {showComplianceAccess && isCheckingOnChain && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying on-chain attestation...
                  </div>
                )}

                {showComplianceCard && (
                  <ComplianceAccessCard
                    identityRegistry={
                      selectedNetworkData?.identityRegistry as
                        | `0x${string}`
                        | null
                    }
                    complianceRules={
                      selectedNetworkData?.complianceRules as
                        | `0x${string}`
                        | null
                    }
                    expectedChainId={selectedNetworkData?.chainId}
                    expectedNetworkName={selectedNetworkData?.name}
                    isGranted={complianceGranted}
                    grantedTxHash={complianceTxHash}
                    grantedExplorerUrl={complianceExplorerUrl}
                    onGranted={() => {
                      if (selectedNetworkData?.id && address) {
                        utils.token.complianceAccess.invalidate({
                          networkId: selectedNetworkData.id,
                          walletAddress: address,
                        });
                      }
                    }}
                  />
                )}

                {/* Info about encryption */}
                {selectedNetworkData?.type === "fhevm" && (
                  <Alert variant="info">
                    <Lock className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      <strong>Encrypted Attestation</strong> - Your identity
                      data will be encrypted using Fully Homomorphic Encryption
                      (FHE) before being stored on-chain. Only authorized smart
                      contracts can verify claims.
                    </AlertDescription>
                  </Alert>
                )}
              </>
            ) : (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  No blockchain networks are currently available. Check your
                  configuration.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/**
 * Individual network card for selection.
 */
function NetworkCard({
  network,
  isSelected,
  onSelect,
}: {
  network: NetworkStatus;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const statusColors = {
    pending: "text-warning bg-warning/15",
    submitted: "text-info bg-info/15",
    confirmed: "text-success bg-success/15",
    failed: "text-destructive bg-destructive/15",
  };

  const statusIcons = {
    pending: <Loader2 className="h-3 w-3 animate-spin" />,
    submitted: <Loader2 className="h-3 w-3 animate-spin" />,
    confirmed: <CheckCircle className="h-3 w-3" />,
    failed: <AlertTriangle className="h-3 w-3" />,
  };

  return (
    <Button
      type="button"
      onClick={onSelect}
      variant="outline"
      className={`flex items-center justify-between p-3 rounded-lg border text-left transition-colors w-full ${
        isSelected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50"
      }`}
    >
      <div className="flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full ${
            network.type === "fhevm" ? "bg-info" : "bg-primary"
          }`}
        />
        <div>
          <p className="text-sm font-medium">{network.name}</p>
          <p className="text-xs text-muted-foreground">
            {network.type === "fhevm" ? "Encrypted" : "Standard"}
          </p>
        </div>
      </div>

      {network.attestation && (
        <div
          className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${statusColors[network.attestation.status]}`}
        >
          {statusIcons[network.attestation.status]}
          <span className="capitalize">{network.attestation.status}</span>
        </div>
      )}
    </Button>
  );
}

/**
 * Actions for the selected network.
 */
function NetworkActions({
  network,
  walletAddress,
  attestedWalletAddress,
  onSubmit,
  onRefresh,
  isSubmitting,
  isRefreshing,
  error,
}: {
  network: NetworkStatus;
  walletAddress: string;
  attestedWalletAddress?: string;
  onSubmit: () => void;
  onRefresh: () => void;
  isSubmitting: boolean;
  isRefreshing: boolean;
  error?: string;
}) {
  const { disconnect } = useDisconnect();
  const attestation = network.attestation;

  // Already confirmed
  if (attestation?.status === "confirmed") {
    const walletMismatch =
      attestedWalletAddress &&
      walletAddress.toLowerCase() !== attestedWalletAddress.toLowerCase();

    return (
      <div className="space-y-3 p-4 rounded-lg bg-success/10 border border-success/30">
        <div className="flex items-center gap-2 text-success">
          <CheckCircle className="h-5 w-5" />
          <span className="font-medium">Attested on {network.name}</span>
        </div>
        <div className="text-sm space-y-1">
          {attestation.blockNumber != null && (
            <p className="text-muted-foreground">
              Block: {attestation.blockNumber}
            </p>
          )}
          {attestation.confirmedAt && (
            <p className="text-muted-foreground">
              Confirmed:{" "}
              {new Date(attestation.confirmedAt).toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Wallet display with Change option */}
        {attestedWalletAddress && (
          <div className="flex items-center justify-between">
            <p className="text-sm">
              <strong>Wallet:</strong>{" "}
              <code className="text-xs bg-success/15 px-2 py-1 rounded">
                {attestedWalletAddress.slice(0, 6)}...
                {attestedWalletAddress.slice(-4)}
              </code>
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => disconnect()}
              className="text-xs"
            >
              Change
            </Button>
          </div>
        )}

        {/* Wallet mismatch warning */}
        {walletMismatch && (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <strong>Different Wallet Connected</strong>
              <div className="mt-1 text-xs">
                Connected: {walletAddress.slice(0, 6)}...
                {walletAddress.slice(-4)}
                <br />
                Attested: {attestedWalletAddress.slice(0, 6)}...
                {attestedWalletAddress.slice(-4)}
              </div>
              <div className="mt-2 text-xs">
                Updating will link attestation to the new wallet and require
                re-granting compliance access.
              </div>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Update Attestation
          </Button>
          {attestation.explorerUrl && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={attestation.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on Explorer
                <ExternalLink className="ml-2 h-3 w-3" />
              </a>
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Submitted - waiting for confirmation
  if (attestation?.status === "submitted") {
    return (
      <div className="space-y-3 p-4 rounded-lg bg-info/10 border border-info/30">
        <div className="flex items-center gap-2 text-info">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="font-medium">Transaction Pending</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Your attestation is being confirmed on {network.name}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Check Status
          </Button>
          {attestation.explorerUrl && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={attestation.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                View TX
                <ExternalLink className="ml-2 h-3 w-3" />
              </a>
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Failed - show error and retry option
  if (attestation?.status === "failed") {
    return (
      <div className="space-y-3 p-4 rounded-lg bg-destructive/10 border border-destructive/30">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          <span className="font-medium">Attestation Failed</span>
        </div>
        {attestation.errorMessage && (
          <p className="text-sm text-muted-foreground">
            {getAttestationError(attestation.errorMessage)}
          </p>
        )}
        <Button size="sm" onClick={onSubmit} disabled={isSubmitting}>
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Retry Attestation
        </Button>
      </div>
    );
  }

  // Not attested - show submit button
  return (
    <div className="space-y-3">
      <div className="p-4 rounded-lg bg-muted/50 border">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm">
            <strong>Wallet:</strong>{" "}
            <code className="text-xs bg-muted px-2 py-1 rounded">
              {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
            </code>
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => disconnect()}
            className="text-xs"
          >
            Change
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Your verified identity will be attested to this wallet address on{" "}
          {network.name}.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{getAttestationError(error)}</AlertDescription>
        </Alert>
      )}

      <Button onClick={onSubmit} disabled={isSubmitting} className="w-full">
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Submitting...
          </>
        ) : (
          <>
            <Shield className="h-4 w-4 mr-2" />
            Register on {network.name}
          </>
        )}
      </Button>
    </div>
  );
}
