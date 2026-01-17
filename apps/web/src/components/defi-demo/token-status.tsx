"use client";

/**
 * Token Status Component
 *
 * Displays token information and user's attestation status.
 */
import { CheckCircle, Coins } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { trpcReact } from "@/lib/trpc/client";
import { formatTokenAmount } from "@/lib/utils/token";

interface TokenStatusProps {
  networkId: string;
  walletAddress: string;
}

export function TokenStatus({
  networkId,
  walletAddress,
}: Readonly<TokenStatusProps>) {
  const { data: tokenInfo, isLoading: tokenLoading } =
    trpcReact.token.info.useQuery({ networkId });

  const { data: attestationStatus } = trpcReact.token.isAttested.useQuery({
    networkId,
    address: walletAddress,
  });

  if (tokenLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Spinner size="lg" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Token Info</CardTitle>
          </div>
          {tokenInfo?.demo ? <Badge variant="warning">DEMO</Badge> : null}
        </div>
        <CardDescription>CompliantERC20 contract details</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {tokenInfo ? (
          <>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Name</p>
                <p className="font-medium">{tokenInfo.name}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Symbol</p>
                <p className="font-medium">{tokenInfo.symbol}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Decimals</p>
                <p className="font-medium">{tokenInfo.decimals}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Total Supply</p>
                <p className="font-medium">
                  {formatTokenAmount(tokenInfo.totalSupply, tokenInfo.decimals)}{" "}
                  {tokenInfo.symbol}
                </p>
              </div>
            </div>

            <div className="border-t pt-2">
              <p className="mb-2 text-muted-foreground text-xs">Contract</p>
              <code className="block truncate rounded bg-muted px-2 py-1 text-xs">
                {tokenInfo.contractAddress}
              </code>
            </div>

            <div className="border-t pt-2">
              <p className="mb-2 text-muted-foreground text-xs">Your Status</p>
              {attestationStatus?.isAttested ? (
                <div className="flex items-center gap-2 text-success">
                  <CheckCircle className="h-4 w-4" />
                  <span className="font-medium text-sm">Attested</span>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Not attested on this network
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            Token info not available
          </p>
        )}
      </CardContent>
    </Card>
  );
}
