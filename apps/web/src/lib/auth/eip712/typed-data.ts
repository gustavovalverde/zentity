import type { Eip712TypedData } from "./types";

import { verifyTypedData } from "viem";

const EIP712_DOMAIN_NAME = "Zentity";

export function buildWalletAuthTypedData(
  address: string,
  chainId: number,
  nonce: string
): Eip712TypedData {
  return {
    domain: { name: EIP712_DOMAIN_NAME, version: "1", chainId },
    types: {
      WalletAuth: [
        { name: "address", type: "address" },
        { name: "nonce", type: "string" },
      ],
    },
    primaryType: "WalletAuth",
    message: { address, nonce },
  };
}

export async function verifyEip712Signature(
  signature: string,
  typedData: Eip712TypedData,
  expectedAddress: string
): Promise<boolean> {
  try {
    return await verifyTypedData({
      ...typedData,
      address: expectedAddress as `0x${string}`,
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}
