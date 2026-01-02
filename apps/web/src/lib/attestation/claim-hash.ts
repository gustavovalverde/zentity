import "server-only";

import { BarretenbergSync, Fr } from "@aztec/bb.js";

let bbInstance: BarretenbergSync | null = null;

async function getBarretenberg(): Promise<BarretenbergSync> {
  if (!bbInstance) {
    bbInstance = await BarretenbergSync.initSingleton();
  }
  return bbInstance;
}

function frToHex(fr: Fr): string {
  return fr.toString();
}

function normalizeToFr(value: bigint): Fr {
  return new Fr(value);
}

export function getDocumentHashField(documentHashHex: string): string {
  const normalized = documentHashHex.startsWith("0x")
    ? documentHashHex.slice(2)
    : documentHashHex;
  const hashBigInt = BigInt(`0x${normalized}`);
  const reduced = hashBigInt % Fr.MODULUS;
  return frToHex(normalizeToFr(reduced));
}

export async function computeClaimHash(args: {
  value: number | bigint;
  documentHashField: string;
}): Promise<string> {
  const bb = await getBarretenberg();
  const valueBigInt =
    typeof args.value === "bigint" ? args.value : BigInt(args.value);
  const documentHashBigInt = BigInt(args.documentHashField);
  const result = bb.poseidon2Hash([
    normalizeToFr(valueBigInt),
    normalizeToFr(documentHashBigInt),
  ]);
  return frToHex(result);
}
