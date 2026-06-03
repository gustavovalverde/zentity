"use client";

import { useAppKitAccount } from "@reown/appkit/react";
import { compliantErc20Abi } from "@zentity/contracts";
import { useCallback, useMemo } from "react";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { useConfidentialChain } from "./chain";

interface UseConfidentialTransferParams {
  /** CompliantERC20 contract address */
  contractAddress: `0x${string}` | undefined;
}

interface TransferResult {
  txHash: `0x${string}`;
}

export function useConfidentialTransfer({
  contractAddress,
}: UseConfidentialTransferParams) {
  const { address } = useAppKitAccount();
  const walletAddress = address as `0x${string}` | undefined;
  const { encryptTokenAmount, isReady: isConfidentialChainReady } =
    useConfidentialChain();

  const {
    data: txHash,
    mutateAsync: writeContractAsync,
    isPending: isWritePending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const isReady = useMemo(
    () => Boolean(isConfidentialChainReady && contractAddress && walletAddress),
    [isConfidentialChainReady, contractAddress, walletAddress]
  );

  const isPending = isWritePending || isConfirming;
  const error = writeError || confirmError;

  const transfer = useCallback(
    async (to: `0x${string}`, amount: bigint): Promise<TransferResult> => {
      if (!(isReady && contractAddress && walletAddress)) {
        throw new Error(
          "Confidential transfer is not ready. Check wallet connection and contract address."
        );
      }

      const encryptedAmount = await encryptTokenAmount({
        amount,
        contractAddress,
        userAddress: walletAddress,
      });

      const hash = await writeContractAsync({
        address: contractAddress,
        abi: compliantErc20Abi,
        functionName: "transferConfidential",
        args: [to, encryptedAmount],
        account: walletAddress,
      });

      return { txHash: hash };
    },
    [
      isReady,
      contractAddress,
      walletAddress,
      encryptTokenAmount,
      writeContractAsync,
    ]
  );

  const reset = useCallback(() => {
    resetWrite();
  }, [resetWrite]);

  return {
    transfer,
    isReady,
    isPending,
    isConfirmed,
    txHash,
    error,
    reset,
  };
}
