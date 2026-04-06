"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";

import { Button } from "@/components/ui/button";
import { Redacted } from "@/components/ui/redacted";

export function WalletConnect() {
  const { address, isConnected } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5">
          <div className="size-2 rounded-full bg-emerald-500" />
          <span className="truncate font-mono text-xs">
            <Redacted>{address}</Redacted>
          </span>
        </div>
        <button
          className="rounded px-1.5 py-1 text-muted-foreground text-xs transition-colors hover:bg-secondary hover:text-foreground"
          onClick={() => disconnect()}
          type="button"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <Button
      className="h-8 w-full text-xs"
      disabled={isPending}
      onClick={() => connect({ connector: injected() })}
      size="sm"
      variant="secondary"
    >
      {isPending ? "Connecting..." : "Connect Wallet"}
    </Button>
  );
}

export function useWalletAddress(): string | undefined {
  const { address } = useAccount();
  return address;
}
