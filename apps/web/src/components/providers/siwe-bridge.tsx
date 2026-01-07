"use client";

import { useAppKitAccount } from "@reown/appkit/react";
import { useEffect, useRef } from "react";
import { useChainId, useSignMessage } from "wagmi";

import { authClient } from "@/lib/auth/auth-client";
import { signInWithSiwe } from "@/lib/auth/siwe";

export function SiweBridge() {
  const { address, isConnected } = useAppKitAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const lastAuthRef = useRef<{ address: string; chainId: number } | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!(isConnected && address)) {
      lastAuthRef.current = null;
      return;
    }

    const activeChainId = chainId || 1;
    if (
      lastAuthRef.current &&
      lastAuthRef.current.address === address &&
      lastAuthRef.current.chainId === activeChainId
    ) {
      return;
    }

    if (inFlightRef.current) {
      return;
    }

    let cancelled = false;
    inFlightRef.current = true;
    const signInWithWallet = async () => {
      const existingSession = await authClient.getSession();
      if (existingSession.data?.user?.id) {
        lastAuthRef.current = { address, chainId: activeChainId };
        return;
      }

      await signInWithSiwe({
        address,
        chainId: activeChainId,
        signMessage: signMessageAsync,
      });
      lastAuthRef.current = { address, chainId: activeChainId };
    };

    signInWithWallet()
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "SIWE sign-in failed.";
        if (
          message.toLowerCase().includes("user rejected") ||
          message.toLowerCase().includes("denied") ||
          message.toLowerCase().includes("cancel")
        ) {
          return;
        }
      })
      .finally(() => {
        inFlightRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [address, chainId, isConnected, signMessageAsync]);

  return null;
}
