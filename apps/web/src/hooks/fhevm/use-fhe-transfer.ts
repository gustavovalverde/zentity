"use client";

/**
 * useFheTransfer Hook
 *
 * Provides client-side FHE-encrypted token transfers.
 * Uses the FHEVM SDK to encrypt transfer amounts before submitting
 * transactions to the CompliantERC20 contract.
 *
 * Flow:
 * 1. User provides recipient address and amount
 * 2. Hook encrypts the amount using FHEVM SDK
 * 3. User signs and submits transaction via their wallet
 * 4. Contract enforces compliance (silent failure if non-compliant)
 */
import { useAppKitAccount } from "@reown/appkit/react";
import { CompliantERC20ABI } from "@zentity/fhevm-contracts";
import { useCallback, useMemo } from "react";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { useFhevmContext } from "@/components/providers/fhevm-provider";
import { toHex, useFHEEncryption } from "@/hooks/fhevm/use-fhe-encryption";
import { useEthersSigner } from "@/lib/blockchain/wagmi/use-ethers-signer";

interface UseFheTransferParams {
  /** CompliantERC20 contract address */
  contractAddress: `0x${string}` | undefined;
}

interface TransferResult {
  txHash: `0x${string}`;
}

export function useFheTransfer({ contractAddress }: UseFheTransferParams) {
  const { address } = useAppKitAccount();
  const walletAddress = address as `0x${string}` | undefined;
  const {
    instance,
    isReady: isFhevmReady,
    status: fhevmStatus,
    error: fhevmError,
  } = useFhevmContext();
  const ethersSigner = useEthersSigner();

  const {
    data: txHash,
    writeContractAsync,
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

  // FHE encryption hook
  const { canEncrypt, encryptWith } = useFHEEncryption({
    instance,
    ethersSigner,
    contractAddress,
  });

  // Combined ready state
  const isReady = useMemo(
    () =>
      Boolean(isFhevmReady && canEncrypt && contractAddress && walletAddress),
    [isFhevmReady, canEncrypt, contractAddress, walletAddress]
  );

  // Debug info for troubleshooting initialization
  const debug = useMemo(
    () => ({
      isFhevmReady,
      fhevmStatus,
      fhevmError: fhevmError?.message,
      hasInstance: Boolean(instance),
      hasSigner: Boolean(ethersSigner),
      hasContract: Boolean(contractAddress),
      canEncrypt,
    }),
    [
      isFhevmReady,
      fhevmStatus,
      fhevmError,
      instance,
      ethersSigner,
      contractAddress,
      canEncrypt,
    ]
  );

  // Combined loading state
  const isPending = isWritePending || isConfirming;

  // Combined error
  const error = writeError || confirmError;

  /**
   * Transfer tokens with FHE-encrypted amount.
   *
   * @param to - Recipient address (must be attested for transfer to succeed)
   * @param amount - Token amount in wei (will be encrypted)
   * @returns Transaction hash
   *
   * Note: CompliantERC20 uses silent failure - if compliance check fails,
   * the transaction succeeds but transfers 0 tokens.
   */
  const transfer = useCallback(
    async (to: `0x${string}`, amount: bigint): Promise<TransferResult> => {
      if (!(isReady && contractAddress)) {
        throw new Error(
          "FHE transfer not ready - check wallet connection and contract address"
        );
      }

      if (!canEncrypt) {
        throw new Error("FHE encryption not available");
      }

      // Encrypt the amount using the FHEVM SDK
      const encrypted = await encryptWith((builder) => {
        builder.add64(amount);
      });

      if (!encrypted) {
        throw new Error("Failed to encrypt transfer amount");
      }

      // Convert handles and proof to hex strings
      const encryptedAmount = toHex(encrypted.handles[0]);
      const inputProof = toHex(encrypted.inputProof);

      // Submit transaction - user signs with their wallet
      const hash = await writeContractAsync({
        address: contractAddress,
        abi: CompliantERC20ABI,
        functionName: "transfer",
        args: [to, encryptedAmount, inputProof],
        account: walletAddress,
      });

      return { txHash: hash };
    },
    [
      isReady,
      contractAddress,
      canEncrypt,
      encryptWith,
      writeContractAsync,
      walletAddress,
    ]
  );

  /**
   * Reset the hook state (clear pending transaction).
   */
  const reset = useCallback(() => {
    resetWrite();
  }, [resetWrite]);

  return {
    /** Execute a transfer */
    transfer,
    /** Whether the hook is ready for transfers */
    isReady,
    /** Whether a transaction is pending */
    isPending,
    /** Whether the transaction was confirmed */
    isConfirmed,
    /** Last transaction hash */
    txHash,
    /** Any error that occurred */
    error,
    /** Reset the hook state */
    reset,
    /** Debug info for troubleshooting */
    debug,
  };
}
