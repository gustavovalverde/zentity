import { createDpopClientFromKeyPair, type DpopKeyPair } from "@zentity/sdk/rp";

export type { DpopKeyPair } from "@zentity/sdk/rp";

export async function createDpopProof(
  dpopKey: DpopKeyPair,
  method: string,
  url: string,
  accessToken?: string,
  nonce?: string
): Promise<string> {
  return (await createDpopClientFromKeyPair(dpopKey)).proofFor(
    method.toUpperCase(),
    url,
    accessToken,
    nonce
  );
}

export function extractDpopNonce(response: Response): string | undefined {
  return response.headers.get("dpop-nonce") ?? undefined;
}
