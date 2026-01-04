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

import { ComplianceAccessCard } from "@/components/blockchain/compliance-access-card";
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
import { getStoredProfile } from "@/lib/crypto/profile-secret";
import { calculateBirthYearOffsetFromYear } from "@/lib/identity/birth-year";
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
      selectedNetworkData?.complianceRules
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

  // Auto-refresh TX status when attestation is submitted (poll every 8 seconds)
  useEffect(() => {
    if (selectedNetworkData?.attestation?.status !== "submitted") {
      return;
    }
    if (!selectedNetwork) {
      return;
    }

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
              <Button size="sm" variant="ghost">
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
            {(() => {
              if (!isConnected) {
                return (
                  <div className="flex flex-col items-center gap-4 py-4">
                    <Wallet className="h-12 w-12 text-muted-foreground" />
                    <p className="text-center text-muted-foreground text-sm">
                      Connect your wallet to register your identity on-chain
                    </p>
                    {/* AppKit web component - globally available after createAppKit init */}
                    <appkit-button />
                  </div>
                );
              }

              if (networksLoading) {
                return (
                  <div className="flex items-center justify-center py-8">
                    <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                );
              }

              if (!(networks && networks.length > 0)) {
                return (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      No blockchain networks are currently available. Check your
                      configuration.
                    </AlertDescription>
                  </Alert>
                );
              }

              return (
                <>
                  {/* Demo Mode Warning */}
                  {isDemo ? (
                    <Alert variant="warning">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        <strong>Demo Mode</strong> - No real blockchain
                        transactions. Configure contract addresses for
                        production use.
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  {/* Wallet Change Warning */}
                  {walletChanged ? (
                    <Alert variant="warning">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        <strong>Wallet Changed</strong> - Attestation will be
                        linked to:{" "}
                        <code className="rounded bg-warning/10 px-1.5 py-0.5 font-mono text-xs">
                          {address?.slice(0, 6)}...{address?.slice(-4)}
                        </code>
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  {/* Network Selector */}
                  <div className="space-y-2">
                    <span className="font-medium text-sm">Select Network</span>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {networks.map((network) => (
                        <NetworkCard
                          isSelected={selectedNetwork === network.id}
                          key={network.id}
                          network={network as NetworkStatus}
                          onSelect={() => setSelectedNetwork(network.id)}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Selected Network Actions */}
                  {selectedNetworkData && address ? (
                    <NetworkActions
                      attestedWalletAddress={
                        selectedNetworkData.attestation?.walletAddress
                      }
                      error={
                        submitMutation.error?.message ??
                        clientError ??
                        undefined
                      }
                      isRefreshing={refreshMutation.isPending}
                      isSubmitting={submitMutation.isPending}
                      network={selectedNetworkData as NetworkStatus}
                      onRefresh={handleRefresh}
                      onSubmit={handleSubmit}
                      walletAddress={address}
                    />
                  ) : null}

                  {/* Re-attestation required warning (DB says confirmed but chain says not) */}
                  {needsReAttestation ? (
                    <Alert variant="warning">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        <strong>Re-attestation Required</strong> - The identity
                        contracts have been updated. Click &quot;Update
                        Attestation&quot; above to re-register your identity
                        on-chain before granting compliance access.
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  {/* Loading on-chain status */}
                  {showComplianceAccess && isCheckingOnChain ? (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Verifying on-chain attestation...
                    </div>
                  ) : null}

                  {showComplianceCard ? (
                    <ComplianceAccessCard
                      complianceRules={
                        selectedNetworkData?.complianceRules as
                          | `0x${string}`
                          | null
                      }
                      expectedChainId={selectedNetworkData?.chainId}
                      expectedNetworkName={selectedNetworkData?.name}
                      grantedExplorerUrl={complianceExplorerUrl}
                      grantedTxHash={complianceTxHash}
                      identityRegistry={
                        selectedNetworkData?.identityRegistry as
                          | `0x${string}`
                          | null
                      }
                      isGranted={complianceGranted}
                      onGranted={() => {
                        if (selectedNetworkData?.id && address) {
                          utils.token.complianceAccess.invalidate({
                            networkId: selectedNetworkData.id,
                            walletAddress: address,
                          });
                        }
                      }}
                    />
                  ) : null}

                  {/* Info about encryption */}
                  {selectedNetworkData?.type === "fhevm" && (
                    <Alert variant="info">
                      <Lock className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        <strong>Encrypted Attestation</strong> - Your identity
                        data will be encrypted using Fully Homomorphic
                        Encryption (FHE) before being stored on-chain. Only
                        authorized smart contracts can verify claims.
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              );
            })()}
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
    pending: "text-warning bg-warning/10",
    submitted: "text-info bg-info/10",
    confirmed: "text-success bg-success/10",
    failed: "text-destructive bg-destructive/10",
  };

  const statusIcons = {
    pending: <Loader2 className="h-3 w-3 animate-spin" />,
    submitted: <Loader2 className="h-3 w-3 animate-spin" />,
    confirmed: <CheckCircle className="h-3 w-3" />,
    failed: <AlertTriangle className="h-3 w-3" />,
  };

  return (
    <Button
      className={`flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors ${
        isSelected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50"
      }`}
      onClick={onSelect}
      type="button"
      variant="outline"
    >
      <div className="flex items-center gap-2">
        <div
          className={`h-2 w-2 rounded-full ${
            network.type === "fhevm" ? "bg-info" : "bg-primary"
          }`}
        />
        <div>
          <p className="font-medium text-sm">{network.name}</p>
          <p className="text-muted-foreground text-xs">
            {network.type === "fhevm" ? "Encrypted" : "Standard"}
          </p>
        </div>
      </div>

      {network.attestation ? (
        <div
          className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs ${statusColors[network.attestation.status]}`}
        >
          {statusIcons[network.attestation.status]}
          <span className="capitalize">{network.attestation.status}</span>
        </div>
      ) : null}
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
      <div className="space-y-3 rounded-lg border border-success/30 bg-success/10 p-4">
        <div className="flex items-center gap-2 text-success">
          <CheckCircle className="h-5 w-5" />
          <span className="font-medium">Attested on {network.name}</span>
        </div>
        <div className="space-y-1 text-sm">
          {attestation.blockNumber !== null && (
            <p className="text-muted-foreground">
              Block: {attestation.blockNumber}
            </p>
          )}
          {attestation.confirmedAt ? (
            <p className="text-muted-foreground">
              Confirmed:{" "}
              {new Date(attestation.confirmedAt).toLocaleDateString()}
            </p>
          ) : null}
        </div>

        {/* Wallet display with Change option */}
        {attestedWalletAddress ? (
          <div className="flex items-center justify-between">
            <p className="text-sm">
              <strong>Wallet:</strong>{" "}
              <code className="rounded bg-success/10 px-1.5 py-0.5 font-mono text-xs">
                {attestedWalletAddress.slice(0, 6)}...
                {attestedWalletAddress.slice(-4)}
              </code>
            </p>
            <Button onClick={() => disconnect()} size="sm" variant="ghost">
              Change
            </Button>
          </div>
        ) : null}

        {/* Wallet mismatch warning */}
        {walletMismatch ? (
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
        ) : null}

        <div className="flex gap-2">
          <Button
            disabled={isSubmitting}
            onClick={onSubmit}
            size="sm"
            variant="outline"
          >
            {isSubmitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
      <div className="space-y-3 rounded-lg border border-info/30 bg-info/10 p-4">
        <div className="flex items-center gap-2 text-info">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="font-medium">Transaction Pending</span>
        </div>
        <p className="text-muted-foreground text-sm">
          Your attestation is being confirmed on {network.name}
        </p>
        {attestation.txHash ? (
          <div className="rounded bg-muted p-2 font-mono text-xs">
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
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
      <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          <span className="font-medium">Attestation Failed</span>
        </div>
        {attestation.errorMessage ? (
          <p className="text-muted-foreground text-sm">
            {getAttestationError(attestation.errorMessage)}
          </p>
        ) : null}
        {attestation.txHash ? (
          <div className="rounded bg-muted p-2 font-mono text-xs">
            <span className="text-muted-foreground">TX: </span>
            <span className="break-all">{attestation.txHash}</span>
          </div>
        ) : null}
        <Button disabled={isSubmitting} onClick={onSubmit} size="sm">
          {isSubmitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
      <div className="rounded-lg border bg-muted/50 p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm">
            <strong>Wallet:</strong>{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
            </code>
          </p>
          <Button onClick={() => disconnect()} size="sm" variant="ghost">
            Change
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Your verified identity will be attested to this wallet address on{" "}
          {network.name}.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{getAttestationError(error)}</AlertDescription>
        </Alert>
      ) : null}

      <Button className="w-full" disabled={isSubmitting} onClick={onSubmit}>
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Submitting...
          </>
        ) : (
          <>
            <Shield className="mr-2 h-4 w-4" />
            Register on {network.name}
          </>
        )}
      </Button>
    </div>
  );
}
