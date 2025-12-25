"use client";

import { useAppKitAccount } from "@reown/appkit/react";
/**
 * DeFi Demo Client Component
 *
 * Main client-side component for the DeFi compliance demo.
 * Orchestrates token operations with encrypted identity verification.
 */
import { AlertTriangle, ArrowRight, Lock, Wallet } from "lucide-react";
import { useEffect, useState } from "react";

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
import { useIsMounted } from "@/hooks/use-is-mounted";
import { trpcReact } from "@/lib/trpc/client";

import { ComplianceAccessCard } from "./compliance-access-card";
import { MintForm } from "./mint-form";
import { TokenStatus } from "./token-status";
import { TransferForm } from "./transfer-form";
import { TxHistory } from "./tx-history";

interface DefiDemoClientProps {
  isVerified: boolean;
  attestedNetworkId: string | null;
  attestedWallet: string | null;
}

export function DefiDemoClient({
  isVerified,
  attestedNetworkId,
  attestedWallet,
}: DefiDemoClientProps) {
  const { address, isConnected } = useAppKitAccount();
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(
    attestedNetworkId,
  );
  const isMounted = useIsMounted();

  // In demo mode (Hardhat), skip wallet mismatch check for easier testing
  const isDemoMode = process.env.NEXT_PUBLIC_ATTESTATION_DEMO === "true";

  // Fetch available networks with CompliantERC20
  const { data: networks, isLoading: networksLoading } =
    trpcReact.token.networks.useQuery();
  const utils = trpcReact.useUtils();

  // Auto-select first network if none selected
  useEffect(() => {
    if (networks && networks.length > 0 && !selectedNetwork) {
      setSelectedNetwork(networks[0].id);
    }
  }, [networks, selectedNetwork]);

  const selectedNetworkData = networks?.find((n) => n.id === selectedNetwork);
  const activeNetworkId = selectedNetworkData?.id;
  const resolvedNetworkId = activeNetworkId ?? "";

  const requiresAccessGrant =
    !isDemoMode &&
    Boolean(
      selectedNetworkData?.complianceRules &&
        selectedNetworkData?.identityRegistry,
    );

  // Check on-chain attestation status (validates DB record against actual contract)
  const { data: attestationStatus, isLoading: attestationLoading } =
    trpcReact.token.isAttested.useQuery(
      {
        networkId: activeNetworkId ?? "",
        address: address ?? "",
      },
      {
        enabled: Boolean(activeNetworkId && address && !isDemoMode),
        staleTime: 30000,
      },
    );

  // If DB says attested but on-chain says not, user needs to re-attest
  const needsReAttestation =
    !isDemoMode &&
    attestedNetworkId &&
    attestationStatus &&
    !attestationStatus.isAttested;

  const { data: complianceAccess } = trpcReact.token.complianceAccess.useQuery(
    {
      networkId: activeNetworkId ?? "",
      walletAddress: address ?? "",
    },
    {
      enabled: Boolean(
        requiresAccessGrant &&
          activeNetworkId &&
          address &&
          !isDemoMode &&
          !needsReAttestation,
      ),
    },
  );

  const hasComplianceAccess = isDemoMode
    ? true
    : Boolean(complianceAccess?.granted);
  const complianceTxHash =
    isDemoMode || !complianceAccess?.granted ? null : complianceAccess?.txHash;
  const complianceExplorerUrl =
    isDemoMode || !complianceAccess?.granted
      ? null
      : complianceAccess?.explorerUrl;

  const handleAccessGranted = () => {
    if (activeNetworkId && address) {
      utils.token.complianceAccess.setData(
        {
          networkId: activeNetworkId,
          walletAddress: address,
        },
        {
          granted: true,
          demo: false,
          txHash: null,
          blockNumber: null,
          explorerUrl: null,
        },
      );
      utils.token.complianceAccess.invalidate({
        networkId: activeNetworkId,
        walletAddress: address,
      });
    }
  };

  const accessReady = !requiresAccessGrant || hasComplianceAccess;

  // Check if wallet matches attested wallet (skip in demo mode for easier testing)
  const walletMismatch =
    !isDemoMode &&
    attestedWallet &&
    address &&
    attestedWallet.toLowerCase() !== address.toLowerCase();

  // Not verified - show requirements
  if (!isVerified) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Verification Required
          </CardTitle>
          <CardDescription>
            Complete identity verification to access compliant DeFi
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              This demo requires verified identity to demonstrate compliance
              checks.
            </AlertDescription>
          </Alert>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">Steps to access:</p>
            <ol className="text-sm space-y-1 list-decimal list-inside text-muted-foreground">
              <li>Complete document verification on the main dashboard</li>
              <li>Pass liveness detection</li>
              <li>Register your identity on-chain (attestation)</li>
            </ol>
          </div>
          <Button variant="outline" asChild>
            <a href="/dashboard">
              Go to Dashboard
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Not attested - need on-chain registration
  if (!attestedNetworkId) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            On-Chain Attestation Required
          </CardTitle>
          <CardDescription>
            Register your identity on-chain to interact with compliant contracts
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Your identity is verified but not yet registered on-chain.
            </AlertDescription>
          </Alert>
          <Button variant="outline" asChild>
            <a href="/dashboard">
              Register On-Chain
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Not connected - show connect button
  if (!isMounted || !isConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Connect Wallet
          </CardTitle>
          <CardDescription>
            Connect your wallet to interact with compliant tokens
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 py-8">
          <Wallet className="h-12 w-12 text-muted-foreground" />
          <p className="text-sm text-muted-foreground text-center">
            Connect the wallet you registered on-chain to continue
          </p>
          {isMounted && <appkit-button />}
        </CardContent>
      </Card>
    );
  }

  // Loading attestation status
  if (attestationLoading && !isDemoMode) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Verifying on-chain attestation...
        </CardContent>
      </Card>
    );
  }

  // On-chain attestation mismatch - contracts were redeployed
  if (needsReAttestation) {
    return (
      <Card className="border-warning/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-warning">
            <AlertTriangle className="h-5 w-5" />
            Re-attestation Required
          </CardTitle>
          <CardDescription>
            Your on-chain identity registration needs to be renewed
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              The identity contracts have been updated. Please register your
              identity on-chain again to continue using compliant DeFi features.
            </AlertDescription>
          </Alert>
          <Button variant="outline" asChild>
            <a href="/dashboard">
              Register On-Chain
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Wallet mismatch warning
  if (walletMismatch) {
    return (
      <Card className="border-warning/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-warning">
            <AlertTriangle className="h-5 w-5" />
            Wallet Mismatch
          </CardTitle>
          <CardDescription>
            Connected wallet differs from your attested wallet
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <p>
                <strong>Connected:</strong>{" "}
                <code className="text-xs">{address}</code>
              </p>
              <p>
                <strong>Attested:</strong>{" "}
                <code className="text-xs">{attestedWallet}</code>
              </p>
            </AlertDescription>
          </Alert>
          <p className="text-sm text-muted-foreground">
            Please connect the wallet you registered on-chain, or update your
            attestation with the new wallet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Network selector */}
      {networks && networks.length > 1 && (
        <div className="flex gap-2 items-center">
          <span className="text-sm font-medium">Network:</span>
          {networks.map((network) => (
            <Badge
              key={network.id}
              variant={selectedNetwork === network.id ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setSelectedNetwork(network.id)}
            >
              {network.name}
            </Badge>
          ))}
        </div>
      )}

      {networksLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Loading networks...
          </CardContent>
        </Card>
      ) : !selectedNetworkData ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No CompliantERC20 deployed on available networks
          </CardContent>
        </Card>
      ) : !address ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Wallet address not available
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {requiresAccessGrant && (
            <ComplianceAccessCard
              identityRegistry={
                selectedNetworkData.identityRegistry as `0x${string}` | null
              }
              complianceRules={
                selectedNetworkData.complianceRules as `0x${string}` | null
              }
              expectedChainId={selectedNetworkData.chainId}
              expectedNetworkName={selectedNetworkData.name}
              isGranted={hasComplianceAccess}
              grantedTxHash={complianceTxHash}
              grantedExplorerUrl={complianceExplorerUrl}
              onGranted={handleAccessGranted}
            />
          )}

          {/* Token Status */}
          <TokenStatus networkId={resolvedNetworkId} walletAddress={address} />

          {/* Mint Form */}
          <MintForm networkId={resolvedNetworkId} walletAddress={address} />

          {/* Transfer Form */}
          <TransferForm
            networkId={resolvedNetworkId}
            contractAddress={
              selectedNetworkData.contractAddress as `0x${string}`
            }
            accessGranted={accessReady}
          />

          {/* Transaction History */}
          <TxHistory networkId={resolvedNetworkId} walletAddress={address} />
        </div>
      )}
    </div>
  );
}
