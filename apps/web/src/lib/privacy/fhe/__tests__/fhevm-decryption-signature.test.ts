import type { FhevmInstance } from "@/lib/privacy/fhe/types";

import { type JsonRpcSigner, verifyTypedData, Wallet } from "ethers";
import { describe, expect, it } from "vitest";

import { FhevmDecryptionSignature } from "@/lib/privacy/fhe/fhevm-decryption-signature";
import { GenericStringInMemoryStorage } from "@/lib/privacy/fhe/signature-cache";

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

function createTestInstance(): FhevmInstance {
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
  } as unknown as FhevmInstance;
}

describe("FhevmDecryptionSignature", () => {
  it("generates a signature that verifies against the typed data", async () => {
    const instance = createTestInstance();
    const storage = new GenericStringInMemoryStorage();
    const wallet = Wallet.createRandom();
    const contractAddresses = ["0x5FbDB2315678afecb367f032d93F642f64180aa3"];

    const sig = await FhevmDecryptionSignature.loadOrSign({
      instance,
      contractAddresses,
      signer: wallet as unknown as JsonRpcSigner,
      storage,
    });

    expect(sig).not.toBeNull();
    if (!sig) {
      return;
    }

    const signatureData = sig.toJSON();
    const recovered = verifyTypedData(
      signatureData.eip712.domain,
      {
        UserDecryptRequestVerification:
          signatureData.eip712.types.UserDecryptRequestVerification,
      },
      signatureData.eip712.message,
      signatureData.signature
    );

    expect(recovered.toLowerCase()).toBe(wallet.address.toLowerCase());
  });

  it("normalizes contract addresses deterministically", async () => {
    const instance = createTestInstance();
    const storage = new GenericStringInMemoryStorage();
    const wallet = Wallet.createRandom();
    const contractAddresses = [
      "0x5fbdb2315678afecb367f032d93f642f64180aa3",
      "0x0000000000000000000000000000000000000002",
      "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    ];

    const sig = await FhevmDecryptionSignature.loadOrSign({
      instance,
      contractAddresses,
      signer: wallet as unknown as JsonRpcSigner,
      storage,
    });

    expect(sig).not.toBeNull();
    if (!sig) {
      return;
    }

    expect(sig.contractAddresses).toEqual([
      "0x0000000000000000000000000000000000000002",
      "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    ]);
  });

  it("reuses cached signatures from storage", async () => {
    const instance = createTestInstance();
    const storage = new GenericStringInMemoryStorage();
    const wallet = Wallet.createRandom();
    const contractAddresses = ["0x5FbDB2315678afecb367f032d93F642f64180aa3"];

    const first = await FhevmDecryptionSignature.loadOrSign({
      instance,
      contractAddresses,
      signer: wallet as unknown as JsonRpcSigner,
      storage,
    });
    const second = await FhevmDecryptionSignature.loadOrSign({
      instance,
      contractAddresses,
      signer: wallet as unknown as JsonRpcSigner,
      storage,
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!(first && second)) {
      return;
    }

    expect(first.signature).toBe(second.signature);
  });
});
