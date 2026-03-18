import { getAuthContext } from "./context.js";
import { createDpopProof, extractDpopNonce } from "./dpop.js";

const dpopNonces = new Map<string, string>();

export async function zentityFetch(
  url: string,
  options?: { method?: string; body?: string }
): Promise<Response> {
  const method = options?.method ?? "GET";
  const auth = getAuthContext();

  const nonceKey = auth.loginHint;
  const dpopNonce = dpopNonces.get(nonceKey);

  let proof = await createDpopProof(
    auth.dpopKey,
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

  const fetchBody = options?.body;
  let response = await fetch(url, {
    method,
    headers,
    ...(fetchBody ? { body: fetchBody } : {}),
  });

  // DPoP nonce retry
  const newNonce = extractDpopNonce(response);
  if (
    newNonce &&
    dpopNonce !== newNonce &&
    (response.status === 400 || response.status === 401)
  ) {
    dpopNonces.set(nonceKey, newNonce);
    proof = await createDpopProof(
      auth.dpopKey,
      method,
      url,
      auth.accessToken,
      newNonce
    );
    headers.DPoP = proof;
    response = await fetch(url, {
      method,
      headers,
      ...(fetchBody ? { body: fetchBody } : {}),
    });
  }
  const finalNonce = extractDpopNonce(response);
  if (finalNonce) {
    dpopNonces.set(nonceKey, finalNonce);
  }

  return response;
}
