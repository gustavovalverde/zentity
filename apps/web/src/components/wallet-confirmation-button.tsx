"use client";

import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { Wallet } from "lucide-react";
import { useState } from "react";
import { useChainId, useSignMessage } from "wagmi";

import { Web3Provider } from "@/components/providers/web3-provider";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { reportRejection } from "@/lib/async-handler";
import { authClient } from "@/lib/auth/auth-client";
import { isWalletRejection } from "@/lib/blockchain/tx-errors";

interface WalletConfirmationButtonProps {
  disabled?: boolean;
  onConfirmed: () => Promise<void> | void;
  onError: (message: string) => void;
}

/**
 * Confirms, inside the current session, that the user holds a wallet linked
 * to their account, so the wallet can pair with an email link in an account
 * recovery. The first press connects a wallet when none is connected.
 */
export function WalletConfirmationButton(
  props: Readonly<WalletConfirmationButtonProps>
) {
  return (
    <Web3Provider cookies={null}>
      <WalletConfirmation {...props} />
    </Web3Provider>
  );
}

function WalletConfirmation({
  disabled,
  onConfirmed,
  onError,
}: Readonly<WalletConfirmationButtonProps>) {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const chainId = useChainId();
  const { mutateAsync: signMessage } = useSignMessage();
  const [busy, setBusy] = useState(false);

  const openWallet = () => {
    open().catch(() => {
      onError("We couldn't open your wallet. Try again.");
    });
  };

  const confirm = async () => {
    if (!address) {
      return;
    }
    setBusy(true);
    try {
      await authClient.siwe.verifyWallet({
        address,
        chainId,
        signMessage: (message) => signMessage({ message }),
      });
      await onConfirmed();
    } catch (err) {
      if (isWalletRejection(err)) {
        onError("You cancelled the signature, so nothing was confirmed.");
      } else {
        onError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!(isConnected && address)) {
    return (
      <Button
        className="justify-start"
        disabled={disabled}
        onClick={openWallet}
        variant="outline"
      >
        <Wallet />
        Use your wallet
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        className="justify-start"
        disabled={disabled || busy}
        onClick={() => {
          confirm().catch(reportRejection);
        }}
        variant="outline"
      >
        {busy ? <Spinner aria-hidden="true" size="sm" /> : <Wallet />}
        Confirm with wallet {address.slice(0, 6)}…{address.slice(-4)}
      </Button>
      <button
        className="self-start text-muted-foreground text-xs hover:underline"
        disabled={disabled || busy}
        onClick={openWallet}
        type="button"
      >
        Use a different wallet
      </button>
    </div>
  );
}
