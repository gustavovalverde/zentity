"use client";

import { useAppKitAccount } from "@reown/appkit/react";
/**
 * Transfer Form Component
 *
 * Enables FHE-encrypted token transfers between attested users.
 * Uses client-side encryption via the FHEVM SDK.
 */
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  ExternalLink,
  Loader2,
  Lock,
  Send,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useBalance, useChainId } from "wagmi";

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
import { useFheTransfer } from "@/hooks/fhevm/use-fhe-transfer";
import { trpcReact } from "@/lib/trpc/client";
import { getUserFriendlyError } from "@/lib/utils/error-messages";
import { parseTokenAmount } from "@/lib/utils/token";
import { useDevFaucet } from "@/lib/wagmi/use-dev-faucet";

interface TransferFormProps {
  networkId: string;
  contractAddress: `0x${string}`;
  accessGranted?: boolean;
}

export function TransferForm({
  networkId,
  contractAddress,
  accessGranted = true,
}: TransferFormProps) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [recipientChecked, setRecipientChecked] = useState(false);
  const { address } = useAppKitAccount();
  const walletAddress = address as `0x${string}` | undefined;
  const utils = trpcReact.useUtils();
  const chainId = useChainId();
  const {
    data: balance,
    isLoading: isBalanceLoading,
    refetch: refetchBalance,
  } = useBalance({ address: walletAddress });
  const {
    faucet,
    isFauceting,
    isSupported: isFaucetSupported,
  } = useDevFaucet(chainId);

  const { transfer, isReady, isPending, isConfirmed, txHash, error, reset } =
    useFheTransfer({ contractAddress });

  // Check if recipient is attested
  const { data: recipientStatus, refetch: checkRecipient } =
    trpcReact.token.isAttested.useQuery(
      { networkId, address: recipient },
      { enabled: false }, // Manual trigger
    );

  // Check recipient when address changes
  useEffect(() => {
    if (recipient && /^0x[a-fA-F0-9]{40}$/.test(recipient)) {
      setRecipientChecked(false);
      checkRecipient().then(() => setRecipientChecked(true));
    }
  }, [recipient, checkRecipient]);

  const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(recipient);
  const recipientNotAttested =
    recipientChecked && isValidAddress && !recipientStatus?.isAttested;
  const balanceValue = balance?.value;
  const insufficientFunds =
    !isBalanceLoading &&
    balanceValue !== undefined &&
    balanceValue <= BigInt(0);
  const canTransfer = accessGranted && !insufficientFunds;

  const handleTransfer = async () => {
    if (!isValidAddress || !amount || Number.parseFloat(amount) <= 0) return;
    let hasFunds = !insufficientFunds;

    if (!hasFunds && isFaucetSupported) {
      const toppedUp = await faucet(walletAddress);
      if (toppedUp) {
        const refreshed = await refetchBalance();
        hasFunds = (refreshed.data?.value ?? BigInt(0)) > BigInt(0);
      }
    }
    if (!hasFunds) return;

    await transfer(recipient as `0x${string}`, parseTokenAmount(amount));
  };

  // Reset form after successful transfer
  useEffect(() => {
    if (isConfirmed) {
      // Refresh history
      if (address) {
        utils.token.history.invalidate({ networkId, walletAddress: address });
      }
    }
  }, [isConfirmed, address, networkId, utils]);

  const handleReset = () => {
    reset();
    setRecipient("");
    setAmount("");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Send className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Transfer</CardTitle>
        </div>
        <CardDescription className="flex items-center gap-1">
          <Lock className="h-3 w-3" />
          FHE-encrypted compliant transfer
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!accessGranted ? (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Grant compliance access to enable transfers on this network.
            </AlertDescription>
          </Alert>
        ) : insufficientFunds ? (
          <div className="space-y-3">
            <Alert variant="warning">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Your wallet has no ETH available for gas on this network.
              </AlertDescription>
            </Alert>
            {isFaucetSupported && (
              <Button
                variant="outline"
                onClick={async () => {
                  const toppedUp = await faucet(walletAddress);
                  if (toppedUp) {
                    await refetchBalance();
                  }
                }}
                disabled={isFauceting}
                className="w-full"
              >
                {isFauceting ? "Topping Up..." : "Top Up Test ETH"}
              </Button>
            )}
          </div>
        ) : !isReady ? (
          <Alert>
            <Lock className="h-4 w-4" />
            <AlertDescription>
              Initializing FHE encryption... Please wait.
            </AlertDescription>
          </Alert>
        ) : txHash ? (
          <div className="space-y-4">
            <Alert variant="success">
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-medium">Transfer submitted!</p>
                <p className="text-xs mt-1">
                  {isConfirmed
                    ? "Transaction confirmed. Note: If recipient is not attested, 0 tokens were transferred (silent failure)."
                    : "Transaction sent. Waiting for confirmation..."}
                </p>
                <a
                  href={`https://sepolia.etherscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs flex items-center gap-1 mt-2 hover:underline"
                >
                  View transaction
                  <ExternalLink className="h-3 w-3" />
                </a>
              </AlertDescription>
            </Alert>
            <Button variant="outline" onClick={handleReset} className="w-full">
              New Transfer
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="recipient">Recipient Address</Label>
              <Input
                id="recipient"
                type="text"
                placeholder="0x..."
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                disabled={isPending || !canTransfer}
              />
              {isValidAddress && recipientChecked && (
                <div className="flex items-center gap-1 text-xs">
                  {recipientStatus?.isAttested ? (
                    <span className="text-success flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" />
                      Recipient is attested
                    </span>
                  ) : (
                    <span className="text-warning flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Recipient not attested - transfer will be 0
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="transfer-amount">Amount</Label>
              <div className="flex gap-2">
                <Input
                  id="transfer-amount"
                  type="number"
                  placeholder="10"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={isPending || !canTransfer}
                  min="0"
                  step="0.01"
                />
              </div>
            </div>

            {recipientNotAttested && (
              <Alert variant="warning">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  <strong>Warning:</strong> Recipient is not attested on this
                  network. Due to compliance checks, 0 tokens will be
                  transferred (the contract uses silent failure).
                </AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>
                  {getUserFriendlyError(error)}
                </AlertDescription>
              </Alert>
            )}

            <Button
              onClick={handleTransfer}
              disabled={
                isPending ||
                !canTransfer ||
                !isValidAddress ||
                !amount ||
                Number.parseFloat(amount) <= 0
              }
              className="w-full"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {isPending ? "Encrypting & Sending..." : "Confirming..."}
                </>
              ) : (
                <>
                  Transfer
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              Amount is encrypted using FHE before submission
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
