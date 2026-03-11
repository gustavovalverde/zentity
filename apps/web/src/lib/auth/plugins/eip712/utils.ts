import type { Eip712TypedData } from "./types";

import { recoverTypedDataAddress } from "viem";

const NONCE_PREFIX = "eip712";

export function nonceIdentifier(address: string, chainId: number): string {
  return `${NONCE_PREFIX}:${address.toLowerCase()}:${chainId}`;
}

export function buildDefaultTypedData(
  address: string,
  chainId: number,
  nonce: string,
  appName: string
): Eip712TypedData {
  return {
    domain: { name: appName, version: "1", chainId },
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
  const recovered = await recoverTypedDataAddress({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
    signature: signature as `0x${string}`,
  });
  return recovered.toLowerCase() === expectedAddress.toLowerCase();
}
