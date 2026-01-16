"use client";

import { useAppKitAccount } from "@reown/appkit/react";
/**
 * DeFi Demo Client Component
 *
 * Main client-side component for the DeFi compliance demo.
 * Orchestrates token operations with encrypted identity verification.
 */
import { AlertTriangle, ArrowRight, Lock, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

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
import { Spinner } from "@/components/ui/spinner";
import { trpcReact } from "@/lib/trpc/client";

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
    attestedNetworkId
  );
  const mintFormRef = useRef<HTMLDivElement>(null);

  const handleMintClick = useCallback(() => {
    mintFormRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, []);

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
        selectedNetworkData?.identityRegistry
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
        staleTime: 30_000,
      }
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
          !needsReAttestation
      ),
    }
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
        }
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
            <p className="text-muted-foreground text-sm">Steps to access:</p>
            <ol className="list-inside list-decimal space-y-1 text-muted-foreground text-sm">
              <li>Complete document verification on the main dashboard</li>
              <li>Pass liveness detection</li>
              <li>Register your identity on-chain (attestation)</li>
            </ol>
          </div>
          <Button asChild variant="outline">
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
              Your identity is verified but not yet attested on-chain.
            </AlertDescription>
          </Alert>
          <Button asChild variant="outline">
            <a href="/dashboard">
              Attest On-Chain
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Not connected - show connect button
  if (!isConnected) {
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
          <p className="text-center text-muted-foreground text-sm">
            Connect the wallet you attested on-chain to continue
          </p>
          <appkit-button />
        </CardContent>
      </Card>
    );
  }

  // Loading attestation status
  if (attestationLoading && !isDemoMode) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-8">
          <Spinner size="lg" />
          <p className="text-muted-foreground text-sm">
            Verifying on-chain attestation…
          </p>
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
            Your on-chain identity attestation needs to be renewed
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              The identity contracts have been updated. Please attest your
              identity on-chain again to continue using compliant DeFi features.
            </AlertDescription>
          </Alert>
          <Button asChild variant="outline">
            <a href="/dashboard">
              Attest On-Chain
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
          <p className="text-muted-foreground text-sm">
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
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">Network:</span>
          {networks.map((network) => (
            <Badge
              className="cursor-pointer"
              key={network.id}
              onClick={() => setSelectedNetwork(network.id)}
              variant={selectedNetwork === network.id ? "default" : "outline"}
            >
              {network.name}
            </Badge>
          ))}
        </div>
      )}

      {(() => {
        if (networksLoading) {
          return (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-3 py-8">
                <Spinner size="lg" />
                <p className="text-muted-foreground text-sm">
                  Loading networks…
                </p>
              </CardContent>
            </Card>
          );
        }

        if (!selectedNetworkData) {
          return (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No CompliantERC20 deployed on available networks
              </CardContent>
            </Card>
          );
        }

        if (!address) {
          return (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Wallet address not available
              </CardContent>
            </Card>
          );
        }

        return (
          <div className="space-y-6">
            {/* Compliance Setup (one-time) */}
            {requiresAccessGrant ? (
              <ComplianceAccessCard
                complianceRules={
                  selectedNetworkData.complianceRules as `0x${string}` | null
                }
                expectedChainId={selectedNetworkData.chainId}
                expectedNetworkName={selectedNetworkData.name}
                grantedExplorerUrl={complianceExplorerUrl}
                grantedTxHash={complianceTxHash}
                identityRegistry={
                  selectedNetworkData.identityRegistry as `0x${string}` | null
                }
                isGranted={hasComplianceAccess}
                onGranted={handleAccessGranted}
              />
            ) : null}

            {/* Token Status */}
            <TokenStatus
              networkId={resolvedNetworkId}
              walletAddress={address}
            />

            {/* Token Actions - side by side for related actions */}
            <div className="grid gap-6 md:grid-cols-2">
              <div ref={mintFormRef}>
                <MintForm
                  networkId={resolvedNetworkId}
                  walletAddress={address}
                />
              </div>
              <TransferForm
                accessGranted={accessReady}
                contractAddress={
                  selectedNetworkData.contractAddress as `0x${string}`
                }
                networkId={resolvedNetworkId}
              />
            </div>

            {/* Transaction History */}
            <TxHistory
              networkId={resolvedNetworkId}
              onMintClick={handleMintClick}
              walletAddress={address}
            />
          </div>
        );
      })()}
    </div>
  );
}
