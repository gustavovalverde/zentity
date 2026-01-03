"use client";

/**
 * FHE User-Controlled Decryption Hook
 *
 * Decrypts encrypted values stored on-chain with user authorization.
 *
 * ## How Decryption Works
 * In fhEVM, only authorized users can decrypt data. The flow is:
 * 1. User requests decryption by calling `decrypt()`
 * 2. Hook loads or creates an EIP-712 signature (cached for reuse)
 * 3. Signature + keypair are sent to the FHEVM gateway
 * 4. Gateway verifies signature with KMS
 * 5. KMS re-encrypts data to user's ephemeral public key
 * 6. User decrypts locally with ephemeral private key
 * 7. Results returned as plaintext values
 *
 * ## Signature Caching
 * Signatures are cached in storage (via FhevmDecryptionSignature):
 * - First decrypt: prompts wallet to sign
 * - Subsequent decrypts: uses cached signature (no popup)
 * - Cache expires after 365 days
 *
 * ## Stale Request Detection
 * If user switches chains or wallets mid-decryption, the request becomes
 * "stale" and is cancelled to avoid applying wrong results.
 *
 * ## Error Handling
 * - "Invalid EIP-712 signature": Cache is cleared, new signature requested
 * - User rejection: Returns with SIGNATURE_ERROR
 * - Network errors: Returns with DECRYPT_ERROR
 *
 * @example
 * ```tsx
 * const { decrypt, results, isDecrypting, error } = useFHEDecrypt({
 *   instance,
 *   ethersSigner,
 *   fhevmDecryptionSignatureStorage: storage,
 *   chainId,
 *   requests: [{ handle: "0x...", contractAddress: "0x..." }],
 * });
 *
 * // Trigger decryption
 * decrypt();
 *
 * // Results keyed by handle
 * console.log(results["0x..."]); // decrypted value
 * ```
 */
import type { ethers } from "ethers";
import type { GenericStringStorage } from "@/lib/fhevm/storage/generic-string-storage";
import type { FHEDecryptRequest, FhevmInstance } from "@/lib/fhevm/types";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FhevmDecryptionSignature } from "@/lib/fhevm/fhevm-decryption-signature";
import { recordClientMetric } from "@/lib/observability/client-metrics";

interface UseFHEDecryptParams {
  /** FHEVM SDK instance (from useFhevmSdk) */
  instance: FhevmInstance | undefined;
  /** User's wallet signer for authorization */
  ethersSigner: ethers.Signer | undefined;
  /** Storage for caching decryption signatures */
  fhevmDecryptionSignatureStorage: GenericStringStorage;
  /** Current chain ID - used for stale detection */
  chainId: number | undefined;
  /** Handles to decrypt - each points to an encrypted value on-chain */
  requests: readonly FHEDecryptRequest[] | undefined;
  /**
   * Optional refresh hook for the FHEVM SDK instance.
   * Useful when the local Hardhat relayer is restarted and metadata changes,
   * which can invalidate EIP-712 signatures built from stale instance state.
   */
  refreshFhevmInstance?: () => void | Promise<void>;
}

