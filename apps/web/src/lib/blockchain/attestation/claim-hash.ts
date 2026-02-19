import "server-only";

import { BN254_FR_MODULUS } from "@aztec/bb.js";

import { getBarretenberg } from "@/lib/privacy/primitives/barretenberg";
import {
  HASH_TO_FIELD_INFO,
  hashToFieldHexFromHex,
} from "@/lib/privacy/zk/hash-to-field";

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

export async function getDocumentHashField(
  documentHashHex: string
): Promise<string> {
  return await hashToFieldHexFromHex(
    documentHashHex,
    HASH_TO_FIELD_INFO.DOCUMENT_HASH
  );
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
