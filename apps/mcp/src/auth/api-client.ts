import { getAuthContext } from "./context.js";
import type { DpopKeyPair } from "./dpop.js";
import { createDpopProof, extractDpopNonce } from "./dpop.js";

let dpopNonce: string | undefined;

export async function zentityFetch(
  url: string,
  dpopKey: DpopKeyPair,
  options?: { method?: string; body?: string }
): Promise<Response> {
  const method = options?.method ?? "GET";
  const auth = getAuthContext();

  let proof = await createDpopProof(
    dpopKey,
    method,
    url,
    auth.accessToken,
    dpopNonce
  );

  const headers: Record<string, string> = {
    Authorization: `DPoP ${auth.accessToken}`,
    DPoP: proof,
  };
  if (options?.body) {
    headers["Content-Type"] = "application/json";
  }

  let response = await fetch(url, {
    method,
    headers,
    body: options?.body,
  });

  // DPoP nonce retry
  const newNonce = extractDpopNonce(response);
  if (
    newNonce &&
    dpopNonce !== newNonce &&
    (response.status === 400 || response.status === 401)
  ) {
    dpopNonce = newNonce;
    proof = await createDpopProof(
      dpopKey,
      method,
      url,
      auth.accessToken,
      dpopNonce
    );
    headers.DPoP = proof;
    response = await fetch(url, {
      method,
      headers,
      body: options?.body,
    });
  }
  dpopNonce = extractDpopNonce(response) ?? dpopNonce;

  return response;
}
