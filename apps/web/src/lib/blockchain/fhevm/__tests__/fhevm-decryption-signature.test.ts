import type { FhevmInstance } from "@/lib/blockchain/fhevm/types";

import { type JsonRpcSigner, verifyTypedData, Wallet } from "ethers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FhevmDecryptionSignature } from "@/lib/blockchain/fhevm/fhevm-decryption-signature";
import { GenericStringInMemoryStorage } from "@/lib/blockchain/fhevm/signature-cache";

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
    nonce?: string;
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
const NONCE_HEX_32_BYTES = /^0x[0-9a-f]{64}$/;

function ensure0x(value: string): string {
  return value.startsWith("0x") ? value : `0x${value}`;
}

function createTestInstance(
  chainId = TEST_CHAIN_ID,
  verifyingContract: `0x${string}` = VERIFYING_CONTRACT
): FhevmInstance {
  const createEIP712 = (
    publicKey: string,
    contractAddresses: string[],
    startTimestamp: number | string,
    durationDays: number | string,
    nonce?: string
  ): TestEip712 => ({
    domain: {
      name: "Decryption",
      version: "1",
      chainId,
      verifyingContract,
    },
    primaryType: "UserDecryptRequestVerification",
    types: {
      UserDecryptRequestVerification: [
        { name: "publicKey", type: "bytes" },
        { name: "contractAddresses", type: "address[]" },
        { name: "contractsChainId", type: "uint256" },
        { name: "startTimestamp", type: "uint256" },
        { name: "durationDays", type: "uint256" },
        { name: "nonce", type: "bytes32" },
        { name: "extraData", type: "bytes" },
      ],
    },
    message: {
      publicKey: ensure0x(publicKey),
      contractAddresses,
      contractsChainId: TEST_CHAIN_ID,
      startTimestamp,
      durationDays,
      nonce,
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
  beforeEach(() => {
    vi.useRealTimers();
  });

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
        UserDecryptRequestVerification: [
          ...(signatureData.eip712.types.UserDecryptRequestVerification ?? []),
        ],
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

  it("does not treat exact expiry boundary as valid", async () => {
    vi.useFakeTimers();
    try {
      const instance = createTestInstance();
      const storage = new GenericStringInMemoryStorage();
      const wallet = Wallet.createRandom();
      const contractAddresses = ["0x5FbDB2315678afecb367f032d93F642f64180aa3"];

      const fixedStart = new Date("2025-01-01T00:00:00.000Z");
      vi.setSystemTime(fixedStart);

      const initial = await FhevmDecryptionSignature.loadOrSign({
        instance,
        contractAddresses,
        signer: wallet as unknown as JsonRpcSigner,
        storage,
      });
      expect(initial).not.toBeNull();
      if (!initial) {
        return;
      }

      const stored =
        await FhevmDecryptionSignature.loadFromGenericStringStorage({
          storage,
          instance,
          contractAddresses,
          userAddress: wallet.address,
        });
      expect(stored).not.toBeNull();

      const exactExpiryMs =
        initial.startTimestamp * 1000 +
        initial.durationDays * 24 * 60 * 60 * 1000;
      vi.setSystemTime(new Date(exactExpiryMs));

      const expired =
        await FhevmDecryptionSignature.loadFromGenericStringStorage({
          storage,
          instance,
          contractAddresses,
          userAddress: wallet.address,
        });
      expect(expired).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("separates cached signatures by EIP-712 domain (chain/verifying contract)", async () => {
    const storage = new GenericStringInMemoryStorage();
    const wallet = Wallet.createRandom();
    const contractAddresses = ["0x5FbDB2315678afecb367f032d93F642f64180aa3"];

    const domainA = createTestInstance(
      TEST_CHAIN_ID,
      "0x0000000000000000000000000000000000000001"
    );
    const domainB = createTestInstance(
      TEST_CHAIN_ID + 1,
      "0x0000000000000000000000000000000000000002"
    );

    const first = await FhevmDecryptionSignature.loadOrSign({
      instance: domainA,
      contractAddresses,
      signer: wallet as unknown as JsonRpcSigner,
      storage,
    });
    const crossLookup =
      await FhevmDecryptionSignature.loadFromGenericStringStorage({
        storage,
        instance: domainB,
        contractAddresses,
        userAddress: wallet.address,
      });

    const second = await FhevmDecryptionSignature.loadOrSign({
      instance: domainB,
      contractAddresses,
      signer: wallet as unknown as JsonRpcSigner,
      storage,
    });
    const secondFromStorage =
      await FhevmDecryptionSignature.loadFromGenericStringStorage({
        storage,
        instance: domainB,
        contractAddresses,
        userAddress: wallet.address,
      });

    const firstFromStorage =
      await FhevmDecryptionSignature.loadFromGenericStringStorage({
        storage,
        instance: domainA,
        contractAddresses,
        userAddress: wallet.address,
      });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!(first && second)) {
      return;
    }
    expect(crossLookup).toBeNull();
    expect(first.signature).not.toBe(second.signature);
    expect(firstFromStorage?.signature).toBe(first.signature);
    expect(secondFromStorage?.signature).toBe(second.signature);
  });

  it("binds signatures to a per-authorization nonce in the EIP-712 message", async () => {
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

    const payload = sig.toJSON();
    expect(payload.nonce).toMatch(NONCE_HEX_32_BYTES);
    expect(payload.eip712.message.nonce).toBe(payload.nonce);
  });

  it("rejects signatures when EIP-712 domain is missing chain/verifying contract binding", async () => {
    const storage = new GenericStringInMemoryStorage();
    const wallet = Wallet.createRandom();
    const contractAddresses = ["0x5FbDB2315678afecb367f032d93F642f64180aa3"];
    const invalidDomainInstance = createTestInstance(
      0,
      "0x0000000000000000000000000000000000000000"
    );

    const sig = await FhevmDecryptionSignature.loadOrSign({
      instance: invalidDomainInstance,
      contractAddresses,
      signer: wallet as unknown as JsonRpcSigner,
      storage,
    });

    expect(sig).toBeNull();
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
