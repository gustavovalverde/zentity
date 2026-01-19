import "server-only";

import { BN254_FR_MODULUS } from "@aztec/bb.js";

import { getBarretenberg } from "@/lib/privacy/crypto/barretenberg";

type Fr = Uint8Array;

function bigIntToFr(value: bigint): Fr {
  const reduced = value % BN254_FR_MODULUS;
  const hex = reduced.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function frToHex(fr: Fr): string {
  const hex = Array.from(fr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
}

export function getDocumentHashField(documentHashHex: string): string {
  const normalized = documentHashHex.startsWith("0x")
    ? documentHashHex.slice(2)
    : documentHashHex;
  const hashBigInt = BigInt(`0x${normalized}`);
  const reduced = hashBigInt % BN254_FR_MODULUS;
  return frToHex(bigIntToFr(reduced));
}

export async function computeClaimHash(args: {
  value: number | bigint;
  documentHashField: string;
}): Promise<string> {
  const bb = await getBarretenberg();
  const valueBigInt =
    typeof args.value === "bigint" ? args.value : BigInt(args.value);
  const documentHashBigInt = BigInt(args.documentHashField);
  const result = await bb.poseidon2Hash({
    inputs: [bigIntToFr(valueBigInt), bigIntToFr(documentHashBigInt)],
  });
  return frToHex(result.hash);
}
