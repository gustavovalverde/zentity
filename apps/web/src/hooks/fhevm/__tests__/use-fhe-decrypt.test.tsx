// @vitest-environment jsdom

import type { FhevmInstance } from "@/lib/privacy/fhe/types";

import { act, renderHook, waitFor } from "@testing-library/react";
import { type JsonRpcSigner, Wallet } from "ethers";
import { describe, expect, it } from "vitest";

import { useFHEDecrypt } from "@/hooks/fhevm/use-fhe-decrypt";
import { GenericStringInMemoryStorage } from "@/lib/privacy/fhe/signature-cache";

type HookProps = Parameters<typeof useFHEDecrypt>[0];

interface TestEip712 {
  domain: {
    chainId: number;
    name: string;
    verifyingContract: `0x${string}`;
    version: string;
  };
  message: {
    publicKey: string;
    contractAddresses: string[];
    contractsChainId: number;
    startTimestamp: number | string;
    durationDays: number | string;
    extraData: `0x${string}`;
  };
  primaryType: string;
  types: {
    [key: string]: { name: string; type: string }[];
  };
}

const TEST_CHAIN_ID = 31_337;
const VERIFYING_CONTRACT =
  "0x0000000000000000000000000000000000000001" as const;

function ensure0x(value: string): string {
  return value.startsWith("0x") ? value : `0x${value}`;
}

function createTestInstance(
  userDecryptImpl: FhevmInstance["userDecrypt"]
): FhevmInstance {
  const createEIP712 = (
    publicKey: string,
    contractAddresses: string[],
    startTimestamp: number | string,
    durationDays: number | string
  ): TestEip712 => ({
    domain: {
      name: "Decryption",
      version: "1",
      chainId: TEST_CHAIN_ID,
      verifyingContract: VERIFYING_CONTRACT,
    },
    primaryType: "UserDecryptRequestVerification",
    types: {
      UserDecryptRequestVerification: [
        { name: "publicKey", type: "bytes" },
        { name: "contractAddresses", type: "address[]" },
        { name: "contractsChainId", type: "uint256" },
        { name: "startTimestamp", type: "uint256" },
        { name: "durationDays", type: "uint256" },
        { name: "extraData", type: "bytes" },
      ],
    },
    message: {
      publicKey: ensure0x(publicKey),
      contractAddresses,
      contractsChainId: TEST_CHAIN_ID,
      startTimestamp,
      durationDays,
      extraData: "0x00",
    },
  });

  const generateKeypair = () => ({
    publicKey: `0x${"11".repeat(32)}`,
    privateKey: `0x${"22".repeat(32)}`,
  });

  return {
    createEIP712,
    generateKeypair,
    userDecrypt: userDecryptImpl,
  } as unknown as FhevmInstance;
}

describe("useFHEDecrypt", () => {
  it("decrypts handles and returns results", async () => {
    const handle = `0x${"11".repeat(32)}`;
    const wallet = new Wallet(`0x${"11".repeat(32)}`);
    const storage = new GenericStringInMemoryStorage();

    const instance = createTestInstance((handles) => {
      const handleKey = handles[0]?.handle as string;
      return Promise.resolve({
        [handleKey]: BigInt(42),
      });
    });

    const { result } = renderHook(() =>
      useFHEDecrypt({
        instance,
        ethersSigner: wallet as unknown as JsonRpcSigner,
        fhevmDecryptionSignatureStorage: storage,
        chainId: TEST_CHAIN_ID,
        requests: [{ handle, contractAddress: VERIFYING_CONTRACT }],
      })
    );

    act(() => {
      result.current.decrypt();
    });
    await waitFor(() =>
      expect(result.current.results[handle]).toBe(BigInt(42))
    );

    expect(result.current.error).toBeNull();
    expect(result.current.results[handle]).toBe(BigInt(42));
  });

  it("re-signs on invalid signature and succeeds on retry", async () => {
    const handle = `0x${"22".repeat(32)}`;
    const wallet = new Wallet(`0x${"22".repeat(32)}`);
    const storage = new GenericStringInMemoryStorage();
    let calls = 0;

    const instance = createTestInstance((handles) => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new Error("Invalid EIP-712 signature!"));
      }
      const handleKey = handles[0]?.handle as string;
      return Promise.resolve({
        [handleKey]: BigInt(7),
      });
    });

    const { result } = renderHook(() =>
      useFHEDecrypt({
        instance,
        ethersSigner: wallet as unknown as JsonRpcSigner,
        fhevmDecryptionSignatureStorage: storage,
        chainId: TEST_CHAIN_ID,
        requests: [{ handle, contractAddress: VERIFYING_CONTRACT }],
      })
    );

    act(() => {
      result.current.decrypt();
    });
    await waitFor(() => expect(result.current.results[handle]).toBe(BigInt(7)));

    expect(calls).toBe(2);
    expect(result.current.error).toBeNull();
    expect(result.current.results[handle]).toBe(BigInt(7));
  });

  it("refreshes the FHEVM instance after repeated invalid signatures", async () => {
    const handle = `0x${"33".repeat(32)}`;
    const wallet = new Wallet(`0x${"33".repeat(32)}`);
    const storage = new GenericStringInMemoryStorage();
    let firstCalls = 0;
    let secondCalls = 0;
    let refreshCalls = 0;

    const instance1 = createTestInstance(() => {
      firstCalls += 1;
      return Promise.reject(new Error("invalid eip-712 signature"));
    });

    const instance2 = createTestInstance((handles) => {
      secondCalls += 1;
      const handleKey = handles[0]?.handle as string;
      return Promise.resolve({
        [handleKey]: BigInt(9),
      });
    });

    let currentInstance = instance1;
    let rerenderHook: ((props?: HookProps) => void) | null = null;

    const baseProps: Omit<HookProps, "instance" | "refreshFhevmInstance"> = {
      ethersSigner: wallet as unknown as JsonRpcSigner,
      fhevmDecryptionSignatureStorage: storage,
      chainId: TEST_CHAIN_ID,
      requests: [{ handle, contractAddress: VERIFYING_CONTRACT }],
    };

    const refreshFhevmInstance = () => {
      refreshCalls += 1;
      currentInstance = instance2;
      const doRerender = rerenderHook;
      if (doRerender) {
        doRerender({
          ...baseProps,
          instance: currentInstance,
          refreshFhevmInstance,
        });
      }
    };

    const initialProps: HookProps = {
      ...baseProps,
      instance: currentInstance,
      refreshFhevmInstance,
    };

    const { result, rerender } = renderHook<
      ReturnType<typeof useFHEDecrypt>,
      HookProps
    >((props) => useFHEDecrypt(props), {
      initialProps,
    });

    rerenderHook = rerender;

    act(() => {
      result.current.decrypt();
    });
    await waitFor(() => expect(result.current.results[handle]).toBe(BigInt(9)));

    expect(firstCalls).toBe(2);
    expect(refreshCalls).toBe(1);
    expect(secondCalls).toBe(1);
    expect(result.current.error).toBeNull();
    expect(result.current.results[handle]).toBe(BigInt(9));
  });
});
