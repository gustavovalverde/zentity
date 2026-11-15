"use client";

import type { Eip712TypedData } from "@/lib/auth/eip712/types";

import { useAppKitAccount } from "@reown/appkit/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useChainId, useSignTypedData } from "wagmi";

import { authClient } from "@/lib/auth/auth-client";

const AUTH_PAGES_PATTERN = /^\/(sign-in|sign-up|recovery\/password)/;

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
      .catch(() => {
        // Best-effort background sign-in: a rejection or failure leaves the
        // user signed out and the sign-in page remains available.
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [address, chainId, isConnected, pathname, signTypedData]);

  return null;
}
