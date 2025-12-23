"use client";

/**
 * Token Status Component
 *
 * Displays token information and user's attestation status.
 */
import { CheckCircle, Coins, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trpcReact } from "@/lib/trpc/client";
import { formatTokenAmount } from "@/lib/utils/token";

interface TokenStatusProps {
  networkId: string;
  walletAddress: string;
}

export function TokenStatus({ networkId, walletAddress }: TokenStatusProps) {
  const { data: tokenInfo, isLoading: tokenLoading } =
    trpcReact.token.info.useQuery({ networkId });

  const { data: attestationStatus } = trpcReact.token.isAttested.useQuery({
    networkId,
    address: walletAddress,
  });

  if (tokenLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
          {tokenInfo?.demo && (
            <Badge variant="outline" className="bg-yellow-100 text-yellow-800">
              DEMO
            </Badge>
          )}
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

            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-2">Contract</p>
              <code className="text-xs bg-muted px-2 py-1 rounded block truncate">
                {tokenInfo.contractAddress}
              </code>
            </div>

            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-2">Your Status</p>
              {attestationStatus?.isAttested ? (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-sm font-medium">Attested</span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Not attested on this network
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Token info not available
          </p>
        )}
      </CardContent>
    </Card>
  );
}
