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

  const mintMutation = trpcReact.token.mint.useMutation({
    onSuccess: () => {
      // Refresh token info and history
      utils.token.info.invalidate({ networkId });
      utils.token.history.invalidate({ networkId, walletAddress });
    },
  });

  const handleMint = async () => {
    if (!amount || Number.parseFloat(amount) <= 0) return;

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
              id="mint-amount"
              type="number"
              placeholder="5"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={mintMutation.isPending}
              min="0"
              max="10"
              step="0.1"
            />
            <Button
              onClick={handleMint}
              disabled={
                mintMutation.isPending ||
                !amount ||
                Number.parseFloat(amount) <= 0
              }
            >
              {mintMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Mint"
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Max 10 tokens per request (euint64 limit). Rate limited to 3
            requests/hour.
          </p>
        </div>

        {mintMutation.isSuccess && mintMutation.data && (
          <Alert variant="success">
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              <p className="font-medium">Tokens minted successfully!</p>
              {mintMutation.data.txHash && !mintMutation.data.demo && (
                <a
                  href={`https://sepolia.etherscan.io/tx/${mintMutation.data.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs flex items-center gap-1 mt-1 hover:underline"
                >
                  View transaction
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </AlertDescription>
          </Alert>
        )}

        {mintMutation.error && (
          <Alert variant="destructive">
            <AlertDescription>{mintMutation.error.message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
