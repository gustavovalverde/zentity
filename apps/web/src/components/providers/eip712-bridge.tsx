"use client";

import type { Eip712TypedData } from "@/lib/auth/plugins/eip712/types";

import { useAppKitAccount } from "@reown/appkit/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useChainId, useSignTypedData } from "wagmi";

import { authClient } from "@/lib/auth/auth-client";

const AUTH_PAGES_PATTERN =
  /^\/(sign-in|sign-up|forgot-password|reset-password)/;

export function Eip712Bridge() {
  const { address, isConnected } = useAppKitAccount();
  const chainId = useChainId();
  const { mutateAsync: signTypedData } = useSignTypedData();
  const pathname = usePathname();
  const lastAuthRef = useRef<{ address: string; chainId: number } | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!(isConnected && address)) {
      lastAuthRef.current = null;
      return;
    }

    if (AUTH_PAGES_PATTERN.test(pathname)) {
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

      await authClient.signIn.eip712({
        address,
        chainId: activeChainId,
        signTypedData: async (typedData: Eip712TypedData) =>
          signTypedData({
            domain: typedData.domain as Record<string, unknown>,
            types: typedData.types as Record<
              string,
              Array<{ name: string; type: string }>
            >,
            primaryType: typedData.primaryType,
            message: typedData.message,
          }),
      });
      lastAuthRef.current = { address, chainId: activeChainId };
    };

    signInWithWallet()
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Wallet sign-in failed.";
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
  }, [address, chainId, isConnected, pathname, signTypedData]);

  return null;
}
