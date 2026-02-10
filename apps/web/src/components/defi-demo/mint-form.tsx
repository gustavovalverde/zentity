"use client";

/**
 * Mint Form Component
 *
 * Allows attested users to request token minting.
 * Tokens are minted by the server (owner) to the user's wallet.
 */
import { CheckCircle, Coins, ExternalLink } from "lucide-react";
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
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { trpcReact } from "@/lib/trpc/client";
import { parseTokenAmount } from "@/lib/utils/token";

interface MintFormProps {
  networkId: string;
  walletAddress: string;
}

export function MintForm({
  networkId,
  walletAddress,
}: Readonly<MintFormProps>) {
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
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

  const validateAmount = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return "Amount is required";
    }
    const parsed = Number.parseFloat(trimmed);
    if (Number.isNaN(parsed) || parsed <= 0) {
      return "Amount must be greater than 0";
    }
    return null;
  };

  const handleMint = async () => {
    const trimmed = amount.trim();
    const validationError = validateAmount(trimmed);
    if (validationError) {
      setAmountError(validationError);
      return;
    }

    await mintMutation.mutateAsync({
      networkId,
      walletAddress,
      amount: parseTokenAmount(trimmed).toString(),
    });

    setAmount("");
    setAmountError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await handleMint();
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
        <form className="space-y-2" onSubmit={handleSubmit}>
          <FieldGroup>
            <Field data-invalid={Boolean(amountError)}>
              <FieldLabel htmlFor="mint-amount">Amount</FieldLabel>
              <div className="flex gap-2">
                <Input
                  aria-invalid={Boolean(amountError)}
                  autoComplete="off"
                  disabled={mintMutation.isPending}
                  id="mint-amount"
                  inputMode="decimal"
                  max="10"
                  min="0"
                  name="amount"
                  onBlur={() => setAmountError(validateAmount(amount))}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    if (amountError) {
                      setAmountError(null);
                    }
                  }}
                  placeholder="5"
                  spellCheck={false}
                  step="0.1"
                  type="number"
                  value={amount}
                />
                <Button
                  disabled={mintMutation.isPending || isSupplyExhausted}
                  type="submit"
                >
                  {mintMutation.isPending ? (
                    <Spinner aria-hidden="true" className="mr-2" />
                  ) : null}
                  Mint
                </Button>
              </div>
              <FieldError>{amountError}</FieldError>
            </Field>
          </FieldGroup>
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
        </form>

        {mintMutation.isSuccess && mintMutation.data ? (
          <Alert variant="success">
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              <p className="font-medium">Tokens minted successfully!</p>
              {mintMutation.data.txHash ? (
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
