"use client";

/**
 * Mint Form Component
 *
 * Allows attested users to request token minting.
 * Tokens are minted by the server (owner) to the user's wallet.
 */
import { CheckCircle, Coins, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpcReact } from "@/lib/trpc/client";
import { parseTokenAmount } from "@/lib/utils/token";

interface MintFormProps {
  networkId: string;
  walletAddress: string;
}

export function MintForm({ networkId, walletAddress }: MintFormProps) {
  const [amount, setAmount] = useState("");
  const utils = trpcReact.useUtils();

  // Query token info for remaining supply
  const { data: tokenInfo } = trpcReact.token.info.useQuery(
    { networkId },
    { staleTime: 30_000 } // Refresh every 30s
  );

  const mintMutation = trpcReact.token.mint.useMutation({
    onSuccess: () => {
      // Refresh token info and history
      utils.token.info.invalidate({ networkId });
      utils.token.history.invalidate({ networkId, walletAddress });
    },
  });

  const remainingTokens = tokenInfo?.remainingTokens ?? 18.4;
  const isSupplyExhausted = remainingTokens <= 0;

  const handleMint = async () => {
    if (!amount || Number.parseFloat(amount) <= 0) {
      return;
    }

    await mintMutation.mutateAsync({
      networkId,
      walletAddress,
      amount: parseTokenAmount(amount).toString(),
    });

    setAmount("");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Coins className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Mint Tokens</CardTitle>
        </div>
        <CardDescription>Request test tokens for your wallet</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="mint-amount">Amount</Label>
          <div className="flex gap-2">
            <Input
              disabled={mintMutation.isPending}
              id="mint-amount"
              max="10"
              min="0"
              onChange={(e) => setAmount(e.target.value)}
              placeholder="5"
              step="0.1"
              type="number"
              value={amount}
            />
            <Button
              disabled={
                mintMutation.isPending ||
                !amount ||
                Number.parseFloat(amount) <= 0 ||
                isSupplyExhausted
              }
              onClick={handleMint}
            >
              {mintMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Mint"
              )}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            {isSupplyExhausted ? (
              <span className="text-destructive">
                Supply cap reached. Contract uses euint64 (~18.4 max tokens).
              </span>
            ) : (
              <>
                {remainingTokens.toFixed(2)} tokens remaining (of ~18.4 max).
                Rate limited to 3 requests/hour.
              </>
            )}
          </p>
        </div>

        {mintMutation.isSuccess && mintMutation.data ? (
          <Alert variant="success">
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              <p className="font-medium">Tokens minted successfully!</p>
              {mintMutation.data.txHash && !mintMutation.data.demo ? (
                <a
                  className="mt-1 flex items-center gap-1 text-xs hover:underline"
                  href={`https://sepolia.etherscan.io/tx/${mintMutation.data.txHash}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  View transaction
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {mintMutation.error ? (
          <Alert variant="destructive">
            <AlertDescription>{mintMutation.error.message}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
