"use client";

import { useAppKitAccount } from "@reown/appkit/react";
/**
 * useEthersSigner Hook
 *
 * Bridges wagmi's wallet client to an ethers v6 JsonRpcSigner.
 * Needed for the FHEVM SDK which requires ethers signers for EIP-712 signatures.
 */
import { BrowserProvider, type Eip1193Provider, type Signer } from "ethers";
import { useEffect, useState } from "react";

export function useEthersSigner(): Signer | undefined {
  const { address, isConnected } = useAppKitAccount();
  const [signer, setSigner] = useState<Signer | undefined>(undefined);

  useEffect(() => {
    async function getSigner() {
      if (!isConnected || !address || typeof window === "undefined") {
        setSigner(undefined);
        return;
      }

      // Check for ethereum provider (injected by wallet)
      const ethereum = window.ethereum as Eip1193Provider | undefined;
      if (!ethereum) {
        setSigner(undefined);
        return;
      }

      try {
        const provider = new BrowserProvider(ethereum as Eip1193Provider);
        const ethSigner = await provider.getSigner(address);
        setSigner(ethSigner);
      } catch {
        setSigner(undefined);
      }
    }

    void getSigner();
  }, [address, isConnected]);

  return signer;
}
