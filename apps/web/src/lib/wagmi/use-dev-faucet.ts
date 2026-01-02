"use client";

import { useCallback, useState } from "react";
import { usePublicClient } from "wagmi";

const HARDHAT_CHAIN_ID = 31_337;
const DEV_FAUCET_WEI = "0x8AC7230489E80000"; // 10 ETH

export function useDevFaucet(chainId?: number) {
  const publicClient = usePublicClient({ chainId });
  const [isFauceting, setIsFauceting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const isSupported = chainId === HARDHAT_CHAIN_ID && Boolean(publicClient);

  const faucet = useCallback(
    async (address?: `0x${string}`) => {
      if (!(address && publicClient) || chainId !== HARDHAT_CHAIN_ID) {
        return false;
      }

      setIsFauceting(true);
      setError(null);

      try {
        const requester = publicClient as unknown as {
          request: (args: {
            method: string;
            params?: unknown[];
          }) => Promise<unknown>;
        };
        await requester.request({
          method: "hardhat_setBalance",
          params: [address, DEV_FAUCET_WEI],
        });
        return true;
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Faucet failed"));
        return false;
      } finally {
        setIsFauceting(false);
      }
    },
    [publicClient, chainId]
  );

  return {
    faucet,
    isFauceting,
    error,
    isSupported,
  } as const;
}
