"use client";

// TODO: Wallet re-binding flow needs design consideration before implementation.
// Key issues:
// - Anonymous wallet users lose access if binding is broken (no way to re-authenticate)
// - Re-authentication flow for existing users not defined in current user stories

import { Info, Link2, Wallet } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSession } from "@/lib/auth/auth-client";
import { useBbsCredentials } from "@/lib/bbs/hooks";

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum Mainnet",
  11155111: "Sepolia Testnet",
  137: "Polygon",
  42161: "Arbitrum One",
  10: "Optimism",
  8453: "Base",
  31337: "Hardhat (Local)",
};

function getChainDisplayName(
  network: string,
  chainId?: number
): { name: string; chainInfo: string } {
  if (chainId) {
    const chainName = CHAIN_NAMES[chainId];
    if (chainName) {
      return { name: chainName, chainInfo: `Chain ID: ${chainId}` };
    }
    return {
      name: `${network.charAt(0).toUpperCase()}${network.slice(1)}`,
      chainInfo: `Chain ID: ${chainId}`,
    };
  }
  return {
    name: `${network.charAt(0).toUpperCase()}${network.slice(1)}`,
    chainInfo: "",
  };
}

function formatDate(dateValue: string): string {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function WalletBindingSection() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;

  const {
    metadata: walletBindings,
    isLoading,
    error,
  } = useBbsCredentials(userId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          Wallet Binding
        </CardTitle>
        <CardDescription>
          Your wallet is cryptographically bound to your identity for
          privacy-preserving proofs
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>
              Failed to load wallet binding: {error}
            </AlertDescription>
          </Alert>
        ) : null}

        {(() => {
          if (isLoading) {
            return (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
              </div>
            );
          }

          if (walletBindings.length === 0) {
            return (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Link2 />
                  </EmptyMedia>
                  <EmptyTitle>No Wallet Bound</EmptyTitle>
                  <EmptyDescription>
                    Your wallet will be automatically bound during sign-up when
                    you authenticate with a wallet.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            );
          }

          return (
            <ItemGroup>
              {walletBindings.map((binding) => {
                const { name, chainInfo } = getChainDisplayName(
                  binding.network,
                  binding.chainId
                );
                return (
                  <Item key={binding.id} size="sm" variant="outline">
                    <ItemMedia variant="icon">
                      <Wallet className="h-4 w-4" />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle className="flex items-center gap-2">
                        {name}
                        {chainInfo && (
                          <span className="text-muted-foreground text-xs">
                            ({chainInfo})
                          </span>
                        )}
                      </ItemTitle>
                      <p className="text-muted-foreground text-xs">
                        Bound {formatDate(binding.issuedAt)}
                      </p>
                    </ItemContent>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">Tier {binding.tier}</Badge>
                      {binding.hasCommitmentSalt && (
                        <Badge variant="outline">Verifiable</Badge>
                      )}
                    </div>
                  </Item>
                );
              })}
            </ItemGroup>
          );
        })()}
      </CardContent>
      <CardFooter>
        <div className="flex items-start gap-2 text-muted-foreground text-xs">
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-4 w-4 shrink-0 cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>
                BBS+ signatures allow selective disclosure - proving specific
                claims without revealing others. Your wallet address is never
                exposed during verification.
              </p>
            </TooltipContent>
          </Tooltip>
          <p>
            This binding enables ZK proofs of wallet ownership without revealing
            your address. It's used internally for compliance checks.
          </p>
        </div>
      </CardFooter>
    </Card>
  );
}