export const useFHEDecrypt = (params: UseFHEDecryptParams) => {
  const {
    instance,
    ethersSigner,
    fhevmDecryptionSignatureStorage,
    chainId,
    requests,
    refreshFhevmInstance,
  } = params;

  const [isDecrypting, setIsDecrypting] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");
  /** Decrypted values keyed by handle */
  const [results, setResults] = useState<
    Record<string, string | bigint | boolean>
  >({});
  const [error, setError] = useState<string | null>(null);

  // Refs to detect concurrent/stale requests without causing re-renders
  const isDecryptingRef = useRef<boolean>(isDecrypting);
  const lastReqKeyRef = useRef<string>("");
  const instanceRef = useRef<FhevmInstance | undefined>(instance);

  useEffect(() => {
    instanceRef.current = instance;
  }, [instance]);

  // Deterministic key for the current requests - used for stale detection
  const requestsKey = useMemo(() => {
    if (!requests || requests.length === 0) {
      return "";
    }
    const sorted = [...requests].sort((a, b) =>
      (a.handle + a.contractAddress).localeCompare(b.handle + b.contractAddress)
    );
    return JSON.stringify(sorted);
  }, [requests]);

  /** True when all dependencies are ready and not already decrypting */
  const canDecrypt = useMemo(
    () =>
      Boolean(
        instance &&
          ethersSigner &&
          requests &&
          requests.length > 0 &&
          !isDecrypting
      ),
    [instance, ethersSigner, requests, isDecrypting]
  );

  /**
   * Trigger decryption of all requested handles.
   *
   * This is idempotent - calling while already decrypting does nothing.
   * Results are stored in `results` state, keyed by handle.
   */
  const decrypt = useCallback(() => {
    // Prevent concurrent decryption
    if (isDecryptingRef.current) {
      return;
    }
    if (!(instance && ethersSigner && requests) || requests.length === 0) {
      return;
    }

    // Capture current context for stale detection
    const thisChainId = chainId;
    const thisSigner = ethersSigner;
    const thisRequests = requests;

    // Capture the current requests key to avoid false "stale" detection on first run
    lastReqKeyRef.current = requestsKey;

    isDecryptingRef.current = true;
    setIsDecrypting(true);
    setMessage("Starting decryption...");
    setError(null);

    const run = async () => {
      // Check if chain/signer/requests changed since we started
      // This prevents applying stale results after user switches context
      const isStale = () =>
        thisChainId !== chainId ||
        thisSigner !== ethersSigner ||
        requestsKey !== lastReqKeyRef.current;

      const decryptWithMetrics = async (decryptParams: {
        instance: FhevmInstance;
        requests: Array<{ handle: string; contractAddress: string }>;
        signature: FhevmDecryptionSignature;
      }): Promise<Record<string, string | bigint | boolean>> => {
        const start = performance.now();
        let result: "ok" | "error" = "ok";
        try {
          return await decryptParams.instance.userDecrypt(
            decryptParams.requests,
            decryptParams.signature.privateKey,
            decryptParams.signature.publicKey,
            decryptParams.signature.signature,
            decryptParams.signature.contractAddresses,
            decryptParams.signature.userAddress,
            decryptParams.signature.startTimestamp,
            decryptParams.signature.durationDays
          );
        } catch (decryptError) {
          result = "error";
          throw decryptError;
        } finally {
          recordClientMetric({
            name: "client.fhevm.decrypt.duration",
            value: performance.now() - start,
            attributes: { result },
          });
        }
      };

      try {
        // Collect unique contracts for signature scope
        const uniqueAddresses = Array.from(
          new Set(thisRequests.map((r) => r.contractAddress))
        );

        const buildSignature = async (
          activeInstance: FhevmInstance
        ): Promise<FhevmDecryptionSignature | null> =>
          await FhevmDecryptionSignature.loadOrSign({
            instance: activeInstance,
            contractAddresses: uniqueAddresses as `0x${string}`[],
            signer: ethersSigner,
            storage: fhevmDecryptionSignatureStorage,
          });

        // Load cached signature or prompt user to sign (may show wallet popup)
        let sig: FhevmDecryptionSignature | null =
          await buildSignature(instance);

        if (!sig) {
          setMessage("Unable to build FHEVM decryption signature");
          setError("SIGNATURE_ERROR: Failed to create decryption signature");
          return;
        }

        if (isStale()) {
          setMessage("Decryption cancelled (stale request)");
          return;
        }

        setMessage("Calling FHEVM userDecrypt...");

        // Convert readonly requests to mutable for SDK
        const mutableReqs = thisRequests.map((r) => ({
          handle: r.handle,
          contractAddress: r.contractAddress,
        }));

        let res: Record<string, string | bigint | boolean> = {};
        try {
          const activeSig = sig;
          if (!activeSig) {
            setMessage("Unable to build FHEVM decryption signature");
            setError("SIGNATURE_ERROR: Failed to create decryption signature");
            return;
          }
          // Call SDK's userDecrypt - this contacts the Gateway/KMS
          res = await decryptWithMetrics({
            instance,
            requests: mutableReqs,
            signature: activeSig,
          });
        } catch (e) {
          const err = e as { name?: string; message?: string };
          const msg =
            err && typeof err === "object" && "message" in err
              ? err.message
              : "Decryption failed";

          // Gateway may reject cached signature if chain state changed
          // In this case, clear cache and re-sign
          const isInvalidSig =
            typeof msg === "string" &&
            msg.toLowerCase().includes("invalid eip-712 signature");

          if (isInvalidSig) {
            setMessage("Refreshing decryption signature...");
            const signatureForClear = sig;
            if (!signatureForClear) {
              setError(
                "SIGNATURE_ERROR: Failed to refresh decryption signature"
              );
              setMessage("FHEVM userDecrypt failed");
              return;
            }
            // Clear stale signature from cache
            await FhevmDecryptionSignature.clearFromGenericStringStorage({
              storage: fhevmDecryptionSignatureStorage,
              instance,
              contractAddresses: uniqueAddresses,
              userAddress: signatureForClear.userAddress,
            });

            // Get fresh signature (will prompt user to sign again)
            sig = await FhevmDecryptionSignature.loadOrSign({
              instance,
              contractAddresses: uniqueAddresses as `0x${string}`[],
              signer: ethersSigner,
              storage: fhevmDecryptionSignatureStorage,
            });

            if (!sig) {
              setError(
                "SIGNATURE_ERROR: Failed to refresh decryption signature"
              );
              setMessage("FHEVM userDecrypt failed");
              return;
            }

            // Retry with fresh signature
            try {
              const refreshedSig = sig;
              if (!refreshedSig) {
                setError(
                  "SIGNATURE_ERROR: Failed to refresh decryption signature"
                );
                setMessage("FHEVM userDecrypt failed");
                return;
              }
              res = await decryptWithMetrics({
                instance,
                requests: mutableReqs,
                signature: refreshedSig,
              });
            } catch (retryError) {
              const retryMsg =
                retryError &&
                typeof retryError === "object" &&
                "message" in retryError
                  ? String((retryError as { message?: string }).message)
                  : "Decryption failed";
              // Retry failed after an invalid signature; attempt instance refresh if available.
              if (refreshFhevmInstance) {
                setMessage("Refreshing FHEVM instance...");
                await refreshFhevmInstance();

                // Wait for provider refresh to create a NEW non-null instance.
                // The refresh sets instance to undefined first, then creates new one.
                // We need to wait until instanceRef has a DIFFERENT non-null instance.
                const start = Date.now();
                const REFRESH_TIMEOUT_MS = 5000; // 5 seconds for Hardhat RPC calls
                while (Date.now() - start < REFRESH_TIMEOUT_MS) {
                  const current = instanceRef.current;
                  // Wait until we have a non-null instance that's different from the old one
                  if (current && current !== instance) {
                    break;
                  }
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }

                const refreshedInstance = instanceRef.current;
                if (!refreshedInstance || refreshedInstance === instance) {
                  setError(`DECRYPT_ERROR: ${retryMsg}`);
                  setMessage("FHEVM SDK refresh timed out. Try again.");
                  return;
                }

                if (isStale()) {
                  setMessage("Decryption cancelled (stale request)");
                  return;
                }

                sig = await buildSignature(refreshedInstance);
                if (!sig) {
                  setError(
                    "SIGNATURE_ERROR: Failed to create signature after refresh"
                  );
                  setMessage("FHEVM userDecrypt failed");
                  return;
                }

                try {
                  const refreshedSig = sig;
                  if (!refreshedSig) {
                    setError(
                      "SIGNATURE_ERROR: Failed to create signature after refresh"
                    );
                    setMessage("FHEVM userDecrypt failed");
                    return;
                  }
                  res = await decryptWithMetrics({
                    instance: refreshedInstance,
                    requests: mutableReqs,
                    signature: refreshedSig,
                  });
                } catch (finalError) {
                  const finalMsg =
                    finalError &&
                    typeof finalError === "object" &&
                    "message" in finalError
                      ? String((finalError as { message?: string }).message)
                      : "Decryption failed";
                  setError(`DECRYPT_ERROR: ${finalMsg}`);
                  setMessage("FHEVM userDecrypt failed");
                  return;
                }
              } else {
                setError(`DECRYPT_ERROR: ${retryMsg}`);
                setMessage("FHEVM userDecrypt failed");
                return;
              }
            }
          } else {
            // Non-signature error - report and abort
            const code =
              err && typeof err === "object" && "name" in err
                ? err.name
                : "DECRYPT_ERROR";
            setError(`${code}: ${msg}`);
            setMessage("FHEVM userDecrypt failed");
            return;
          }
        }

        setMessage("FHEVM userDecrypt completed!");

        // Final stale check before applying results
        if (isStale()) {
          setMessage("Decryption cancelled (stale request)");
          return;
        }

        setResults(res);
      } catch (e) {
        const err = e as { name?: string; message?: string };
        const code =
          err && typeof err === "object" && "name" in err
            ? err.name
            : "UNKNOWN_ERROR";
        const msg =
          err && typeof err === "object" && "message" in err
            ? err.message
            : "Unknown error";
        setError(`${code}: ${msg}`);
        setMessage("FHE decryption errored");
      } finally {
        isDecryptingRef.current = false;
        setIsDecrypting(false);
        lastReqKeyRef.current = requestsKey;
      }
    };

    run().catch(() => {
      // Error handled via finally block state reset
    });
  }, [
    instance,
    ethersSigner,
    fhevmDecryptionSignatureStorage,
    chainId,
    requests,
    requestsKey,
    refreshFhevmInstance,
  ]);

  return {
    canDecrypt,
    decrypt,
    isDecrypting,
    message,
    results,
    error,
    setMessage,
    setError,
  } as const;
};
