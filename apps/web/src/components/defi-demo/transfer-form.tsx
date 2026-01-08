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
  Lock,
  Send,
} from "lucide-react";

import { Spinner } from "@/components/ui/spinner";

/** Matches a valid Ethereum address (0x followed by 40 hex characters) */
const ETH_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

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
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
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
      { enabled: false } // Manual trigger
    );

  // Check recipient when address changes
  useEffect(() => {
    if (recipient && ETH_ADDRESS_PATTERN.test(recipient)) {
      setRecipientChecked(false);
      checkRecipient().then(() => setRecipientChecked(true));
    }
  }, [recipient, checkRecipient]);

  const isValidAddress = ETH_ADDRESS_PATTERN.test(recipient);
  const recipientNotAttested =
    recipientChecked && isValidAddress && !recipientStatus?.isAttested;
  const balanceValue = balance?.value;
  const insufficientFunds =
    !isBalanceLoading &&
    balanceValue !== undefined &&
    balanceValue <= BigInt(0);
  const canTransfer = accessGranted && !insufficientFunds;

  const validateRecipient = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return "Recipient address is required";
    }
    if (!ETH_ADDRESS_PATTERN.test(trimmed)) {
      return "Enter a valid wallet address";
    }
    return null;
  };

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

  const handleTransfer = async () => {
    const trimmedRecipient = recipient.trim();
    const trimmedAmount = amount.trim();
    const recipientValidation = validateRecipient(trimmedRecipient);
    const amountValidation = validateAmount(trimmedAmount);
    setRecipientError(recipientValidation);
    setAmountError(amountValidation);
    if (recipientValidation || amountValidation) {
      return;
    }
    let hasFunds = !insufficientFunds;

    if (!hasFunds && isFaucetSupported) {
      const toppedUp = await faucet(walletAddress);
      if (toppedUp) {
        const refreshed = await refetchBalance();
        hasFunds = (refreshed.data?.value ?? BigInt(0)) > BigInt(0);
      }
    }
    if (!hasFunds) {
      return;
    }

    await transfer(
      trimmedRecipient as `0x${string}`,
      parseTokenAmount(trimmedAmount)
    );
  };

  // Reset form after successful transfer
  useEffect(() => {
    // Refresh history
    if (isConfirmed && address) {
      utils.token.history
        .invalidate({
          networkId,
          walletAddress: address,
        })
        .catch(() => {
          // History refresh failure is non-critical
        });
    }
  }, [isConfirmed, address, networkId, utils]);

  const handleReset = () => {
    reset();
    setRecipient("");
    setAmount("");
    setRecipientError(null);
    setAmountError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await handleTransfer();
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
        {(() => {
          if (!accessGranted) {
            return (
              <Alert variant="warning">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Grant compliance access to enable transfers on this network.
                </AlertDescription>
              </Alert>
            );
          }

          if (insufficientFunds) {
            return (
              <div className="space-y-3">
                <Alert variant="warning">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Your wallet has no ETH available for gas on this network.
                  </AlertDescription>
                </Alert>
                {isFaucetSupported ? (
                  <Button
                    className="w-full"
                    disabled={isFauceting}
                    onClick={async () => {
                      const toppedUp = await faucet(walletAddress);
                      if (toppedUp) {
                        await refetchBalance();
                      }
                    }}
                    variant="outline"
                  >
                    {isFauceting ? (
                      <Spinner aria-hidden="true" className="mr-2" />
                    ) : null}
                    Top Up Test ETH
                  </Button>
                ) : null}
              </div>
            );
          }

          if (!isReady) {
            return (
              <Alert>
                <Lock className="h-4 w-4" />
                <AlertDescription>
                  Initializing FHE encryption… Please wait.
                </AlertDescription>
              </Alert>
            );
          }

          if (txHash) {
            return (
              <div className="space-y-4">
                <Alert variant="success">
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    <p className="font-medium">Transfer submitted!</p>
                    <p className="mt-1 text-xs">
                      {isConfirmed
                        ? "Transaction confirmed. Note: If recipient is not attested, 0 tokens were transferred (silent failure)."
                        : "Transaction sent. Waiting for confirmation…"}
                    </p>
                    <a
                      className="mt-2 flex items-center gap-1 text-xs hover:underline"
                      href={`https://sepolia.etherscan.io/tx/${txHash}`}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      View transaction
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </AlertDescription>
                </Alert>
                <Button
                  className="w-full"
                  onClick={handleReset}
                  variant="outline"
                >
                  New Transfer
                </Button>
              </div>
            );
          }

          return (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <FieldGroup>
                <Field data-invalid={Boolean(recipientError)}>
                  <FieldLabel htmlFor="recipient">Recipient Address</FieldLabel>
                  <Input
                    aria-invalid={Boolean(recipientError)}
                    autoCapitalize="none"
                    autoComplete="off"
                    disabled={isPending || !canTransfer}
                    id="recipient"
                    inputMode="text"
                    name="recipient"
                    onBlur={() =>
                      setRecipientError(validateRecipient(recipient))
                    }
                    onChange={(e) => {
                      setRecipient(e.target.value);
                      if (recipientError) {
                        setRecipientError(null);
                      }
                    }}
                    placeholder="0x…"
                    spellCheck={false}
                    type="text"
                    value={recipient}
                  />
                  <FieldError>{recipientError}</FieldError>
                </Field>
              </FieldGroup>
              {isValidAddress && recipientChecked ? (
                <div className="flex items-center gap-1 text-xs">
                  {recipientStatus?.isAttested ? (
                    <span className="flex items-center gap-1 text-success">
                      <CheckCircle className="h-3 w-3" />
                      Recipient is attested
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-warning">
                      <AlertTriangle className="h-3 w-3" />
                      Recipient not attested - transfer will be 0
                    </span>
                  )}
                </div>
              ) : null}

              <FieldGroup>
                <Field data-invalid={Boolean(amountError)}>
                  <FieldLabel htmlFor="transfer-amount">Amount</FieldLabel>
                  <Input
                    aria-invalid={Boolean(amountError)}
                    autoComplete="off"
                    disabled={isPending || !canTransfer}
                    id="transfer-amount"
                    inputMode="decimal"
                    min="0"
                    name="amount"
                    onBlur={() => setAmountError(validateAmount(amount))}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      if (amountError) {
                        setAmountError(null);
                      }
                    }}
                    placeholder="10"
                    spellCheck={false}
                    step="0.01"
                    type="number"
                    value={amount}
                  />
                  <FieldError>{amountError}</FieldError>
                </Field>
              </FieldGroup>

              {recipientNotAttested ? (
                <Alert variant="warning">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    <strong>Warning:</strong> Recipient is not attested on this
                    network. Due to compliance checks, 0 tokens will be
                    transferred (the contract uses silent failure).
                  </AlertDescription>
                </Alert>
              ) : null}

              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    {getUserFriendlyError(error)}
                  </AlertDescription>
                </Alert>
              ) : null}

              <Button
                className="w-full"
                disabled={isPending || !canTransfer}
                type="submit"
              >
                {isPending ? (
                  <Spinner aria-hidden="true" className="mr-2" />
                ) : null}
                Transfer
                {isPending ? null : <ArrowRight className="ml-2 h-4 w-4" />}
              </Button>

              <p className="text-center text-muted-foreground text-xs">
                Amount is encrypted using FHE before submission
              </p>
            </form>
          );
        })()}
      </CardContent>
    </Card>
  );
}
