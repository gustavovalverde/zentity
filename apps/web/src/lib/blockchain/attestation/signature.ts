import { type Hex, parseSignature } from "viem";

/**
 * Split a wallet signature into the `(v, r, s)` arguments the registry
 * contract expects. The ECDSA recovery on-chain only accepts `v` of 27 or 28,
 * so wallets that return a 0/1 parity byte are normalized.
 */
export function toContractSignature(signature: Hex) {
  const { r, s, v, yParity } = parseSignature(signature);
  return { r, s, v: Number(v ?? BigInt(yParity + 27)) };
}
