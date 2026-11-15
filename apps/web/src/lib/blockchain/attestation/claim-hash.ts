import "server-only";

import { bytesToHex } from "viem";

import {
  bigIntToFr,
  getBarretenberg,
} from "@/lib/privacy/primitives/barretenberg";
import {
  HASH_TO_FIELD_INFO,
  hashToFieldHexFromHex,
} from "@/lib/privacy/zk/hash-to-field";

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
  return bytesToHex(result.hash);
}
